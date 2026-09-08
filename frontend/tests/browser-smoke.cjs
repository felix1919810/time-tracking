// Run with PLAYWRIGHT_MODULE_PATH pointing to an installed playwright package.
// Only the local dev server is accessed; every remote API call is mocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
;(async () => {
  fs.mkdirSync(path.join(__dirname,'../../artifacts'),{recursive:true})
  const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'})
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000}})
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const errors=[], notices=[], requests=[]
    page.on('pageerror', e => errors.push(e.message))
    page.on('dialog', async d => { notices.push(d.message()); await d.accept() })
    const today = new Date(); today.setHours(9,0,0,0)
    let rows = Array.from({length:500},(_,i)=>({record_id:'old-'+i,fields:{user:'alice',description:'历史记录'+i,category:'会议',start_time:today.getTime()-86400000*40,end_time:today.getTime()-86400000*40+60000}}))
    rows.push({record_id:'second-page',fields:{user:'alice',description:'第二页验证记录',category:'会议',start_time:today.getTime(),end_time:today.getTime()+3600000,country:'中国',notes:'备注验证'}})
    let running = null, failStop = false, failWrite = false, signedIn = 'alice'
    await page.route('**/*', async route => {
      const url=new URL(route.request().url())
      if(url.hostname==='127.0.0.1') return route.continue()
      if(!url.hostname.endsWith('.tencentscf.com')) return route.abort()
      const request=route.request(), method=request.method(), body=request.postDataJSON()
      requests.push(method+' '+url.pathname+url.search)
      let data, status=200
      if(method==='OPTIONS') data={}
      else if(url.pathname==='/login' || url.pathname==='/auth/me') { signedIn=body?.username || signedIn; data={ok:true,user:signedIn,display_name:signedIn==='alice'?'Alice':'Bob',role:'member',team:'测试团队',session_token:'mock-session'} }
      else if(url.pathname==='/entries' && method==='GET') data={items:url.searchParams.has('page_token')?rows.slice(500):rows.slice(0,500),has_more:!url.searchParams.has('page_token')&&rows.length>500,page_token:'page-2'}
      else if(url.pathname==='/categories') data={items:[{name:'会议',color:'#10b981',team:'测试团队'}]}
      else if(url.pathname==='/teams') data={items:[{name:'测试团队'}]}
      else if(url.pathname==='/teams/members') data={items:[{username:'alice',display_name:'Alice',team:'测试团队',role:'member'}]}
      else if(url.pathname==='/countries') data={items:[{name:'中国',code:'CN'}]}
      else if(url.pathname==='/timer/active') data=running?{active:true,...running}: {active:false}
      else if(url.pathname==='/timer/start') {
        await new Promise(r=>setTimeout(r,150))
        running={record_id:'running',start_time:Date.now(),...body}
        rows.push({record_id:'running',fields:{...body,start_time:running.start_time,end_time:null}})
        data=running
      } else if(url.pathname==='/timer/stop') {
        if(failStop){status=500;data={error:'模拟停止失败'}}
        else {data={ok:true,end_time:Date.now()};rows=rows.map(r=>r.record_id===body.record_id?{...r,fields:{...r.fields,end_time:data.end_time}}:r);running=null}
      } else if(url.pathname.startsWith('/entries/') && ['PUT','DELETE'].includes(method)) {
        if(failWrite){status=500;data={error:'模拟写入失败'}}
        else {const id=url.pathname.split('/').at(-1);if(method==='DELETE'){rows=rows.filter(r=>r.record_id!==id);data={ok:true}}else{const old=rows.find(r=>r.record_id===id);const record={...old,fields:{...old.fields,...body.fields}};rows=rows.map(r=>r.record_id===id?record:r);data={record}}}
      } else { status=404;data={error:'Unexpected mock route: '+url.pathname} }
      await route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)})
    })
    await page.goto(process.env.TEST_SITE || 'http://127.0.0.1:5173/time-tracking/')
    await page.getByPlaceholder('您的用户名').fill('alice')
    await page.getByPlaceholder('您的密码').fill('password')
    await page.getByRole('button',{name:'登录',exact:true}).click()
    await page.getByText('第二页验证记录',{exact:true}).first().waitFor()
    const entryReadsBeforeSwitch=requests.filter(r=>r.startsWith('GET /entries')).length
    assert(requests.some(r=>r.includes('page_token=page-2')))
    await page.locator('.switch-arrow').click()
    await page.locator('.dropdown-item').filter({hasText:'日视图'}).click()
    await page.getByText('第二页验证记录',{exact:true}).first().waitFor()
    assert.equal(requests.filter(r=>r.startsWith('GET /entries')).length,entryReadsBeforeSwitch)
    await page.locator('.timer-start').click()
    await page.getByPlaceholder('你在做什么？').fill('日视图计时验证')
    await page.getByRole('button',{name:'确认开始'}).click()
    await page.locator('.day-view .entry').filter({hasText:'日视图计时验证'}).waitFor()
    failStop=true
    await page.locator('.timer-stop').click()
    await page.waitForFunction(() => !document.querySelector('.timer-stop')?.disabled)
    assert(notices.some(m=>m.includes('停止计时失败')))
    assert(await page.locator('.timer-stop').isVisible())
    failStop=false
    await page.locator('.timer-stop').click()
    await page.locator('.timer-start').waitFor()
    await page.locator('.switch-btn').filter({hasText:'列表视图'}).click()
    await page.getByText('日视图计时验证',{exact:true}).first().waitFor()
    failWrite=true
    await page.getByText('第二页验证记录',{exact:true}).first().click()
    await page.locator('.modal-mask input').first().fill('应当回滚的修改')
    await page.getByRole('button',{name:'保存',exact:true}).click()
    await page.getByText('第二页验证记录',{exact:true}).first().waitFor()
    assert(notices.some(m=>m.includes('保存失败')))
    assert.equal(await page.locator('.modal-mask input').first().inputValue(),'应当回滚的修改')
    await page.getByRole('button',{name:'取消',exact:true}).click()
    await page.getByText('第二页验证记录',{exact:true}).first().click()
    await page.getByRole('button',{name:'删除',exact:true}).click()
    await page.getByText('第二页验证记录',{exact:true}).first().waitFor()
    assert(notices.some(m=>m.includes('删除失败')))
    failWrite=false
    await page.getByText('第二页验证记录',{exact:true}).first().click()
    assert.equal(await page.locator('.modal-mask textarea').inputValue(),'备注验证')
    await page.locator('.modal-mask textarea').fill('修改后的备注')
    await Promise.all([
      page.waitForResponse(r=>r.request().method()==='PUT'),
      page.getByRole('button',{name:'保存',exact:true}).click(),
    ])
    assert.equal(rows.find(r=>r.record_id==='second-page').fields.notes,'修改后的备注')
    for(const label of ['仪表盘','报表','设置']) {
      await page.locator('.nav-item').filter({hasText:label}).click()
      await page.locator('.page-title').filter({hasText:label}).waitFor()
    }
    // Theme changes apply globally and survive page navigation and reloads.
    assert(await page.getByRole('radio',{name:'深色模式'}).isChecked())
    await page.getByRole('radio',{name:'浅色模式'}).check()
    const readTheme = () => page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      saved: localStorage.getItem('tt_theme'),
      scheme: getComputedStyle(document.documentElement).colorScheme,
      surface: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
    }))
    assert.deepEqual(await readTheme(),{theme:'light',saved:'light',scheme:'light',surface:'rgb(255, 255, 255)'})
    await page.screenshot({path:path.join(__dirname,'../../artifacts/settings-light.png'),fullPage:true,animations:'disabled'})
    await page.reload()
    await page.getByRole('radio',{name:'浅色模式'}).waitFor()
    assert(await page.getByRole('radio',{name:'浅色模式'}).isChecked())
    for(const label of ['仪表盘','报表']) {
      await page.locator('.nav-item').filter({hasText:label}).click()
      await page.locator('.page-title').filter({hasText:label}).waitFor()
      assert.equal((await readTheme()).theme,'light')
    }
    await page.locator('.nav-item').filter({hasText:'设置'}).click()
    await page.getByRole('radio',{name:'深色模式'}).check()
    assert.deepEqual(await readTheme(),{theme:'dark',saved:'dark',scheme:'dark',surface:'rgb(20, 28, 40)'})
    await page.reload()
    await page.getByRole('radio',{name:'深色模式'}).waitFor()
    assert(await page.getByRole('radio',{name:'深色模式'}).isChecked())
    await page.screenshot({path:path.join(__dirname,'../../artifacts/settings-dark.png'),fullPage:true,animations:'disabled'})
    await page.locator('.nav-item').filter({hasText:'视图'}).click()
    await page.getByText('第二页验证记录',{exact:true}).first().waitFor()
    await page.locator('.collapse-btn').click()
    await page.waitForFunction(() => Math.abs(document.querySelector('.sidebar').getBoundingClientRect().right - document.querySelector('.week-toolbar, .day-toolbar, .list-toolbar').getBoundingClientRect().left) < 2)
    const layout=await page.evaluate(()=>({sidebar:document.querySelector('.sidebar').getBoundingClientRect().right,toolbar:document.querySelector('.week-toolbar, .day-toolbar, .list-toolbar').getBoundingClientRect().left}))
    assert(Math.abs(layout.sidebar-layout.toolbar)<5)
    await page.locator('.cal').evaluate(el=>{el.scrollTop=8*80})
    await page.screenshot({path:path.join(__dirname,'../../artifacts/smoke-week.png'),fullPage:true})
    await page.locator('.collapse-btn').click()
    await page.getByRole('button',{name:'退出登录',exact:true}).click()
    await page.getByPlaceholder('您的用户名').fill('bob')
    await page.getByPlaceholder('您的密码').fill('password')
    await page.getByRole('button',{name:'登录',exact:true}).click()
    await page.locator('.week-view, .day-view, .list-view').waitFor()
    assert.equal(await page.getByText('第二页验证记录',{exact:true}).count(),0)
    // Malformed persisted JSON and obsolete page names must not white-screen.
    await page.evaluate(() => {
      localStorage.setItem('tt_categories','{broken')
      localStorage.setItem('tt_countries','{broken')
      localStorage.setItem('tt_all_categories','{broken')
      localStorage.setItem('tt_current_page','obsolete')
    })
    await page.reload()
    await page.locator('.week-view').waitFor()
    console.log('Runtime errors:',JSON.stringify(errors))
    assert.deepEqual(errors,[])
    console.log('PASS: 501条分页、日视图计时、停止失败重试、删除回滚、六页面切换、侧栏对齐、账号隔离')
    fs.writeFileSync(path.join(__dirname,'../../artifacts/browser-smoke.json'),JSON.stringify({errors,notices,requests},null,2))
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
