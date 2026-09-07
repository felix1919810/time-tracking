import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const {installAuth}=createRequire(import.meta.url)('../api-deploy/auth.cjs')
function harness() {
 const users=[{record_id:'a',fields:{用户名:'alice',姓名:'Alice',密码:'p',角色:'member',团队:'one'}},{record_id:'b',fields:{用户名:'bob',密码:'p',角色:'member',团队:'two'}},{record_id:'c',fields:{用户名:'boss',密码:'p',角色:'admin',团队:'one'}}]
 let middleware;const routes={};const app={post:(p,f)=>routes[p]=f,use:f=>middleware=f};const writes=[]
 const lark=async(path,method,body)=>{
  if(method){writes.push({path,method,body});return {data:{}}}
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
 return {api,call,login,users,writes}
}
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
