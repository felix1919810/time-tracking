"""飞书事件订阅回调。

飞书开放平台通过 HTTP 回调把事件推送到我们的服务器。
我们需要：
1. 处理 URL 验证（飞书首次配置回调地址时发送 challenge）
2. 处理消息事件（用户在机器人会话里发指令）
3. 处理卡片按钮回调（用户点击卡片上的按钮）

配置入口：飞书开放平台 → 应用 → 事件与回调 → 事件配置
- 服务器地址: https://your-domain/api/lark/webhook
- 订阅事件:
  - im.message.receive_v1  (接收消息)
  - application.button.click.v1 (卡片按钮点击，需在卡片里声明 button)

注意：飞书回调用 Encrypt Key 加密，需在 SDK 里配置。
"""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Request, HTTPException

from .. import timer_service
from .. import notify_service as notify
from .. import report_service as report

log = logging.getLogger(__name__)
router = APIRouter()


# ──────────────────────────────────────────────
#  event_id 幂等去重
# ──────────────────────────────────────────────
# 飞书在 3 秒内没收到 200 会重推同一事件，导致机器人重复回复。
# 用进程内 set 记录已处理的 event_id，重复的直接返回 200 跳过。
# 进程重启后 set 清空——可接受，因为重试窗口只有几秒。
_processed_event_ids: set[str] = set()
_PROCESSED_MAX = 500  # 防止内存无限增长


def _is_duplicate(event_id: str) -> bool:
    """返回 True 表示这是重复事件，应跳过。"""
    if not event_id:
        return False
    if event_id in _processed_event_ids:
        return True
    _processed_event_ids.add(event_id)
    if len(_processed_event_ids) > _PROCESSED_MAX:
        # 淘汰最早的一半（set 无序，这里简化为清空）
        _processed_event_ids.clear()
        _processed_event_ids.add(event_id)
    return False


# ──────────────────────────────────────────────
#  Webhook 主入口
# ──────────────────────────────────────────────

@router.post("/webhook")
async def lark_webhook(request: Request):
    """飞书事件回调主入口。

    飞书推送的 JSON 结构：
    {
        "schema": "2.0",
        "header": {
            "event_id": "...",
            "event_type": "im.message.receive_v1",
            "token": "verification_token",   # 用于校验请求来源
            "app_id": "...",
            "tenant_key": "..."
        },
        "event": { ... }
    }

    或 URL 验证请求：
    {
        "challenge": "...",
        "token": "...",
        "type": "url_verification"
    }
    """
    body = await request.json()
    log.info("lark_webhook received: %s", json.dumps(body, ensure_ascii=False)[:500])

    # ── 1. URL 验证 ──
    if body.get("type") == "url_verification":
        return {"challenge": body.get("challenge", "")}

    # ── 2. 事件去重 ──
    header = body.get("header", {})
    event_id = header.get("event_id", "")
    if _is_duplicate(event_id):
        log.info("duplicate event_id=%s, skipping", event_id)
        return {"code": 0, "msg": "ok", "data": {}}

    # ── 3. 事件处理 ──
    event_type = header.get("event_type", "")
    event = body.get("event", {})

    try:
        if event_type == "im.message.receive_v1":
            _handle_message(event)
        elif event_type == "card.action.trigger":
            _handle_card_action(event)
        else:
            log.debug("Unhandled event type: %s", event_type)
    except Exception as e:
        log.exception("Event handling failed: %s", e)

    # 飞书要求 200 响应，否则会重试
    return {"code": 0, "msg": "ok", "data": {}}


# ──────────────────────────────────────────────
#  消息指令处理
# ──────────────────────────────────────────────

