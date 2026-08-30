/** 多维表格数据访问层。对应 Python bitable_repo.py。
 *
 * 所有对飞书多维表格的读写都经过这里，统一处理：
 * - record_id 的获取与缓存
 * - 字段名 → API 字段名的映射
 * - 分页与错误处理
 *
 * 用 REST API 直调飞书开放平台（绕过 SDK 类型限制），与 Python 版一致。
 */
const axios = require('axios');
const config = require('./config');
const { APP_TOKEN } = require('./lark-client');

// ──────────────────────────────────────────────
//  Token 获取（飞书 tenant_access_token）
// ──────────────────────────────────────────────

let _cachedToken = null;
let _tokenExpireAt = 0;

async function getTenantAccessToken() {
  // 飞书 token 有效期 2 小时，提前 5 分钟刷新
  const now = Date.now();
  if (_cachedToken && now < _tokenExpireAt - 5 * 60 * 1000) {
    return _cachedToken;
  }
  const resp = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: config.larkAppId, app_secret: config.larkAppSecret },
    { timeout: 15000 }
  );
  _cachedToken = resp.data.tenant_access_token;
  _tokenExpireAt = now + (resp.data.expire || 7200) * 1000;
  return _cachedToken;
}

async function authHeaders() {
  const token = await getTenantAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// ──────────────────────────────────────────────
//  时间戳辅助
// ──────────────────────────────────────────────

function nowMs() {
  return Date.now();
}

// ──────────────────────────────────────────────
//  单条记录 CRUD
// ──────────────────────────────────────────────

async function createRecord(tableId, fields) {
  /** 新建一条记录，返回 record_id。 */
  const headers = await authHeaders();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records`;
  const resp = await axios.post(url, { fields }, { headers, timeout: 30000 });
  if (resp.data.code !== 0) {
    throw new Error(`create_record failed: ${resp.data.code} ${resp.data.msg}`);
  }
  return resp.data.data.record.record_id;
}

async function updateRecord(tableId, recordId, fields) {
  /** 更新一条记录的指定字段。 */
  const headers = await authHeaders();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`;
  const resp = await axios.put(url, { fields }, { headers, timeout: 30000 });
  if (resp.data.code !== 0) {
    throw new Error(`update_record failed: ${resp.data.code} ${resp.data.msg}`);
  }
  return resp.data.data.record;
}

async function deleteRecord(tableId, recordId) {
  const headers = await authHeaders();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`;
  const resp = await axios.delete(url, { headers, timeout: 30000 });
  if (resp.data.code !== 0) {
    throw new Error(`delete_record failed: ${resp.data.code} ${resp.data.msg}`);
  }
  return true;
}

async function getRecord(tableId, recordId) {
  /** 读取单条记录。 */
  const headers = await authHeaders();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/${recordId}`;
  const resp = await axios.get(url, { headers, timeout: 15000 });
  if (resp.data.code !== 0) {
    throw new Error(`get_record ${recordId} not found: ${resp.data.code} ${resp.data.msg}`);
  }
  const record = resp.data.data.record;
  return { record_id: record.record_id, fields: flattenFields(record.fields || {}) };
}

// ──────────────────────────────────────────────
//  查询
// ──────────────────────────────────────────────

async function searchRecords(tableId, filter = null, pageSize = 100, offset = 0) {
  /** 按条件搜索记录，返回 [{record_id, fields}] 列表。
   *
   * 直接用 REST API（POST /records/search），绕过 SDK 的 FilterInfo 类型限制。
   * filter 是飞书 Bitable 的 Conjunction 结构，例如：
   *   {
   *     "conjunction": "and",
   *     "conditions": [
   *       {"field_name": "状态", "operator": "is", "value": ["running"]}
   *     ]
   *   }
   */
  const headers = await authHeaders();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/search?page_size=${pageSize}`;
  const body = {};
  if (filter !== null) {
    body.filter = filter;
  }
  const resp = await axios.post(url, body, { headers, timeout: 30000 });
  const j = resp.data;
  if (j.code !== 0) {
    throw new Error(`search_records failed: ${j.code} ${j.msg}`);
  }
  const out = [];
  for (const item of j.data.items || []) {
    out.push({ record_id: item.record_id, fields: flattenFields(item.fields || {}) });
  }
  return out;
}

// ──────────────────────────────────────────────
//  字段扁平化
// ──────────────────────────────────────────────

function flattenFields(fields) {
  /** 把飞书多维表格的复杂字段值扁平化成简单类型，方便前端直接渲染。
   *
   * - 文本字段 [{"text":"xxx","type":"text"}] → "xxx"
   * - 日期字段 {"value": 1786896000000} → 1786896000000
   * - 关联字段 [{"record_ids":["recXXX"]}] → ["recXXX"]
   * - 单选字段 {"text":"工签","type":"text"} → "工签"
   * - 多选字段 [{"text":"标签1","type":"text"}] → ["标签1"]
   */
  const result = {};
  for (const [key, val] of Object.entries(fields)) {
    result[key] = flattenValue(val);
  }
  return result;
}

function flattenValue(val) {
  if (val === null || val === undefined) {
    return null;
  }
  // 列表类型
  if (Array.isArray(val)) {
    if (val.length === 0) return [];
    // 纯文本数组 [{"text":"xxx","type":"text"}] → "xxx"（单元素）或 ["xxx", ...]（多元素）
    if (val.every((item) => item && typeof item === 'object' && 'text' in item)) {
      const texts = val.map((item) => item.text);
      return texts.length === 1 ? texts[0] : texts;
    }
    // 关联字段 [{"record_ids":["recXXX"],"table_id":"..."}] → ["recXXX"]
    if (val.every((item) => item && typeof item === 'object' && 'record_ids' in item)) {
      return val.flatMap((item) => item.record_ids || []);
    }
    // 普通列表，递归处理每个元素
    return val.map((item) => flattenValue(item));
  }
  // 字典类型
  if (typeof val === 'object') {
    // 日期字段：{"value": 1786896000000}
    if ('value' in val && typeof val.value === 'number') {
      return val.value;
    }
    // 单选/文本：{"text":"xxx"} 或 {"name":"xxx"}
    for (const k of ['text', 'name']) {
      if (k in val && typeof val[k] === 'string') {
        return val[k];
      }
    }
    // 其他字典，递归处理 value
    return flattenValue(val.value || val);
  }
  // 简单类型直接返回
  return val;
}

module.exports = {
  nowMs,
  createRecord,
  updateRecord,
  deleteRecord,
  getRecord,
  searchRecords,
  flattenFields,
  flattenValue,
  getTenantAccessToken,
};
