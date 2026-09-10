import test from 'node:test'
import assert from 'node:assert/strict'
import { createHttp, fetchAllEntries } from '../src/lib/http.js'
import { createEntryStore, filterScopedEntries, durationMinutes, validEditRange } from '../src/lib/entries.js'
import { createTimer } from '../src/lib/timer.js'
import { encodeCSV } from '../src/lib/csv.js'

const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data })
const record = (id, user = 'alice') => ({ record_id: id, fields: { user, start_time: 1000, end_time: 61000 } })
globalThis.localStorage = { data: new Map(), getItem(k) { return this.data.get(k) || null }, setItem(k,v) { this.data.set(k,v) } }

test('分页读完超过500条，去重并保留第二页', async () => {
  const paths = []
  const entries = await fetchAllEntries(async path => {
    paths.push(path)
    return paths.length === 1 ? { items: Array.from({length:500}, (_, i) => record(String(i))), has_more:true, page_token:'next/&' } : {items:[record('499'),record('500')], has_more:false}
  })
  assert.equal(entries.length,501)
  assert.equal(new URL(paths[1],'http://local').searchParams.get('page_token'),'next/&')
})
test('缺少游标时拒绝不完整结果', async () => {
  await assert.rejects(fetchAllEntries(async () => ({items:[record('a')], has_more:true})), /分页不完整/)
})
test('并发相同请求合并，结果独立，写操作后重新读取', async () => {
  let calls = 0
  const http = createHttp({base:'http://local', fetchImpl: async () => { calls++; return response({items:[record('a')]}) }})
  const [a,b] = await Promise.all([http('/entries'),http('/entries')])
  assert.equal(calls,1)
  a.items.pop(); assert.equal(b.items.length,1)
  await http('/entries/a',{method:'PUT',body:{}})
  await http('/entries')
  assert.equal(calls,3)
})
test('写入期间迟到的GET不能填充缓存', async () => {
  const gate = defer(); let calls = 0
  const http = createHttp({base:'http://local',fetchImpl: () => ++calls === 1 ? gate.promise : Promise.resolve(response({items:[]}))})
  const old = http('/entries')
  await http('/entries/a',{method:'DELETE'})
  gate.resolve(response({items:[record('old')]})); await old
  assert.deepEqual((await http('/entries')).items,[])
  assert.equal(calls,3)
})
test('保留服务端错误原因；超时可重试', async () => {
  const http = createHttp({base:'http://local', fetchImpl:async () => response({error:'保存失败原因'},500)})
  await assert.rejects(http('/entries'),/保存失败原因/)
  const slow = createHttp({base:'http://local',timeout:5, fetchImpl: (_url, {signal}) => new Promise((_,reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error(),{name:'AbortError'}))))})
  await assert.rejects(slow('/entries'),/请求超时/)
})
test('首次加载期间计时和删除不会丢失其他历史记录', async () => {
  const gate = defer(), store = createEntryStore(() => gate.promise)
  const task = store.load()
  store.update(record('new')); store.remove('deleted')
  gate.resolve({items:[record('history'),record('deleted')],has_more:false})
  await task
  assert.deepEqual(store.items.value.map(r=>r.record_id),['history','new'])
})
test('换账号后迟到响应不能重新填入前账号记录', async () => {
  const gate = defer(), store = createEntryStore(() => gate.promise)
  const task = store.load(); store.clear()
  gate.resolve({items:[record('old')],has_more:false}); await task
  assert.deepEqual(store.items.value,[])
})
test('局部编辑保留其他成员记录，筛选兼容用户名和旧姓名', () => {
  const store = createEntryStore(async()=>({items:[]}))
  store.update(record('1')); store.update(record('2','Alice')); store.update(record('3','bob'))
  store.update({...record('1'),fields:{...record('1').fields,description:'changed'}})
  assert.equal(store.items.value.length,3)
  const opts = {role:'team_admin',user:'alice',name:'Alice',scope:'team',team:'A',members:[{user:'alice',displayName:'Alice',team:'A'}]}
  assert.equal(filterScopedEntries(store.items.value,opts).length,2)
  assert.equal(filterScopedEntries(store.items.value,{...opts,role:'member',scope:'all'}).length,2)
  assert.equal(filterScopedEntries(store.items.value,{...opts,team:''}).length,0)
})
test('坏日期不产生NaN，长记录不被静默清零，拒绝倒序编辑', () => {
  assert.equal(durationMinutes({fields:{start_time:'bad'}}),0)
  assert.equal(durationMinutes({fields:{start_time:null}}),0)
  assert.equal(durationMinutes({fields:{start_time:1000,end_time:90001000}}),1500)
  assert.equal(validEditRange('bad','bad'),false)
  assert.equal(validEditRange('2026-09-06T12:00','2026-09-06T11:00'),false)
})
test('CSV所有列统一转义引号、逗号和换行', () => {
  assert.equal(encodeCSV([['A"B','C,D','E\nF',null]]),'"A""B","C,D","E\nF",""')
})

