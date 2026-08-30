/** 定时任务调度器。对应 Python scheduler.py。
 *
 * 定时任务：
 * - 每小时 :05  扫描未停止计时器，超过阈值则提醒
 * - 每天 10:00  检测项目工时超额，发预警
 * - 每天 18:00  发送当日日报
 * - 每周一 09:00  发送周报
 *
 * 调用 notify-service 推送消息卡片。
 */
const cron = require('node-cron');
const config = require('./config');
const notify = require('./notify-service');
const report = require('./report-service');
const timerService = require('./timer-service');
const repo = require('./bitable');
const { PROJECTS_TABLE_ID, Field, STATUS_ACTIVE } = require('./constants');

// 未停止计时器提醒阈值（小时）
const RUN_ALERT_HOURS = 8;

let scheduledTasks = [];

// ──────────────────────────────────────────────
//  定时任务实现
// ──────────────────────────────────────────────

async function jobCheckRunningTimers() {
  /** 每小时检查未停止计时器。 */
  try {
    const entries = await timerService.listAllRunning();
    if (!entries || entries.length === 0) return;

    const now = Date.now();
    const alertEntries = [];
    for (const e of entries) {
      const startMs = extractInt(e.fields['开始时间']);
      if (!startMs) continue;
      const elapsedH = (now - startMs) / 3600000;
      if (elapsedH >= RUN_ALERT_HOURS) {
        alertEntries.push(e);
      }
    }

    if (alertEntries.length > 0) {
      const card = notify.runningTimerAlert(alertEntries);
      if (card && Object.keys(card).length > 0) {
        await notify.sendCard(card);
      }
    }
  } catch (e) {
    console.error('[scheduler] jobCheckRunningTimers failed:', e);
  }
}

async function jobCheckProjectOverrun() {
  /** 每天 10:00 检测所有活跃项目的工时超额。 */
  try {
    const projects = await repo.searchRecords(
      PROJECTS_TABLE_ID,
      {
        conjunction: 'and',
        conditions: [
          { field_name: Field.STATUS, operator: 'is', value: [STATUS_ACTIVE] },
        ],
      },
      200
    );
    for (const p of projects) {
      const f = p.fields || {};
      const estimated = extractFloat(f['预估工时']);
      if (!estimated || estimated <= 0) continue;

      const projectName = extractText(f['项目名称']) || '(未命名)';
      const result = await report.checkProjectOverrun(p.record_id, estimated);
      if (result.overrun) {
        const card = notify.overrunAlert(projectName, result);
        await notify.sendCard(card);
      }
    }
  } catch (e) {
    console.error('[scheduler] jobCheckProjectOverrun failed:', e);
  }
}

async function jobSendDailyReport() {
  /** 每天 18:00 发送当日日报。 */
  try {
    const today = new Date();
    const startMs = report.dateToMs(today);
    const endMs = report.dateToMs(today, true);
    const reportData = await report.generateCustomReport(startMs, endMs);
    const card = notify.dailyReportCard('全体成员', reportData);
    await notify.sendCard(card);
  } catch (e) {
    console.error('[scheduler] jobSendDailyReport failed:', e);
  }
}

async function jobSendWeeklyReport() {
  /** 每周一 09:00 发送周报。 */
  try {
    const reportData = await report.generateWeeklyReport();
    const card = notify.weeklyReportCard('全体成员', reportData);
    await notify.sendCard(card);
  } catch (e) {
    console.error('[scheduler] jobSendWeeklyReport failed:', e);
  }
}

// ──────────────────────────────────────────────
//  调度器生命周期
// ──────────────────────────────────────────────

function startScheduler() {
  /** 启动后台调度器。在 Express 启动时调用。 */
  if (scheduledTasks.length > 0) return; // 已启动

  // 每小时 :05 检查未停止计时器
  scheduledTasks.push(cron.schedule('5 * * * *', jobCheckRunningTimers));

  // 每天 10:00 检测项目工时超额
  scheduledTasks.push(cron.schedule('0 10 * * *', jobCheckProjectOverrun));

  // 每天 18:00 发送日报
  scheduledTasks.push(cron.schedule('0 18 * * *', jobSendDailyReport));

  // 每周一 09:00 发送周报
  scheduledTasks.push(cron.schedule('0 9 * * 1', jobSendWeeklyReport));

  console.info('[scheduler] started with timezone=%s', config.timezone);
}

function shutdownScheduler() {
  /** 关闭调度器。在 Express shutdown 时调用。 */
  for (const task of scheduledTasks) {
    task.stop();
  }
  scheduledTasks = [];
  console.info('[scheduler] shutdown');
}

// ──────────────────────────────────────────────
//  内部辅助
// ──────────────────────────────────────────────

function extractInt(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Math.floor(value);
  if (typeof value === 'object') {
    const v = value.value || value.text || value.name;
    const n = Number(v);
    return isNaN(n) ? 0 : Math.floor(n);
  }
  if (typeof value === 'string') {
    const n = Number(value);
    return isNaN(n) ? 0 : Math.floor(n);
  }
  return 0;
}

function extractFloat(value) {
  return extractInt(value);
}

function extractText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'object' ? (item.text || item.name || '') : String(item)
      )
      .join('');
  }
  if (typeof value === 'object') {
    return value.text || value.name || '';
  }
  return '';
}

module.exports = {
  startScheduler,
  shutdownScheduler,
  jobCheckRunningTimers,
  jobCheckProjectOverrun,
  jobSendDailyReport,
  jobSendWeeklyReport,
};
