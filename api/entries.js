// GET  /api/entries           → 列出时间条目
// POST /api/entries           → 新增时间条目
import { lark, getAppToken, getTableId, json, fail } from './_lark.js'

export default async function handler(req, res) {
  try {
    const appToken = getAppToken(req.query)
    const tableId = getTableId('time_entries', req.query)

    if (req.method === 'GET') {
      // 参数：page_size, page_token, filter
      const { page_size = 100, page_token, filter } = req.query
      const params = new URLSearchParams({ page_size: String(page_size) })
      if (page_token) params.set('page_token', page_token)
      if (filter) params.set('filter', filter)

      const data = await lark(
        `/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params}`,
      )
      json(res, { items: data.data.items || [], total: data.data.total, has_more: data.data.has_more })
    } else if (req.method === 'POST') {
      // body: { fields: {...} }
      const { fields } = req.body || {}
      if (!fields) return fail(res, new Error('fields 必填'), 400)

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
