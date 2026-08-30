"""定时任务调度器（APScheduler）。

定时任务：
- 每小时 :05  扫描未停止计时器，超过阈值则提醒
- 每天 10:00  检测项目工时超额，发预警
- 每天 18:00  发送当日日报
- 每周一 09:00  发送周报

调用 notify_service 推送消息卡片。
"""
from __future__ import annotations

import datetime as dt
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import get_settings
from . import notify_service as notify
from . import report_service as report
from . import timer_service
from . import bitable_repo as repo
from .constants import PROJECTS_TABLE_ID, Field, STATUS_ACTIVE

log = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None

_settings = get_settings()
_TZ = _settings.timezone

# 未停止计时器提醒阈值（小时）
_RUN_ALERT_HOURS = 8


# ──────────────────────────────────────────────
#  定时任务实现
# ──────────────────────────────────────────────

def _job_check_running_timers() -> None:
    """每小时检查未停止计时器。"""
    try:
        entries = timer_service.list_all_running()
        if not entries:
            return

        # 过滤运行时间超过阈值的
        now = dt.datetime.now()
        alert_entries = []
        for e in entries:
            start_ms = _extract_int(e["fields"].get("开始时间"))
            if not start_ms:
                continue
            start_dt = dt.datetime.fromtimestamp(start_ms / 1000)
            elapsed_h = (now - start_dt).total_seconds() / 3600
            if elapsed_h >= _RUN_ALERT_HOURS:
                alert_entries.append(e)

        if alert_entries:
            card = notify.running_timer_alert(alert_entries)
            if card:
                notify.send_card(card)
    except Exception as e:
        log.exception("_job_check_running_timers failed: %s", e)


def _job_check_project_overrun() -> None:
    """每天 10:00 检测所有活跃项目的工时超额。"""
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
        for p in projects:
            f = p["fields"]
            estimated = _extract_float(f.get("预估工时"))
            if not estimated or estimated <= 0:
                continue  # 未设预估，跳过

            project_name = _extract_text(f.get("项目名称")) or "(未命名)"
            result = report.check_project_overrun(p["record_id"], estimated)
            if result.get("overrun"):
                card = notify.overrun_alert(project_name, result)
                notify.send_card(card)
    except Exception as e:
        log.exception("_job_check_project_overrun failed: %s", e)


def _job_send_daily_report() -> None:
    """每天 18:00 发送当日日报（使用 custom report 取当日 0:00-23:59）。"""
    try:
        today = dt.date.today()
        start_ms = report.date_to_ms(today)
        end_ms = report.date_to_ms(today, end_of_day=True)
        report_data = report.generate_custom_report(start_ms, end_ms)

        user_name = "全体成员"  # MVP: 群推；后续可按用户分别推送
        card = notify.daily_report_card(user_name, report_data)
        notify.send_card(card)
    except Exception as e:
        log.exception("_job_send_daily_report failed: %s", e)


def _job_send_weekly_report() -> None:
    """每周一 09:00 发送周报。"""
    try:
        report_data = report.generate_weekly_report()
        user_name = "全体成员"
        card = notify.weekly_report_card(user_name, report_data)
        notify.send_card(card)
    except Exception as e:
        log.exception("_job_send_weekly_report failed: %s", e)


# ──────────────────────────────────────────────
#  调度器生命周期
# ──────────────────────────────────────────────

def start_scheduler() -> None:
    """启动后台调度器。在 FastAPI lifespan 中调用。"""
    global _scheduler
    if _scheduler is not None:
        return  # 已启动

    _scheduler = BackgroundScheduler(timezone=_TZ)

    # 每小时 :05 检查未停止计时器
    _scheduler.add_job(
        _job_check_running_timers,
        CronTrigger(minute=5, timezone=_TZ),
        id="check_running_timers",
        max_instances=1,
        coalesce=True,
    )

    # 每天 10:00 检测项目工时超额
    _scheduler.add_job(
        _job_check_project_overrun,
        CronTrigger(hour=10, minute=0, timezone=_TZ),
        id="check_project_overrun",
        max_instances=1,
        coalesce=True,
    )

    # 每天 18:00 发送日报
    _scheduler.add_job(
        _job_send_daily_report,
        CronTrigger(hour=18, minute=0, timezone=_TZ),
        id="send_daily_report",
        max_instances=1,
        coalesce=True,
    )

    # 每周一 09:00 发送周报
    _scheduler.add_job(
        _job_send_weekly_report,
        CronTrigger(day_of_week="mon", hour=9, minute=0, timezone=_TZ),
        id="send_weekly_report",
        max_instances=1,
        coalesce=True,
    )

    _scheduler.start()
    log.info("Scheduler started with timezone=%s", _TZ)


def shutdown_scheduler() -> None:
    """关闭调度器。在 FastAPI lifespan shutdown 中调用。"""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        log.info("Scheduler shutdown")


# ──────────────────────────────────────────────
#  内部辅助
# ──────────────────────────────────────────────

def _extract_int(value) -> int:
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


def _extract_float(value) -> float:
    v = _extract_int(value)
    return float(v)


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
