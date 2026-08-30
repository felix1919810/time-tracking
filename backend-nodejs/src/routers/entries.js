/** 时间条目 CRUD 路由。对应 Python routers/entries.py。
 *
 * POST   /api/entries                 手动创建已完成的工时条目
 * GET    /api/entries                 列出条目（支持 user_id / project_id / start/end 过滤）
 * GET    /api/entries/:record_id      获取单条
 * PATCH  /api/entries/:record_id      更新条目
 * DELETE /api/entries/:record_id      删除条目
 */
const express = require('express');
const repo = require('../bitable');
const { TIME_ENTRIES_TABLE_ID, Field, STATE_STOPPED } = require('../constants');

const router = express.Router();

// ──────────────────────────────────────────────
//  路由
// ──────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { user_id, description = '', project_id, tags, billable = false, start_at_ms, stop_at_ms } = req.body;
  if (!stop_at_ms || !start_at_ms || stop_at_ms <= start_at_ms) {
    return res.status(400).json({ detail: '结束时间必须晚于开始时间' });
  }

  const durationSec = Math.floor((stop_at_ms - start_at_ms) / 1000);
  const fields = {
    [Field.TE_DESCRIPTION]: description,
    [Field.TE_START]: start_at_ms,
    [Field.TE_STOP]: stop_at_ms,
    [Field.TE_DURATION]: durationSec,
    [Field.TE_STATE]: STATE_STOPPED,
    [Field.TE_USER]: user_id,
    [Field.TE_BILLABLE]: billable,
  };
  if (project_id) fields[Field.TE_PROJECT] = [project_id];
  if (tags) fields[Field.TE_TAGS] = tags;

  try {
    const recordId = await repo.createRecord(TIME_ENTRIES_TABLE_ID, fields);
    res.json({ ok: true, record_id: recordId, duration_sec: durationSec });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.get('/', async (req, res) => {
  const { user_id, project_id, start_ms, end_ms } = req.query;
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);

  const conditions = [];
  if (user_id) conditions.push({ field_name: Field.TE_USER, operator: 'is', value: [user_id] });
  if (project_id) conditions.push({ field_name: Field.TE_PROJECT, operator: 'is', value: [project_id] });
  if (start_ms) conditions.push({ field_name: Field.TE_START, operator: 'isGreater', value: ['ExactDate', String(start_ms)] });
  if (end_ms) conditions.push({ field_name: Field.TE_STOP, operator: 'isLess', value: ['ExactDate', String(end_ms)] });

  const filter = conditions.length > 0 ? { conjunction: 'and', conditions } : null;

  try {
    const results = await repo.searchRecords(TIME_ENTRIES_TABLE_ID, filter, limit);
    res.json({ ok: true, entries: results, count: results.length });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.get('/:record_id', async (req, res) => {
  try {
    const entry = await repo.getRecord(TIME_ENTRIES_TABLE_ID, req.params.record_id);
    res.json({ ok: true, entry });
  } catch (e) {
    res.status(404).json({ detail: e.message });
  }
});

router.patch('/:record_id', async (req, res) => {
  const { description, project_id, tags, billable, start_at_ms, stop_at_ms } = req.body;
  const fields = {};

  if (description !== undefined) fields[Field.TE_DESCRIPTION] = description;
  if (project_id !== undefined) fields[Field.TE_PROJECT] = project_id ? [project_id] : [];
  if (tags !== undefined) fields[Field.TE_TAGS] = tags;
  if (billable !== undefined) fields[Field.TE_BILLABLE] = billable;

  // 时间变更需重新计算 duration
  if (start_at_ms !== undefined || stop_at_ms !== undefined) {
    const existing = await repo.getRecord(TIME_ENTRIES_TABLE_ID, req.params.record_id);
    const oldFields = existing.fields;
    const startMs = start_at_ms !== undefined ? start_at_ms : extractMs(oldFields[Field.TE_START]);
    const stopMs = stop_at_ms !== undefined ? stop_at_ms : extractMs(oldFields[Field.TE_STOP]);
    if (startMs === null || stopMs === null) {
      return res.status(400).json({ detail: '条目缺少开始/结束时间' });
    }
    if (stopMs < startMs) {
      return res.status(400).json({ detail: '结束时间必须晚于开始时间' });
    }
    fields[Field.TE_START] = startMs;
    fields[Field.TE_STOP] = stopMs;
    fields[Field.TE_DURATION] = Math.floor((stopMs - startMs) / 1000);
  }

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ detail: '没有需要更新的字段' });
  }

  try {
    await repo.updateRecord(TIME_ENTRIES_TABLE_ID, req.params.record_id, fields);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.delete('/:record_id', async (req, res) => {
  try {
    await repo.deleteRecord(TIME_ENTRIES_TABLE_ID, req.params.record_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// ──────────────────────────────────────────────
//  内部辅助
// ──────────────────────────────────────────────

function extractMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object') {
    const v = value.value || value.timestamp;
    return v !== undefined ? Number(v) : null;
  }
  return null;
}

module.exports = router;
