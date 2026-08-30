/** 项目 / 客户 / 标签 CRUD 路由。对应 Python routers/projects.py。
 *
 * 项目：
 *   POST   /api/projects                  创建项目
 *   GET    /api/projects                  列出项目（支持 ?status=active|archived|all）
 *   GET    /api/projects/:record_id       获取单个项目
 *   PATCH  /api/projects/:record_id       更新项目
 *   POST   /api/projects/:record_id/archive   归档项目
 *   POST   /api/projects/:record_id/unarchive 取消归档
 *   DELETE /api/projects/:record_id       删除项目
 *
 * 客户：
 *   POST   /api/projects/clients
 *   GET    /api/projects/clients
 *
 * 标签：
 *   POST   /api/projects/tags
 *   GET    /api/projects/tags
 *   DELETE /api/projects/tags/:record_id
 */
const express = require('express');
const repo = require('../bitable');
const {
  CLIENTS_TABLE_ID,
  PROJECTS_TABLE_ID,
  TAGS_TABLE_ID,
  Field,
  STATUS_ACTIVE,
  STATUS_ARCHIVED,
} = require('../constants');

const router = express.Router();

// ──────────────────────────────────────────────
//  项目 CRUD
// ──────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { name, client_id, color = 'blue', billable = false, estimated_hours } = req.body;
  if (!name) return res.status(400).json({ detail: 'name 必填' });

  const fields = {
    [Field.PROJECT_NAME]: name,
    [Field.PROJECT_COLOR]: color,
    [Field.PROJECT_BILLABLE]: billable,
    [Field.STATUS]: STATUS_ACTIVE,
  };
  if (client_id) fields[Field.PROJECT_CLIENT] = [client_id];
  if (estimated_hours !== undefined) fields[Field.PROJECT_ESTIMATED_HOURS] = estimated_hours;

  try {
    const recordId = await repo.createRecord(PROJECTS_TABLE_ID, fields);
    res.json({ ok: true, record_id: recordId });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.get('/', async (req, res) => {
  const status = req.query.status || 'active';
  let filter = null;
  if (status !== 'all') {
    filter = {
      conjunction: 'and',
      conditions: [{ field_name: Field.STATUS, operator: 'is', value: [status] }],
    };
  }
  try {
    const results = await repo.searchRecords(PROJECTS_TABLE_ID, filter, 200);
    res.json({ ok: true, projects: results, count: results.length });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.patch('/:record_id', async (req, res) => {
  const { name, client_id, color, billable, estimated_hours } = req.body;
  const fields = {};
  if (name !== undefined) fields[Field.PROJECT_NAME] = name;
  if (client_id !== undefined) fields[Field.PROJECT_CLIENT] = [client_id];
  if (color !== undefined) fields[Field.PROJECT_COLOR] = color;
  if (billable !== undefined) fields[Field.PROJECT_BILLABLE] = billable;
  if (estimated_hours !== undefined) fields[Field.PROJECT_ESTIMATED_HOURS] = estimated_hours;

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ detail: '没有需要更新的字段' });
  }

  try {
    await repo.updateRecord(PROJECTS_TABLE_ID, req.params.record_id, fields);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.post('/:record_id/archive', async (req, res) => {
  try {
    await repo.updateRecord(PROJECTS_TABLE_ID, req.params.record_id, { [Field.STATUS]: STATUS_ARCHIVED });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.post('/:record_id/unarchive', async (req, res) => {
  try {
    await repo.updateRecord(PROJECTS_TABLE_ID, req.params.record_id, { [Field.STATUS]: STATUS_ACTIVE });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.delete('/:record_id', async (req, res) => {
  try {
    await repo.deleteRecord(PROJECTS_TABLE_ID, req.params.record_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// ──────────────────────────────────────────────
//  客户 CRUD
// ──────────────────────────────────────────────

router.post('/clients', async (req, res) => {
  const { name, contact, email } = req.body;
  if (!name) return res.status(400).json({ detail: 'name 必填' });

  const fields = {
    [Field.CLIENT_NAME]: name,
    [Field.STATUS]: STATUS_ACTIVE,
  };
  if (contact) fields[Field.CLIENT_CONTACT] = contact;
  if (email) fields[Field.CLIENT_EMAIL] = email;

  try {
    const recordId = await repo.createRecord(CLIENTS_TABLE_ID, fields);
    res.json({ ok: true, record_id: recordId });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.get('/clients', async (req, res) => {
  const status = req.query.status || 'active';
  let filter = null;
  if (status !== 'all') {
    filter = {
      conjunction: 'and',
      conditions: [{ field_name: Field.STATUS, operator: 'is', value: [status] }],
    };
  }
  try {
    const results = await repo.searchRecords(CLIENTS_TABLE_ID, filter, 200);
    res.json({ ok: true, clients: results, count: results.length });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// ──────────────────────────────────────────────
//  标签 CRUD
// ──────────────────────────────────────────────

router.post('/tags', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ detail: 'name 必填' });
  try {
    const recordId = await repo.createRecord(TAGS_TABLE_ID, { [Field.TAG_NAME]: name });
    res.json({ ok: true, record_id: recordId });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.get('/tags', async (req, res) => {
  try {
    const results = await repo.searchRecords(TAGS_TABLE_ID, null, 200);
    res.json({ ok: true, tags: results, count: results.length });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.delete('/tags/:record_id', async (req, res) => {
  try {
    await repo.deleteRecord(TAGS_TABLE_ID, req.params.record_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

module.exports = router;
