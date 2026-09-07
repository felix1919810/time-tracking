import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createTranslationClient } from '../src/lib/translation-client.js'
const require = createRequire(import.meta.url)
const { createTranslationService } = require('../api-deploy/translation.cjs')
const settle = () => new Promise(resolve => setImmediate(resolve))

test('display translation deduplicates, caches by original text and supports both directions', async () => {
  const calls = []
  const client = createTranslationClient({ request: async (text, to) => { calls.push([text, to]); return to === 'en' ? 'Meeting notes' : '会议备注' } })
  assert.equal(client.read('会议备注', 'en'), '会议备注')
  client.read('会议备注', 'en')
  await settle()
  assert.equal(client.read('会议备注', 'en'), 'Meeting notes')
  assert.equal(client.read('会议备注', 'zh'), '会议备注')
  assert.equal(client.read('Meeting notes', 'zh'), 'Meeting notes')
  await settle()
  assert.equal(client.read('Meeting notes', 'zh'), '会议备注')
  assert.equal(calls.length, 2)
  assert.equal(client.read('会议备注', 'en', { translate: false }), '会议备注')
  client.read('修改后的备注', 'en')
  await settle()
  assert.equal(calls.length, 3)
})

test('account reset discards late results and failures fall back without retry storms', async () => {
  let finish, calls = 0, time = 0
  const client = createTranslationClient({ now: () => time, request: () => { calls++; return new Promise(resolve => { finish = resolve }) } })
  client.read('会议', 'en'); await settle()
  client.reset(); finish('Meeting'); await settle()
  assert.equal(client.read('会议', 'en'), '会议')
  await settle(); finish('Meeting'); await settle()
  assert.equal(calls, 2)
  let failures = 0
  const broken = createTranslationClient({ now: () => time, request: async () => { failures++; throw Error('offline') } })
  broken.read('备注', 'en'); await settle()
  for(let i=0;i<10;i++) assert.equal(broken.read('备注','en'), '备注')
  await settle(); assert.equal(failures,1)
  time = 31000; broken.read('备注','en'); await settle(); assert.equal(failures,2)
})

test('provider service retains multiline notes, separates array items, deduplicates and retries failures', async () => {
  let calls = 0, fail = true
  const service = createTranslationService({ appid:'test', key:'test', interval:0, request:async ({text}) => { calls++; if(text==='失败' && fail) throw Error('offline'); return text.replaceAll('行','line') } })
  const input = {text:'第一行\n第二行',to:'en'}
  const result = await Promise.all([service(input), service(input)])
  assert.deepEqual(result,['第一line\n第二line','第一line\n第二line']); assert.equal(calls,1)
  assert.deepEqual(await service({text:['一行\n二行','三行'],to:'en'}),['一line\n二line','三line'])
  await assert.rejects(service({text:'失败'})); fail=false
  assert.equal(await service({text:'失败'}),'失败')
  assert.equal(await service(input),result[0])
})

test('provider service validates inputs and chunks long text without splitting surrogate pairs', async () => {
  const parts=[]
  const service=createTranslationService({appid:'test',key:'test',interval:0,request:async ({text})=>{parts.push(text);return text}})
  const text='🙂'.repeat(1900)
  await service({text,to:'zh'})
  assert.equal(parts.join(''),text)
  assert(parts.every(s=>Array.from(s).length<=1800))
  for(const input of [{text:''},{text:{q:'x'}},{text:'x',to:'auto'},{text:'x'.repeat(12001)}]) await assert.rejects(service(input),e=>e.status===400)
  await assert.rejects(createTranslationService()({text:'你好'}),e=>e.status===503)
})
