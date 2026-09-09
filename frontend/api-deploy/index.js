// 腾讯云 SCF Web 函数
// 部署：把 api-deploy/ 目录打包成 zip，上传到 SCF
// 运行：SCF 自动设置 PORT 环境变量，Express 监听这个端口
const express = require('express')
const axios = require('axios')
const cors = require('cors')

const app = express()
app.set('case sensitive routing', true)
app.set('strict routing', true)
app.use(cors())
app.use(express.json({ limit: '2mb' }))
require('./input-security.cjs').installInputSecurity(app)

// 托管前端静态文件（和后端同一个域名，避免 COS CDN 缓存问题）
const path = require('path')

// 全局中间件：强制所有响应 Content-Disposition: inline（覆盖 SCF 网关的 attachment）
app.use((req, res, next) => {
  res.setHeader('Content-Disposition', 'inline')
  next()
})

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
    else if (filePath.includes(path.sep + 'assets' + path.sep)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  },
}))
app.get('/health', (req, res) => res.json({ ok: true, version: 'stability-20260906' }))

// 飞书凭证（从 SCF 环境变量读）
// 旧凭证: 多维表格 bot (cli_aa0e40ef3fe19bcd) - 用于读写 Bitable
const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_aa0e40ef3fe19bcd'
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || ''
// 新凭证: 飞书企业自建应用 (cli_aa07f5b29ef89bd1) - 用于 H5 免登
const FEISHU_H5_APP_ID = process.env.FEISHU_H5_APP_ID || 'cli_aa07f5b29ef89bd1'
const FEISHU_H5_APP_SECRET = process.env.FEISHU_H5_APP_SECRET || ''
const DEFAULT_APP_TOKEN = process.env.LARK_BITABLE_APP_TOKEN || 'VYF7btMbnaNkV1sTnYBc1ldjnqh'
const DEFAULT_TIME_TABLE = process.env.LARK_TIME_ENTRIES_TABLE_ID || 'tbl4DQrLz56St8Uj'
// 用户表（与工时表同一个 base，table_id 在控制台或 API 里查）
const DEFAULT_USER_TABLE = process.env.LARK_USER_TABLE_ID || 'tblKmai7bKF54DYx'
// 设置表（存邀请码等配置）
const DEFAULT_SETTINGS_TABLE = process.env.LARK_SETTINGS_TABLE_ID || 'tblgToxZeOIQMafP'
// 团队表 / 分类表 / 国家表
const DEFAULT_TEAM_TABLE = process.env.LARK_TEAM_TABLE_ID || 'tblmAjCl6YI20Jja'
const DEFAULT_CATEGORY_TABLE = process.env.LARK_CATEGORY_TABLE_ID || 'tblWInTairM6xnAB'
const DEFAULT_COUNTRY_TABLE = process.env.LARK_COUNTRY_TABLE_ID || 'tbl3PnVDvHZmo311'

// token 缓存
let cachedToken = null
let cachedTokenExpire = 0

let tokenFlight = null
async function getTenantToken() {
  if (tokenFlight) return tokenFlight
  tokenFlight = obtainTenantToken()
  try { return await tokenFlight } finally { tokenFlight = null }
}

