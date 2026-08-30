// PATCH /api/entry?id=xxx    → 编辑条目
// DELETE /api/entry?id=xxx   → 删除条目
import { lark, getAppToken, getTableId, json, fail } from './_lark.js'

export default async function handler(req, res) {
  try {
    const appToken = getAppToken(req.query)
    const tableId = getTableId('time_entries', req.query)
    const recordId = req.query.id
    if (!recordId) return fail(res, new Error('id 必填'), 400)

    if (req.method === 'PATCH') {
      const { fields } = req.body || {}
      if (!fields) return fail(res, new Error('fields 必填'), 400)
      const data = await lark(
        `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
        { method: 'PUT', body: JSON.stringify({ fields }) },  // 飞书用 PUT 更新
      )
      json(res, { record: data.data.record })
    } else if (req.method === 'DELETE') {
      const data = await lark(
        `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
        { method: 'DELETE' },
      )
      json(res, { ok: true })
    } else {
      fail(res, new Error(`Method ${req.method} not allowed`), 405)
    }
  } catch (err) {
    fail(res, err)
  }
}
