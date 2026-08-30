/** 报表与分析模块。对应 Python report_service.py。
 *
 * 对应 Toggl Track 的 Reports API：
 * - 按项目/标签/日期维度聚合工时
 * - 生成周报/月报
 * - 导出 CSV / Excel / 飞书电子表格 / 飞书云文档
 *
 * 聚合逻辑在后端完成（Node.js），不依赖多维表格仪表盘，便于后续扩展和导出。
 */
const repo = require('./bitable');
const { TIME_ENTRIES_TABLE_ID, Field } = require('./constants');

// ──────────────────────────────────────────────
//  时间范围辅助
// ──────────────────────────────────────────────

/** 返回本周一到周日。Toggl 默认周一起算。 */
function weekRange(today = null) {
  const t = today || new Date();
  const dayOfWeek = (t.getDay() + 6) % 7; // 周一=0
  const monday = new Date(t);
  monday.setDate(t.getDate() - dayOfWeek);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  monday.setHours(0, 0, 0, 0);
  sunday.setHours(23, 59, 59, 999);
  return [monday, sunday];
}

/** 返回本月第一天到最后一天。 */
function monthRange(today = null) {
  const t = today || new Date();
  const first = new Date(t.getFullYear(), t.getMonth(), 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0, 23, 59, 59, 999);
  return [first, last];
}

/** 日期 → 毫秒时间戳。 */
function dateToMs(d, endOfDay = false) {
  if (endOfDay) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

// ──────────────────────────────────────────────
//  拉取条目
// ──────────────────────────────────────────────

async function fetchEntriesInRange(startMs, endMs, userId = null) {
  /** 拉取指定时间范围内的已完成时间条目。
   *
   * 过滤条件：
   * - start_time >= start_ms
   * - start_time <= end_ms
   * - 可选 user_id
   *
   * 注意：飞书多维表格日期字段筛选，value 必须是
   * ["ExactDate", "毫秒时间戳字符串"] 这种格式（官方文档要求）。
   */
  const conditions = [
    {
      field_name: Field.TE_START,
      operator: 'isGreater',
      value: ['ExactDate', String(startMs)],
    },
  ];
  if (userId) {
    conditions.push({ field_name: Field.TE_USER, operator: 'is', value: [userId] });
  }

  const filter = { conjunction: 'and', conditions };
  const raw = await repo.searchRecords(TIME_ENTRIES_TABLE_ID, filter, 500);

  // isGreater 只筛下限，end_ms 上限在代码里精确过滤
  const result = [];
  for (const e of raw) {
    const startVal = e.fields[Field.TE_START];
    if (startVal === null || startVal === undefined) continue;
    const sMs = typeof startVal === 'number' ? startVal : Number(startVal.value || 0);
    if (sMs <= endMs) {
      result.push(e);
    }
  }
  return result;
}

// ──────────────────────────────────────────────
//  聚合
// ──────────────────────────────────────────────

function aggregateByProject(entries) {
  /** 按项目聚合：返回 [{project_id, project_name, total_sec, count}] 降序。 */
  const agg = {}; // key → {total_sec, count, name}
  for (const e of entries) {
    const f = e.fields;
    const projectIds = extractList(f[Field.TE_PROJECT]);
    const projectName = extractText(f[Field.TE_PROJECT]) || '(无项目)';
    const duration = extractInt(f[Field.TE_DURATION]);
    const key = projectIds.length > 0 ? projectIds[0] : projectName;
    if (!agg[key]) {
      agg[key] = { total_sec: 0, count: 0, name: '' };
    }
    agg[key].total_sec += duration;
    agg[key].count += 1;
    agg[key].name = projectName;
  }
  const out = Object.entries(agg).map(([k, v]) => ({
    project_id: typeof k === 'string' && k.startsWith('rec') ? k : null,
    project_name: v.name,
    total_sec: v.total_sec,
    count: v.count,
  }));
  return out.sort((a, b) => b.total_sec - a.total_sec);
}

function aggregateByTag(entries) {
  /** 按标签聚合：返回 [{tag_name, total_sec, count}] 降序。 */
  const agg = {};
  for (const e of entries) {
    const f = e.fields;
    const tags = extractList(f[Field.TE_TAGS]);
    const duration = extractInt(f[Field.TE_DURATION]);
    if (!tags || tags.length === 0) {
      const key = '(无标签)';
      if (!agg[key]) agg[key] = { total_sec: 0, count: 0 };
      agg[key].total_sec += duration;
      agg[key].count += 1;
    } else {
      for (const tag of tags) {
        const key = typeof tag === 'string' ? tag : String(tag);
        if (!agg[key]) agg[key] = { total_sec: 0, count: 0 };
        agg[key].total_sec += duration;
        agg[key].count += 1;
      }
    }
  }
  const out = Object.entries(agg).map(([k, v]) => ({
    tag_name: k,
    total_sec: v.total_sec,
    count: v.count,
  }));
  return out.sort((a, b) => b.total_sec - a.total_sec);
}

function aggregateByDate(entries) {
  /** 按日期聚合：返回 [{date: 'YYYY-MM-DD', total_sec, count}] 升序。 */
  const agg = {};
  for (const e of entries) {
    const f = e.fields;
    const startMs = extractInt(f[Field.TE_START]);
    if (!startMs) continue;
    const dateStr = new Date(startMs).toISOString().slice(0, 10);
    const duration = extractInt(f[Field.TE_DURATION]);
    if (!agg[dateStr]) agg[dateStr] = { total_sec: 0, count: 0 };
    agg[dateStr].total_sec += duration;
    agg[dateStr].count += 1;
  }
  const out = Object.entries(agg)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ date: k, total_sec: v.total_sec, count: v.count }));
  return out;
}

