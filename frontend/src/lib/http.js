export function createHttp({ base, fetchImpl = globalThis.fetch, now = Date.now, timeout = 25000, message = text => text }) {
  const cache = new Map()
  const pending = new Map()
  let generation = 0
  function clear() { generation++; cache.clear(); pending.clear() }

  async function request(url, options) {
    const session = globalThis.localStorage?.getItem('tt_session')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetchImpl(url, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(session ? {Authorization: 'Bearer ' + session} : {}), ...options.headers },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      })
      if (res.status === 401 && session === globalThis.localStorage?.getItem('tt_session') && !['/login','/feishu-auth','/auth/feishu/start'].includes(new URL(url).pathname)) {
        globalThis.localStorage?.removeItem('tt_session')
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('auth-expired'))
      }
      const data = await res.json().catch(() => null)
      if (!res.ok || data?.ok === false && options.method && options.method !== 'GET') {
        const error = new Error(message(data?.error || data?.message || `HTTP ${res.status}`))
        error.status = res.status
        throw error
      }
      if (data === null) throw new Error(message("服务器返回了无效数据，请重试"))
      return data
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(message("请求超时，请检查网络后重试"))
      throw error
    } finally { clearTimeout(timer) }
  }

  async function http(path, options = {}) {
    const url = new URL(path, base.endsWith('/') ? base : base + '/')
    url.searchParams.sort()
    const key = url.toString()
    const method = options.method || 'GET'
    const cacheable = method === 'GET' && ['/entries', '/teams', '/teams/members', '/categories', '/countries'].includes(url.pathname)
    if (method !== 'GET') clear()
    if (!cacheable) {
      try { return await request(key, options) }
      finally { if (method !== 'GET') clear() }
    }
    const ttl = url.pathname === '/entries' ? 5000 : 30000
    const saved = cache.get(key)
    if (saved && now() - saved.time < ttl) return structuredClone(saved.data)
    if (pending.has(key)) return structuredClone(await pending.get(key))
    const version = generation
    const task = request(key, options)
    pending.set(key, task)
    try {
      const data = await task
      if (generation === version) cache.set(key, { data, time: now() })
      return structuredClone(data)
    } finally { if (pending.get(key) === task) pending.delete(key) }
  }
  http.clear = clear
  http.message = message
  return http
}

export async function fetchAllEntries(http) {
  const message = http.message || (text => text)
  const items = new Map()
  const seen = new Set()
  let token = ''
  do {
    const query = new URLSearchParams({ page_size: '500' })
    if (token) query.set('page_token', token)
    const data = await http('/entries?' + query)
    if (!Array.isArray(data.items)) throw new Error(message("工时数据格式错误"))
    for (const item of data.items) items.set(item.record_id, item)
    if (!data.has_more) break
    if (!data.page_token || seen.has(data.page_token)) {
      throw new Error(message("工时分页不完整，请更新后端后重试；本次未覆盖已有记录"))
    }
    token = data.page_token
    seen.add(token)
  } while (token)
  return [...items.values()]
}
