"""计时器 REST 路由。

POST /api/timer/start   开始计时
POST /api/timer/stop    停止计时
GET  /api/timer/current 获取当前进行中条目
GET  /api/timer/running 列出所有正在计时的条目（管理员视角）
POST /api/timer/edit    手动编辑条目时间
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import timer_service

router = APIRouter()


# ──────────────────────────────────────────────
#  请求 / 响应模型
# ──────────────────────────────────────────────

class StartReq(BaseModel):
    user_id: str
    description: str = ""
    project_id: str | None = None
    tags: list[str] | None = None
    billable: bool = False
    start_at_ms: int | None = Field(None, description="可选：自定义开始时间戳(毫秒)")


class StopReq(BaseModel):
    record_id: str
    stop_at_ms: int | None = None


class EditReq(BaseModel):
    record_id: str
    start_at_ms: int | None = None
    stop_at_ms: int | None = None


class CurrentReq(BaseModel):
    user_id: str


# ──────────────────────────────────────────────
#  路由
# ──────────────────────────────────────────────

@router.post("/start")
def start_timer(req: StartReq):
    """开始计时。如果该用户已有 running 条目，先自动停止旧的。"""
    try:
        result = timer_service.start_timer(
            user_id=req.user_id,
            description=req.description,
            project_id=req.project_id,
            tags=req.tags,
            billable=req.billable,
            start_at_ms=req.start_at_ms,
        )
        return {"ok": True, "entry": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop")
def stop_timer(req: StopReq):
    """停止指定条目，计算并写入 duration。"""
    try:
        result = timer_service.stop_timer(req.record_id, stop_at_ms=req.stop_at_ms)
        return {"ok": True, "entry": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/current")
def get_current(user_id: str):
    """获取指定用户当前正在计时的条目。"""
    entry = timer_service.get_running_entry(user_id)
    return {"ok": True, "entry": entry}


@router.get("/running")
def list_running():
    """列出全局所有正在计时的条目。"""
    entries = timer_service.list_all_running()
    return {"ok": True, "entries": entries, "count": len(entries)}


@router.post("/edit")
def edit_time(req: EditReq):
    """手动编辑条目的开始/结束时间，重新计算 duration。"""
    try:
        duration = timer_service.edit_entry_time(
            req.record_id,
            start_at_ms=req.start_at_ms,
            stop_at_ms=req.stop_at_ms,
        )
        return {"ok": True, "duration_sec": duration}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