function totalDuration(entries) {
  /** 计算总时长（秒）。 */
  return entries.reduce((sum, e) => sum + extractInt(e.fields[Field.TE_DURATION]), 0);
}

// ──────────────────────────────────────────────
//  报表生成
// ──────────────────────────────────────────────

async function generateWeeklyReport(userId = null, today = null) {
  /** 生成周报：本周一到周日的工时汇总。 */
  const [monday, sunday] = weekRange(today);
  const startMs = dateToMs(monday);
  const endMs = dateToMs(sunday, true);
  const entries = await fetchEntriesInRange(startMs, endMs, userId);
  return {
    period: 'week',
    start_date: monday.toISOString().slice(0, 10),
    end_date: sunday.toISOString().slice(0, 10),
    total_sec: totalDuration(entries),
    entry_count: entries.length,
    by_project: aggregateByProject(entries),
    by_tag: aggregateByTag(entries),
    by_date: aggregateByDate(entries),
  };
}

async function generateMonthlyReport(userId = null, today = null) {
  /** 生成月报：本月第一到最后一天的工时汇总。 */
  const [first, last] = monthRange(today);
  const startMs = dateToMs(first);
  const endMs = dateToMs(last, true);
  const entries = await fetchEntriesInRange(startMs, endMs, userId);
  return {
    period: 'month',
    start_date: first.toISOString().slice(0, 10),
    end_date: last.toISOString().slice(0, 10),
    total_sec: totalDuration(entries),
    entry_count: entries.length,
    by_project: aggregateByProject(entries),
    by_tag: aggregateByTag(entries),
    by_date: aggregateByDate(entries),
  };
}

async function generateDailyReport(userId = null, today = null) {
  /** 生成日报：当日 0:00-23:59。 */
  const t = today || new Date();
  const startMs = dateToMs(t);
  const endMs = dateToMs(t, true);
  const entries = await fetchEntriesInRange(startMs, endMs, userId);
  return {
    period: 'day',
    date: t.toISOString().slice(0, 10),
    total_sec: totalDuration(entries),
    entry_count: entries.length,
    by_project: aggregateByProject(entries),
    by_tag: aggregateByTag(entries),
    by_date: aggregateByDate(entries),
  };
}

async function generateCustomReport(startMs, endMs, userId = null) {
  /** 生成自定义时间范围的报表。 */
  const entries = await fetchEntriesInRange(startMs, endMs, userId);
  return {
    period: 'custom',
    start_ms: startMs,
    end_ms: endMs,
    total_sec: totalDuration(entries),
    entry_count: entries.length,
    by_project: aggregateByProject(entries),
    by_tag: aggregateByTag(entries),
    by_date: aggregateByDate(entries),
  };
}

// ──────────────────────────────────────────────
//  项目工时超额检测
// ──────────────────────────────────────────────

async function checkProjectOverrun(projectRecordId, estimatedHours) {
  /** 检测指定项目工时是否超额。
   *
   * 返回：
   * - {overrun: bool, total_sec, estimated_sec, ratio}
   */
  const filter = {
    conjunction: 'and',
    conditions: [
      { field_name: Field.TE_PROJECT, operator: 'is', value: [projectRecordId] },
    ],
  };
  const entries = await repo.searchRecords(TIME_ENTRIES_TABLE_ID, filter, 500);
  const totalSec = entries.reduce(
    (sum, e) => sum + extractInt(e.fields[Field.TE_DURATION]),
    0
  );
  const estimatedSec = estimatedHours * 3600;
  const ratio = estimatedSec > 0 ? totalSec / estimatedSec : 0;
  return {
    overrun: totalSec > estimatedSec,
    total_sec: totalSec,
    estimated_sec: estimatedSec,
    ratio,
  };
}

