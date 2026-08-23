// POST /api/timer-stop  body: {record_id, duration_sec?}
// 停止计时：状态改 stopped，写入结束时间、时长
import { lark, getAppToken, getTableId, json, fail } from './_lark.js'

export default async function handler(req, res) {
  try {
    const appToken = getAppToken(req.query)
    const tableId = getTableId('time_entries', req.query)
    const { record_id, duration_sec } = req.body || {}
    if (!record_id) return fail(res, new Error('record_id 必填'), 400)

    const stopMs = Date.now()
    // 先读出开始时间，算时长
    const readData = await lark(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${record_id}`,
    )
    const fields = readData.data.record.fields
    const startMs = typeof fields['开始时间'] === 'number'
      ? fields['开始时间']
      : (fields['开始时间']?.value || stopMs)
    const durSec = duration_sec ?? Math.floor((stopMs - startMs) / 1000)

    // 更新
    const updateFields = {
      '结束时间': stopMs,
      '时长(秒)': durSec,
      '状态': 'stopped',
    }
    const data = await lark(
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${record_id}`,
      { method: 'PUT', body: JSON.stringify({ fields: updateFields }) },
    )
    json(res, { record: data.data.record })
  } catch (err) {
    fail(res, err)
  }
}
