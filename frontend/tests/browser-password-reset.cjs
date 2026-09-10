const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const assert=require('node:assert/strict')
;(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'})
 try{
  const page=await browser.newPage({viewport:{width:430,height:900}})
  const errors=[];let writes=0
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url())
   if(url.hostname==='127.0.0.1')return route.continue()
   if(!url.hostname.endsWith('.tencentscf.com'))return route.abort()
   let data={}
   if(url.pathname==='/auth/feishu/start')data={state:'signed-state',url:'http://127.0.0.1:5173/time-tracking/?code=provider-code&state=signed-state'}
   if(url.pathname==='/feishu-auth')data={ok:true,reset_required:true,user:'alice',reset_token:'reset-only-token'}
   if(url.pathname==='/auth/password/reset'){
    writes++;const body=route.request().postDataJSON()
    assert.equal(body.reset_token,'reset-only-token');assert.equal(body.new_password,'long-new-password')
    data={ok:true,reauthenticate:true}
   }
   await route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)})
  })
  await page.goto('http://127.0.0.1:5173/time-tracking/')
  await page.getByRole('button',{name:'忘记密码',exact:true}).click()
  await page.getByRole('button',{name:'通过飞书验证身份',exact:true}).click()
  await page.locator('#reset-password').fill('short')
  await page.getByRole('button',{name:'设置新密码',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'12 至 256'}).waitFor()
  assert.equal(writes,0)
  await page.locator('#reset-password').fill('long-new-password')
  await page.locator('#reset-confirm').fill('mismatched-password')
  await page.getByRole('button',{name:'设置新密码',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'两次输入'}).waitFor()
  assert.equal(writes,0)
  await page.locator('#reset-confirm').fill('long-new-password')
  await page.getByRole('button',{name:'设置新密码',exact:true}).click()
  await page.getByText('密码已重置，请使用新密码登录',{exact:true}).waitFor()
  assert.equal(await page.locator('#app-field-1').inputValue(),'alice')
  assert.equal(writes,1);assert.deepEqual(errors,[])
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>/reset/i.test(k))),false)
  console.log('PASS: recovery callback, confirmation validation, reset submission and return to login; no real accounts modified')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
