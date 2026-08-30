/** 计时器核心服务。对应 Python timer_service.py。
 *
 * 对应 Toggl Track 的 time entry 核心 API：
 * - 开始计时（同一用户只能有一个 running）
 * - 停止当前计时，写入 duration
 * - 获取当前进行中条目
 *
 * 数据写入多维表格 `time_entries` 表。
 */
const repo = require('./bitable');
const {
  TIME_ENTRIES_TABLE_ID,
  Field,
  STATE_RUNNING,
  STATE_STOPPED,
} = require('./constants');

// ──────────────────────────────────────────────
//  时间戳辅助
// ──────────────────────────────────────────────

function nowMs() {
  return Date.now();
}

function msToIso(ms) {
  /** 毫秒时间戳 → ISO8601 字符串（调试用）。 */
  return new Date(ms).toISOString();
}

// ──────────────────────────────────────────────
//  当前进行中条目
// ──────────────────────────────────────────────

async function getRunningEntry(userId) {
  /** 获取指定用户当前正在计时的条目。
   *
   * Toggl 规则：同一用户同一时刻最多一个 running 条目。
   *
   * 注意：人员字段的 filter 飞书 search 接口不认，所以只过滤状态=running，
   * 拿到所有 running 条目后在 JS 里按 user_id 筛。
   */
  if (!TIME_ENTRIES_TABLE_ID) {
    throw new Error('TIME_ENTRIES_TABLE_ID 未配置');
  }

  const results = await repo.searchRecords(
    TIME_ENTRIES_TABLE_ID,
    {
      conjunction: 'and',
      conditions: [
        { field_name: Field.TE_STATE, operator: 'is', value: [STATE_RUNNING] },
      ],
    },
    50
  );
  // 在 JS 里按 user_id 筛
  for (const entry of results) {
    const entryUser = extractUser(entry.fields[Field.TE_USER]);
    if (entryUser === userId) {
      return entry;
    }
  }
  return null;
}

async function listAllRunning() {
  /** 列出全局所有正在计时的条目（用于智能提醒检测未停止计时器）。 */
  if (!TIME_ENTRIES_TABLE_ID) {
    throw new Error('TIME_ENTRIES_TABLE_ID 未配置');
  }

  return repo.searchRecords(
    TIME_ENTRIES_TABLE_ID,
    {
      conjunction: 'and',
      conditions: [
        { field_name: Field.TE_STATE, operator: 'is', value: [STATE_RUNNING] },
      ],
    },
    100
  );
}

// ──────────────────────────────────────────────
//  开始 / 停止计时
// ──────────────────────────────────────────────

async function startTimer({
  userId,
  description,
  projectId = null,
  tags = null,
  billable = false,
  startAtMs = null,
}) {
  /** 开始一个新计时条目。
   *
   * 如果该用户已有 running 条目，先自动停止旧的（Toggl 行为）。
   * 返回新条目 {record_id, fields}。
   */
  // 1. 若已有 running 条目，先停止
  const existing = await getRunningEntry(userId);
  if (existing) {
    await stopTimer(existing.record_id);
  }

  // 2. 创建新 running 条目
  const startMs = startAtMs !== null ? startAtMs : nowMs();
  const fields = {
    [Field.TE_DESCRIPTION]: description,
    [Field.TE_START]: startMs, // 多维表格日期字段接受毫秒时间戳
    [Field.TE_STATE]: STATE_RUNNING,
    [Field.TE_USER]: userId,
    [Field.TE_BILLABLE]: billable,
    [Field.TE_DURATION]: 0, // running 期间 duration=0，停止时回填
  };
  if (projectId) {
    // 关联字段需要 record_id 列表
    fields[Field.TE_PROJECT] = [projectId];
  }
  if (tags) {
    // 多选关联字段
    fields[Field.TE_TAGS] = tags;
  }

  const recordId = await repo.createRecord(TIME_ENTRIES_TABLE_ID, fields);
  return { record_id: recordId, fields };
}

async function stopTimer(recordId, stopAtMs = null) {
  /** 停止指定条目，计算并写入 duration。
   *
   * 原子操作：
   * 1. 读取条目 start_time
   * 2. 计算 duration = stop - start（秒）
   * 3. 写入 stop_time + duration + state=stopped
   */
  if (!TIME_ENTRIES_TABLE_ID) {
    throw new Error('TIME_ENTRIES_TABLE_ID 未配置');
  }

  // 读取当前条目
  const entry = await repo.getRecord(TIME_ENTRIES_TABLE_ID, recordId);
  const fields = entry.fields;

  const startMs = extractMs(fields[Field.TE_START]);
  if (startMs === null) {
    throw new Error(`条目 ${recordId} 缺少开始时间`);
  }

  let stopMs = stopAtMs !== null ? stopAtMs : nowMs();
  if (stopMs < startMs) {
    stopMs = startMs; // 容错：不允许负时长
  }

  const durationSec = Math.floor((stopMs - startMs) / 1000);

  // 更新条目
  const updateFields = {
    [Field.TE_STOP]: stopMs,
    [Field.TE_DURATION]: durationSec,
    [Field.TE_STATE]: STATE_STOPPED,
  };
  await repo.updateRecord(TIME_ENTRIES_TABLE_ID, recordId, updateFields);

  return {
    record_id: recordId,
    start_ms: startMs,
    stop_ms: stopMs,
    duration_sec: durationSec,
  };
}

// ──────────────────────────────────────────────
//  编辑条目时间
// ──────────────────────────────────────────────

async function editEntryTime(recordId, startAtMs = null, stopAtMs = null) {
  /** 手动编辑条目的开始/结束时间，重新计算 duration。返回新 duration（秒）。 */
  const entry = await repo.getRecord(TIME_ENTRIES_TABLE_ID, recordId);
  const fields = entry.fields;

  const startMs = startAtMs !== null ? startAtMs : extractMs(fields[Field.TE_START]);
  const stopMs = stopAtMs !== null ? stopAtMs : extractMs(fields[Field.TE_STOP]);

  if (startMs === null) throw new Error('缺少开始时间');
  if (stopMs === null) throw new Error('缺少结束时间');

  const durationSec = Math.max(0, Math.floor((stopMs - startMs) / 1000));

  const updateFields = {
    [Field.TE_START]: startMs,
    [Field.TE_STOP]: stopMs,
    [Field.TE_DURATION]: durationSec,
  };
  await repo.updateRecord(TIME_ENTRIES_TABLE_ID, recordId, updateFields);
  return durationSec;
}

// ──────────────────────────────────────────────
//  内部辅助
// ──────────────────────────────────────────────

function extractMs(value) {
  /** 从多维表格字段值中提取毫秒时间戳。 */
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object') {
    const v = value.value || value.timestamp;
    return v !== undefined ? Number(v) : null;
  }
  if (typeof value === 'string') {
    const n = Number(value);
    return isNaN(n) ? null : n;
  }
  return null;
}

function extractUser(value) {
  /** 从多维表格人员字段值中提取用户 ID。 */
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'object') {
        const uid = item.id || item.open_id || item.user_id;
        if (uid) return uid;
        if (item.text) return item.text;
      } else if (typeof item === 'string') {
        return item;
      }
    }
    return null;
  }
  return null;
}

module.exports = {
  nowMs,
  msToIso,
  getRunningEntry,
  listAllRunning,
  startTimer,
  stopTimer,
  editEntryTime,
  extractMs,
  extractUser,
};
