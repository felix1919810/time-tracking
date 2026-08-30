"""多维表格数据访问层。

所有对飞书多维表格的读写都经过这里，统一处理：
- record_id 的获取与缓存
- 字段名 → API 字段名的映射
- 分页与错误处理

使用 lark-oapi 真实 SDK API：
- CreateAppTableRecordRequest + AppTableRecord 作为 request_body
- SearchAppTableRecordRequest + SearchAppTableRecordRequestBody
- ListAppTableRecordRequest 用于列出/单条查询
- DeleteAppTableRecordRequest
- UpdateAppTableRecordRequest + AppTableRecord 作为 request_body
"""
from __future__ import annotations

from typing import Any

import lark_oapi as lark
from lark_oapi.api.bitable.v1 import (
    AppTableRecord,
    CreateAppTableRecordRequest,
    DeleteAppTableRecordRequest,
    ListAppTableRecordRequest,
    SearchAppTableRecordRequest,
    SearchAppTableRecordRequestBody,
    UpdateAppTableRecordRequest,
)

from .lark_client import APP_TOKEN, lark_client


# ──────────────────────────────────────────────
#  时间戳辅助
# ──────────────────────────────────────────────

def now_ms() -> int:
    """当前 Unix 毫秒时间戳，多维表格日期字段需要毫秒。"""
    import time
    return int(time.time() * 1000)


# ──────────────────────────────────────────────
#  单条记录 CRUD
# ──────────────────────────────────────────────

def create_record(table_id: str, fields: dict[str, Any]) -> str:
    """新建一条记录，返回 record_id。"""
    record_body = AppTableRecord.builder().fields(fields).build()
    req = (
        CreateAppTableRecordRequest.builder()
        .app_token(APP_TOKEN)
        .table_id(table_id)
        .request_body(record_body)
        .build()
    )
    resp = lark_client.bitable.v1.app_table_record.create(req)
    if not resp.success():
        raise RuntimeError(
            f"create_record failed: {resp.code} {resp.msg} log_id={resp.get_log_id()}"
        )
    return resp.data.record.record_id


def update_record(table_id: str, record_id: str, fields: dict[str, Any]) -> None:
    """更新一条记录的指定字段。"""
    record_body = AppTableRecord.builder().fields(fields).build()
    req = (
        UpdateAppTableRecordRequest.builder()
        .app_token(APP_TOKEN)
        .table_id(table_id)
        .record_id(record_id)
        .request_body(record_body)
        .build()
    )
    resp = lark_client.bitable.v1.app_table_record.update(req)
    if not resp.success():
        raise RuntimeError(
            f"update_record failed: {resp.code} {resp.msg} log_id={resp.get_log_id()}"
        )


def delete_record(table_id: str, record_id: str) -> None:
    req = (
        DeleteAppTableRecordRequest.builder()
        .app_token(APP_TOKEN)
        .table_id(table_id)
        .record_id(record_id)
        .build()
    )
    resp = lark_client.bitable.v1.app_table_record.delete(req)
    if not resp.success():
        raise RuntimeError(
            f"delete_record failed: {resp.code} {resp.msg} log_id={resp.get_log_id()}"
        )


# ──────────────────────────────────────────────
#  查询
# ──────────────────────────────────────────────

def search_records(
    table_id: str,
    filter_: Any | None = None,
    page_size: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """按条件搜索记录，返回 [{record_id, fields}] 列表。

    直接用 REST API（POST /records/search），绕过 SDK 的 FilterInfo 类型限制。
    filter_ 是飞书 Bitable 的 Conjunction 结构，例如：
        {
            "conjunction": "and",
            "conditions": [
                {"field_name": "状态", "operator": "is", "value": ["running"]}
            ]
        }
    """
    import requests

    from .config import get_settings
    _s = get_settings()
    token_resp = requests.post(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": _s.lark_app_id, "app_secret": _s.lark_app_secret},
        timeout=15,
    )
    token = token_resp.json()["tenant_access_token"]

    url = (
        f"https://open.feishu.cn/open-apis/bitable/v1/apps/{APP_TOKEN}"
        f"/tables/{table_id}/records/search?page_size={page_size}"
    )
    body: dict[str, Any] = {}
    if filter_ is not None:
        body["filter"] = filter_

    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=body,
        timeout=30,
    )
    j = r.json()
    if j.get("code") != 0:
        raise RuntimeError(f"search_records failed: {j.get('code')} {j.get('msg')}")

    out = []
    for item in j["data"].get("items", []) or []:
        out.append({"record_id": item["record_id"], "fields": _flatten_fields(item.get("fields", {}))})
    return out


def _flatten_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """把飞书多维表格的复杂字段值扁平化成简单类型，方便前端直接渲染。

    - 文本字段 [{"text":"xxx","type":"text"}] → "xxx"
    - 日期字段 {"value": 1786896000000} → 1786896000000
    - 关联字段 [{"record_ids":["recXXX"]}] → ["recXXX"]
    - 单选字段 {"text":"工签","type":"text"} → "工签"
    - 多选字段 [{"text":"标签1","type":"text"}] → ["标签1"]
    """
    result = {}
    for key, val in fields.items():
        result[key] = _flatten_value(val)
    return result


def _flatten_value(val: Any) -> Any:
    """递归扁平化单个字段值。"""
    if val is None:
        return None
    # 列表类型：文本数组、多选数组、关联数组等
    if isinstance(val, list):
        if not val:
            return []
        # 纯文本数组 [{"text":"xxx","type":"text"}] → "xxx"（单元素）或 ["xxx", ...]（多元素）
        if all(isinstance(item, dict) and "text" in item for item in val):
            texts = [item["text"] for item in val]
            return texts[0] if len(texts) == 1 else texts
        # 关联字段 [{"record_ids":["recXXX"],"table_id":"..."}] → ["recXXX"]
        if all(isinstance(item, dict) and "record_ids" in item for item in val):
            return [rid for item in val for rid in item.get("record_ids", [])]
        # 普通列表，递归处理每个元素
        return [_flatten_value(item) for item in val]
    # 字典类型：日期 {"value": ms} / 单选 {"text":"xxx"} / 人员 {"name":"张三"} 等
    if isinstance(val, dict):
        # 日期字段：{"value": 1786896000000}
        if "value" in val and isinstance(val["value"], (int, float)):
            return val["value"]
        # 单选/文本：{"text":"xxx"} 或 {"name":"xxx"}
        for k in ("text", "name"):
            if k in val and isinstance(val[k], str):
                return val[k]
        # 其他字典，递归处理 value
        return _flatten_value(val.get("value", val))
    # 简单类型直接返回
    return val


def get_record(table_id: str, record_id: str) -> dict[str, Any]:
    """读取单条记录。"""
    from lark_oapi.api.bitable.v1 import GetAppTableRecordRequest

    req = (
        GetAppTableRecordRequest.builder()
        .app_token(APP_TOKEN)
        .table_id(table_id)
        .record_id(record_id)
        .build()
    )
    resp = lark_client.bitable.v1.app_table_record.get(req)
    if not resp.success() or not resp.data or not resp.data.record:
        raise RuntimeError(f"get_record {record_id} not found: {resp.code} {resp.msg}")
    record = resp.data.record
    return {"record_id": record.record_id, "fields": record.fields}
