// GET /api/projects → 列出项目
import { lark, getAppToken, getTableId, json, fail } from './_lark.js'

export default async function handler(req, res) {
  try {
    const appToken = getAppToken(req.query)
    const tableId = getTableId('projects', req.query)
    const { page_size = 100, page_token } = req.query
    const params = new URLSearchParams({ page_size: String(page_size) })
    if (page_token) params.set('page_token', page_token)

    const data = await lark(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params}`,
    )
    json(res, { items: data.data.items || [], total: data.data.total })
  } catch (err) {
    fail(res, err)
  }
}
