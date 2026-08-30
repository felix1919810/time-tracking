"""飞书消息机器人推送。

对应 Toggl 的邮件提醒，我们用飞书消息卡片交互性更强。

推送类型：
- 日报（每天 18:00）
- 周报（每周一 09:00）
- 未停止计时器提醒（每小时检测）
- 工时超额预警（每天 10:00 检测）

消息通过 im/v1 CreateMessage 接口发送到群聊或个人。
"""
from __future__ import annotations

import json
from typing import Any

import lark_oapi as lark
from lark_oapi.api.im.v1 import (
    CreateMessageRequest,
    CreateMessageRequestBody,
)

from .config import get_settings

_settings = get_settings()

# 接收者类型
RECEIVER_CHAT = "chat_id"       # 群聊
RECEIVER_OPEN_ID = "open_id"    # 个人 open_id
RECEIVER_USER_ID = "user_id"    # 个人 user_id


def send_text(
    text: str,
    receive_id: str | None = None,
    receive_id_type: str = RECEIVER_CHAT,
) -> bool:
    """发送纯文本消息到指定接收者。默认发到群聊。

    用 REST API 直接发消息，绕过 SDK builder 的 receive_id_type 问题。
    """
    import requests as _req

    from .config import get_settings
    _s = get_settings()

    target_id = receive_id or _s.lark_notify_chat_id
    if not target_id:
        raise RuntimeError("未配置 receive_id 且 LARK_NOTIFY_CHAT_ID 为空")

    # 拿 tenant_access_token
    tr = _req.post(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": _s.lark_app_id, "app_secret": _s.lark_app_secret},
        timeout=15,
    )
    token = tr.json()["tenant_access_token"]

    # 发消息
    resp = _req.post(
        "https://open.feishu.cn/open-apis/im/v1/messages",
        params={"receive_id_type": receive_id_type},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "receive_id": target_id,
            "msg_type": "text",
            "content": json.dumps({"text": text}),
        },
        timeout=15,
    )
    rj = resp.json()
    if rj.get("code") != 0:
        print(f"[notify] send_text failed: {rj}")
        return False
    return True


def send_card(
    card: dict[str, Any],
    receive_id: str | None = None,
    receive_id_type: str = RECEIVER_CHAT,
) -> bool:
    """发送交互式消息卡片（用 REST API 绕过 SDK builder 问题）。"""
    import requests as _req

    from .config import get_settings
    _s = get_settings()

    target_id = receive_id or _s.lark_notify_chat_id
    if not target_id:
        raise RuntimeError("未配置 receive_id 且 LARK_NOTIFY_CHAT_ID 为空")

    tr = _req.post(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": _s.lark_app_id, "app_secret": _s.lark_app_secret},
        timeout=15,
    )
    token = tr.json()["tenant_access_token"]

    resp = _req.post(
        "https://open.feishu.cn/open-apis/im/v1/messages",
        params={"receive_id_type": receive_id_type},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "receive_id": target_id,
            "msg_type": "interactive",
            "content": json.dumps(card, ensure_ascii=False),
        },
        timeout=15,
    )
    rj = resp.json()
    if rj.get("code") != 0:
        print(f"[notify] send_card failed: {rj}")
        return False
    return True


# ──────────────────────────────────────────────
#  预设卡片模板
# ──────────────────────────────────────────────

def _fmt_duration(sec: int) -> str:
    """秒 → '8h 30m' 格式。"""
    h = sec // 3600
    m = (sec % 3600) // 60
    if h > 0:
        return f"{h}h {m}m"
    return f"{m}m"


def daily_report_card(user_name: str, report: dict[str, Any]) -> dict[str, Any]:
    """日报卡片模板。

    report 结构见 report_service.generate_weekly_report 返回值。
    """
    total = _fmt_duration(report.get("total_sec", 0))
    count = report.get("entry_count", 0)

    # 项目明细（最多展示 5 个）
    projects = report.get("by_project", [])[:5]
    project_lines = []
    for p in projects:
        name = p.get("project_name", "(无项目)")
        dur = _fmt_duration(p.get("total_sec", 0))
        project_lines.append(f"• {name}: {dur}")
    project_text = "\n".join(project_lines) if project_lines else "暂无记录"

    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": f"📅 日报 - {user_name}"},
            "template": "blue",
        },
        "elements": [
            {
                "tag": "div",
                "fields": [
                    {"is_short": True, "text": {"tag": "lark_md", "content": f"**总工时**\n{total}"}},
                    {"is_short": True, "text": {"tag": "lark_md", "content": f"**条目数**\n{count}"}},
                ],
            },
            {"tag": "hr"},
            {"tag": "div", "text": {"tag": "lark_md", "content": f"**项目明细**\n{project_text}"}},
        ],
    }


