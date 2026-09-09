import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {createRequire} from 'node:module'
const require=createRequire(new URL('../api-deploy/index.js',import.meta.url))
test('real Express routing does not allow case or slash variants to bypass authorization',async()=>{
 const real=require('express'), app=real(), listen=app.listen.bind(app);app.listen=()=>{}
 const express=()=>app;express.json=real.json;express.static=real.static
 const user={record_id:'u1',fields:{用户名:'alice',姓名:'Alice',密码:'p',角色:'member',团队:'A'}}
 let writes=0
 const axios=async c=>{
  if(c.method!=='GET'&&!c.url.includes('/records/search?')){writes++;const body=JSON.parse(c.data.toString());if(c.url.includes('/tblKmai7bKF54DYx/'))Object.assign(user.fields,body.fields);return {data:{code:0,data:{record:{},records:(body.records||[]).map((r,i)=>({...r,record_id:'new'+i}))}}}}
  const users=c.url.includes('/tblKmai7bKF54DYx/')
  return {data:{code:0,data:users?{items:[user]}:{items:[{record_id:'own',fields:{user:[{text:'alice',type:'text'}]}},{record_id:'other',fields:{user:[{text:'bob',type:'text'}]}}],record:{record_id:'other',fields:{user:'bob',start_time:1,end_time:2}}}}}
 }
 axios.post=async()=>({data:{tenant_access_token:'fake',expire:7200}})
 vm.runInNewContext(fs.readFileSync(new URL('../api-deploy/index.js',import.meta.url),'utf8'),{require:n=>n==='express'?express:n==='axios'?axios:require(n),__dirname:'nonexistent-public',process:{env:{FEISHU_H5_APP_SECRET:'test-secret'}},Buffer,URLSearchParams,Date,console:{log(){},error(){}},module:{exports:{}}})
 const server=listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port
 try {
  const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'alice',password:'p'})});const data=await login.json();assert(data.session_token)
  const headers={Authorization:'Bearer '+data.session_token,'Content-Type':'application/json'}
  for(const payload of ['{"__proto__":{"role":"admin"}}','{"fields":{"notes":{"constructor":{}}}}']) {
   assert.equal((await fetch(base+'/entries',{method:'POST',headers,body:payload})).status,400)
  }
  assert.equal((await fetch(base+'/entries?filter=TRUE',{headers})).status,400)
  assert.equal((await fetch(base+'/entries/x%3Fy',{method:'PUT',headers,body:'{}'})).status,400)
  const normal=await fetch(base+'/entries',{headers});assert.equal((await normal.json()).items.length,1)
  for(const path of ['/Entries','/entries/']){const r=await fetch(base+path,{headers});assert.equal(r.status,404,path)}
  for(const path of ['/Entries/other','/entries/other/','/Teams/members']){const r=await fetch(base+path,{method:'PUT',headers,body:JSON.stringify({fields:{description:'attack'}})});assert.equal(r.status,404,path)}
  const denied=await fetch(base+'/entries/other',{method:'PUT',headers,body:JSON.stringify({fields:{description:'attack'}})});assert.equal(denied.status,403)
  assert.equal(writes,1)
  const body=JSON.stringify({rows:[{user:'alice',description:'Imported',startTime:'2026-09-09 09:00:00',hours:'1'}]})
  assert.equal((await fetch(base+'/entries/batch',{method:'POST',headers,body})).status,403)
  user.fields.can_import=true
  const imported=await fetch(base+'/entries/batch',{method:'POST',headers,body});assert.equal(imported.status,200);assert.equal((await imported.json()).success,1)
  user.fields.can_import=false
  assert.equal((await fetch(base+'/entries/batch',{method:'POST',headers,body})).status,403)
  user.fields.角色='team_admin'
  assert.equal((await fetch(base+'/entries/batch',{method:'POST',headers,body})).status,200)
  assert.equal(writes,3)
  const change=await fetch(base+'/change-password',{method:'POST',headers,body:JSON.stringify({old_password:'p',new_password:'new safe password',username:'someone-else'})})
  assert.equal(change.status,200)
  assert.equal((await fetch(base+'/entries',{headers})).status,401)
  assert.equal((await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'alice',password:'new safe password'})})).status,200)
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r))}
})
