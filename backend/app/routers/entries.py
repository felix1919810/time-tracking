"""时间条目 CRUD 路由。

对应 Toggl 的 time entries API：

  POST   /api/entries                 手动创建已完成的工时条目
  GET    /api/entries                 列出条目（支持 user_id / project_id / start/end 过滤）
  GET    /api/entries/{record_id}     获取单条
  PATCH  /api/entries/{record_id}     更新条目（描述/项目/标签/计费/时间）
  DELETE /api/entries/{record_id}     删除条目
"""
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .. import bitable_repo as repo
from ..constants import (
    TIME_ENTRIES_TABLE_ID,
    Field,
    STATE_STOPPED,
)

router = APIRouter()


# ──────────────────────────────────────────────
#  请求模型
# ──────────────────────────────────────────────

class EntryCreate(BaseModel):
    """手动添加工时条目（已完成状态）。"""
    user_id: str
    description: str = ""
    project_id: str | None = None
    tags: list[str] | None = None
    billable: bool = False
    start_at_ms: int
    stop_at_ms: int


class EntryUpdate(BaseModel):
    description: str | None = None
    project_id: str | None = None
    tags: list[str] | None = None
    billable: bool | None = None
    start_at_ms: int | None = None
    stop_at_ms: int | None = None


# ──────────────────────────────────────────────
#  路由
# ──────────────────────────────────────────────

@router.post("")
def create_entry(req: EntryCreate):
    """手动添加工时条目（不经过计时器，直接写入已完成条目）。"""
    if req.stop_at_ms <= req.start_at_ms:
        raise HTTPException(status_code=400, detail="结束时间必须晚于开始时间")

    duration_sec = int((req.stop_at_ms - req.start_at_ms) / 1000)
    fields: dict[str, Any] = {
        Field.TE_DESCRIPTION: req.description,
        Field.TE_START: req.start_at_ms,
        Field.TE_STOP: req.stop_at_ms,
        Field.TE_DURATION: duration_sec,
        Field.TE_STATE: STATE_STOPPED,
        Field.TE_USER: req.user_id,
        Field.TE_BILLABLE: req.billable,
    }
    if req.project_id:
        fields[Field.TE_PROJECT] = [req.project_id]
    if req.tags:
        fields[Field.TE_TAGS] = req.tags

    try:
        record_id = repo.create_record(TIME_ENTRIES_TABLE_ID, fields)
        return {"ok": True, "record_id": record_id, "duration_sec": duration_sec}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
def list_entries(
    user_id: str | None = Query(None),
    project_id: str | None = Query(None),
    start_ms: int | None = Query(None, description="筛选开始时间下限(毫秒)"),
    end_ms: int | None = Query(None, description="筛选结束时间上限(毫秒)"),
    limit: int = Query(100, ge=1, le=500),
):
    """列出时间条目，支持多维过滤。"""
    conditions = []
    if user_id:
        conditions.append(
            {"field_name": Field.TE_USER, "operator": "is", "value": [user_id]}
        )
    if project_id:
        # 关联字段过滤需用 record_id
        conditions.append(
            {"field_name": Field.TE_PROJECT, "operator": "is", "value": [project_id]}
        )
    if start_ms is not None:
        conditions.append(
            {"field_name": Field.TE_START, "operator": "isGreater", "value": [start_ms]}
        )
    if end_ms is not None:
        conditions.append(
            {"field_name": Field.TE_STOP, "operator": "isLess", "value": [end_ms]}
        )

    filter_ = {"conjunction": "and", "conditions": conditions} if conditions else None

    try:
        results = repo.search_records(
            TIME_ENTRIES_TABLE_ID, filter_=filter_, page_size=limit
        )
        return {"ok": True, "entries": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{record_id}")
def get_entry(record_id: str):
    try:
        entry = repo.get_record(TIME_ENTRIES_TABLE_ID, record_id)
        return {"ok": True, "entry": entry}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch("/{record_id}")
def update_entry(record_id: str, req: EntryUpdate):
    fields: dict[str, Any] = {}

    if req.description is not None:
        fields[Field.TE_DESCRIPTION] = req.description
    if req.project_id is not None:
        fields[Field.TE_PROJECT] = [req.project_id] if req.project_id else []
    if req.tags is not None:
        fields[Field.TE_TAGS] = req.tags
    if req.billable is not None:
        fields[Field.TE_BILLABLE] = req.billable

    # 时间变更需重新计算 duration
    if req.start_at_ms is not None or req.stop_at_ms is not None:
        existing = repo.get_record(TIME_ENTRIES_TABLE_ID, record_id)
        old_fields = existing["fields"]
        start_ms = req.start_at_ms if req.start_at_ms is not None else _extract_ms(
            old_fields.get(Field.TE_START)
        )
        stop_ms = req.stop_at_ms if req.stop_at_ms is not None else _extract_ms(
            old_fields.get(Field.TE_STOP)
        )
        if start_ms is None or stop_ms is None:
            raise HTTPException(status_code=400, detail="条目缺少开始/结束时间")
        if stop_ms < start_ms:
            raise HTTPException(status_code=400, detail="结束时间必须晚于开始时间")
        duration_sec = int((stop_ms - start_ms) / 1000)
        fields[Field.TE_START] = start_ms
        fields[Field.TE_STOP] = stop_ms
        fields[Field.TE_DURATION] = duration_sec

    if not fields:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")

    try:
        repo.update_record(TIME_ENTRIES_TABLE_ID, record_id, fields)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{record_id}")
def delete_entry(record_id: str):
    try:
        repo.delete_record(TIME_ENTRIES_TABLE_ID, record_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
#  内部辅助
# ──────────────────────────────────────────────

def _extract_ms(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, dict):
        v = value.get("value") or value.get("timestamp")
        return int(v) if v is not None else None
    return None
