// 飞书 API 封装（Vercel serverless 内部用）
// 凭证从 Vercel 环境变量读：LARK_APP_ID, LARK_APP_SECRET, LARK_BITABLE_APP_TOKEN

const BASE = 'https://open.feishu.cn/open-apis'

let cachedToken = null
let cachedTokenExpire = 0

export async function getTenantToken() {
  const now = Date.now()
  if (cachedToken && now < cachedTokenExpire - 60000) {
    return cachedToken
  }
  const appId = process.env.LARK_APP_ID
  const appSecret = process.env.LARK_APP_SECRET
  if (!appId || !appSecret) {
    throw new Error('LARK_APP_ID / LARK_APP_SECRET 未配置（Vercel 环境变量）')
  }
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const data = await r.json()
  if (!data.tenant_access_token) {
    throw new Error(`获取 token 失败: ${JSON.stringify(data)}`)
  }
  cachedToken = data.tenant_access_token
  cachedTokenExpire = now + (data.expire || 7200) * 1000
  return cachedToken
}

export function getAppToken(query = {}) {
  // 1. URL 参数（驼峰或下划线）
  const fromUrl = query.app_token || query.appToken
  if (fromUrl) return fromUrl
  // 2. 环境变量
  const fromEnv = process.env.LARK_BITABLE_APP_TOKEN
  if (fromEnv) return fromEnv
  throw new Error('LARK_BITABLE_APP_TOKEN 未配置')
}

// 各表 table_id 也走环境变量（您之前 .env 里那几个）
// 优先级：URL 参数 > 环境变量
export function getTableId(name, query = {}) {
  const urlKey = `LARK_${name.toUpperCase()}_TABLE_ID`
  const map = {
    clients: ['LARK_CLIENTS_TABLE_ID', 'clients_table_id'],
    projects: ['LARK_PROJECTS_TABLE_ID', 'projects_table_id'],
    tags: ['LARK_TAGS_TABLE_ID', 'tags_table_id'],
    time_entries: ['LARK_TIME_ENTRIES_TABLE_ID', 'time_entries_table_id'],
  }
  const cfg = map[name]
  if (!cfg) throw new Error(`未知表: ${name}`)
  // 1. URL 参数（驼峰或下划线）
  const fromUrl = query[cfg[1]] || query[urlKey]
  if (fromUrl) return fromUrl
  // 2. 环境变量
  const fromEnv = process.env[cfg[0]]
  if (fromEnv) return fromEnv
  throw new Error(`table_id 未配置: ${name}`)
}

// 通用飞书 API 调用
export async function lark(path, options = {}) {
  const token = await getTenantToken()
  const r = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const data = await r.json()
  if (data.code !== 0) {
    throw new Error(`飞书 API 错误 ${data.code}: ${data.msg || ''}`)
  }
  return data
}

// JSON 响应
export function json(res, data, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

// 错误响应
export function fail(res, err, status = 500) {
  json(res, { error: err.message || String(err) }, status)
}
