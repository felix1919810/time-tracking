"""计时器核心服务。

对应 Toggl Track 的 time entry 核心 API：
- POST /time_entries/start   开始计时（同一用户只能有一个 running）
- POST /time_entries/stop    停止当前计时，写入 duration
- GET  /time_entries/current 获取当前进行中条目
- GET  /time_entries/running 列出所有正在计时的条目（管理员视角）

数据写入多维表格 `time_entries` 表。
"""
from __future__ import annotations

import time
from typing import Any

from . import bitable_repo as repo
from .constants import (
    TIME_ENTRIES_TABLE_ID,
    Field,
    STATE_RUNNING,
    STATE_STOPPED,
)


# ──────────────────────────────────────────────
#  时间戳辅助
# ──────────────────────────────────────────────

def now_ms() -> int:
    """当前 Unix 毫秒时间戳。多维表格日期字段需毫秒。"""
    return int(time.time() * 1000)


def ms_to_iso(ms: int) -> str:
    """毫秒时间戳 → ISO8601 字符串（调试用）。"""
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M:%S")


# ──────────────────────────────────────────────
#  当前进行中条目
# ──────────────────────────────────────────────

def get_running_entry(user_id: str) -> dict[str, Any] | None:
    """获取指定用户当前正在计时的条目。

    Toggl 规则：同一用户同一时刻最多一个 running 条目。

    注意：人员字段的 filter 飞书 search 接口不认，所以只过滤状态=running，
    拿到所有 running 条目后在 Python 里按 user_id 筛。
    """
    if not TIME_ENTRIES_TABLE_ID:
        raise RuntimeError("TIME_ENTRIES_TABLE_ID 未配置")

    results = repo.search_records(
        TIME_ENTRIES_TABLE_ID,
        filter_={
            "conjunction": "and",
            "conditions": [
                {"field_name": Field.TE_STATE, "operator": "is", "value": [STATE_RUNNING]},
            ],
        },
        page_size=50,
    )
    # 在 Python 里按 user_id 筛
    for entry in results:
        entry_user = _extract_user(entry["fields"].get(Field.TE_USER))
        if entry_user == user_id:
            return entry
    return None


def list_all_running() -> list[dict[str, Any]]:
    """列出全局所有正在计时的条目（用于智能提醒检测未停止计时器）。"""
    if not TIME_ENTRIES_TABLE_ID:
        raise RuntimeError("TIME_ENTRIES_TABLE_ID 未配置")

    return repo.search_records(
        TIME_ENTRIES_TABLE_ID,
        filter_={
            "conjunction": "and",
            "conditions": [
                {"field_name": Field.TE_STATE, "operator": "is", "value": [STATE_RUNNING]},
            ],
        },
        page_size=100,
    )


# ──────────────────────────────────────────────
#  开始 / 停止计时
# ──────────────────────────────────────────────

def start_timer(
    user_id: str,
    description: str,
    project_id: str | None = None,
    tags: list[str] | None = None,
    billable: bool = False,
    start_at_ms: int | None = None,
) -> dict[str, Any]:
    """开始一个新计时条目。

    如果该用户已有 running 条目，先自动停止旧的（Toggl 行为）。
    返回新条目 {record_id, fields}。
    """
    # 1. 若已有 running 条目，先停止
    existing = get_running_entry(user_id)
    if existing:
        stop_timer(existing["record_id"])

    # 2. 创建新 running 条目
    start_ms = start_at_ms if start_at_ms is not None else now_ms()
    fields: dict[str, Any] = {
        Field.TE_DESCRIPTION: description,
        Field.TE_START: start_ms,        # 多维表格日期字段接受毫秒时间戳
        Field.TE_STATE: STATE_RUNNING,
        Field.TE_USER: user_id,
        Field.TE_BILLABLE: billable,
        Field.TE_DURATION: 0,            # running 期间 duration=0，停止时回填
    }
    if project_id:
        # 关联字段需要 record_id 列表
        fields[Field.TE_PROJECT] = [project_id]
    if tags:
        # 多选关联字段
        fields[Field.TE_TAGS] = tags

    record_id = repo.create_record(TIME_ENTRIES_TABLE_ID, fields)
    return {"record_id": record_id, "fields": fields}


