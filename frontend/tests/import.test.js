import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {normalizeRows,parseTime,installImport}=createRequire(import.meta.url)('../api-deploy/import.cjs')
const all=[{record_id:'a',fields:{用户名:'alice',姓名:'Alice',角色:'member',团队:'A'}},{record_id:'b',fields:{用户名:'bob',姓名:'Bob',角色:'member',团队:'B'}}]
const row={user:'Alice',description:'Task',startTime:'2026-09-09 09:00:00',endTime:'2026-09-09 10:00:00',notes:'one\ntwo'}
test('imports normalize member aliases and preserve multiline notes with Beijing timestamps',()=>{
 const [r]=normalizeRows([row],{user:'alice',all},u=>u==='alice');assert.equal(r.fields.user,'alice');assert.equal(r.fields.start_time,Date.parse('2026-09-09T01:00:00Z'));assert.equal(r.fields['时长(秒)'],3600);assert.equal(r.fields.notes,'one\ntwo')
 assert.equal(parseTime('2026-02-30 10:00:00'),null)
 for(const fields of [{hours:'-1'},{hours:'2'},{endTime:'bad'},{endTime:'2026-09-09 08:00:00'},{description:''},{user:'Bob'}])assert.throws(()=>normalizeRows([{...row,...fields}],{user:'alice',all},u=>u==='alice'))
})
test('import grants are limited to management roles and team scope',async()=>{
 const routes={},writes=[];installImport({post:(p,f)=>routes[p]=f},{lark:async(...a)=>{writes.push(a);return {data:{}}},appToken:'app',userTable:'users',timeTable:'time'})
 async function call(role,team,id,enabled){let status=200,data;await routes['/members/:id/import-permission']({auth:{role,team,all},params:{id},body:{can_import:enabled}},{status(s){status=s;return this},json(d){data=d}});return {status,data}}
 assert.equal((await call('member','A','a',true)).status,403)
 assert.equal((await call('team_admin','A','b',true)).status,403)
 assert.equal((await call('team_admin','A','a',true)).status,200)
 assert.equal((await call('admin','','b',false)).status,200)
 assert.equal(writes.length,2);assert.equal(writes[1][2].fields.can_import,false)
})
