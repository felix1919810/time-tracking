/** 消息推送服务。对应 Python notify_service.py。
 *
 * 用 REST API 直接发消息，绕过 SDK builder 的 receive_id_type 问题。
 */
const axios = require('axios');
const config = require('./config');

const RECEIVER_CHAT = 'chat_id';
const RECEIVER_USER = 'open_id';

// ──────────────────────────────────────────────
//  Token 获取
// ──────────────────────────────────────────────

let _cachedToken = null;
let _tokenExpireAt = 0;

async function getTenantAccessToken() {
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

// ──────────────────────────────────────────────
//  发送消息
// ──────────────────────────────────────────────

async function sendText(text, receiveId = null, receiveIdType = RECEIVER_CHAT) {
  /** 发送纯文本消息到指定接收者。默认发到群聊。 */
  const targetId = receiveId || config.larkNotifyChatId;
  if (!targetId) {
    throw new Error('未配置 receive_id 且 LARK_NOTIFY_CHAT_ID 为空');
  }

  const token = await getTenantAccessToken();
  const resp = await axios.post(
    'https://open.feishu.cn/open-apis/im/v1/messages',
    {
      receive_id: targetId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
    {
      params: { receive_id_type: receiveIdType },
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    }
  );
  const rj = resp.data;
  if (rj.code !== 0) {
    console.error('[notify] send_text failed:', rj);
    return false;
  }
  return true;
}

async function sendCard(card, receiveId = null, receiveIdType = RECEIVER_CHAT) {
  /** 发送交互式消息卡片（用 REST API 绕过 SDK builder 问题）。 */
  const targetId = receiveId || config.larkNotifyChatId;
  if (!targetId) {
    throw new Error('未配置 receive_id 且 LARK_NOTIFY_CHAT_ID 为空');
  }

  const token = await getTenantAccessToken();
  const resp = await axios.post(
    'https://open.feishu.cn/open-apis/im/v1/messages',
    {
      receive_id: targetId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    },
    {
      params: { receive_id_type: receiveIdType },
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    }
  );
  const rj = resp.data;
  if (rj.code !== 0) {
    console.error('[notify] send_card failed:', rj);
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────
//  预设卡片模板
// ──────────────────────────────────────────────

function fmtDuration(sec) {
  /** 秒 → '8h 30m' 格式。 */
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function dailyReportCard(userName, report) {
  /** 日报卡片模板。 */
  const total = fmtDuration(report.total_sec || 0);
  const count = report.entry_count || 0;

  // 项目明细（最多展示 5 个）
  const projects = (report.by_project || []).slice(0, 5);
  const projectLines = projects.map((p) =>
    `• ${p.project_name || '(无项目)'}: ${fmtDuration(p.total_sec || 0)}`
  );
  const projectText = projectLines.length > 0 ? projectLines.join('\n') : '暂无记录';

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `📅 日报 - ${userName}` },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**总工时**\n${total}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**条目数**\n${count}` } },
        ],
      },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `**项目明细**\n${projectText}` } },
    ],
  };
}

function weeklyReportCard(userName, report) {
  /** 周报卡片模板。 */
  const total = fmtDuration(report.total_sec || 0);
  const count = report.entry_count || 0;
  const startDate = report.start_date || '';
  const endDate = report.end_date || '';

  // 按日期明细
  const byDate = report.by_date || [];
  const dateLines = byDate.slice(-7).map((d) =>
    `• ${d.date}: ${fmtDuration(d.total_sec || 0)}`
  );
  const dateText = dateLines.length > 0 ? dateLines.join('\n') : '暂无记录';

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `📊 周报 - ${userName}` },
      template: 'green',
    },
    elements: [
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**周期**\n${startDate} ~ ${endDate}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**总工时**\n${total}` } },
        ],
      },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `**每日工时**\n${dateText}` } },
    ],
  };
}

function runningTimerAlert(entries) {
  /** 未停止计时器提醒卡片。 */
  if (!entries || entries.length === 0) return {};

  const lines = entries.slice(0, 10).map((e) => {
    const f = e.fields || {};
    const desc = extractText(f['描述']) || '(无描述)';
    const user = extractText(f['用户']) || '(未知用户)';
    const startMs = extractInt(f['开始时间']);
    if (startMs) {
      const startDate = new Date(startMs);
      const startStr = `${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')} ${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;
      const elapsed = Math.floor((Date.now() - startMs) / 3600000);
      return `• ${user} - ${desc} (自 ${startStr}, 已 ${elapsed}h)`;
    }
    return `• ${user} - ${desc}`;
  });

  const text = lines.join('\n');
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `⚠️ 未停止计时器提醒 (${entries.length} 个)` },
      template: 'orange',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `以下计时器运行时间较长，请检查是否忘记停止：\n\n${text}` } },
    ],
  };
}

function overrunAlert(projectName, result) {
  /** 工时超额预警卡片。 */
  const estimatedH = result.estimated_hours || 0;
  const actualH = result.actual_hours || 0;
  const overrunH = (result.overrun_sec || 0) / 3600;

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `🚨 工时超额预警 - ${projectName}` },
      template: 'red',
    },
    elements: [
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**预估工时**\n${estimatedH}h` } },
          { is_short: true, text: { tag: 'lark_md', content: `**实际工时**\n${actualH}h` } },
        ],
      },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: `**超额**\n${overrunH.toFixed(1)}h\n\n请评估是否需要调整项目计划或预估工时。` } },
    ],
  };
}

// ──────────────────────────────────────────────
//  字段值提取辅助
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

module.exports = {
  RECEIVER_CHAT,
  RECEIVER_USER,
  sendText,
  sendCard,
  fmtDuration,
  dailyReportCard,
  weeklyReportCard,
  runningTimerAlert,
  overrunAlert,
  getTenantAccessToken,
};
