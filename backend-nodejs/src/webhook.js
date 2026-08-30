/** 飞书事件回调 + 机器人指令处理。对应 Python routers/lark_webhook.py。
 *
 * 支持的指令（类似 Toggl 的 CLI）：
 * - "开始 <描述>"          开始计时
 * - "停止"                 停止当前计时
 * - "当前"                 查看当前计时
 * - "日报"                 推送今日日报
 * - "周报"                 推送本周周报
 * - "帮助"                 显示可用指令
 */
const timerService = require('./timer-service');
const notify = require('./notify-service');
const report = require('./report-service');

// ──────────────────────────────────────────────
//  event_id 幂等去重
// ──────────────────────────────────────────────
// 飞书在 3 秒内没收到 200 会重推同一事件，导致机器人重复回复。
// 用进程内 Set 记录已处理的 event_id，重复的直接返回 200 跳过。
// 进程重启后 Set 清空——可接受，因为重试窗口只有几秒。
const processedEventIds = new Set();
const PROCESSED_MAX = 500;

function isDuplicate(eventId) {
  /** 返回 true 表示这是重复事件，应跳过。 */
  if (!eventId) return false;
  if (processedEventIds.has(eventId)) return true;
  processedEventIds.add(eventId);
  if (processedEventIds.size > PROCESSED_MAX) {
    // 淘汰最早的一半（Set 无序，这里简化为清空）
    processedEventIds.clear();
    processedEventIds.add(eventId);
  }
  return false;
}

// ──────────────────────────────────────────────
//  Webhook 主入口（Express handler）
// ──────────────────────────────────────────────

async function larkWebhook(req, res) {
  /** 飞书事件回调主入口。
   *
   * 飞书推送的 JSON 结构：
   * {
   *   "schema": "2.0",
   *   "header": {
   *     "event_id": "...",
   *     "event_type": "im.message.receive_v1",
   *     "token": "verification_token",
   *     "app_id": "...",
   *     "tenant_key": "..."
   *   },
   *   "event": { ... }
   * }
   *
   * 或 URL 验证请求：
   * { "challenge": "...", "token": "...", "type": "url_verification" }
   */
  const body = req.body || {};
  console.log('[webhook] received:', JSON.stringify(body).slice(0, 500));

  // ── 1. URL 验证 ──
  if (body.type === 'url_verification') {
    return res.json({ challenge: body.challenge || '' });
  }

  // ── 2. 事件去重 ──
  const header = body.header || {};
  const eventId = header.event_id || '';
  if (isDuplicate(eventId)) {
    console.log('[webhook] duplicate event_id=%s, skipping', eventId);
    return res.json({ code: 0, msg: 'ok', data: {} });
  }

  // ── 3. 事件处理 ──
  const eventType = header.event_type || '';
  const event = body.event || {};

  try {
    if (eventType === 'im.message.receive_v1') {
      await handleMessage(event);
    } else if (eventType === 'card.action.trigger') {
      await handleCardAction(event);
    } else {
      console.debug('[webhook] Unhandled event type: %s', eventType);
    }
  } catch (e) {
    console.error('[webhook] Event handling failed:', e);
  }

  // 飞书要求 200 响应，否则会重试
  res.json({ code: 0, msg: 'ok', data: {} });
}

// ──────────────────────────────────────────────
//  消息指令处理
// ──────────────────────────────────────────────