def _handle_message(event: dict[str, Any]) -> None:
    """处理用户发来的消息。

    支持的指令（类似 Toggl 的 CLI）：
    - "开始 <描述>"          开始计时
    - "停止"                 停止当前计时
    - "当前"                 查看当前计时
    - "日报"                 推送今日日报
    - "周报"                 推送本周周报
    - "帮助"                 显示可用指令
    """
    msg = event.get("message", {})
    content_str = msg.get("content", "{}")
    try:
        content = json.loads(content_str)
    except json.JSONDecodeError:
        return

    text = (content.get("text") or "").strip()
    if not text:
        return

    # 从消息发送者提取 open_id 作为 user_id
    sender = event.get("sender", {})
    sender_id_info = sender.get("sender_id", {})
    user_id = sender_id_info.get("open_id", "unknown")
    chat_id = msg.get("chat_id", "")

    if not chat_id:
        log.warning("No chat_id in message event")
        return

    # 群聊 @机器人时，text 形如 "@_user_1 开始 测试"
    # 需先剥离所有 @_user_* 占位符再解析指令
    import re
    cleaned = re.sub(r"@_user_\d+\s*", "", text).strip()
    log.info("parsed command: raw=%r cleaned=%r user=%s chat=%s",
             text, cleaned, user_id, chat_id)
    if not cleaned:
        return

    # 解析指令
    cmd = cleaned.lower()

    if cmd.startswith("开始") or cmd.startswith("start"):
        # 指令后的描述（可能为空）
        parts = cleaned.split(None, 1)
        desc = parts[1] if len(parts) > 1 else ""
        try:
            result = timer_service.start_timer(
                user_id=user_id,
                description=desc,
            )
            notify.send_text(
                f"⏱️ 已开始计时：{desc}\n条目ID: {result['record_id']}",
                receive_id=chat_id,
                receive_id_type="chat_id",
            )
        except Exception as e:
            notify.send_text(f"❌ 开始计时失败: {e}", receive_id=chat_id)

    elif cmd in ("停止", "stop"):
        running = timer_service.get_running_entry(user_id)
        if not running:
            notify.send_text("没有正在计时的条目", receive_id=chat_id)
            return
        try:
            result = timer_service.stop_timer(running["record_id"])
            dur_min = result["duration_sec"] // 60
            notify.send_text(
                f"⏹️ 已停止计时\n时长: {dur_min} 分钟",
                receive_id=chat_id,
            )
        except Exception as e:
            notify.send_text(f"❌ 停止计时失败: {e}", receive_id=chat_id)

    elif cmd in ("当前", "current"):
        running = timer_service.get_running_entry(user_id)
        if not running:
            notify.send_text("没有正在计时的条目", receive_id=chat_id)
            return
        import datetime as dt
        fields = running["fields"]
        start_ms = _extract_int(fields.get("开始时间"))
        start_str = dt.datetime.fromtimestamp(start_ms / 1000).strftime("%H:%M") if start_ms else "?"
        desc = _extract_text(fields.get("描述")) or "(无描述)"
        elapsed_min = (int(dt.datetime.now().timestamp() * 1000) - start_ms) // 60000 if start_ms else 0
        notify.send_text(
            f"⏱️ 正在计时：{desc}\n开始: {start_str}\n已计时: {elapsed_min} 分钟",
            receive_id=chat_id,
        )

    elif cmd in ("日报", "daily"):
        try:
            import datetime as dt
            today = dt.date.today()
            start_ms = report.date_to_ms(today)
            end_ms = report.date_to_ms(today, end_of_day=True)
            report_data = report.generate_custom_report(start_ms, end_ms, user_id=user_id)
            card = notify.daily_report_card("我", report_data)
            notify.send_card(card, receive_id=chat_id)
        except Exception as e:
            notify.send_text(f"❌ 日报生成失败: {e}", receive_id=chat_id)

    elif cmd in ("周报", "weekly"):
        try:
            report_data = report.generate_weekly_report(user_id=user_id)
            card = notify.weekly_report_card("我", report_data)
            notify.send_card(card, receive_id=chat_id)
        except Exception as e:
            notify.send_text(f"❌ 周报生成失败: {e}", receive_id=chat_id)

    elif cmd in ("帮助", "help", "h"):
        help_text = (
            "🤖 时间追踪机器人指令：\n\n"
            "• 开始 <描述>  - 开始计时\n"
            "• 停止         - 停止当前计时\n"
            "• 当前         - 查看当前计时\n"
            "• 日报         - 推送今日工时报表\n"
            "• 周报         - 推送本周工时报表\n"
            "• 帮助         - 显示此帮助信息\n\n"
            "示例：开始 编写用户登录模块"
        )
        notify.send_text(help_text, receive_id=chat_id)

    else:
        notify.send_text(
            "未识别的指令。发送\"帮助\"查看可用指令。",
            receive_id=chat_id,
        )


# ──────────────────────────────────────────────
#  卡片按钮回调
# ──────────────────────────────────────────────

def _handle_card_action(event: dict[str, Any]) -> None:
    """处理消息卡片上的按钮点击。

    卡片按钮需声明 value 字段，例如：
    {
        "tag": "button",
        "text": {"tag": "plain_text", "content": "停止计时"},
        "type": "primary",
        "value": {"action": "stop_timer", "record_id": "recXXX"}
    }

    点击后飞书会推送：
    event = {
        "operator": {...},      # 点击者信息
        "action": {
            "value": {"action": "stop_timer", "record_id": "recXXX"},
            "tag": "button"
        },
        "open_message_id": "...",
        "open_chat_id": "..."
    }
    """
    action = event.get("action", {})
    value = action.get("value", {})
    action_name = value.get("action", "")
    chat_id = event.get("open_chat_id", "")

    if action_name == "stop_timer":
        record_id = value.get("record_id", "")
        if not record_id:
            return
        try:
            result = timer_service.stop_timer(record_id)
            dur_min = result["duration_sec"] // 60
            notify.send_text(
                f"⏹️ 已通过卡片停止计时\n时长: {dur_min} 分钟",
                receive_id=chat_id,
            )
        except Exception as e:
            log.exception("stop_timer via card failed: %s", e)

    elif action_name == "start_timer":
        desc = value.get("description", "")
        user_id = event.get("operator", {}).get("open_id", "unknown")
        try:
            timer_service.start_timer(user_id=user_id, description=desc)
            notify.send_text(f"⏱️ 已开始计时：{desc}", receive_id=chat_id)
        except Exception as e:
            log.exception("start_timer via card failed: %s", e)

    elif action_name == "view_report":
        # 可在卡片上放"查看完整报表"按钮，点击后推送详细报表
        notify.send_text("完整报表请访问：https://your-app-domain", receive_id=chat_id)

    else:
        log.debug("Unknown card action: %s", action_name)


# ──────────────────────────────────────────────
#  辅助
# ──────────────────────────────────────────────

def _extract_int(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, dict):
        v = value.get("value") or value.get("text") or value.get("name")
        try:
            return int(v) if v is not None else 0
        except (ValueError, TypeError):
            return 0
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0


def _extract_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                parts.append(item.get("text") or item.get("name") or "")
            elif isinstance(item, str):
                parts.append(item)
        return "".join(parts)
    if isinstance(value, dict):
        return value.get("text") or value.get("name") or ""
    return ""
