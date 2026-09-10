import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {installHistory,RETENTION}=createRequire(import.meta.url)('../api-deploy/history.cjs')
function harness(){let middleware;const entry={record_id:'e',fields:{user:'alice',description:'Original',notes:'Notes',start_time:100000,end_time:160000}};const logs=[],events=[];let failPrepare=false,failFinalize=false
 const lark=async(path,method,body)=>{
  const audit=path.includes('/audit/');if(method==='POST'){events.push('prepare');if(failPrepare)throw Error('offline');const r={record_id:'l'+logs.length,fields:{...body.fields}};logs.push(r);return {data:{record:r}}}
  if(method==='PUT'){if(audit){events.push('finalize');if(failFinalize)throw Error('offline');Object.assign(logs.find(l=>path.endsWith('/'+l.record_id)).fields,body.fields);return {data:{}}}events.push('write');Object.assign(entry.fields,body.fields);return {data:{record:structuredClone(entry)}}}
  if(path.includes('?'))return {data:{items:audit?structuredClone(logs):[structuredClone(entry)]}}
  return {data:{record:structuredClone(entry)}}
 }
 installHistory({use:f=>middleware=f},{lark,appToken:'app',timeTable:'time',auditTable:'audit'})
 async function call(path,method='GET',body={},allowed=true,request={}){let status=200,data;await middleware({path,method,body,query:{id:'e'},auth:{user:'alice'},canAccessEntryUser:()=>allowed,...request},{status(s){status=s;return this},json(d){data=d;return this}},()=>{throw Error('Unexpected route')});return {status,data}}
 return {call,entry,logs,events,failPrepare:()=>failPrepare=true,failFinalize:()=>failFinalize=true}
}

test('queued history mutations refresh a snapshot taken before a preceding write',async()=>{
 const h=harness(),request={authorizedEntry:{id:'e',record:structuredClone(h.entry)}}
 const [deleted,restored]=await Promise.all([h.call('/entries/e','DELETE',{},true,request),h.call('/entries/e/restore','POST',{},true,request)])
 assert.equal(deleted.status,200);assert.equal(restored.status,200)
 assert.equal(h.entry.fields.deleted_at,null)
 assert.deepEqual(h.logs.map(l=>l.fields.action),['delete','restore'])
})
test('soft deletion excludes data and restoration preserves original fields, logs both actions',async()=>{
 const h=harness();const original=structuredClone(h.entry.fields)
 assert.equal((await h.call('/entries/e','DELETE')).status,200);assert(h.entry.fields.deleted_at)
 assert.deepEqual(h.events,['prepare','write','finalize'])
 assert.equal((await h.call('/entries/deleted')).data.items.length,1)
 assert.equal((await h.call('/entries/e/restore','POST')).status,200)
 assert.deepEqual({...h.entry.fields,deleted_at:undefined},{...original,deleted_at:undefined})
 assert.deepEqual(h.logs.map(l=>l.fields.action),['delete','restore'])
})
test('failed audit preparation prevents writes; uncertain finalization preserves an honest pending log',async()=>{
 const a=harness();a.failPrepare();assert.equal((await a.call('/entries/e','PUT',{fields:{description:'New'}})).status,503);assert.equal(a.entry.fields.description,'Original')
 const b=harness();b.failFinalize();const r=await b.call('/entries/e','PUT',{fields:{description:'New'}});assert.equal(r.status,200);assert.equal(r.data.audit_pending,true);assert.equal(b.logs[0].fields.status,'pending');assert.equal(b.entry.fields.description,'New')
})
test('expired restores, active timers and unauthorized history are blocked',async()=>{
 const h=harness();h.entry.fields.deleted_at=Date.now()-RETENTION-1;assert.equal((await h.call('/entries/e/restore','POST')).status,410)
 assert.equal((await h.call('/entries/deleted')).data.items.length,0)
 assert.equal((await h.call('/entries/e/history','GET',{},false)).status,403)
 h.entry.fields.deleted_at=null;h.entry.fields.end_time=null;assert.equal((await h.call('/entries/e','DELETE')).status,409)
 assert.equal(h.logs.length,0)
})
test('history is read-only and retries do not extend the restore window',async()=>{
 const h=harness();await h.call('/entries/e','DELETE');const timestamp=h.entry.fields.deleted_at;await h.call('/entries/e','DELETE');assert.equal(h.entry.fields.deleted_at,timestamp);assert.equal(h.logs.length,1)
 const d=await h.call('/entries/e/history');assert.equal(d.data.items[0].before.description,'Original');assert.equal(d.data.items[0].actor,'alice')
 assert.equal((await h.call('/entries/e/history','POST')).status,405)
})