function timerFixture(http) {
  let user = 'alice'; const events=[], notices=[]
  localStorage.data.clear()
  const timer = createTimer({http,user:()=>user,displayName:()=> 'Alice',emit:(...args)=>events.push(args),notify:m=>notices.push(m),now:()=>100000})
  return {timer,events,notices,setUser:value=>{user=value}}
}
test('快速开始、重复开始、立即停止只发一次写入，等待真实ID', async () => {
  const start = defer(), requests=[]
  const f = timerFixture(async (path, options) => {requests.push([path,options]); if(path==='/timer/start') return start.promise; return {ok:true,end_time:110000} })
  try {
    const a=f.timer.startActiveTimer({user:'Alice',description:'Work'})
    await f.timer.startActiveTimer({description:'Duplicate'})
    const b=f.timer.stopActiveTimer(), c=f.timer.stopActiveTimer()
    start.resolve({record_id:'real',start_time:99000})
    await Promise.all([a,b,c])
    assert.equal(requests.length,2)
    assert.equal(requests[0][1].body.user,'alice')
    assert.equal(requests[1][1].body.record_id,'real')
    assert.equal(f.timer.activeTimer.value,null)
    assert.equal(f.events.filter(e=>e[0]==='timer-stopped').length,1)
  } finally {f.timer.reset()}
})
test('停止失败保留计时，重试确认后才通知视图停止', async () => {
  let fail=true
  const f=timerFixture(async path => {
    if(path==='/timer/start')return {record_id:'real',start_time:90000}
    if(fail)throw Error('断网')
    return {ok:true,end_time:110000}
  })
  try {
    await f.timer.startActiveTimer({})
    await f.timer.stopActiveTimer()
    assert.equal(f.timer.activeTimer.value.record_id,'real')
    assert.equal(f.events.filter(e=>e[0]==='timer-stopped').length,0)
    fail=false; await f.timer.stopActiveTimer()
    assert.equal(f.timer.activeTimer.value,null)
  } finally {f.timer.reset()}
})

test('pending stop freezes the display immediately and resumes safely on failure',async()=>{
  const gate=defer();let time=100000
  const timer=createTimer({http:async path=>path==='/timer/start'?{record_id:'r',start_time:90000}:gate.promise,user:()=> 'alice',displayName:()=> 'Alice',emit(){},notify(){},now:()=>time})
  try {
    await timer.startActiveTimer({});const stopping=timer.stopActiveTimer()
    assert.equal(timer.stopping.value,true);assert.equal(timer.timerElapsedText.value,'0:10')
    time=120000;assert.equal(timer.timerElapsedText.value,'0:10')
    gate.reject(Error('offline'));assert.equal(await stopping,false)
    assert.equal(timer.activeTimer.value.record_id,'r');assert.equal(timer.timerElapsedText.value,'0:30')
  }finally{timer.reset()}
})
test('无本地缓存也能恢复，服务端ID覆盖旧缓存，旧账号响应被忽略', async () => {
  const f=timerFixture(async()=>({active:true,record_id:'server',start_time:50000,user:'alice'}))
  try {
    await f.timer.restoreActiveTimer()
    assert.equal(f.timer.activeTimer.value.record_id,'server')
    f.timer.reset()
    const gate=defer(), other=timerFixture(()=>gate.promise)
    const task=other.timer.restoreActiveTimer(); other.timer.reset(); other.setUser('bob')
    gate.resolve({active:true,record_id:'alice-timer',start_time:50000}); await task
    assert.equal(other.timer.activeTimer.value,null)
    other.timer.reset()
  } finally {f.timer.reset()}
})
