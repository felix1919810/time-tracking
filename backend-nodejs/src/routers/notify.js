/** 提醒相关 REST 路由。对应 Python routers/notify.py。
 *
 * POST /api/notify/text         发送纯文本消息
 * POST /api/notify/card         发送消息卡片
 * POST /api/notify/daily        手动触发日报推送
 * POST /api/notify/weekly       手动触发周报推送
 * POST /api/notify/running      手动触发未停止计时器检测
 * POST /api/notify/overrun      手动触发工时超额检测
 */
const express = require('express');
const notify = require('../notify-service');
const report = require('../report-service');
const timerService = require('../timer-service');
const repo = require('../bitable');
const { PROJECTS_TABLE_ID, Field, STATUS_ACTIVE } = require('../constants');

const router = express.Router();

// ──────────────────────────────────────────────
//  基础发送
// ──────────────────────────────────────────────

router.post('/text', async (req, res) => {
  try {
    const ok = await notify.sendText(
      req.body.text,
      req.body.receive_id || null,
      req.body.receive_id_type || 'chat_id'
    );
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.post('/card', async (req, res) => {
  try {
    const ok = await notify.sendCard(
      req.body.card,
      req.body.receive_id || null,
      req.body.receive_id_type || 'chat_id'
    );
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// ──────────────────────────────────────────────
//  手动触发定时任务
// ──────────────────────────────────────────────

router.post('/daily', async (req, res) => {
  try {
    const today = new Date();
    const startMs = report.dateToMs(today);
    const endMs = report.dateToMs(today, true);
    const reportData = await report.generateCustomReport(startMs, endMs);
    const card = notify.dailyReportCard(req.body.user_name || '全体成员', reportData);
    const ok = await notify.sendCard(card);
    res.json({ ok, total_sec: reportData.total_sec });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.post('/weekly', async (req, res) => {
  try {
    const reportData = await report.generateWeeklyReport();
    const card = notify.weeklyReportCard(req.body.user_name || '全体成员', reportData);
    const ok = await notify.sendCard(card);
    res.json({ ok, total_sec: reportData.total_sec });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.post('/running', async (req, res) => {
  try {
    const entries = await timerService.listAllRunning();
    if (!entries || entries.length === 0) {
      return res.json({ ok: true, message: '无运行中计时器', count: 0 });
    }
    const card = notify.runningTimerAlert(entries);
    const ok = card && Object.keys(card).length > 0
      ? await notify.sendCard(card)
      : true;
    res.json({ ok, count: entries.length });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

router.post('/overrun', async (req, res) => {
  try {
    const projects = await repo.searchRecords(
      PROJECTS_TABLE_ID,
      {
        conjunction: 'and',
        conditions: [{ field_name: Field.STATUS, operator: 'is', value: [STATUS_ACTIVE] }],
      },
      200
    );
    let alertsSent = 0;
    for (const p of projects) {
      const f = p.fields || {};
      const estimated = extractFloat(f['预估工时']);
      if (!estimated || estimated <= 0) continue;
      const result = await report.checkProjectOverrun(p.record_id, estimated);
      if (result.overrun) {
        const projectName = extractText(f['项目名称']) || '(未命名)';
        const card = notify.overrunAlert(projectName, result);
        if (await notify.sendCard(card)) alertsSent++;
      }
    }
    res.json({ ok: true, alerts_sent: alertsSent, projects_checked: projects.length });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

// ──────────────────────────────────────────────
//  内部辅助
// ──────────────────────────────────────────────

function extractFloat(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'object') {
    const v = value.value || value.text || value.name;
    return Number(v) || 0;
  }
  return Number(value) || 0;
}

function extractText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'object' ? (item.text || item.name || '') : String(item)
    ).join('');
  }
  if (typeof value === 'object') return value.text || value.name || '';
  return '';
}

module.exports = router;
