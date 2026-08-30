"""项目 / 客户 / 标签 CRUD 路由。

对应 Toggl 的 workspace → client → project → tag 层级。

项目：
  POST   /api/projects                  创建项目
  GET    /api/projects                  列出项目（支持 ?status=active|archived）
  GET    /api/projects/{record_id}      获取单个项目
  PATCH  /api/projects/{record_id}      更新项目
  POST   /api/projects/{record_id}/archive   归档项目
  POST   /api/projects/{record_id}/unarchive 取消归档
  DELETE /api/projects/{record_id}      删除项目

客户（复用 clients 表）：
  POST   /api/projects/clients
  GET    /api/projects/clients

标签（复用 tags 表）：
  POST   /api/projects/tags
  GET    /api/projects/tags
  DELETE /api/projects/tags/{record_id}
"""
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .. import bitable_repo as repo
from ..constants import (
    CLIENTS_TABLE_ID,
    PROJECTS_TABLE_ID,
    TAGS_TABLE_ID,
    Field,
    STATUS_ACTIVE,
    STATUS_ARCHIVED,
)

router = APIRouter()


# ──────────────────────────────────────────────
#  请求模型
# ──────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    client_id: str | None = None
    color: str = "blue"
    billable: bool = False
    estimated_hours: float | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    client_id: str | None = None
    color: str | None = None
    billable: bool | None = None
    estimated_hours: float | None = None


class ClientCreate(BaseModel):
    name: str
    contact: str | None = None
    email: str | None = None


class TagCreate(BaseModel):
    name: str


# ──────────────────────────────────────────────
#  项目 CRUD
# ──────────────────────────────────────────────

@router.post("")
def create_project(req: ProjectCreate):
    fields: dict[str, Any] = {
        Field.PROJECT_NAME: req.name,
        Field.PROJECT_COLOR: req.color,
        Field.PROJECT_BILLABLE: req.billable,
        Field.STATUS: STATUS_ACTIVE,
    }
    if req.client_id:
        # 关联字段接受 record_id 列表
        fields[Field.PROJECT_CLIENT] = [req.client_id]
    if req.estimated_hours is not None:
        fields[Field.PROJECT_ESTIMATED_HOURS] = req.estimated_hours

    try:
        record_id = repo.create_record(PROJECTS_TABLE_ID, fields)
        return {"ok": True, "record_id": record_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("")
def list_projects(status: str = Query("active", regex="^(active|archived|all)$")):
    filter_ = None
    if status != "all":
        filter_ = {
            "conjunction": "and",
            "conditions": [
                {"field_name": Field.STATUS, "operator": "is", "value": [status]}
            ],
        }
    try:
        results = repo.search_records(PROJECTS_TABLE_ID, filter_=filter_, page_size=200)
        return {"ok": True, "projects": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{record_id}")
def update_project(record_id: str, req: ProjectUpdate):
    fields: dict[str, Any] = {}
    if req.name is not None:
        fields[Field.PROJECT_NAME] = req.name
    if req.client_id is not None:
        fields[Field.PROJECT_CLIENT] = [req.client_id]
    if req.color is not None:
        fields[Field.PROJECT_COLOR] = req.color
    if req.billable is not None:
        fields[Field.PROJECT_BILLABLE] = req.billable
    if req.estimated_hours is not None:
        fields[Field.PROJECT_ESTIMATED_HOURS] = req.estimated_hours

    if not fields:
        raise HTTPException(status_code=400, detail="没有需要更新的字段")

    try:
        repo.update_record(PROJECTS_TABLE_ID, record_id, fields)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{record_id}/archive")
def archive_project(record_id: str):
    try:
        repo.update_record(PROJECTS_TABLE_ID, record_id, {Field.STATUS: STATUS_ARCHIVED})
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{record_id}/unarchive")
def unarchive_project(record_id: str):
    try:
        repo.update_record(PROJECTS_TABLE_ID, record_id, {Field.STATUS: STATUS_ACTIVE})
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{record_id}")
def delete_project(record_id: str):
    try:
        repo.delete_record(PROJECTS_TABLE_ID, record_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
#  客户 CRUD
# ──────────────────────────────────────────────

@router.post("/clients")
def create_client(req: ClientCreate):
    fields: dict[str, Any] = {
        Field.CLIENT_NAME: req.name,
        Field.STATUS: STATUS_ACTIVE,
    }
    if req.contact:
        fields[Field.CLIENT_CONTACT] = req.contact
    if req.email:
        fields[Field.CLIENT_EMAIL] = req.email
    try:
        record_id = repo.create_record(CLIENTS_TABLE_ID, fields)
        return {"ok": True, "record_id": record_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/clients")
def list_clients(status: str = Query("active", regex="^(active|archived|all)$")):
    filter_ = None
    if status != "all":
        filter_ = {
            "conjunction": "and",
            "conditions": [
                {"field_name": Field.STATUS, "operator": "is", "value": [status]}
            ],
        }
    try:
        results = repo.search_records(CLIENTS_TABLE_ID, filter_=filter_, page_size=200)
        return {"ok": True, "clients": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
#  标签 CRUD
# ──────────────────────────────────────────────

@router.post("/tags")
def create_tag(req: TagCreate):
    try:
        record_id = repo.create_record(TAGS_TABLE_ID, {Field.TAG_NAME: req.name})
        return {"ok": True, "record_id": record_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/tags")
def list_tags():
    try:
        results = repo.search_records(TAGS_TABLE_ID, page_size=200)
        return {"ok": True, "tags": results, "count": len(results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/tags/{record_id}")
def delete_tag(record_id: str):
    try:
        repo.delete_record(TAGS_TABLE_ID, record_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