async function obtainTenantToken() {
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

const lark = require('./read-transport.cjs').createReadTransport(larkRequest, {
  cacheable: path => [DEFAULT_TEAM_TABLE,DEFAULT_CATEGORY_TABLE,DEFAULT_COUNTRY_TABLE].some(table => path.includes('/tables/'+table+'/records')),
})
async function larkRequest(path, method = 'GET', body = null) {
  const token = await getTenantToken()
  // 飞书日期字段需要毫秒时间戳，前端发 ISO 字符串时转换
  if (body && body.fields) {
    for (const k of ['start_time', 'end_time']) {
      const v = body.fields[k]
      if (typeof v === 'string') {
        const d = new Date(v)
        if (isNaN(d.getTime())) throw new Error('无效时间字段: ' + k)
        body.fields[k] = d.getTime()
      }
    }
  }
  // 手动序列化 body，避免 axios 在 SCF 环境丢失中文字段名
  const bodyStr = body ? JSON.stringify(body) : undefined
  const config = {
    method,
    url: `https://open.feishu.cn/open-apis${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    timeout: 15000,
  }
  if (bodyStr) {
    // 转 UTF-8 Buffer, 避免 axios 把字符串按 latin-1 发送导致中文乱码
    config.data = Buffer.from(bodyStr, 'utf-8')
  }
  const r = await axios(config)
  const data = r.data
  if (data.code !== 0) throw Object.assign(new Error(`飞书 API 错误 ${data.code}: ${data.msg || ''}`), {code:'FEISHU_'+data.code,providerCode:data.code})
  return path.includes('/tables/'+DEFAULT_TIME_TABLE+'/records') ? require('./entry-record.cjs').normalizeEntryResponse(data) : data
}

function getCtx(req) {
  const appToken = req.query.app_token || DEFAULT_APP_TOKEN
  const tableId = req.query.time_entries_table_id || DEFAULT_TIME_TABLE
  return { appToken, tableId }
}

// ───── 路由 ─────

app.get('/', (req, res) => res.json({ ok: true, msg: 'time-track-api running', version: 'v3-fields-fix' }))

// 测试路由：绕过 lark()，直接调飞书
const { installAuth } = require('./auth.cjs')
installAuth(app, { lark, appToken: DEFAULT_APP_TOKEN, userTable: DEFAULT_USER_TABLE, timeTable: DEFAULT_TIME_TABLE, categoryTable: DEFAULT_CATEGORY_TABLE, secret: () => { if (!FEISHU_H5_APP_SECRET) throw Error('Missing session signing secret'); return FEISHU_H5_APP_SECRET }, appId: () => FEISHU_H5_APP_ID })
require('./history.cjs').installHistory(app, { lark, appToken: DEFAULT_APP_TOKEN, timeTable: DEFAULT_TIME_TABLE, auditTable: process.env.LARK_AUDIT_TABLE_ID || 'tbla2kZObkEkozl4' })
function escapeFilter(value) { return JSON.stringify(String(value || '')).slice(1, -1) }

app.post('/test-direct', async (req, res) => {
  try {
    const token = await getTenantToken()
    const bodyStr = JSON.stringify(req.body)
    const r = await axios({
      method: 'POST',
      url: `https://open.feishu.cn/open-apis/bitable/v1/apps/${DEFAULT_APP_TOKEN}/tables/${DEFAULT_TIME_TABLE}/records`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
      data: bodyStr,
      timeout: 15000,
    })
    res.json(r.data)
  } catch (e) {
    res.status(500).json({ error: e.message, resp: e.response ? e.response.data : null })
  }
})

require('./passwords.cjs').installPasswords(app, { lark, appToken: DEFAULT_APP_TOKEN, userTable: DEFAULT_USER_TABLE, settingsTable: DEFAULT_SETTINGS_TABLE })

// POST /update-profile → 修改姓名
app.post('/update-profile', async (req, res) => {
  try {
    const { username, display_name } = req.body || {}
    if (!username || !display_name) {
      return res.status(400).json({ ok: false, error: '用户名和姓名都必填' })
    }

    const appToken = req.query.app_token || DEFAULT_APP_TOKEN
    const userTableId = req.query.user_table_id || DEFAULT_USER_TABLE

    // 1. 查用户记录
    const filter = `CurrentValue.[用户名]="${escapeFilter(username)}"`
    const params = new URLSearchParams({ page_size: '5', filter })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${userTableId}/records?${params}`)
    const items = data.data.items || []
    if (items.length === 0) {
      return res.json({ ok: false, error: '用户不存在' })
    }

    // 2. 更新姓名
    const recordId = items[0].record_id
    await lark(
      `/bitable/v1/apps/${appToken}/tables/${userTableId}/records/${recordId}`,
      'PUT',
      { fields: { '姓名': display_name } },
    )
    return res.json({ ok: true, display_name })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// GET /entries → 列出条目（可选 ?user=xxx 按用户过滤）
app.get('/entries', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const { page_size = 100, page_token, user } = req.query
    const params = new URLSearchParams({ page_size: String(Math.min(500, Math.max(1, Number(page_size) || 100))) })
    if (page_token) params.set('page_token', page_token)
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/search?${params}`, 'POST', {field_names:['user','description','category','country','notes','start_time','end_time','deleted_at'],automatic_fields:false})
    res.json({ items: (data.data.items || []).filter(record => !user || record.fields.user === user), total: data.data.total, has_more: data.data.has_more, page_token: data.data.page_token })
  } catch (e) { console.error('entries_read_failed', {code:e.code || 'provider_error',status:e.response?.status || 0}); res.status(503).json({ error: '工时数据源暂时繁忙，请稍后重试' }) }
})