def stop_timer(record_id: str, stop_at_ms: int | None = None) -> dict[str, Any]:
    """停止指定条目，计算并写入 duration。

    原子操作：
    1. 读取条目 start_time
    2. 计算 duration = stop - start（秒）
    3. 写入 stop_time + duration + state=stopped
    """
    if not TIME_ENTRIES_TABLE_ID:
        raise RuntimeError("TIME_ENTRIES_TABLE_ID 未配置")

    # 读取当前条目
    entry = repo.get_record(TIME_ENTRIES_TABLE_ID, record_id)
    fields = entry["fields"]

    start_ms = _extract_ms(fields.get(Field.TE_START))
    if start_ms is None:
        raise RuntimeError(f"条目 {record_id} 缺少开始时间")

    stop_ms = stop_at_ms if stop_at_ms is not None else now_ms()
    if stop_ms < start_ms:
        stop_ms = start_ms  # 容错：不允许负时长

    duration_sec = int((stop_ms - start_ms) / 1000)

    # 更新条目
    update_fields = {
        Field.TE_STOP: stop_ms,
        Field.TE_DURATION: duration_sec,
        Field.TE_STATE: STATE_STOPPED,
    }
    repo.update_record(TIME_ENTRIES_TABLE_ID, record_id, update_fields)

    return {
        "record_id": record_id,
        "start_ms": start_ms,
        "stop_ms": stop_ms,
        "duration_sec": duration_sec,
    }


# ──────────────────────────────────────────────
#  编辑条目时间
# ──────────────────────────────────────────────

def edit_entry_time(
    record_id: str,
    start_at_ms: int | None = None,
    stop_at_ms: int | None = None,
) -> int:
    """手动编辑条目的开始/结束时间，重新计算 duration。返回新 duration（秒）。"""
    entry = repo.get_record(TIME_ENTRIES_TABLE_ID, record_id)
    fields = entry["fields"]

    start_ms = start_at_ms if start_at_ms is not None else _extract_ms(fields.get(Field.TE_START))
    stop_ms = stop_at_ms if stop_at_ms is not None else _extract_ms(fields.get(Field.TE_STOP))

    if start_ms is None:
        raise RuntimeError("缺少开始时间")
    if stop_ms is None:
        raise RuntimeError("缺少结束时间")

    duration_sec = max(0, int((stop_ms - start_ms) / 1000))

    update_fields = {
        Field.TE_START: start_ms,
        Field.TE_STOP: stop_ms,
        Field.TE_DURATION: duration_sec,
    }
    repo.update_record(TIME_ENTRIES_TABLE_ID, record_id, update_fields)
    return duration_sec


# ──────────────────────────────────────────────
#  内部辅助
# ──────────────────────────────────────────────

def _extract_ms(value: Any) -> int | None:
    """从多维表格字段值中提取毫秒时间戳。

    多维表格日期字段返回值可能是：
    - int (毫秒)
    - float (毫秒)
    - dict {"value": 毫秒, ...}  某些 SDK 版本
    - None
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, dict):
        v = value.get("value") or value.get("timestamp")
        return int(v) if v is not None else None
    # 字符串尝试解析
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _extract_user(value: Any) -> str | None:
    """从多维表格人员字段值中提取用户 ID。

    人员字段返回值格式：
    - [{"id": "ou_xxx", "name": "张三", "en_name": "..."}]
    - [{"open_id": "ou_xxx", ...}]
    - [{"text": "ou_xxx", "type": "text"}]  # 多行文本字段
    - None（字段为空）
    """
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                # 人员字段：id / open_id / user_id
                uid = item.get("id") or item.get("open_id") or item.get("user_id")
                if uid:
                    return uid
                # 多行文本字段：text
                text = item.get("text")
                if text:
                    return text
            elif isinstance(item, str):
                return item
        return None
    if isinstance(value, dict):
        return value.get("id") or value.get("open_id") or value.get("user_id") or value.get("text")
    return None
