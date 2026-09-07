const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
;(async () => {
  const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'})
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000}})
    const page = await context.newPage(), errors=[], translations=[], writes=[]
    page.setDefaultTimeout(12000)
    page.on('pageerror', error=>errors.push(error.message))
    page.on('dialog', dialog=>dialog.accept())
    let running=null, documentLoads=0, failTranslation=false
    const start=new Date();start.setHours(9,0,0,0)
    const entries=[
      {record_id:'cn',fields:{user:'alice',description:'客户沟通',category:'会议',country:'中国',notes:'第一行备注\n第二行备注',start_time:+start,end_time:+start+3600000}},
      {record_id:'en',fields:{user:'alice',description:'Client review',category:'培训',country:'美国',notes:'English notes',start_time:+start+7200000,end_time:+start+9000000}},
    ]
    const dictionary={'客户沟通':'Client discussion','会议':'Meeting','培训':'Training','第一行备注\n第二行备注':'First line of notes\nSecond line of notes','Client review':'客户评审','English notes':'英文备注','持续计时':'Ongoing task','修改标题':'Edited title','新备注':'New notes'}
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url())
      if(url.hostname==='127.0.0.1'){if(request.resourceType()==='document')documentLoads++;return route.continue()}
      if(!url.hostname.endsWith('.tencentscf.com'))return route.abort()
      const body=request.postDataJSON(),method=request.method();let data={},status=200
      if(method==='OPTIONS')data={}
      else if(url.pathname==='/login')data={ok:true,user:'alice',display_name:'Alice',role:'admin',team:'测试团队'}
      else if(url.pathname==='/entries')data={items:entries}
      else if(url.pathname==='/categories')data={items:[{record_id:'c1',name:'会议',color:'#10b981',team:'测试团队'},{record_id:'c2',name:'培训',color:'#6366f1',team:'测试团队'}]}
      else if(url.pathname==='/teams')data={items:[{record_id:'t1',name:'测试团队'}]}
      else if(url.pathname==='/teams/members')data={items:[{record_id:'u1',username:'alice',display_name:'Alice',team:'测试团队',role:'member'}]}
      else if(url.pathname==='/countries')data={items:[{record_id:'cn',name:'中国',code:'CN'},{record_id:'us',name:'美国',code:'US'}]}
      else if(url.pathname==='/timer/active')data=running?{active:true,...running}:{active:false}
      else if(url.pathname==='/timer/start') {
        running={...body,record_id:'timer',start_time:Date.now()};writes.push({timerStart:body});data=running
      }
      else if(url.pathname==='/timer/stop') {writes.push({timerStop:body});running=null;data={ok:true,end_time:Date.now()}}
      else if(url.pathname==='/translate'){
        translations.push(body)
        await new Promise(resolve=>setTimeout(resolve,40))
        if(failTranslation){status=502;data={error:'Translation temporarily unavailable'}}
        else data={text:dictionary[body.text] || (body.to==='en'?'Translated content':'翻译内容')}
      } else if(url.pathname.startsWith('/entries/') && method==='PUT'){
        writes.push(body);const entry=entries.find(e=>e.record_id===url.pathname.split('/').at(-1));entry.fields={...entry.fields,...body.fields};data={record:entry}
      } else {status=404;data={error:'Unexpected mock route: '+url.pathname}}
      await route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)})
    })
    await page.goto(process.env.TEST_SITE || 'http://127.0.0.1:5174/time-tracking/')
    await page.locator('.auth-card select').selectOption('en')
    assert.equal(await page.locator('html').getAttribute('lang'),'en')
    await page.getByPlaceholder('Your username').fill('alice')
    await page.getByPlaceholder('Your password').fill('password')
    await page.getByRole('button',{name:'Log in',exact:true}).click()
    await page.locator('.week-view').waitFor()
    const changeLanguage=lang=>page.locator('.sidebar-footer .language-picker select').selectOption(lang)
    const nav=label=>page.locator('.nav-item').filter({hasText:label}).click()
    const missing={}
    for(const label of ['Dashboard','Reports','Settings']){
      await nav(label);await page.locator('.page-title').filter({hasText:label}).waitFor()
      if(label==='Dashboard') {
        await page.locator('.cat-name').filter({hasText:'Meeting'}).waitFor()
        await page.locator('.cat-name').filter({hasText:'Training'}).waitFor()
      }
      if(label==='Reports'){
        await page.getByText('Client discussion',{exact:true}).first().waitFor()
        await page.locator('.detail-row').filter({hasText:'Client discussion'}).click()
        await page.getByText('First line of notes\nSecond line of notes',{exact:true}).waitFor()
        assert(await page.locator('.detail-expanded').getByText('China',{exact:true}).isVisible())
        assert.equal(await page.locator('.detail-row').filter({hasText:'Client review'}).locator('.cat-dot').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(99, 102, 241)')
        await page.getByRole('button',{name:'Edit entry',exact:true}).click()
        assert.equal(await page.locator('.modal-mask input').first().inputValue(),'客户沟通')
        assert.equal(await page.locator('.modal-mask textarea').inputValue(),'第一行备注\n第二行备注')
        await page.getByRole('button',{name:'Save',exact:true}).click()
        await page.locator('.modal-mask').waitFor({state:'hidden'})

        assert.equal(writes.at(-1).fields.description,'客户沟通')
        const downloadPromise=page.waitForEvent('download')
        await page.getByRole('button',{name:'⬇ Export CSV',exact:true}).click()
        const download=await downloadPromise;const csv=fs.readFileSync(await download.path(),'utf8')
        assert(csv.includes('Task title'));assert(csv.includes('客户沟通'));assert(csv.includes('第一行备注'))
        await page.getByRole('combobox',{name:'Comparison object A',exact:true}).selectOption('会议')
        await page.getByRole('combobox',{name:'Comparison object B',exact:true}).selectOption('培训')
        assert.deepEqual(await page.locator('.comparison .hours').allTextContents(),['1h 0m','0h 30m'])
        assert((await page.locator('.difference').innerText()).includes('+100.0%'))
        await page.locator('.report-filters select').first().selectOption('培训')
        assert.equal(await page.locator('.detail-row:not(.detail-header)').count(),1)
        assert.deepEqual(await page.locator('.comparison .hours').allTextContents(),['1h 0m','0h 30m'])
        await page.getByRole('button',{name:'Clear filters',exact:true}).click()
        await page.getByRole('combobox',{name:'Compare by',exact:true}).selectOption('period')
        for (const [index,date] of ['2000-01-01','2000-01-02'].entries()) {
          await page.locator('.date-inputs input').nth(index*2).fill(date)
          await page.locator('.date-inputs input').nth(index*2+1).fill(date)
        }
        assert((await page.locator('.difference').innerText()).includes('B is zero'))
      }
      if(label==='Settings'){
        await page.getByRole('radio',{name:'Light mode'}).check()
        await page.getByText('Meeting',{exact:true}).first().waitFor()
      }
      missing[label]=await page.locator('.main-content').evaluate(el=>el.innerText.split('\n').filter(s=>/[\u3400-\u9fff]/.test(s) && !s.includes('测试团队') && s!=='简体中文'))
      await page.screenshot({path:path.join(__dirname,`../../artifacts/i18n-${label.toLowerCase()}.png`),fullPage:true,animations:'disabled'})
    }
    const before=translations.filter(t=>t.text==='客户沟通').length
    await nav('Views')
    await page.locator('.switch-btn').filter({hasText:'List view'}).click()
    await page.getByText('Client discussion',{exact:true}).first().waitFor()
    await changeLanguage('zh')
    await page.getByText('客户沟通',{exact:true}).first().waitFor()
    await page.getByText('客户评审',{exact:true}).first().waitFor()
    await changeLanguage('en')
    await page.getByText('Client discussion',{exact:true}).first().waitFor()
    assert.equal(translations.filter(t=>t.text==='客户沟通').length,before)
    assert.equal(documentLoads,1,'Language switching must not reload the page')
    await page.getByText('Client discussion',{exact:true}).first().click()
    assert.equal(await page.locator('.modal-mask input').first().inputValue(),'客户沟通')
    assert.equal(await page.locator('.modal-mask textarea').inputValue(),'第一行备注\n第二行备注')
    const country=page.getByRole('combobox',{name:'Country',exact:true})
    assert.equal(await country.inputValue(),'China')
    await country.fill('United')
    await page.getByRole('option',{name:'United States US'}).click()
    await page.locator('.modal-mask input').first().fill('修改标题')
    await page.locator('.modal-mask textarea').fill('新备注')
    await page.getByRole('button',{name:'Save',exact:true}).click()
    await page.getByText('Edited title',{exact:true}).waitFor()
    assert.equal(writes.at(-1).fields.description,'修改标题')
    assert.equal(writes.at(-1).fields.notes,'新备注')
    assert.equal(writes.at(-1).fields.country,'美国')
    await nav('Settings')
    await page.getByLabel('Show original task content').check()
    await nav('Views')
    await page.locator('.switch-btn').filter({hasText:'List view'}).click()
    await page.getByText('修改标题',{exact:true}).waitFor()
    await nav('Settings');await page.getByLabel('Show original task content').uncheck()
    await page.reload();await page.locator('.settings-view').waitFor()
    assert.equal(await page.locator('html').getAttribute('lang'),'en')
    assert(await page.getByRole('radio',{name:'Light mode'}).isChecked())
    failTranslation=true
    await nav('Views');await page.locator('.switch-btn').filter({hasText:'List view'}).click()
    await page.getByText('修改标题',{exact:true}).waitFor()
    await page.screenshot({path:path.join(__dirname,'../../artifacts/i18n-fallback.png'),animations:'disabled'})
    failTranslation=false
    await page.evaluate(()=>{localStorage.setItem('tt_role','member');localStorage.setItem('tt_current_page','day')})
    await page.reload();await page.locator('.day-view').waitFor()
    await page.locator('.timer-start').click()
    await page.getByPlaceholder('What are you working on?').fill('持续计时')
    await page.getByRole('button',{name:'Confirm start',exact:true}).click()
    await page.locator('.timer-desc').filter({hasText:'Ongoing task'}).waitFor()
    const started=running.start_time,loadsBefore=documentLoads
    await changeLanguage('zh');await page.locator('.timer-desc').filter({hasText:'持续计时'}).waitFor()
    await changeLanguage('en');await page.locator('.timer-desc').filter({hasText:'Ongoing task'}).waitFor()
    assert.equal(running.start_time,started)
    assert.equal(writes.filter(w=>w.timerStart).length,1)
    assert.equal(documentLoads,loadsBefore)
    assert.equal(await page.locator('.day-view .dow').innerText(),new Intl.DateTimeFormat('en',{weekday:'long'}).format(new Date()))
    await page.locator('.switch-arrow').click()
    await page.locator('.dropdown-item').filter({hasText:'Week view'}).click()
    await page.locator('.week-view').waitFor()
    assert.deepEqual(await page.locator('.dow').allTextContents(),['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])
    await page.screenshot({path:path.join(__dirname,'../../artifacts/i18n-week.png'),animations:'disabled'})
    await page.locator('.timer-stop').click();await page.locator('.timer-start').waitFor()
    await page.evaluate(()=>{localStorage.setItem('tt_role','team_admin');localStorage.setItem('tt_current_page','settings')})
    await page.reload();await page.locator('.settings-view').waitFor()
    assert.equal(await page.getByRole('button',{name:'Create team',exact:true}).count(),0)
    assert.equal(await page.getByRole('textbox',{name:'Original category name'}).count(),2)
    assert.deepEqual(errors,[])
    for(const [pageName,strings] of Object.entries(missing))assert.deepEqual(strings,[],pageName+' has untranslated UI: '+strings)
    fs.writeFileSync(path.join(__dirname,'../../artifacts/i18n-browser.json'),JSON.stringify({errors,translations,writes,missing},null,2))
    console.log('PASS: English UI, 3 pages, bilingual content, multiline notes, caching, original edits, country values, CSV, persistence, failure fallback')
  } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
