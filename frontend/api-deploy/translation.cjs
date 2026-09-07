const https = require('node:https')
const { createHash, randomBytes } = require('node:crypto')

function baiduRequest({ text, from, to, appid, key }) {
  const salt = randomBytes(8).toString('hex')
  const sign = createHash('md5').update(appid + text + salt + key).digest('hex')
  const body = new URLSearchParams({ q: text, from, to, appid, salt, sign }).toString()
  return new Promise((resolve, reject) => {
    const request = https.request('https://fanyi-api.baidu.com/api/trans/vip/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, response => {
      let data = '', size = 0
      response.setEncoding('utf8')
      response.on('data', chunk => {
        size += Buffer.byteLength(chunk)
        if (size > 1000000) request.destroy(new Error('Translation response too large'))
        else data += chunk
      })
      response.on('error', reject)
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('Translation provider unavailable')
          const result = JSON.parse(data)
          if (result.error_code || !Array.isArray(result.trans_result) || !result.trans_result.length) throw new Error('Translation provider rejected the request')
          // Baidu returns one result per paragraph. Keep every paragraph.
          resolve(result.trans_result.map(item => item.dst).join('\n'))
        } catch (error) { reject(error) }
      })
    })
    request.setTimeout(10000, () => request.destroy(new Error('Translation timed out')))
    request.on('error', reject)
    request.end(body)
  })
}

function createTranslationService({ appid, key, request = baiduRequest, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), interval = 1100 } = {}) {
  const cache = new Map(), pending = new Map()
  let tail = Promise.resolve(), lastRequest = -Infinity
  async function translateOne(text, from, to) {
    const cacheKey = JSON.stringify([text, from, to])
    const cached = cache.get(cacheKey)
    if (cached && cached.expires > now()) return cached.text
    if (pending.has(cacheKey)) return pending.get(cacheKey)
    if (pending.size >= 100) throw Object.assign(new Error('Translation is busy; try again later'), { status: 429 })
    const job = tail.catch(() => {}).then(async () => {
      const characters = Array.from(text), parts = []
      for (let i = 0; i < characters.length; i += 1800) {
        const wait = interval - (now() - lastRequest)
        if (wait > 0) await pause(wait)
        lastRequest = now()
        const result = await request({ text: characters.slice(i, i + 1800).join(''), from, to, appid, key })
        if (typeof result !== 'string' || !result.trim()) throw new Error('Empty translation')
        parts.push(result)
      }
      const result = parts.join('\n')
      cache.set(cacheKey, { text: result, expires: now() + 86400000 })
      if (cache.size > 1000) cache.delete(cache.keys().next().value)
      return result
    })
    tail = job
    pending.set(cacheKey, job)
    try { return await job } finally { pending.delete(cacheKey) }
  }
  return async ({ text, from = 'auto', to = 'en' } = {}) => {
    const items = Array.isArray(text) ? text : [text]
    if (!['auto', 'zh', 'en'].includes(from) || !['zh', 'en'].includes(to) || !items.length || items.length > 20 || items.some(item => typeof item !== 'string' || !item.trim()) || items.reduce((sum, item) => sum + item.length, 0) > 12000) {
      throw Object.assign(new Error('Invalid translation request'), { status: 400 })
    }
    if (!appid || !key) throw Object.assign(new Error('Translation is not configured'), { status: 503 })
    const results = await Promise.all(items.map(item => translateOne(item, from, to)))
    return Array.isArray(text) ? results : results[0]
  }
}
module.exports = { createTranslationService, baiduRequest }
