"""提醒相关 REST 路由。

手动触发提醒（供调试和机器人交互调用）：

POST /api/notify/text         发送纯文本消息
POST /api/notify/card         发送消息卡片
POST /api/notify/daily        手动触发日报推送
POST /api/notify/weekly       手动触发周报推送
POST /api/notify/running      手动触发未停止计时器检测
POST /api/notify/overrun      手动触发工时超额检测
"""
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import notify_service as notify
from .. import report_service as report
from .. import timer_service
from .. import bitable_repo as repo
from ..constants import PROJECTS_TABLE_ID, Field, STATUS_ACTIVE

router = APIRouter()


# ──────────────────────────────────────────────
#  请求模型
# ──────────────────────────────────────────────

class TextReq(BaseModel):
    text: str
    receive_id: str | None = None
    receive_id_type: str = "chat_id"


class CardReq(BaseModel):
    card: dict[str, Any]
    receive_id: str | None = None
    receive_id_type: str = "chat_id"


class DailyReq(BaseModel):
    user_name: str = "全体成员"


class WeeklyReq(BaseModel):
    user_name: str = "全体成员"


# ──────────────────────────────────────────────
#  基础发送
# ──────────────────────────────────────────────

@router.post("/text")
def send_text(req: TextReq):
    try:
        ok = notify.send_text(req.text, req.receive_id, req.receive_id_type)
        return {"ok": ok}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/card")
def send_card(req: CardReq):
    try:
        ok = notify.send_card(req.card, req.receive_id, req.receive_id_type)
        return {"ok": ok}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
#  手动触发定时任务
# ──────────────────────────────────────────────

@router.post("/daily")
def trigger_daily(req: DailyReq):
    """手动触发日报推送。"""
    try:
        import datetime as dt
        today = dt.date.today()
        start_ms = report.date_to_ms(today)
        end_ms = report.date_to_ms(today, end_of_day=True)
        report_data = report.generate_custom_report(start_ms, end_ms)
        card = notify.daily_report_card(req.user_name, report_data)
        ok = notify.send_card(card)
        return {"ok": ok, "total_sec": report_data["total_sec"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/weekly")
def trigger_weekly(req: WeeklyReq):
    """手动触发周报推送。"""
    try:
        report_data = report.generate_weekly_report()
        card = notify.weekly_report_card(req.user_name, report_data)
        ok = notify.send_card(card)
        return {"ok": ok, "total_sec": report_data["total_sec"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/running")
def trigger_running_check():
    """手动触发未停止计时器检测。"""
    try:
        entries = timer_service.list_all_running()
        if not entries:
            return {"ok": True, "message": "无运行中计时器", "count": 0}
        card = notify.running_timer_alert(entries)
        ok = notify.send_card(card) if card else True
        return {"ok": ok, "count": len(entries)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/overrun")
def trigger_overrun_check():
    """手动触发工时超额检测。"""
    try:
        projects = repo.search_records(
            PROJECTS_TABLE_ID,
            filter_={
                "conjunction": "and",
                "conditions": [
                    {"field_name": Field.STATUS, "operator": "is", "value": [STATUS_ACTIVE]}
                ],
            },
            page_size=200,
        )
        alerts_sent = 0
        for p in projects:
            f = p["fields"]
            estimated = _extract_float(f.get("预估工时"))
            if not estimated or estimated <= 0:
                continue
            result = report.check_project_overrun(p["record_id"], estimated)
            if result.get("overrun"):
                project_name = _extract_text(f.get("项目名称")) or "(未命名)"
                card = notify.overrun_alert(project_name, result)
                if notify.send_card(card):
                    alerts_sent += 1
        return {"ok": True, "alerts_sent": alerts_sent, "projects_checked": len(projects)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
#  内部辅助
# ──────────────────────────────────────────────

def _extract_float(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        v = value.get("value") or value.get("text") or value.get("name")
        try:
            return float(v) if v is not None else 0.0
        except (ValueError, TypeError):
            return 0.0
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return 0.0
    return 0.0


def _extract_text(value) -> str:
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