// POST /timer/start → 开始计时，立即写库一条 end_time 为空的记录
// body: { user, description, category, country, notes }
// 返回: { record_id, start_time }
app.post('/timer/start', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const b = req.body || {}
    if (!b.user) return res.status(400).json({ error: 'user 必填' })

    const startTime = Date.now()
    const fields = {
      'description': b.description || '',
      'category': b.category || '其他',
      'start_time': startTime,
      'end_time': null,  // 空 = 计时中
      'user': b.user,
      'country': b.country || '国内',
      'notes': b.notes || '',
    }
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records`, 'POST', { fields })
    const record = data.data.record
    res.json({
      record_id: record.record_id,
      start_time: startTime,
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /timer/stop → 完成计时，PUT 补全 end_time + 时长(秒) + 时长(小时)
// body: { record_id }  (end_time 用当前时间)
// 返回: { ok: true, duration_ms, duration_sec, duration_hour }
app.post('/timer/stop', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const { record_id } = req.body || {}
    if (!record_id) return res.status(400).json({ error: 'record_id 必填' })

    // 先查这条记录，拿 start_time 算时长
    const r = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${record_id}`)
    const startMs = r.data.record.fields.start_time
    const existingEnd = r.data.record.fields.end_time
    const endTime = existingEnd ? new Date(existingEnd).getTime() : Date.now()
    if (!Number.isFinite(Number(startMs)) || Number(startMs) <= 0 || !Number.isFinite(endTime) || endTime < Number(startMs)) {
      return res.status(400).json({ error: '计时记录的开始或结束时间无效' })
    }

    // 计算时长
    const durationMs = startMs ? (endTime - startMs) : 0
    const durationSec = Math.floor(durationMs / 1000)
    const durationHour = Math.round((durationMs / 3600000) * 10000) / 10000  // 保留4位小数

    // PUT 补全 end_time + 时长(秒) + 时长(小时)
    await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${record_id}`, 'PUT', {
      fields: {
        'end_time': endTime,
        '时长(秒)': durationSec,
        '时长（小时）': durationHour,
      }
    })

    res.json({ ok: true, end_time: endTime, duration_ms: durationMs, duration_sec: durationSec, duration_hour: durationHour })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /timer/active?user=xxx → 查某用户正在计时的记录（end_time 为空）
// 返回: { record_id, start_time, description, category } 或 { active: false }
app.get('/timer/active', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const { user } = req.query
    if (!user) return res.status(400).json({ error: 'user 必填' })

    // 查该用户 end_time 为空的记录
    const filter = `AND(CurrentValue.[user]="${escapeFilter(user)}", CurrentValue.[end_time]="")`
    const params = new URLSearchParams({ page_size: '5', filter })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params}`)
    const items = data.data.items || []
    if (items.length === 0) {
      res.json({ active: false })
    } else {
      const item = items[0]
      const f = item.fields
      res.json({
        active: true,
        record_id: item.record_id,
        start_time: f.start_time,
        description: f.description || '',
        category: f.category || '其他',
        user: f.user || user,
        country: f.country || '中国',
        notes: f.notes || '',
      })
    }
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/entries → 新增条目
app.post('/entries', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const { fields } = req.body || {}
    if (!fields) return res.status(400).json({ error: 'fields 必填' })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records`, 'POST', { fields })
    res.json({ record: data.data.record })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /entries/batch → 批量导入 { rows: [{ 日期, 成员, 任务名称, 任务分类, 国家, 任务开始时间, 任务结束时间, 工时, 备注 }] }
// 权限: admin 可导入所有人; team_admin 只能导入本团队; member 只能导入自己
require('./import.cjs').installImport(app, { lark, appToken: DEFAULT_APP_TOKEN, timeTable: DEFAULT_TIME_TABLE, userTable: DEFAULT_USER_TABLE })

// PATCH /api/entry?id=xxx → 编辑条目
app.patch('/entry', async (req, res) => {
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

// PUT /entries/:id → 编辑条目（RESTful）
// 如果改了 start_time/end_time, 自动重算 时长(秒) + 时长(小时)
app.put('/entries/:id', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const recordId = req.params.id
    if (!recordId) return res.status(400).json({ error: 'id 必填' })
    const { fields } = req.body || {}
    if (!fields) return res.status(400).json({ error: 'fields 必填' })

    // 如果改了 start_time 或 end_time, 重算时长
    if (fields.start_time !== undefined || fields.end_time !== undefined) {
      // 先读现有 record, 拿原始 start_time/end_time
      const r = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`)
      const oldFields = r.data.record.fields
      // 合并新旧字段
      const startTime = fields.start_time !== undefined ? fields.start_time : oldFields.start_time
      const endTime = fields.end_time !== undefined ? fields.end_time : oldFields.end_time
      // 转毫秒时间戳
      const startMs = typeof startTime === 'string' ? new Date(startTime).getTime() : startTime
      const endMs = typeof endTime === 'string' ? new Date(endTime).getTime() : endTime
      if (!Number.isFinite(startMs) || startMs <= 0 || (endTime != null && (!Number.isFinite(endMs) || endMs <= startMs))) {
        return res.status(400).json({ error: '结束时间必须晚于有效的开始时间' })
      }
      if (startMs && endMs) {
        const durationMs = endMs - startMs
        const durationSec = Math.floor(durationMs / 1000)
        const durationHour = Math.round((durationMs / 3600000) * 10000) / 10000
        fields['时长(秒)'] = durationSec
        fields['时长（小时）'] = durationHour
      }
    }

    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, 'PUT', { fields })
    res.json({ record: data.data.record })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/entry?id=xxx → 删除条目