async function handleMessage(event) {
  /** 处理用户发来的消息。 */
  const msg = event.message || {};
  const contentStr = msg.content || '{}';
  let content;
  try {
    content = JSON.parse(contentStr);
  } catch (e) {
    return;
  }

  const text = (content.text || '').trim();
  if (!text) return;

  // 从消息发送者提取 open_id 作为 user_id
  const sender = event.sender || {};
  const senderIdInfo = sender.sender_id || {};
  const userId = senderIdInfo.open_id || 'unknown';
  const chatId = msg.chat_id || '';

  if (!chatId) {
    console.warn('[webhook] No chat_id in message event');
    return;
  }

  // 群聊 @机器人时，text 形如 "@_user_1 开始 测试"
  // 需先剥离所有 @_user_* 占位符再解析指令
  const cleaned = text.replace(/@_user_\d+\s*/g, '').trim();
  console.info('[webhook] parsed command: raw=%j cleaned=%j user=%s chat=%s',
               text, cleaned, userId, chatId);
  if (!cleaned) return;

  // 解析指令
  const cmd = cleaned.toLowerCase();

  if (cmd.startsWith('开始') || cmd.startsWith('start')) {
    // 指令后的描述（可能为空）
    const parts = cleaned.split(/\s+/);
    const desc = parts.length > 1 ? parts.slice(1).join(' ') : '';
    try {
      const result = await timerService.startTimer({
        userId,
        description: desc,
      });
      await notify.sendText(
        `⏱️ 已开始计时：${desc}\n条目ID: ${result.record_id}`,
        chatId,
        notify.RECEIVER_CHAT
      );
    } catch (e) {
      await notify.sendText(`❌ 开始计时失败: ${e.message}`, chatId);
    }
  } else if (cmd === '停止' || cmd === 'stop') {
    const running = await timerService.getRunningEntry(userId);
    if (!running) {
      await notify.sendText('没有正在计时的条目', chatId);
      return;
    }
    try {
      const result = await timerService.stopTimer(running.record_id);
      const durMin = Math.floor(result.duration_sec / 60);
      await notify.sendText(`⏹️ 已停止计时\n时长: ${durMin} 分钟`, chatId);
    } catch (e) {
      await notify.sendText(`❌ 停止计时失败: ${e.message}`, chatId);
    }
  } else if (cmd === '当前' || cmd === 'current') {
    const running = await timerService.getRunningEntry(userId);
    if (!running) {
      await notify.sendText('没有正在计时的条目', chatId);
      return;
    }
    const fields = running.fields || {};
    const startMs = extractInt(fields['开始时间']);
    const startDate = startMs ? new Date(startMs) : null;
    const startStr = startDate
      ? `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`
      : '?';
    const desc = extractText(fields['描述']) || '(无描述)';
    const elapsedMin = startMs ? Math.floor((Date.now() - startMs) / 60000) : 0;
    await notify.sendText(
      `⏱️ 正在计时：${desc}\n开始: ${startStr}\n已计时: ${elapsedMin} 分钟`,
      chatId
    );
  } else if (cmd === '日报' || cmd === 'daily') {
    try {
      const today = new Date();
      const startMs = report.dateToMs(today);
      const endMs = report.dateToMs(today, true);
      const reportData = await report.generateCustomReport(startMs, endMs, userId);
      const card = notify.dailyReportCard('我', reportData);
      await notify.sendCard(card, chatId);
    } catch (e) {
      await notify.sendText(`❌ 日报生成失败: ${e.message}`, chatId);
    }
  } else if (cmd === '周报' || cmd === 'weekly') {
    try {
      const reportData = await report.generateWeeklyReport(userId);
      const card = notify.weeklyReportCard('我', reportData);
      await notify.sendCard(card, chatId);
    } catch (e) {
      await notify.sendText(`❌ 周报生成失败: ${e.message}`, chatId);
    }
  } else if (cmd === '帮助' || cmd === 'help' || cmd === 'h') {
    const helpText =
      '🤖 时间追踪机器人指令：\n\n' +
      '• 开始 <描述>  - 开始计时\n' +
      '• 停止         - 停止当前计时\n' +
      '• 当前         - 查看当前计时\n' +
      '• 日报         - 推送今日工时报表\n' +
      '• 周报         - 推送本周工时报表\n' +
      '• 帮助         - 显示此帮助信息\n\n' +
      '示例：开始 编写用户登录模块';
    await notify.sendText(helpText, chatId);
  } else {
    await notify.sendText('未识别的指令。发送"帮助"查看可用指令。', chatId);
  }
}

// ──────────────────────────────────────────────
//  卡片按钮回调
// ──────────────────────────────────────────────

async function handleCardAction(event) {
  /** 处理消息卡片上的按钮点击。
   *
   * 卡片按钮需声明 value 字段，例如：
   * {
   *   "tag": "button",
   *   "text": {"tag": "plain_text", "content": "停止计时"},
   *   "type": "primary",
   *   "value": {"action": "stop_timer", "record_id": "recXXX"}
   * }
   */
  const action = event.action || {};
  const value = action.value || {};
  const actionName = value.action || '';
  const chatId = event.open_chat_id || '';

  if (actionName === 'stop_timer') {
    const recordId = value.record_id || '';
    if (!recordId) return;
    try {
      const result = await timerService.stopTimer(recordId);
      const durMin = Math.floor(result.duration_sec / 60);
      await notify.sendText(`⏹️ 已通过卡片停止计时\n时长: ${durMin} 分钟`, chatId);
    } catch (e) {
      console.error('[webhook] stop_timer via card failed:', e);
    }
  } else if (actionName === 'start_timer') {
    const desc = value.description || '';
    const userId = (event.operator || {}).open_id || 'unknown';
    try {
      await timerService.startTimer({ userId, description: desc });
      await notify.sendText(`⏱️ 已开始计时：${desc}`, chatId);
    } catch (e) {
      console.error('[webhook] start_timer via card failed:', e);
    }
  } else if (actionName === 'view_report') {
    await notify.sendText('完整报表请访问：https://your-app-domain', chatId);
  } else {
    console.debug('[webhook] Unknown card action: %s', actionName);
  }
}

// ──────────────────────────────────────────────
//  辅助
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
  larkWebhook,
  isDuplicate,
  handleMessage,
  handleCardAction,
};
