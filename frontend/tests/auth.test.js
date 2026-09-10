import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const {installAuth}=createRequire(import.meta.url)('../api-deploy/auth.cjs')
function harness() {
 const users=[{record_id:'a',fields:{用户名:'alice',姓名:'Alice',密码:'p',角色:'member',团队:'one'}},{record_id:'b',fields:{用户名:'bob',密码:'p',角色:'member',团队:'two'}},{record_id:'c',fields:{用户名:'boss',密码:'p',角色:'admin',团队:'one'}}]
 let middleware;const routes={};const app={post:(p,f)=>routes[p]=f,use:f=>middleware=f};const writes=[],reads=[]
 const lark=async(path,method,body)=>{
  if(method){writes.push({path,method,body});const record=users.find(u=>path.endsWith('/'+u.record_id));if(record)Object.assign(record.fields,body.fields);return {data:{}}}
  reads.push(path)
  if(path.includes('/users/'))return {data:{items:users}}
  return {data:{record:{fields:{user:'bob',团队:'two'}}}}
 }
 const api=installAuth(app,{lark,appToken:'app',userTable:'users',timeTable:'time',categoryTable:'categories',secret:()=> 'test-secret',appId:()=> 'app'})
 async function call(path,{method='GET',body={},token='',query={},output={ok:true}}={}) {
  return new Promise((resolve,reject)=>{
   const req={path,method,body,query,headers:{authorization:token?'Bearer '+token:''}}
   let status=200;const res={setHeader(){},status(s){status=s;return this},json(data){resolve({status,data,req});return this}}
   const next=()=>res.json(output)
   Promise.resolve(routes[path]?routes[path](req,res):middleware(req,res,next)).catch(reject)
  })
 }
 async function login(user='alice'){return (await call('/login',{method:'POST',output:{ok:true,user}})).data.session_token}
 return {api,call,login,users,writes,reads}
}

test('authorized writes fetch the entry once alongside fresh membership and expose only the checked snapshot',async()=>{
 const h=harness(),token=await h.login('boss');h.reads.length=0
 const response=await h.call('/timer/stop',{method:'POST',token,body:{record_id:'r'}})
 assert.equal(response.status,200);assert.equal(response.req.authorizedEntry.id,'r')
 assert.equal(h.reads.filter(p=>p.includes('/time/')).length,1)
 h.users[2].fields.停用=true
 assert.equal((await h.call('/timer/stop',{method:'POST',token,body:{record_id:'r'}})).status,401)
})

test('Feishu recovery is purpose-bound, expires, hashes passwords and revokes old sessions',async()=>{
 const h=harness();h.users[0].fields.feishu_user_id='verified-alice'
 const old=await h.login()
 const start=await h.call('/auth/feishu/start',{method:'POST',body:{action:'reset',redirect_uri:'https://felix1919810.github.io/time-tracking/'}})
 const result=await h.call('/feishu-auth',{method:'POST',body:{state:start.data.state,code:'provider-code'},output:{ok:true,user:'bob',feishu_user_id:'verified-alice'}})
 assert.equal(result.data.user,'alice');assert.equal(result.data.session_token,undefined)
 const token=result.data.reset_token;assert(token)
 assert.equal((await h.call('/auth/me',{token})).status,401)
 assert.equal((await h.call('/auth/password/reset',{method:'POST',body:{reset_token:old,new_password:'a-long-new-password'}})).status,401)
 assert.equal((await h.call('/auth/password/reset',{method:'POST',body:{reset_token:token,new_password:'short'}})).status,400)
 const claims=h.api.verify(token,'password-reset')
 assert.equal((await h.call('/auth/password/reset',{method:'POST',body:{reset_token:h.api.sign(claims,-1),new_password:'a-long-new-password'}})).status,401)
 const done=await h.call('/auth/password/reset',{method:'POST',body:{reset_token:token,new_password:'a-long-new-password',username:'bob'}})
 assert.equal(done.status,200);assert.match(h.users[0].fields.密码,/^scrypt\$/)
 assert.equal(h.users[1].fields.密码,'p')
 assert.equal((await h.call('/auth/me',{token:old})).status,401)
 assert.equal((await h.call('/auth/password/reset',{method:'POST',body:{reset_token:token,new_password:'another-long-password'}})).status,401)
 const {verifyPassword}=createRequire(import.meta.url)('../api-deploy/passwords.cjs')
 assert(await verifyPassword('a-long-new-password',h.users[0].fields.密码))
})

