// A bounded, account-scoped display cache. Original records never enter this store.
export function createTranslationClient({ request, changed = () => {}, now = Date.now, limit = 1000 }) {
  const cache = new Map(), pending = new Set(), failures = new Map()
  let queue = [], active = 0, generation = 0
  const keyFor = (text, to) => JSON.stringify([to, text])
  function drain() {
    while (active < 2 && queue.length) {
      const task = queue.shift()
      if (task.generation !== generation) continue
      active++
      Promise.resolve().then(() => request(task.text, task.to)).then(result => {
        if (task.generation !== generation) return
        if (typeof result !== 'string' || !result.trim()) throw new Error('Empty translation')
        cache.set(task.key, result)
        if (cache.size > limit) cache.delete(cache.keys().next().value)
        failures.delete(task.key)
      }).catch(() => {
        if (task.generation === generation) failures.set(task.key, now() + 30000)
        if (failures.size > limit) failures.delete(failures.keys().next().value)
      }).finally(() => {
        active--
        if (task.generation === generation) { pending.delete(task.key); changed() }
        drain()
      })
    }
  }
  return {
    read(text, to, { translate = true } = {}) {
      if (typeof text !== 'string' || !text.trim() || !translate) return text || ''
      // The first version supports Chinese and English content only.
      const hasChinese = /[\u3400-\u9fff]/.test(text)
      if (to === 'en' && !hasChinese || to === 'zh' && (hasChinese || !/[A-Za-z]{2}/.test(text))) return text
      const key = keyFor(text, to)
      if (cache.has(key)) return cache.get(key)
      if (!pending.has(key) && (failures.get(key) || 0) <= now() && pending.size < limit) {
        pending.add(key)
        queue.push({ text, to, key, generation })
        queueMicrotask(drain)
      }
      return text
    },
    reset() { generation++; queue = []; cache.clear(); pending.clear(); failures.clear(); changed() },
    get status() { return { pending: pending.size, failed: failures.size } },
  }
}
