import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createEntryStore} from '../src/lib/entries.js'
const {createReadTransport}=createRequire(import.meta.url)('../api-deploy/read-transport.cjs')
test('concurrent reads share a request but independent results; auth reads are never cached',async()=>{
 let calls=0
 const read=createReadTransport(async()=>{calls++;await Promise.resolve();return {data:{items:[1]}}})
 const [a,b]=await Promise.all([read('/users'),read('/users')]);assert.equal(calls,1);a.data.items.pop();assert.equal(b.data.items.length,1)
 await read('/users');assert.equal(calls,2)
})
test('reference cache invalidates on writes and never saves stale in-flight reads',async()=>{
 let calls=0,release;const gate=new Promise(r=>release=r)
 const read=createReadTransport(async(path,method)=>{calls++;if(calls===1)await gate;return {data:{items:[calls]}}},{cacheable:()=>true})
 const old=read('/refs');await read('/refs','PUT',{});release();await old
 await read('/refs');assert.equal(calls,3);await read('/refs');assert.equal(calls,3)
})
test('only transient reads retry; failed reads and writes are not cached or replayed',async()=>{
 let calls=0;const read=createReadTransport(async()=>{if(++calls===1)throw Object.assign(Error('timeout'),{code:'ECONNABORTED'});return {ok:true}},{wait:async()=>{}})
 assert((await read('/entries')).ok);assert.equal(calls,2)
 let writes=0;const fail=createReadTransport(async()=>{writes++;throw Object.assign(Error('timeout'),{code:'ECONNABORTED'})},{wait:async()=>{}})
 await assert.rejects(fail('/entries','POST',{}));assert.equal(writes,1)
 let permanent=0;const bad=createReadTransport(async()=>{permanent++;throw Error('bad request')});await assert.rejects(bad('/entries'));assert.equal(permanent,1)
})
test('recent entries reuse memory; force refresh, mutations and account clearing require new reads',async()=>{
 let calls=0;const store=createEntryStore(async()=>{calls++;return {items:[],has_more:false}})
 await store.load();await store.load();assert.equal(calls,1)
 await store.load({force:true});assert.equal(calls,2)
 store.update({record_id:'r',fields:{}});await store.load();assert.equal(calls,3)
 store.clear();await store.load();assert.equal(calls,4)
})
test('Feishu data-not-ready retries reads once',async()=>{
 let calls=0,delay=0;const read=createReadTransport(async()=>{if(++calls===1)throw Object.assign(Error('Data not ready'),{providerCode:1254607});return {data:{items:[]}}},{wait:async ms=>{delay=ms}})
 await read('/entries');assert.equal(calls,2);assert.equal(delay,1000)
})
test('POST record search is a read; different request bodies never share results',async()=>{
 let calls=0;const read=createReadTransport(async(path,method,body)=>{calls++;await Promise.resolve();return {data:body}})
 const [a,b,c]=await Promise.all([read('/records/search?page_size=500','POST',{field_names:['user']}),read('/records/search?page_size=500','POST',{field_names:['user']}),read('/records/search?page_size=500','POST',{field_names:['notes']})])
 assert.equal(calls,2);assert.deepEqual(a,b);assert.notDeepEqual(a,c)
})
