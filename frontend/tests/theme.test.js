import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

function setup(saved = 'auto') {
  let now = +new Date(2026, 8, 10, 6, 59, 59), nextId = 0
  const callbacks = new Map(), events = {}, dataset = {}
  const context = vm.createContext({
    ref: value => ({value}), readonly: value => value,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])) } },
    document: {documentElement:{dataset},addEventListener:(name,fn)=>events[name]=fn},
    window: {addEventListener:(name,fn)=>events[name]=fn},
    localStorage: {getItem:()=>saved,setItem:(_,value)=>saved=value},
    setTimeout: (fn,delay) => { callbacks.set(++nextId,{fn,delay}); return nextId },
    clearTimeout: id => callbacks.delete(id),
  })
  const source = fs.readFileSync(new URL('../src/lib/theme.js', import.meta.url),'utf8')
    .replace(/^import .*\n/, '').replace(/export /g, '')
  vm.runInContext(source,context)
  return {
    call: code => vm.runInContext(code,context), dataset, events, callbacks,
    saved:()=>saved,
    time:(h,m=0,s=0)=>{now=+new Date(2026,8,10,h,m,s)},
    tick:()=>{const job=[...callbacks.values()][0];assert(job);job.fn()},
  }
}

test('automatic theme switches at local 07:00 and 19:00 while preserving the selected mode',()=>{
  const t=setup();t.call('initializeTheme()');assert.equal(t.dataset.theme,'dark')
  assert.equal([...t.callbacks.values()][0].delay,1000)
  t.time(7);t.tick();assert.equal(t.dataset.theme,'light')
  t.time(18,59,59);t.tick();assert.equal(t.dataset.theme,'light')
  assert.equal([...t.callbacks.values()][0].delay,1000)
  t.time(19);t.tick();assert.equal(t.dataset.theme,'dark')
  assert.equal(t.call('theme.value'),'auto');assert.equal(t.saved(),'auto')
})

test('resume refreshes automatic mode; manual themes cancel timers and survive initialization',()=>{
  const t=setup();t.call('initializeTheme()');t.time(12);t.events.focus()
  assert.equal(t.dataset.theme,'light');t.time(23);t.events.visibilitychange()
  assert.equal(t.dataset.theme,'dark');t.call("setTheme('light')")
  assert.equal(t.callbacks.size,0);t.events.focus();assert.equal(t.dataset.theme,'light')
  assert.equal(t.saved(),'light');t.call('initializeTheme()');assert.equal(t.dataset.theme,'light')
  t.call("setTheme('auto')");t.call('initializeTheme()');assert.equal(t.callbacks.size,1)
  assert.equal(t.saved(),'auto');t.call("setTheme('unknown')");assert.equal(t.dataset.theme,'dark')
})
