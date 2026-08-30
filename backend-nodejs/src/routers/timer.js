/** 计时器路由。对应 Python routers/timer.py。
 *
 * POST /api/timer/start   开始计时
 * POST /api/timer/stop    停止计时
 * GET  /api/timer/current 获取当前进行中条目
 * GET  /api/timer/running 列出所有正在计时的条目（管理员视角）
 * POST /api/timer/edit    手动编辑条目时间
 */
const express = require('express');
const timerService = require('../timer-service');

const router = express.Router();

// ──────────────────────────────────────────────
//  路由
// ──────────────────────────────────────────────

router.post('/start', async (req, res) => {
  try {
    const result = await timerService.startTimer({
      userId: req.body.user_id,
      description: req.body.description || '',
      projectId: req.body.project_id || null,
      tags: req.body.tags || null,
      billable: req.body.billable || false,
      startAtMs: req.body.start_at_ms || null,
    });
    res.json({ ok: true, entry: result });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.post('/stop', async (req, res) => {
  try {
    const result = await timerService.stopTimer(
      req.body.record_id,
      req.body.stop_at_ms || null
    );
    res.json({ ok: true, entry: result });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.get('/current', async (req, res) => {
  try {
    const entry = await timerService.getRunningEntry(req.query.user_id);
    res.json({ ok: true, entry });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.get('/running', async (req, res) => {
  try {
    const entries = await timerService.listAllRunning();
    res.json({ ok: true, entries, count: entries.length });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.post('/edit', async (req, res) => {
  try {
    const duration = await timerService.editEntryTime(
      req.body.record_id,
      req.body.start_at_ms || null,
      req.body.stop_at_ms || null
    );
    res.json({ ok: true, duration_sec: duration });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

module.exports = router;
