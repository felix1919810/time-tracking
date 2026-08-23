// 腾讯云 SCF Web 函数
// 部署：把 api-deploy/ 目录打包成 zip，上传到 SCF
// 运行：SCF 自动设置 PORT 环境变量，Express 监听这个端口
const express = require('express')
const axios = require('axios')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

// 飞书凭证（从 SCF 环境变量读）
const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_aa0e40ef3fe19bcd'
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'dyBZhig4pWYsDuBlgnRsRdaqYMecCHw6'
const DEFAULT_APP_TOKEN = process.env.LARK_BITABLE_APP_TOKEN || 'VYF7btMbnaNkV1sTnYBc1ldjnqh'
const DEFAULT_TIME_TABLE = process.env.LARK_TIME_ENTRIES_TABLE_ID || 'tbl4DQrLz56St8Uj'

// token 缓存
let cachedToken = null
let cachedTokenExpire = 0

async function getTenantToken() {
  const now = Date.now()
  if (cachedToken && now < cachedTokenExpire - 60000) return cachedToken
  const r = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET },
    { timeout: 10000 }
  )
  const data = r.data
  if (!data.tenant_access_token) throw new Error(`获取 token 失败: ${JSON.stringify(data)}`)
  cachedToken = data.tenant_access_token
  cachedTokenExpire = now + (data.expire || 7200) * 1000
  return cachedToken
}

async function lark(path, method = 'GET', body = null) {
  const token = await getTenantToken()
  const config = {
    method,
    url: `https://open.feishu.cn/open-apis${path}`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 15000,
  }
  if (body) config.data = body
  const r = await axios(config)
  const data = r.data
  if (data.code !== 0) throw new Error(`飞书 API 错误 ${data.code}: ${data.msg || ''}`)
  return data
}

function getCtx(req) {
  const appToken = req.query.app_token || DEFAULT_APP_TOKEN
  const tableId = req.query.time_entries_table_id || DEFAULT_TIME_TABLE
  return { appToken, tableId }
}

// ───── 路由 ─────

app.get('/', (req, res) => res.json({ ok: true, msg: 'time-track-api running' }))

// GET /api/entries → 列出条目
app.get('/api/entries', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const { page_size = 100, page_token } = req.query
    const params = new URLSearchParams({ page_size: String(page_size) })
    if (page_token) params.set('page_token', page_token)
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params}`)
    res.json({ items: data.data.items || [], total: data.data.total, has_more: data.data.has_more })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/entries → 新增条目
app.post('/api/entries', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const { fields } = req.body || {}
    if (!fields) return res.status(400).json({ error: 'fields 必填' })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records`, 'POST', { fields })
    res.json({ record: data.data.record })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PATCH /api/entry?id=xxx → 编辑条目
app.patch('/api/entry', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const recordId = req.query.id
    if (!recordId) return res.status(400).json({ error: 'id 必填' })
    const { fields } = req.body || {}
    if (!fields) return res.status(400).json({ error: 'fields 必填' })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, 'PUT', { fields })
    res.json({ record: data.data.record })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/entry?id=xxx → 删除条目
app.delete('/api/entry', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const recordId = req.query.id
    if (!recordId) return res.status(400).json({ error: 'id 必填' })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, 'DELETE')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ───── 启动 ─────
const port = process.env.PORT || 9000
app.listen(port, () => {
  console.log(`time-track-api listening on port ${port}`)
})

module.exports = { app }
