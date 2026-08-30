/** 报表与分析 REST 路由。对应 Python routers/reports.py。
 *
 * GET  /api/reports/weekly              本周报（可选 ?user_id=）
 * GET  /api/reports/monthly             本月报（可选 ?user_id=）
 * GET  /api/reports/custom              自定义时间范围（start_ms/end_ms，可选 user_id）
 * GET  /api/reports/export              导出 CSV
 * GET  /api/reports/export-xlsx         导出 Excel (.xlsx)
 * GET  /api/reports/project-overrun     工时超额检测
 */
const express = require('express');
const svc = require('../report-service');

const router = express.Router();

// ──────────────────────────────────────────────
//  周报 / 月报 / 自定义
// ──────────────────────────────────────────────

router.get('/weekly', async (req, res) => {
  try {
    const report = await svc.generateWeeklyReport(req.query.user_id || null);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.get('/monthly', async (req, res) => {
  try {
    const report = await svc.generateMonthlyReport(req.query.user_id || null);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.get('/custom', async (req, res) => {
  const { start_ms, end_ms, user_id } = req.query;
  if (!start_ms || !end_ms) {
    return res.status(400).json({ detail: '需要 start_ms 和 end_ms' });
  }
  if (Number(end_ms) <= Number(start_ms)) {
    return res.status(400).json({ detail: 'end_ms 必须大于 start_ms' });
  }
  try {
    const report = await svc.generateCustomReport(Number(start_ms), Number(end_ms), user_id || null);
    res.json({ ok: true, report });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// ──────────────────────────────────────────────
//  导出 CSV
// ──────────────────────────────────────────────

router.get('/export', async (req, res) => {
  const { start_ms, end_ms, user_id } = req.query;
  if (!start_ms || !end_ms) {
    return res.status(400).json({ detail: '需要 start_ms 和 end_ms' });
  }
  try {
    const entries = await svc.fetchEntriesInRange(Number(start_ms), Number(end_ms), user_id || null);
    const csvText = svc.exportEntriesCsv(entries);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=time_entries.csv');
    res.send(csvText);
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// ──────────────────────────────────────────────
//  导出 Excel (.xlsx)
// ──────────────────────────────────────────────

router.get('/export-xlsx', async (req, res) => {
  const { start_ms, end_ms, user_id } = req.query;
  if (!start_ms || !end_ms) {
    return res.status(400).json({ detail: '需要 start_ms 和 end_ms' });
  }
  try {
    const entries = await svc.fetchEntriesInRange(Number(start_ms), Number(end_ms), user_id || null);
    const xlsxBuffer = await svc.exportEntriesXlsx(entries);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=time_entries.xlsx');
    res.send(Buffer.from(xlsxBuffer));
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// ──────────────────────────────────────────────
//  工时超额检测
// ──────────────────────────────────────────────

router.get('/project-overrun', async (req, res) => {
  const { project_id, estimated_hours } = req.query;
  if (!project_id || !estimated_hours || Number(estimated_hours) <= 0) {
    return res.status(400).json({ detail: '需要 project_id 和正数 estimated_hours' });
  }
  try {
    const result = await svc.checkProjectOverrun(project_id, Number(estimated_hours));
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

module.exports = router;
