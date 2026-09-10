import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// Exercise actual SCF handlers with an in-memory Feishu transport. No credentials
// or real records are used; listening and all outbound calls are replaced.
function backend() {
  const routes=new Map(), writes=[]
  let entry={record_id:'r',fields:{user:[{text:'alice',type:'text'}],description:[{text:'First',type:'text'},{text:'\nSecond',type:'text'}],notes:[{text:'Notes',type:'text'}],start_time:100000,end_time:160000}}
  let tokenCalls=0, recordReads=0
  const app={set(){},use(){},listen(){}}
  for(const method of ['get','post','put','delete','patch'])app[method]=(path,fn)=>routes.set(method+' '+path,fn)
  const express=()=>app;express.json=()=>()=>{}
  express.static=()=>()=>{}
  const axios=async config=>{
    if(config.url.includes('/records/search?')||config.method==='GET'&&config.url.includes('/records?'))return {data:{code:0,data:{items:[entry],has_more:true,page_token:'next-page'}}}
    if(config.method==='GET'){recordReads++;return {data:{code:0,data:{record:entry}}}}
    writes.push(config)
    const body=JSON.parse(config.data.toString())
    entry={...entry,fields:{...entry.fields,...body.fields}}
    return {data:{code:0,data:{record:entry}}}
  }
  axios.post=async()=>{tokenCalls++;return {data:{tenant_access_token:'mock-token',expire:7200}}}
  const context={require:name=>name==='express'?express:name==='cors'?()=>()=>{}:name==='axios'?axios:name==='./entry-record.cjs'?require('../api-deploy/entry-record.cjs'):name==='./read-transport.cjs'?require('../api-deploy/read-transport.cjs'):name==='./passwords.cjs'?require('../api-deploy/passwords.cjs'):name==='./input-security.cjs'?require('../api-deploy/input-security.cjs'):name==='./import.cjs'?require('../api-deploy/import.cjs'):name==='./history.cjs'?require('../api-deploy/history.cjs'):name==='./auth.cjs'?require('../api-deploy/auth.cjs'):name==='./translation.cjs'?require('../api-deploy/translation.cjs'):['path','crypto','https','zlib'].includes(name)?require(name):name==='iconv-lite'?{decode:b=>b.toString()}:(()=>{throw Error('Unexpected dependency '+name)})(),__dirname:'mock-public',process:{env:{}},Buffer,URLSearchParams,console:{log(){},error(){}},module:{exports:{}},Date}
  const originalRequire=context.require
  context.require=name=>name==='./directory.cjs'?require('../api-deploy/directory.cjs'):originalRequire(name)
  vm.runInNewContext(fs.readFileSync(new URL('../api-deploy/index.js',import.meta.url),'utf8'),context)
  async function call(method,path,body={},query={},request={}) {
    let status=200,data
    const res={status(n){status=n;return this},json(value){data=value;return this}}
    await routes.get(method+' '+path)({body,query,params:{id:'r'},...request},res)
    return {status,data}
  }
  return {call,writes,get tokenCalls(){return tokenCalls},get recordReads(){return recordReads}}
}
test('SCF条目接口返回下一页游标',async()=>{
  const api=backend(),res=await api.call('get','/entries')
  assert.equal(res.data.page_token,'next-page')
  assert.equal(res.data.has_more,true)
  assert.equal(res.data.items[0].fields.user,'alice')
  assert.equal(res.data.items[0].fields.description,'First\nSecond')
  const filtered=await api.call('get','/entries',{}, {user:'alice'});assert.equal(filtered.data.items.length,1)
})
test('重复停止已完成记录保持原结束时间和工时',async()=>{
  const api=backend()
  const a=await api.call('post','/timer/stop',{record_id:'r'})
  const b=await api.call('post','/timer/stop',{record_id:'r'})
  assert.equal(a.data.end_time,160000)
  assert.equal(b.data.end_time,160000)
  assert.equal(b.data.duration_ms,60000)
  assert.equal(api.writes.length,0)
})

test('stop reuses the authorized snapshot and timestamps receipt before upstream delays',async()=>{
  const api=backend(),record={record_id:'r',fields:{user:'alice',start_time:100000,end_time:null}}
  const result=await api.call('post','/timer/stop',{record_id:'r'}, {}, {requestTime:110000,authorizedEntry:{id:'r',record}})
  assert.equal(result.status,200);assert.equal(result.data.end_time,110000)
  assert.equal(api.recordReads,0);assert.equal(api.writes.length,1)
})

test('manual creation rejects invalid ranges and derives durations on the server',async()=>{
 const api=backend()
 for(const fields of [{user:'alice',start_time:100,end_time:99},{user:'alice',start_time:'bad',end_time:123},{user:'alice',start_time:100,end_time:null}]) {
  assert.equal((await api.call('post','/entries',{fields})).status,400)
 }
 assert.equal(api.writes.length,0)
 const created=await api.call('post','/entries',{fields:{user:'alice',start_time:100000,end_time:160000,'时长(秒)':99999,'时长（小时）':999}})
 assert.equal(created.status,200)
 const fields=JSON.parse(api.writes[0].data.toString()).fields
 assert.equal(fields['时长(秒)'],60);assert.equal(fields['时长（小时）'],0.0167)
})
test('倒序时间编辑返回400，不写入飞书',async()=>{
  const api=backend(),res=await api.call('put','/entries/:id',{fields:{start_time:200000,end_time:100000}})
  assert.equal(res.status,400)
  assert.equal(api.writes.length,0)
})
test('并发冷启动只获取一个tenant token',async()=>{
  const api=backend()
  await Promise.all([api.call('get','/entries'),api.call('get','/entries')])
  assert.equal(api.tokenCalls,1)
})
test('部署版本提供健康检查',async()=>{
  const res=await backend().call('get','/health')
  assert.equal(res.data.version,'stability-20260906')
})
