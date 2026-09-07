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
  let entry={record_id:'r',fields:{start_time:100000,end_time:160000}}
  let tokenCalls=0
  const app={use(){},listen(){}}
  for(const method of ['get','post','put','delete','patch'])app[method]=(path,fn)=>routes.set(method+' '+path,fn)
  const express=()=>app;express.json=()=>()=>{}
  express.static=()=>()=>{}
  const axios=async config=>{
    if(config.method==='GET'&&config.url.includes('/records?'))return {data:{code:0,data:{items:[entry],has_more:true,page_token:'next-page'}}}
    if(config.method==='GET')return {data:{code:0,data:{record:entry}}}
    writes.push(config)
    const body=JSON.parse(config.data.toString())
    entry={...entry,fields:{...entry.fields,...body.fields}}
    return {data:{code:0,data:{record:entry}}}
  }
  axios.post=async()=>{tokenCalls++;return {data:{tenant_access_token:'mock-token',expire:7200}}}
  const context={require:name=>name==='express'?express:name==='cors'?()=>()=>{}:name==='axios'?axios:name==='./translation.cjs'?require('../api-deploy/translation.cjs'):['path','crypto','https','zlib'].includes(name)?require(name):name==='iconv-lite'?{decode:b=>b.toString()}:(()=>{throw Error('Unexpected dependency '+name)})(),__dirname:'mock-public',process:{env:{}},Buffer,URLSearchParams,console:{log(){},error(){}},module:{exports:{}},Date}
  vm.runInNewContext(fs.readFileSync(new URL('../api-deploy/index.js',import.meta.url),'utf8'),context)
  async function call(method,path,body={},query={}) {
    let status=200,data
    const res={status(n){status=n;return this},json(value){data=value;return this}}
    await routes.get(method+' '+path)({body,query,params:{id:'r'}},res)
    return {status,data}
  }
  return {call,writes,get tokenCalls(){return tokenCalls}}
}
test('SCF条目接口返回下一页游标',async()=>{
  const api=backend(),res=await api.call('get','/entries')
  assert.equal(res.data.page_token,'next-page')
  assert.equal(res.data.has_more,true)
})
test('重复停止已完成记录保持原结束时间和工时',async()=>{
  const api=backend()
  const a=await api.call('post','/timer/stop',{record_id:'r'})
  const b=await api.call('post','/timer/stop',{record_id:'r'})
  assert.equal(a.data.end_time,160000)
  assert.equal(b.data.end_time,160000)
  assert.equal(b.data.duration_ms,60000)
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
