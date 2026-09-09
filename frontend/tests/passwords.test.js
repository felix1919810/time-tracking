import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {encodeCSV} from '../src/lib/csv.js'
const require=createRequire(import.meta.url)
const {hashPassword,verifyPassword,installPasswords}=require('../api-deploy/passwords.cjs')
test('CSV export neutralizes spreadsheet formulas, including leading whitespace',()=>{
 assert.equal(encodeCSV([['=1+1',' +SUM(A1)','@test','ordinary']]),'"\'=1+1","\' +SUM(A1)","\'@test","ordinary"')
})
test('salted password hashes verify without accepting hashes as passwords or malformed work factors',async()=>{
 const password='a long unique password',a=await hashPassword(password),b=await hashPassword(password)
 assert.notEqual(a,b);assert(!a.includes(password));assert(await verifyPassword(password,a))
 assert(!await verifyPassword('wrong',a));assert(!await verifyPassword(a,a));assert(!await verifyPassword(password,a.replace('16384','999999999')))
 assert(await verifyPassword('legacy','legacy'));assert(!await verifyPassword({},a))
})
test('login upgrades legacy passwords; literal injection text cannot match another account; changes use authenticated identity',async()=>{
 const routes={},writes=[],record={record_id:'u1',fields:{用户名:'alice',密码:'legacy'}}
 installPasswords({post:(p,f)=>routes[p]=f},{appToken:'app',userTable:'users',settingsTable:'settings',lark:async(path,method,body)=>{
  assert(!path.includes('filter='))
  if(method==='PUT'){writes.push(body);Object.assign(record.fields,body.fields);return {data:{record}}}
  return {data:{items:[record]}}
 }})
 async function call(path,body){let status=200,data;await routes[path]({body,auth:{record,record_id:'u1'}},{status(s){status=s;return this},json(d){data=d}});return {status,data}}
 assert.equal((await call('/login',{username:'alice" OR true',password:'legacy'})).status,401)
 assert.equal(writes.length,0)
 assert.equal((await call('/login',{username:'alice',password:'legacy'})).status,200)
 assert(record.fields.密码.startsWith('scrypt$'));assert.equal(writes.length,1)
 assert.equal((await call('/login',{username:'alice',password:'legacy'})).status,200);assert.equal(writes.length,1)
 assert.equal((await call('/change-password',{username:'bob',old_password:'wrong',new_password:'new long password'})).status,403)
 assert.equal((await call('/change-password',{old_password:'legacy',new_password:'short'})).status,400)
 assert((await call('/change-password',{username:'bob',old_password:'legacy',new_password:'new long password'})).data.reauthenticate)
 assert(!await verifyPassword('legacy',record.fields.密码));assert(await verifyPassword('new long password',record.fields.密码))
})
test('input boundary rejects prototype, formula query and structured field payloads while accepting literal text',()=>{
 let handler;require('../api-deploy/input-security.cjs').installInputSecurity({use:f=>handler=f})
 function check(body,query={}){let passed=false;handler({body,query},{setHeader(){},status(){return this},json(){}},()=>passed=true);return passed}
 assert(!check(JSON.parse('{"__proto__":{"admin":true}}')))
 assert(!check({fields:{description:{text:'attack'}}}))
 assert(!check({fields:{deleted_at:1}}));assert(!check({}, {user:['alice','bob']}));assert(!check({}, {filter:'TRUE'}))
 assert(check({fields:{description:'<script>alert(1)</script>',notes:'literal "quoted" text'}}))
 assert.equal({}.admin,undefined)
})
