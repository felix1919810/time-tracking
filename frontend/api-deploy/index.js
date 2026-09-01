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
// 旧凭证: 多维表格 bot (cli_aa0e40ef3fe19bcd) - 用于读写 Bitable
const LARK_APP_ID = process.env.LARK_APP_ID || 'cli_aa0e40ef3fe19bcd'
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || 'dyBZhig4pWYsDuBlgnRsRdaqYMecCHw6'
// 新凭证: 飞书企业自建应用 (cli_aa07f5b29ef89bd1) - 用于 H5 免登
const FEISHU_H5_APP_ID = process.env.FEISHU_H5_APP_ID || 'cli_aa07f5b29ef89bd1'
const FEISHU_H5_APP_SECRET = process.env.FEISHU_H5_APP_SECRET || 'iaNlh9dpp4dpKxkvJaOQOeXq00EpNUui'
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
  // 飞书日期字段需要毫秒时间戳，前端发 ISO 字符串时转换
  if (body && body.fields) {
    for (const k of ['start_time', 'end_time']) {
      const v = body.fields[k]
      if (typeof v === 'string') {
        const d = new Date(v)
        body.fields[k] = isNaN(d.getTime()) ? Date.now() : d.getTime()
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
  if (data.code !== 0) throw new Error(`飞书 API 错误 ${data.code}: ${data.msg || ''}`)
  return data
}

function getCtx(req) {
  const appToken = req.query.app_token || DEFAULT_APP_TOKEN
  const tableId = req.query.time_entries_table_id || DEFAULT_TIME_TABLE
  return { appToken, tableId }
}

// ───── 路由 ─────

app.get('/', (req, res) => res.json({ ok: true, msg: 'time-track-api running', version: 'v3-fields-fix' }))

// 测试路由：绕过 lark()，直接调飞书
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

// POST /login → 验证账号密码，返回 {ok, role, user, display_name} 或 {ok:false, error}
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {}
    if (!username || !password) return res.status(400).json({ ok: false, error: '用户名和密码必填' })

    const appToken = req.query.app_token || DEFAULT_APP_TOKEN
    const userTableId = req.query.user_table_id || DEFAULT_USER_TABLE

    // 用飞书 filter 查匹配记录
    const filter = `AND(CurrentValue.[用户名]="${username}",CurrentValue.[密码]="${password}")`
    const params = new URLSearchParams({ page_size: '5', filter })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${userTableId}/records?${params}`)
    const items = data.data.items || []
    if (items.length === 0) {
      return res.json({ ok: false, error: '用户名或密码错误' })
    }
    const f = items[0].fields
    // 角色字段可能是字符串或数组
    let role = 'user'
    const rawRole = f['角色']
    if (typeof rawRole === 'string') role = rawRole
    else if (Array.isArray(rawRole) && rawRole[0]) role = rawRole[0].text || rawRole[0].name || 'user'
    const displayName = f['姓名'] || username
    // 团队字段可能是字符串或数组
    let team = ''
    const rawTeam = f['团队']
    if (typeof rawTeam === 'string') team = rawTeam
    else if (Array.isArray(rawTeam) && rawTeam[0]) team = rawTeam[0].text || rawTeam[0].name || ''
    return res.json({ ok: true, user: username, role, display_name: displayName, team, record_id: items[0].record_id })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /register → 注册新用户（验证邀请码 + 查重 + 插用户表）
app.post('/register', async (req, res) => {
  try {
    const { invite_code, username, password, display_name } = req.body || {}
    if (!invite_code || !username || !password) {
      return res.status(400).json({ ok: false, error: '邀请码、用户名、密码都必填' })
    }

    const appToken = req.query.app_token || DEFAULT_APP_TOKEN
    const userTableId = req.query.user_table_id || DEFAULT_USER_TABLE
    const settingsTableId = req.query.settings_table_id || DEFAULT_SETTINGS_TABLE

    // 1. 读设置表里的邀请码
    const settingsFilter = `CurrentValue.[设置项]="邀请码"`
    const sParams = new URLSearchParams({ page_size: '5', filter: settingsFilter })
    const sData = await lark(`/bitable/v1/apps/${appToken}/tables/${settingsTableId}/records?${sParams}`)
    const sItems = sData.data.items || []
    if (sItems.length === 0) {
      return res.json({ ok: false, error: '系统未配置邀请码' })
    }
    const realInvite = sItems[0].fields['值']
    if (realInvite !== invite_code) {
      return res.json({ ok: false, error: '邀请码错误' })
    }

    // 2. 查用户名是否已存在
    const userFilter = `CurrentValue.[用户名]="${username}"`
    const uParams = new URLSearchParams({ page_size: '5', filter: userFilter })
    const uData = await lark(`/bitable/v1/apps/${appToken}/tables/${userTableId}/records?${uParams}`)
    if ((uData.data.items || []).length > 0) {
      return res.json({ ok: false, error: '用户名已存在' })
    }

    // 3. 插入新用户（默认 role=user）
    const ins = await lark(
      `/bitable/v1/apps/${appToken}/tables/${userTableId}/records`,
      'POST',
      { fields: { '用户名': username, '密码': password, '角色': 'user', '姓名': display_name || username } },
    )
    return res.json({ ok: true, user: username, role: 'user', display_name: display_name || username })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /change-password → 修改密码（需原密码）
app.post('/change-password', async (req, res) => {
  try {
    const { username, old_password, new_password } = req.body || {}
    if (!username || !old_password || !new_password) {
      return res.status(400).json({ ok: false, error: '用户名、原密码、新密码都必填' })
    }

    const appToken = req.query.app_token || DEFAULT_APP_TOKEN
    const userTableId = req.query.user_table_id || DEFAULT_USER_TABLE

    // 1. 查用户记录，验证原密码
    const filter = `AND(CurrentValue.[用户名]="${username}",CurrentValue.[密码]="${old_password}")`
    const params = new URLSearchParams({ page_size: '5', filter })
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${userTableId}/records?${params}`)
    const items = data.data.items || []
    if (items.length === 0) {
      return res.json({ ok: false, error: '原密码错误' })
    }

    // 2. 更新密码
    const recordId = items[0].record_id
    await lark(
      `/bitable/v1/apps/${appToken}/tables/${userTableId}/records/${recordId}`,
      'PUT',
      { fields: { '密码': new_password } },
    )
    return res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

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
    const filter = `CurrentValue.[用户名]="${username}"`
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
    const params = new URLSearchParams({ page_size: String(page_size) })
    if (page_token) params.set('page_token', page_token)
    if (user) {
      // 飞书 filter 语法：CurrentValue.[字段名]="值"
      // 工时表字段名已改英文，用户字段为 user
      const filter = `CurrentValue.[user]="${user}"`
      params.set('filter', filter)
    }
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params}`)
    res.json({ items: data.data.items || [], total: data.data.total, has_more: data.data.has_more })
  } catch (e) { res.status(500).json({ error: e.message }) }
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
    const endTime = Date.now()

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

    res.json({ ok: true, duration_ms: durationMs, duration_sec: durationSec, duration_hour: durationHour })
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
    const filter = `AND(CurrentValue.[user]="${user}", CurrentValue.[end_time]="")`
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
app.post('/entries/batch', async (req, res) => {
  try {
    const { appToken, tableId } = getCtx(req)
    const { rows, username, role } = req.body || {}
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows 必填且为数组' })

    // ── 权限校验 ──
    // admin: 允许所有成员
    // team_admin: 只允许本团队的成员 (查用户表拿团队, 再校验每行成员是否在本团队)
    // member: 只允许 username 自己
    const allowedMembers = new Set()  // 空集合 = 允许所有 (admin)
    let permError = null

    if (role === 'admin') {
      // 允许所有人
    } else if (role === 'team_admin') {
      // 查用户表, 拿本团队成员列表
      try {
        const userData = await lark(`/bitable/v1/apps/${appToken}/tables/${DEFAULT_USER_TABLE}/records?page_size=200`)
        const userItems = userData.data.items || []
        // 找当前用户的团队
        let myTeam = ''
        for (const u of userItems) {
          if (u.fields['用户名'] === username) {
            const t = u.fields['团队']
            myTeam = typeof t === 'string' ? t : (Array.isArray(t) ? (t[0]?.text || t[0] || '') : '')
            break
          }
        }
        if (!myTeam) {
          permError = '无法确定你的团队, 导入失败'
        } else {
          // 收集本团队所有成员的 username
          for (const u of userItems) {
            const t = u.fields['团队']
            const teamVal = typeof t === 'string' ? t : (Array.isArray(t) ? (t[0]?.text || t[0] || '') : '')
            if (teamVal === myTeam) {
              const un = u.fields['用户名']
              if (un) allowedMembers.add(un)
            }
          }
        }
      } catch (e) {
        permError = '权限校验失败: ' + e.message
      }
    } else if (role === 'member' || !role) {
      // 只允许导入自己
      if (!username) {
        permError = '未登录, 导入失败'
      } else {
        allowedMembers.add(username)
      }
    }

    if (permError) {
      return res.status(403).json({ error: permError, success: 0, failed: rows.length })
    }

    // 校验每行数据的"成员"是否在权限范围内
    if (allowedMembers.size > 0) {
      for (const r of rows) {
        const member = r['成员'] || r['用户'] || r['user'] || r['username'] || ''
        if (!allowedMembers.has(member)) {
          return res.status(403).json({
            error: `身份不合规: 你没有权限导入成员 "${member}" 的数据`,
            success: 0,
            failed: rows.length,
          })
        }
      }
    }

    const BATCH = 100
    let success = 0
    let failed = 0
    const errors = []

    const buildFields = (r) => {
      // parseTime: 把各种格式的时间字符串解析成飞书 UTC 毫秒时间戳
      // 支持格式: "2026-08-31 14:00:00", "2026/8/31 9:00", "2026-08-31", "2026/8/31"
      // 飞书 start_time/end_time (type=5) 存 UTC 毫秒时间戳, 显示时自动转北京时间
      // 用户输入的是北京时间, 所以 UTC = 北京时间 - 8h
      const parseTime = (v) => {
        if (!v && v !== 0) return null
        if (typeof v === 'number') return v
        const s = String(v).trim()
        if (!s) return null
        if (/^\d+$/.test(s)) return parseInt(s, 10)
        // 支持 - 或 / 分隔, 月/日/时/分/秒可选前导零
        const m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
        if (!m) {
          // 兜底: 尝试 new Date 解析
          const d = new Date(s.replace(' ', 'T'))
          return isNaN(d.getTime()) ? null : d.getTime()
        }
        const [, yy, mm, dd, hh = '0', mi = '0', ss = '0'] = m
        const utcMs = Date.UTC(+yy, +mm - 1, +dd, +hh, +mi, +ss)
        return utcMs - 8 * 3600 * 1000
      }
      // 支持中文 key (CSV 表头) 和英文 key (前端映射)
      let startTime = parseTime(r['任务开始时间'] ?? r['开始时间'] ?? r['startTime'])
      let endTime = parseTime(r['任务结束时间'] ?? r['结束时间'] ?? r['endTime'])
      // startTime 为空时, 用 date 字段作为开始时间
      if (startTime === null) {
        const dateStr = r['日期'] ?? r['date'] ?? ''
        startTime = parseTime(dateStr)
      }
      // endTime 为空时, 用 startTime + 工时推算
      if (endTime === null && startTime !== null) {
        const hoursRaw = r['工时'] ?? r['hours']
        if (hoursRaw !== undefined && hoursRaw !== '' && !isNaN(parseFloat(hoursRaw))) {
          endTime = startTime + Math.round(parseFloat(hoursRaw) * 3600 * 1000)
        } else {
          endTime = startTime
        }
      }
      let durSec = null
      const hoursRaw = r['工时'] ?? r['hours']
      if (hoursRaw !== undefined && hoursRaw !== '' && !isNaN(parseFloat(hoursRaw))) {
        durSec = Math.round(parseFloat(hoursRaw) * 3600)
      } else if (startTime && endTime) {
        durSec = Math.max(0, Math.round((endTime - startTime) / 1000))
      }
      const fields = {
        'user': r['成员'] || r['用户'] || r['user'] || '',
        'description': r['任务名称'] || r['描述'] || r['description'] || '',
        'category': r['任务分类'] || r['分类'] || r['category'] || '',
        'country': r['国家'] || r['country'] || '',
        'notes': r['备注'] || r['remark'] || r['notes'] || '',
      }
      if (startTime) fields['start_time'] = startTime
      if (endTime) fields['end_time'] = endTime
      // 用中文字段名写入时长字段, lark 函数会用 UTF-8 Buffer 发送
      if (durSec !== null) {
        fields['时长(秒)'] = durSec
        fields['时长（小时）'] = durSec / 3600
      }
      return fields
    }

    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH)
      // 过滤掉关键字段 (user/description) 为空的行, 避免创建空白条目
      const records = slice
        .map(r => ({ fields: buildFields(r), raw: r }))
        .filter(item => item.fields.user && item.fields.description)
        .map(item => ({ fields: item.fields }))
      const skipped = slice.length - records.length
      if (records.length === 0) {
        failed += slice.length
        continue
      }
      try {
        const data = await lark(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`, 'POST', { records })
        const created = data.data?.records?.length || 0
        success += created
        const batchFailed = (records.length - created) + skipped
        if (batchFailed > 0) failed += batchFailed
      } catch (e) {
        failed += records.length
        errors.push(`批次 ${Math.floor(i / BATCH) + 1}: ${e.message}`)
      }
    }

    res.json({ success, failed, errors: errors.slice(0, 10) })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

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
    const appToken = DEFAULT_APP_TOKEN
    const { team } = req.query
    const params = new URLSearchParams({ page_size: '200' })
    if (team) {
      params.set('filter', `CurrentValue.[团队]="${team}"`)
    }
    const data = await lark(`/bitable/v1/apps/${appToken}/tables/${DEFAULT_USER_TABLE}/records?${params}`)
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
      params.set('filter', `CurrentValue.[团队]="${team}"`)
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
// GET /feishu-auth?code=xxx → 用 code 换 user_id, 再匹配用户表
// 返回: { ok, user, role, display_name, team, feishu_user_id }
app.get('/feishu-auth', async (req, res) => {
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
          redirect_uri: 'https://felix1919810.github.io/time-tracking/',
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
    const filter = `CurrentValue.[feishu_user_id]="${feishuUserId}"`
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
    const filter = `CurrentValue.[用户名]="${username}"`
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
    const filter2 = `CurrentValue.[feishu_user_id]="${feishu_user_id}"`
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

// ───── 启动 ─────
const port = process.env.PORT || 9000
app.listen(port, () => {
  console.log(`time-track-api listening on port ${port}`)
})

module.exports = { app }