// ──────────────────────────────────────────────
//  导出 CSV
// ──────────────────────────────────────────────

function exportEntriesCsv(entries) {
  /** 将时间条目导出为 CSV 字符串。
   *
   * 列：日期, 描述, 项目, 标签, 开始时间, 结束时间, 时长(秒), 是否计费, 用户
   */
  const header = [
    '日期', '描述', '项目', '标签', '开始时间', '结束时间',
    '时长(秒)', '是否计费', '用户',
  ];
  const rows = [header];
  for (const e of entries) {
    const f = e.fields;
    const startMs = extractInt(f[Field.TE_START]);
    const stopMs = extractInt(f[Field.TE_STOP]);
    const startDt = startMs ? new Date(startMs) : null;
    const stopDt = stopMs ? new Date(stopMs) : null;
    rows.push([
      startDt ? startDt.toISOString().slice(0, 10) : '',
      extractText(f[Field.TE_DESCRIPTION]),
      extractText(f[Field.TE_PROJECT]),
      extractList(f[Field.TE_TAGS]).join(', '),
      startDt ? startDt.toISOString().replace('T', ' ').slice(0, 19) : '',
      stopDt ? stopDt.toISOString().replace('T', ' ').slice(0, 19) : '',
      extractInt(f[Field.TE_DURATION]),
      f[Field.TE_BILLABLE] ? 'true' : 'false',
      extractText(f[Field.TE_USER]),
    ]);
  }
  // 简单 CSV 序列化（含引号转义）
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? '');
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        })
        .join(',')
    )
    .join('\n');
}

// ──────────────────────────────────────────────
//  导出 Excel (.xlsx)
// ──────────────────────────────────────────────

async function exportEntriesXlsx(entries) {
  /** 将时间条目导出为 Excel 文件（Buffer）。
   *
   * 列与 CSV 一致：日期, 描述, 项目, 标签, 开始时间, 结束时间, 时长(秒), 是否计费, 用户
   */
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('时间条目');
  ws.columns = [
    { header: '日期', key: 'date', width: 12 },
    { header: '描述', key: 'desc', width: 30 },
    { header: '项目', key: 'project', width: 20 },
    { header: '标签', key: 'tags', width: 15 },
    { header: '开始时间', key: 'start', width: 20 },
    { header: '结束时间', key: 'stop', width: 20 },
    { header: '时长(秒)', key: 'duration', width: 10 },
    { header: '是否计费', key: 'billable', width: 10 },
    { header: '用户', key: 'user', width: 15 },
  ];

  for (const e of entries) {
    const f = e.fields;
    const startMs = extractInt(f[Field.TE_START]);
    const stopMs = extractInt(f[Field.TE_STOP]);
    const startDt = startMs ? new Date(startMs) : null;
    const stopDt = stopMs ? new Date(stopMs) : null;
    ws.addRow({
      date: startDt ? startDt.toISOString().slice(0, 10) : '',
      desc: extractText(f[Field.TE_DESCRIPTION]),
      project: extractText(f[Field.TE_PROJECT]),
      tags: extractList(f[Field.TE_TAGS]).join(', '),
      start: startDt ? startDt.toISOString().replace('T', ' ').slice(0, 19) : '',
      stop: stopDt ? stopDt.toISOString().replace('T', ' ').slice(0, 19) : '',
      duration: extractInt(f[Field.TE_DURATION]),
      billable: f[Field.TE_BILLABLE] ? 'true' : 'false',
      user: extractText(f[Field.TE_USER]),
    });
  }

  return wb.xlsx.writeBuffer();
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

function extractList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  return [];
}

module.exports = {
  weekRange,
  monthRange,
  dateToMs,
  fetchEntriesInRange,
  aggregateByProject,
  aggregateByTag,
  aggregateByDate,
  totalDuration,
  generateWeeklyReport,
  generateMonthlyReport,
  generateDailyReport,
  generateCustomReport,
  checkProjectOverrun,
  exportEntriesCsv,
  exportEntriesXlsx,
  extractInt,
  extractText,
  extractList,
};