app.delete('/entry', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const recordId = req.query.id
    if (!recordId) return res.status(400).json({ error: 'id 必填' })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, 'DELETE')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /entries/:id → 删除条目（RESTful）
app.delete('/entries/:id', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const recordId = req.params.id
    if (!recordId) return res.status(400).json({ error: 'id 必填' })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, 'DELETE')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ───── 团队接口 ─────
// GET /teams → 列出所有团队
app.get('/teams', async (req, res) => {
  try {
    const appToken = DEFAULT_APP_TOKEN
    const params = new URLSearchParams({ page_size: '100' })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${DEFAULT_TEAM_TABLE}/records?${params}`)
    const items = (data.data.items || []).map(i => ({
      record_id: i.record_id,
      name: i.fields['团队名'] || '',
      description: i.fields['团队描述'] || '',
    }))
    res.json({ items })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /teams → 创建团队 { name, description }
app.post('/teams', async (req, res) => {
  try {
    const appToken = DEFAULT_APP_TOKEN
    const { name, description } = req.body || {}
    if (!name) return res.status(400).json({ error: 'name 必填' })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${DEFAULT_TEAM_TABLE}/records`, 'POST', {
      fields: { '团队名': name, '团队描述': description || '' }
    })
    res.json({ record_id: data.data.record.record_id, name })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /teams/:id → 删除团队
app.delete('/teams/:id', async (req, res) => {
  try {
    const appToken = DEFAULT_APP_TOKEN
    const recordId = req.params.id
    if (!recordId) return res.status(400).json({ error: 'id 必填' })
    await lark(`/bitable/v1/apps/${appToken}/tables/${DEFAULT_TEAM_TABLE}/records/${recordId}`, 'DELETE')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ───── 团队成员接口 ─────
// GET /teams/members?team=xxx → 列出某团队的所有成员
// 不传 team 则返回全部用户
app.get('/teams/members', async (req, res) => {
  try {
    const { team } = req.query
    const data = {data:{items:req.auth.all.filter(record => !team || record.fields['团队'] === team)}}
    const items = (data.data.items || []).map(i => {
      const f = i.fields
      return {
        record_id: i.record_id,
        username: f['用户名'] || '',
        display_name: f['姓名'] || f['用户名'] || '',
        role: f['角色'] || 'member',
        team: f['团队'] || '',
        feishu_user_id: f['feishu_user_id'] || '',
      }
    })
    res.json({ items })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /teams/members → 分配成员到团队 { record_id, team, role }
app.post('/teams/members', async (req, res) => {
  try {
    const appToken = DEFAULT_APP_TOKEN
    const { record_id, team, role } = req.body || {}
    if (!record_id) return res.status(400).json({ error: 'record_id 必填' })
    const fields = {}
    if (team !== undefined) fields['团队'] = team
    if (role !== undefined) fields['角色'] = role
    await lark(`/bitable/v1/apps/${appToken}/tables/${DEFAULT_USER_TABLE}/records/${record_id}`, 'PUT', { fields })
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ───── 分类接口 ─────
// GET /categories?team=xxx → 列出某团队的分类（不传 team 则返回全部）
app.get('/categories', async (req, res) => {
  try {
    const appToken = DEFAULT_APP_TOKEN
    const { team } = req.query
    const params = new URLSearchParams({ page_size: '200' })
    if (team) {
      params.set('filter', `CurrentValue.[团队]="${escapeFilter(team)}"`)
    }
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${DEFAULT_CATEGORY_TABLE}/records?${params}`)
    const items = (data.data.items || []).map(i => ({
      record_id: i.record_id,
      team: i.fields['团队'] || '',
      name: i.fields['分类名'] || '',
      color: i.fields['颜色'] || '#6b7280',
    }))
    res.json({ items })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /categories → 创建分类 { team, name, color }
app.post('/categories', async (req, res) => {
  try {
    const appToken = DEFAULT_APP_TOKEN
    const { team, name, color } = req.body || {}
    if (!team || !name) return res.status(400).json({ error: 'team 和 name 必填' })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${DEFAULT_CATEGORY_TABLE}/records`, 'POST', {
      fields: { '团队': team, '分类名': name, '颜色': color || '#6366f1' }
    })
    res.json({ record_id: data.data.record.record_id, name, color: color || '#6366f1' })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /categories/:id → 删除分类
app.delete('/categories/:id', async (req, res) => {
  try {
    const appToken = DEFAULT_APP_TOKEN
    const recordId = req.params.id
    if (!recordId) return res.status(400).json({ error: 'id 必填' })
    await lark(`/bitable/v1/apps/${appToken}/tables/${DEFAULT_CATEGORY_TABLE}/records/${recordId}`, 'DELETE')
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PUT /categories/:id → 更新分类 { name?, color? }
app.put('/categories/:id', async (req, res) => {
  try {
    const appToken = DEFAULT_APP_TOKEN
    const recordId = req.params.id
    if (!recordId) return res.status(400).json({ error: 'id 必填' })
    const { name, color } = req.body || {}
    const fields = {}
    if (name !== undefined) fields['分类名'] = name
    if (color !== undefined) fields['颜色'] = color
    if (Object.keys(fields).length === 0) return res.status(400).json({ error: '至少传 name 或 color' })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${DEFAULT_CATEGORY_TABLE}/records/${recordId}`, 'PUT', { fields })
    res.json({ ok: true, record: data.data.record })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ───── 国家接口 ─────
// GET /countries → 列出所有预设国家
app.get('/countries', async (req, res) => {
  try {
    const appToken = DEFAULT_APP_TOKEN
    const params = new URLSearchParams({ page_size: '200' })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${DEFAULT_COUNTRY_TABLE}/records?${params}`)
    const items = (data.data.items || []).map(i => ({
      record_id: i.record_id,
      name: i.fields['国家名'] || '',
      code: i.fields['代码'] || '',
    }))
    res.json({ items })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ───── 飞书 H5 免登接口 ─────

// JSAPI 鉴权：生成 signature
// GET /feishu-jsapi-sign?url=xxx → 返回 { appId, timestamp, noncestr, signature }
const crypto = require('crypto')

let cachedJsapiTicket = null
let cachedJsapiTicketExpire = 0

async function getH5AppAccessToken() {
  // 飞书企业自建应用 (cli_aa07f5b29ef89bd1) 的 app_access_token
  const r = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
    { app_id: FEISHU_H5_APP_ID, app_secret: FEISHU_H5_APP_SECRET },
    { timeout: 10000 }
  )
  if (!r.data.app_access_token) throw new Error(`获取 H5 app_access_token 失败: ${JSON.stringify(r.data)}`)
  return r.data.app_access_token
}

async function getJsapiTicket() {
  const now = Date.now()
  if (cachedJsapiTicket && now < cachedJsapiTicketExpire - 60000) return cachedJsapiTicket
  const appAccessToken = await getH5AppAccessToken()
  const r = await axios.post(
    'https://open.feishu.cn/open-apis/jssdk/ticket/get',
    {},
    { headers: { Authorization: `Bearer ${appAccessToken}` }, timeout: 10000 }
  )
  const ticket = r.data?.data?.ticket
  if (!ticket) throw new Error(`获取 jsapi_ticket 失败: ${JSON.stringify(r.data)}`)
  cachedJsapiTicket = ticket
  cachedJsapiTicketExpire = now + (r.data?.data?.expire_in || 7200) * 1000
  return ticket
}

app.get('/feishu-jsapi-sign', async (req, res) => {
  try {
    const { url } = req.query
    if (!url) return res.status(400).json({ error: 'url 必填' })

    const ticket = await getJsapiTicket()
    const noncestr = Math.random().toString(36).substring(2, 18)
    const timestamp = Math.floor(Date.now() / 1000).toString()

    // signature = sha1(ticket + noncestr + timestamp + url)
    const signStr = `jsapi_ticket=${ticket}&noncestr=${noncestr}&timestamp=${timestamp}&url=${url}`
    const signature = crypto.createHash('sha1').update(signStr).digest('hex')

    res.json({
      appId: FEISHU_H5_APP_ID,
      timestamp,
      noncestr,
      signature,
    })
  } catch (e) {
    console.error('feishu-jsapi-sign error:', e.response?.data || e.message)
    res.status(500).json({ error: e.message })
  }
})

// GET /feishu-auth?code=xxx → 用 code 换 user_id, 再匹配用户表
// 返回: { ok, user, role, display_name, team, feishu_user_id }
app.post('/feishu-auth', async (req, res) => {
  try {
    const { code } = req.query
    if (!code) return res.status(400).json({ error: 'code 必填' })

    // 1. 用 code 换 user_access_token (飞书 v2 oauth2)
    // 注意: 飞书v2 oauth2错误时返回HTTP 400, axios会抛异常, 需要捕获
    let tokenData
    try {
      const tokenRes = await axios.post(
        'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
        {
          grant_type: 'authorization_code',
          client_id: FEISHU_H5_APP_ID,
          client_secret: FEISHU_H5_APP_SECRET,
          code,
          redirect_uri: req.query.redirect_uri,
        },
        { timeout: 10000 }
      )
      tokenData = tokenRes.data || {}
    } catch (tokenErr) {
      // 飞书返回400, 提取错误信息
      const errData = tokenErr.response?.data || {}
      return res.status(401).json({
        ok: false,
        error: 'code 无效或已过期: ' + (errData.error_description || errData.error || '未知错误'),
        code: errData.code,
      })
    }

    if (!tokenData.access_token) {
      return res.status(401).json({ ok: false, error: '未获取到 access_token', detail: tokenData })
    }
    const userAccessToken = tokenData.access_token

    // 2. 用 user_access_token 拿用户信息 (v2 用 authen/v1/user_info)
    let userData
    try {
      const userRes = await axios.get(
        'https://open.feishu.cn/open-apis/authen/v1/user_info',
        { headers: { Authorization: `Bearer ${userAccessToken}` }, timeout: 10000 }
      )
      userData = userRes.data.data || {}
    } catch (userErr) {
      const errData = userErr.response?.data || {}
      return res.status(401).json({
        ok: false,
        error: '获取用户信息失败: ' + (errData.error_description || errData.error || '未知错误'),
        code: errData.code,
      })
    }

    const feishuUserId = userData.user_id || userData.open_id || userData.union_id

    if (!feishuUserId) {
      return res.status(401).json({ ok: false, error: '无法获取飞书用户 ID', detail: userData })
    }

    // 3. 查用户表, 匹配 feishu_user_id 字段
    const tenantToken = await getTenantToken()
    const filter = `CurrentValue.[feishu_user_id]="${escapeFilter(feishuUserId)}"`
    const params = new URLSearchParams({ page_size: '5', filter })
    const userQuery = await axios.get(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${DEFAULT_APP_TOKEN}/tables/${DEFAULT_USER_TABLE}/records?${params}`,
      { headers: { Authorization: `Bearer ${tenantToken}` }, timeout: 10000 }
    )
    const userItems = userQuery.data.data.items || []
    if (userItems.length === 0) {
      // 用户表里没这个飞书用户 → 需要先在用户表注册/绑定
      return res.json({
        ok: false,
        error: '飞书账号未绑定系统用户, 请先在网页端登录并在设置页绑定飞书',
        feishu_user_id: feishuUserId,
      })
    }

    // 4. 匹配成功 → 返回用户信息
    const u = userItems[0].fields
    res.json({
      ok: true,
      user: u['用户名'] || '',
      role: u['角色'] || 'member',
      display_name: u['姓名'] || u['用户名'] || '',
      team: u['团队'] || '',
      feishu_user_id: feishuUserId,
    })
  } catch (e) {
    console.error('feishu-auth error:', e.response?.data || e.message)
    res.status(500).json({ error: e.message })
  }
})

// POST /feishu-bind → 用户绑定飞书账号 (在设置页点"绑定飞书"时调用)
// body: { username, feishu_user_id }
app.post('/feishu-bind', async (req, res) => {
  try {
    const { username, feishu_user_id } = req.body || {}
    if (!username || !feishu_user_id) {
      return res.status(400).json({ error: 'username 和 feishu_user_id 必填' })
    }

    // 1. 查用户表里有没有这个 username
    const tenantToken = await getTenantToken()
    const filter = `CurrentValue.[用户名]="${escapeFilter(username)}"`
    const params = new URLSearchParams({ page_size: '5', filter })
    const userQuery = await axios.get(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${DEFAULT_APP_TOKEN}/tables/${DEFAULT_USER_TABLE}/records?${params}`,
      { headers: { Authorization: `Bearer ${tenantToken}` }, timeout: 10000 }
    )
    const userItems = userQuery.data.data.items || []
    if (userItems.length === 0) {
      return res.json({ ok: false, error: '用户名不存在' })
    }
    const recordId = userItems[0].record_id

    // 2. 检查这个 feishu_user_id 是否已被其他人绑定
    const filter2 = `CurrentValue.[feishu_user_id]="${escapeFilter(feishu_user_id)}"`
    const params2 = new URLSearchParams({ page_size: '5', filter: filter2 })
    const dupQuery = await axios.get(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${DEFAULT_APP_TOKEN}/tables/${DEFAULT_USER_TABLE}/records?${params2}`,
      { headers: { Authorization: `Bearer ${tenantToken}` }, timeout: 10000 }
    )
    const dupItems = dupQuery.data.data.items || []
    if (dupItems.length > 0 && dupItems[0].record_id !== recordId) {
      return res.json({ ok: false, error: '该飞书账号已被其他用户绑定' })
    }

    // 3. PUT 更新 feishu_user_id 字段
    await axios.put(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${DEFAULT_APP_TOKEN}/tables/${DEFAULT_USER_TABLE}/records/${recordId}`,
      { fields: { 'feishu_user_id': feishu_user_id } },
      { headers: { Authorization: `Bearer ${tenantToken}`, 'Content-Type': 'application/json' }, timeout: 10000 }
    )

    res.json({ ok: true, feishu_user_id })
  } catch (e) {
    console.error('feishu-bind error:', e.response?.data || e.message)
    res.status(500).json({ error: e.message })
  }
})


// Display-only translation. Credentials stay in server environment variables.
const { createTranslationService } = require('./translation.cjs')
const translateContent = createTranslationService({ appid: process.env.BAIDU_APP_ID, key: process.env.BAIDU_KEY })
app.post('/translate', async (req, res) => {
  try {
    res.json({ text: await translateContent(req.body) })
  } catch (error) {
    res.status(error.status || 502).json({ error: error.status ? error.message : 'Translation temporarily unavailable' })
  }
})

// Views are selected in-app; unknown API paths must not fall back to HTML.
app.use((req, res) => res.status(404).json({ error: '接口不存在' }))
app.use((error,req,res,next) => {
  res.status(error.type === 'entity.too.large' ? 413 : 400).json({error:'请求格式无效或内容过大'})
})

// ───── 启动 ─────
const port = process.env.PORT || 9000
app.listen(port, () => {
  console.log(`time-track-api listening on port ${port}`)
})

module.exports = { app }