test('recovery refuses missing, ambiguous, disabled or changed Feishu bindings',async()=>{
 for(const mode of ['missing','ambiguous','disabled','changed']){
  const h=harness();h.users[0].fields.feishu_user_id='verified'
  if(mode==='missing')h.users[0].fields.feishu_user_id='other'
  if(mode==='ambiguous')h.users[1].fields.feishu_user_id='verified'
  if(mode==='disabled')h.users[0].fields.停用=true
  const state=h.api.sign({purpose:'oauth',action:'reset'})
  const result=await h.call('/feishu-auth',{method:'POST',body:{state,code:'verified'},output:{ok:true,user:'alice',feishu_user_id:'verified'}})
  if(mode!=='changed'){assert.equal(result.status,403);assert.equal(result.data.reset_token,undefined)}
  else{
   h.users[0].fields.feishu_user_id='other'
   assert.equal((await h.call('/auth/password/reset',{method:'POST',body:{reset_token:result.data.reset_token,new_password:'a-long-new-password'}})).status,401)
  }
  assert.equal(h.writes.length,0)
 }
})
test('reject missing or forged sessions; ignore forged browser role; recheck current role',async()=>{
 const h=harness();assert.equal((await h.call('/entries')).status,401)
 const token=await h.login();assert(token)
 assert.equal((await h.call('/entries',{token:token+'x'})).status,401)
 assert.equal((await h.call('/teams/members',{method:'POST',token,body:{role:'admin'}})).status,403)
 const out=await h.call('/entries',{token,output:{items:[{fields:{user:'alice'}},{fields:{user:'alice',deleted_at:Date.now()}},{fields:{user:'bob'}}],total:2,has_more:true,page_token:'next'}})
 assert.equal(out.data.items.length,1);assert.equal(out.data.page_token,'next');assert.equal(out.data.total,undefined)
 h.users[0].fields.角色='admin';assert.equal((await h.call('/auth/me',{token})).data.role,'admin')
 h.users[0].fields.密码='changed';assert.equal((await h.call('/auth/me',{token})).status,401)
})
test('cross-owner edits, impersonated imports and legacy binding are rejected',async()=>{
 const h=harness(),token=await h.login()
 for(const path of ['/entries/record','/entry','/timer/stop']) assert.equal((await h.call(path,{method:'PUT',token,query:{id:'record'},body:{record_id:'record',fields:{user:'alice'}}})).status,403)
 assert.equal((await h.call('/entries/batch',{method:'POST',token,body:{role:'admin',rows:[{成员:'bob'}]}})).status,403)
 assert.equal((await h.call('/feishu-bind',{method:'POST',token,body:{username:'bob',feishu_user_id:'fake'}})).status,403)
 assert.equal((await h.call('/entries',{token,query:{app_token:'other'}})).status,403)
 assert.equal(h.writes.length,0)
})
test('OAuth allowlist, signed expiring state and binding requires a session',async()=>{
 const h=harness()
 assert.equal((await h.call('/auth/feishu/start',{method:'POST',body:{redirect_uri:'https://evil.example/'}})).status,400)
 const uri='https://felix1919810.github.io/time-tracking/preview-20260906/'
 assert.equal((await h.call('/auth/feishu/start',{method:'POST',body:{redirect_uri:uri,action:'bind'}})).status,401)
 const result=await h.call('/auth/feishu/start',{method:'POST',body:{redirect_uri:uri}})
 assert.equal(h.api.verify(result.data.state,'oauth').redirect_uri,uri)
 assert.equal(new URL(result.data.url).searchParams.get('state'),result.data.state)
 assert.equal((await h.call('/feishu-auth',{method:'POST',body:{state:'fake',code:'fake'}})).status,401)
 assert.throws(()=>h.api.verify(h.api.sign({purpose:'oauth'},-1),'oauth'))
})
test('team administrators cannot access another team or elevate members',async()=>{
 const h=harness();h.users[0].fields.角色='team_admin';const token=await h.login()
 assert.equal((await h.call('/categories/other',{method:'DELETE',token})).status,403)
 assert.equal((await h.call('/teams/members',{method:'POST',token,body:{role:'admin'}})).status,403)
 assert.equal((await h.call('/timer/active',{token,query:{user:'bob'}})).status,403)
})

test('verified OAuth binding preserves the signed-in account and rejects existing bindings',async()=>{
 const h=harness(),token=await h.login()
 const start=await h.call('/auth/feishu/start',{method:'POST',token,body:{action:'bind',redirect_uri:'https://felix1919810.github.io/time-tracking/'}})
 const bound=await h.call('/feishu-auth',{method:'POST',token,body:{state:start.data.state,code:'verified'},output:{ok:false,feishu_user_id:'feishu-alice'}})
 assert.equal(bound.data.user,'alice');assert(bound.data.session_token)
 assert.equal(h.writes[0].body.fields.feishu_user_id,'feishu-alice')
 const token2=bound.data.session_token
 h.users[1].fields.feishu_user_id='feishu-bob'
 const state2=(await h.call('/auth/feishu/start',{method:'POST',token:token2,body:{action:'bind',redirect_uri:'https://felix1919810.github.io/time-tracking/'}})).data.state
 const conflict=await h.call('/feishu-auth',{method:'POST',token:token2,body:{state:state2,code:'verified'},output:{ok:true,user:'bob',feishu_user_id:'feishu-bob'}})
 assert.equal(conflict.status,409);assert.equal(h.writes.length,1)
})