def weekly_report_card(user_name: str, report: dict[str, Any]) -> dict[str, Any]:
    """周报卡片模板。"""
    total = _fmt_duration(report.get("total_sec", 0))
    count = report.get("entry_count", 0)
    start_date = report.get("start_date", "")
    end_date = report.get("end_date", "")

    # 按日期明细
    by_date = report.get("by_date", [])
    date_lines = []
    for d in by_date[-7:]:  # 最多展示最近 7 天
        date_str = d.get("date", "")
        dur = _fmt_duration(d.get("total_sec", 0))
        date_lines.append(f"• {date_str}: {dur}")
    date_text = "\n".join(date_lines) if date_lines else "暂无记录"

    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": f"📊 周报 - {user_name}"},
            "template": "green",
        },
        "elements": [
            {
                "tag": "div",
                "fields": [
                    {"is_short": True, "text": {"tag": "lark_md", "content": f"**周期**\n{start_date} ~ {end_date}"}},
                    {"is_short": True, "text": {"tag": "lark_md", "content": f"**总工时**\n{total}"}},
                ],
            },
            {"tag": "hr"},
            {"tag": "div", "text": {"tag": "lark_md", "content": f"**每日工时**\n{date_text}"}},
        ],
    }


def running_timer_alert(entries: list[dict[str, Any]]) -> dict[str, Any]:
    """未停止计时器提醒卡片。

    entries 是 timer_service.list_all_running() 返回的列表。
    """
    if not entries:
        return {}  # 无运行中条目，不发消息

    lines = []
    for e in entries[:10]:  # 最多展示 10 条
        f = e["fields"]
        desc = _extract_text(f.get("描述")) or "(无描述)"
        user = _extract_text(f.get("用户")) or "(未知用户)"
        start_ms = _extract_int(f.get("开始时间"))
        if start_ms:
            import datetime as dt
            start_str = dt.datetime.fromtimestamp(start_ms / 1000).strftime("%m-%d %H:%M")
            elapsed = int((dt.datetime.now().timestamp() - start_ms / 1000) / 3600)
            lines.append(f"• {user} - {desc} (自 {start_str}, 已 {elapsed}h)")
        else:
            lines.append(f"• {user} - {desc}")

    text = "\n".join(lines)
    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": f"⚠️ 未停止计时器提醒 ({len(entries)} 个)"},
            "template": "orange",
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": f"以下计时器运行时间较长，请检查是否忘记停止：\n\n{text}"}},
        ],
    }


def overrun_alert(project_name: str, result: dict[str, Any]) -> dict[str, Any]:
    """工时超额预警卡片。

    result 结构见 report_service.check_project_overrun 返回值。
    """
    estimated_h = result.get("estimated_hours", 0)
    actual_h = result.get("actual_hours", 0)
    overrun_h = result.get("overrun_sec", 0) / 3600

    return {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": f"🚨 工时超额预警 - {project_name}"},
            "template": "red",
        },
        "elements": [
            {
                "tag": "div",
                "fields": [
                    {"is_short": True, "text": {"tag": "lark_md", "content": f"**预估工时**\n{estimated_h}h"}},
                    {"is_short": True, "text": {"tag": "lark_md", "content": f"**实际工时**\n{actual_h}h"}},
                ],
            },
            {"tag": "hr"},
            {"tag": "div", "text": {"tag": "lark_md", "content": f"**超额**\n{overrun_h:.1f}h\n\n请评估是否需要调整项目计划或预估工时。"}},
        ],
    }


# ──────────────────────────────────────────────
#  字段值提取辅助（与 report_service 一致，避免循环依赖）
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
