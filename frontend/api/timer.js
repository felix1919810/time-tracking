// GET  /api/timer?user_id=xxx           → 查当前 running 条目
// POST /api/timer/start   body: {user_id, description?, task_category?, country?, billable?}
// POST /api/timer/stop    body: {record_id}   (stop 走子路径)
import { lark, getAppToken, getTableId, json, fail } from './_lark.js'

export default async function handler(req, res) {
  try {
    const appToken = getAppToken(req.query)
    const tableId = getTableId('time_entries', req.query)

    if (req.method === 'GET') {
      // 查当前 running 条目（按 user_id 过滤，状态=running）
      const userId = req.query.user_id
      const filter = userId
        ? `AND(CurrentValue.[状态]="running", CurrentValue.[用户]="${userId}")`
        : `CurrentValue.[状态]="running"`
      const data = await lark(
        `/bitable/v1/apps/${appToken}/tables/${tableId}/records?filter=${encodeURIComponent(filter)}&page_size=1`,
      )
      const items = data.data.items || []
      json(res, { entry: items[0] || null })
    } else if (req.method === 'POST') {
      const body = req.body || {}
      // 新增一条 running 记录
      const fields = {
        '描述': body.description || '',
        '用户': body.user_id || 'anonymous',
        '开始时间': Date.now(),  // 毫秒时间戳
        '状态': 'running',
        '是否计费': !!body.billable,
        '任务分类': body.task_category || '其他',
        '国家': body.country || '',
        '时长(秒)': 0,
      }
      const data = await lark(
        `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
        { method: 'POST', body: JSON.stringify({ fields }) },
      )
      json(res, { record: data.data.record })
    } else {
      fail(res, new Error(`Method ${req.method} not allowed`), 405)
    }
  } catch (err) {
    fail(res, err)
  }
}
