"""报表与分析模块。

对应 Toggl Track 的 Reports API：
- 按项目/标签/日期维度聚合工时
- 生成周报/月报
- 导出 CSV
- 工时超额检测（用于智能提醒）

聚合逻辑在后端完成（Python），不依赖多维表格仪表盘，便于后续扩展和导出。
"""
from __future__ import annotations

import csv
import datetime as dt
import io
from collections import defaultdict
from typing import Any

from . import bitable_repo as repo
from .constants import TIME_ENTRIES_TABLE_ID, Field


# ──────────────────────────────────────────────
#  时间范围辅助
# ──────────────────────────────────────────────

def week_range(today: dt.date | None = None) -> tuple[dt.date, dt.date]:
    """返回本周一到周日。Toggl 默认周一起算。"""
    today = today or dt.date.today()
    monday = today - dt.timedelta(days=today.weekday())
    sunday = monday + dt.timedelta(days=6)
    return monday, sunday


def month_range(today: dt.date | None = None) -> tuple[dt.date, dt.date]:
    """返回本月第一天到最后一天。"""
    today = today or dt.date.today()
    first = today.replace(day=1)
    # 下月第一天减一天 = 本月最后一天
    if today.month == 12:
        last = today.replace(day=31)
    else:
        next_month_first = today.replace(month=today.month + 1, day=1)
        last = next_month_first - dt.timedelta(days=1)
    return first, last


def date_to_ms(d: dt.date, end_of_day: bool = False) -> int:
    """日期 → 毫秒时间戳。end_of_day=True 时取当天 23:59:59。"""
    if end_of_day:
        t = dt.datetime.combine(d, dt.time(23, 59, 59))
    else:
        t = dt.datetime.combine(d, dt.time(0, 0, 0))
    return int(t.timestamp() * 1000)


# ──────────────────────────────────────────────
#  拉取条目
# ──────────────────────────────────────────────

def fetch_entries_in_range(
    start_ms: int,
    end_ms: int,
    user_id: str | None = None,
) -> list[dict[str, Any]]:
    """拉取指定时间范围内的已完成时间条目。

    过滤条件：
    - start_time >= start_ms
    - start_time <= end_ms
    - 可选 user_id

    注意：飞书多维表格日期字段筛选，value 必须是
    ["ExactDate", "毫秒时间戳字符串"] 这种格式（官方文档要求）。
    """
    conditions = [
        {
            "field_name": Field.TE_START,
            "operator": "isGreater",
            "value": ["ExactDate", str(start_ms)],
        },
    ]
    if user_id:
        conditions.append(
            {"field_name": Field.TE_USER, "operator": "is", "value": [user_id]}
        )

    filter_ = {"conjunction": "and", "conditions": conditions}
    raw = repo.search_records(TIME_ENTRIES_TABLE_ID, filter_=filter_, page_size=500)

    # isGreater 只筛下限，end_ms 上限在代码里精确过滤
    result = []
    for e in raw:
        start_val = e["fields"].get(Field.TE_START)
        if start_val is None:
            continue
        # 日期字段值可能是毫秒数或 {"value": ms}
        s_ms = int(start_val) if isinstance(start_val, (int, float)) else int(start_val.get("value", 0))
        if s_ms <= end_ms:
            result.append(e)
    return result


# ──────────────────────────────────────────────
#  聚合
# ──────────────────────────────────────────────

def aggregate_by_project(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按项目聚合：返回 [{project_id, project_name, total_sec, count}] 降序。"""
    agg: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"total_sec": 0, "count": 0, "name": ""}
    )
    for e in entries:
        f = e["fields"]
        project_ids = _extract_list(f.get(Field.TE_PROJECT))
        project_name = _extract_text(f.get(Field.TE_PROJECT)) or "(无项目)"
        duration = _extract_int(f.get(Field.TE_DURATION))
        key = project_ids[0] if project_ids else project_name
        agg[key]["total_sec"] += duration
        agg[key]["count"] += 1
        agg[key]["name"] = project_name
    out = [
        {
            "project_id": k if isinstance(k, str) and k.startswith("rec") else None,
            "project_name": v["name"],
            "total_sec": v["total_sec"],
            "count": v["count"],
        }
        for k, v in agg.items()
    ]
    return sorted(out, key=lambda x: x["total_sec"], reverse=True)


def aggregate_by_tag(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按标签聚合：返回 [{tag_name, total_sec, count}] 降序。"""
    agg: dict[str, dict[str, Any]] = defaultdict(lambda: {"total_sec": 0, "count": 0})
    for e in entries:
        f = e["fields"]
        tags = _extract_list(f.get(Field.TE_TAGS))
        duration = _extract_int(f.get(Field.TE_DURATION))
        if not tags:
            key = "(无标签)"
            agg[key]["total_sec"] += duration
            agg[key]["count"] += 1
        else:
            for tag in tags:
                key = tag if isinstance(tag, str) else str(tag)
                agg[key]["total_sec"] += duration
                agg[key]["count"] += 1
    out = [
        {"tag_name": k, "total_sec": v["total_sec"], "count": v["count"]}
        for k, v in agg.items()
    ]
    return sorted(out, key=lambda x: x["total_sec"], reverse=True)


def aggregate_by_date(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按日期聚合：返回 [{date: 'YYYY-MM-DD', total_sec, count}] 升序。"""
    agg: dict[str, dict[str, Any]] = defaultdict(lambda: {"total_sec": 0, "count": 0})
    for e in entries:
        f = e["fields"]
        start_ms = _extract_int(f.get(Field.TE_START))
        if not start_ms:
            continue
        date_str = dt.datetime.fromtimestamp(start_ms / 1000).strftime("%Y-%m-%d")
        duration = _extract_int(f.get(Field.TE_DURATION))
        agg[date_str]["total_sec"] += duration
        agg[date_str]["count"] += 1
    out = [
        {"date": k, "total_sec": v["total_sec"], "count": v["count"]}
        for k, v in sorted(agg.items())
    ]
    return out


def total_duration(entries: list[dict[str, Any]]) -> int:
    """计算总时长（秒）。"""
    return sum(_extract_int(e["fields"].get(Field.TE_DURATION)) for e in entries)


# ──────────────────────────────────────────────
#  报表生成
# ──────────────────────────────────────────────

def generate_weekly_report(user_id: str | None = None, today: dt.date | None = None) -> dict[str, Any]:
    """生成周报：本周一到周日的工时汇总。"""
    monday, sunday = week_range(today)
    start_ms = date_to_ms(monday)
    end_ms = date_to_ms(sunday, end_of_day=True)

    entries = fetch_entries_in_range(start_ms, end_ms, user_id)
    return {
        "period": "week",
        "start_date": monday.isoformat(),
        "end_date": sunday.isoformat(),
        "total_sec": total_duration(entries),
        "entry_count": len(entries),
        "by_project": aggregate_by_project(entries),
        "by_tag": aggregate_by_tag(entries),
        "by_date": aggregate_by_date(entries),
    }


def generate_monthly_report(user_id: str | None = None, today: dt.date | None = None) -> dict[str, Any]:
    """生成月报：本月第一到最后一天的工时汇总。"""
    first, last = month_range(today)
    start_ms = date_to_ms(first)
    end_ms = date_to_ms(last, end_of_day=True)

    entries = fetch_entries_in_range(start_ms, end_ms, user_id)
    return {
        "period": "month",
        "start_date": first.isoformat(),
        "end_date": last.isoformat(),
        "total_sec": total_duration(entries),
        "entry_count": len(entries),
        "by_project": aggregate_by_project(entries),
        "by_tag": aggregate_by_tag(entries),
        "by_date": aggregate_by_date(entries),
    }


def generate_custom_report(
    start_ms: int,
    end_ms: int,
    user_id: str | None = None,
) -> dict[str, Any]:
    """生成自定义时间范围的报表。"""
    entries = fetch_entries_in_range(start_ms, end_ms, user_id)
    return {
        "period": "custom",
        "start_ms": start_ms,
        "end_ms": end_ms,
        "total_sec": total_duration(entries),
        "entry_count": len(entries),
        "by_project": aggregate_by_project(entries),
        "by_tag": aggregate_by_tag(entries),
        "by_date": aggregate_by_date(entries),
    }


# ──────────────────────────────────────────────
#  导出 CSV
# ──────────────────────────────────────────────

def export_entries_csv(entries: list[dict[str, Any]]) -> str:
    """将时间条目导出为 CSV 字符串。

    列：日期, 描述, 项目, 标签, 开始时间, 结束时间, 时长(秒), 是否计费, 用户
    """
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "日期", "描述", "项目", "标签", "开始时间", "结束时间",
        "时长(秒)", "是否计费", "用户",
    ])

    for e in entries:
        f = e["fields"]
        start_ms = _extract_int(f.get(Field.TE_START))
        stop_ms = _extract_int(f.get(Field.TE_STOP))
        start_dt = dt.datetime.fromtimestamp(start_ms / 1000) if start_ms else ""
        stop_dt = dt.datetime.fromtimestamp(stop_ms / 1000) if stop_ms else ""
        writer.writerow([
            start_dt.strftime("%Y-%m-%d") if start_dt else "",
            _extract_text(f.get(Field.TE_DESCRIPTION)),
            _extract_text(f.get(Field.TE_PROJECT)),
            ", ".join(_extract_list(f.get(Field.TE_TAGS))),
            start_dt.strftime("%Y-%m-%d %H:%M:%S") if start_dt else "",
            stop_dt.strftime("%Y-%m-%d %H:%M:%S") if stop_dt else "",
            _extract_int(f.get(Field.TE_DURATION)),
            f.get(Field.TE_BILLABLE, False),
            f.get(Field.TE_USER, ""),
        ])

    return output.getvalue()


# ──────────────────────────────────────────────
#  导出 Excel (.xlsx)
# ──────────────────────────────────────────────

def export_entries_xlsx(entries: list[dict[str, Any]]) -> bytes:
    """将时间条目导出为 Excel 文件（bytes）。

    列与 CSV 一致：日期, 描述, 项目, 标签, 开始时间, 结束时间, 时长(秒), 是否计费, 用户
    """
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "时间条目"
    ws.append([
        "日期", "描述", "项目", "标签", "开始时间", "结束时间",
        "时长(秒)", "是否计费", "用户",
    ])

    for e in entries:
        f = e["fields"]
        start_ms = _extract_int(f.get(Field.TE_START))
        stop_ms = _extract_int(f.get(Field.TE_STOP))
        start_dt = dt.datetime.fromtimestamp(start_ms / 1000) if start_ms else ""
        stop_dt = dt.datetime.fromtimestamp(stop_ms / 1000) if stop_ms else ""
        ws.append([
            start_dt.strftime("%Y-%m-%d") if start_dt else "",
            _extract_text(f.get(Field.TE_DESCRIPTION)),
            _extract_text(f.get(Field.TE_PROJECT)),
            ", ".join(_extract_list(f.get(Field.TE_TAGS))),
            start_dt.strftime("%Y-%m-%d %H:%M:%S") if start_dt else "",
            stop_dt.strftime("%Y-%m-%d %H:%M:%S") if stop_dt else "",
            _extract_int(f.get(Field.TE_DURATION)),
            bool(f.get(Field.TE_BILLABLE, False)),
            f.get(Field.TE_USER, ""),
        ])

    # 简单列宽自适应
    for col in ws.columns:
        max_len = max(len(str(c.value or "")) for c in col)
        ws.column_dimensions[col[0].column_letter].width = min(max_len + 2, 40)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ──────────────────────────────────────────────
#  导出到飞书电子表格
# ──────────────────────────────────────────────

def export_to_feishu_sheet(entries: list[dict[str, Any]], title: str = "时间条目导出") -> dict[str, Any]:
    """将时间条目导出到飞书电子表格。

    流程：
    1. 调 sheets.v3.spreadsheet.create 创建电子表格
    2. 调 sheets.v2.data.update 写入数据
    3. 返回电子表格 url

    需要权限：sheets:spreadsheet, drive:drive
    """
    import requests as _req

    from .config import get_settings
    _s = get_settings()

    # 拿 token
    tr = _req.post(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": _s.lark_app_id, "app_secret": _s.lark_app_secret},
        timeout=15,
    )
    token = tr.json()["tenant_access_token"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # 1. 创建电子表格
    create_url = "https://open.feishu.cn/open-apis/sheets/v3/spreadsheets"
    create_body = {"title": title, "folder_token": ""}
    cr = _req.post(create_url, headers=headers, json=create_body, timeout=30)
    cj = cr.json()
    if cj.get("code") != 0:
        raise RuntimeError(f"创建电子表格失败: {cj}")
    spreadsheet_token = cj["data"]["spreadsheet"]["spreadsheet_token"]
    spreadsheet_url = cj["data"]["spreadsheet"]["url"]

    # 2. 获取默认 sheet_id
    sheets_url = f"https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/{spreadsheet_token}/sheets/query"
    sr = _req.get(sheets_url, headers=headers, timeout=15)
    sj = sr.json()
    if sj.get("code") != 0 or not sj["data"].get("sheets"):
        raise RuntimeError(f"获取 sheet 失败: {sj}")
    sheet_id = sj["data"]["sheets"][0]["sheet_id"]

    # 3. 写入数据（用 sheets.v2.data 接口）
    # 先写表头
    header_range = f"{sheet_id}!A1:I1"
    header_values = [[
        "日期", "描述", "项目", "标签", "开始时间", "结束时间",
        "时长(秒)", "是否计费", "用户",
    ]]
    update_url = f"https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/{spreadsheet_token}/values_prepend"
    update_body = {
        "valueRange": {
            "range": header_range,
            "values": header_values,
        }
    }
    ur = _req.post(update_url, headers=headers, json=update_body, timeout=30)
    if ur.json().get("code") != 0:
        raise RuntimeError(f"写表头失败: {ur.json()}")

    # 写数据行
    data_rows = []
    for e in entries:
        f = e["fields"]
        start_ms = _extract_int(f.get(Field.TE_START))
        stop_ms = _extract_int(f.get(Field.TE_STOP))
        start_dt = dt.datetime.fromtimestamp(start_ms / 1000) if start_ms else None
        stop_dt = dt.datetime.fromtimestamp(stop_ms / 1000) if stop_ms else None
        row = [
            start_dt.strftime("%Y-%m-%d") if start_dt else "",
            _extract_text(f.get(Field.TE_DESCRIPTION)),
            _extract_text(f.get(Field.TE_PROJECT)),
            ", ".join(_extract_list(f.get(Field.TE_TAGS))),
            start_dt.strftime("%Y-%m-%d %H:%M:%S") if start_dt else "",
            stop_dt.strftime("%Y-%m-%d %H:%M:%S") if stop_dt else "",
            _extract_int(f.get(Field.TE_DURATION)),
            bool(f.get(Field.TE_BILLABLE, False)),
            f.get(Field.TE_USER, ""),
        ]
        data_rows.append(row)

    if data_rows:
        data_range = f"{sheet_id}!A2:I{1 + len(data_rows)}"
        data_body = {
            "valueRange": {
                "range": data_range,
                "values": data_rows,
            }
        }
        dr = _req.post(update_url, headers=headers, json=data_body, timeout=60)
        if dr.json().get("code") != 0:
            raise RuntimeError(f"写数据失败: {dr.json()}")

    return {
        "spreadsheet_token": spreadsheet_token,
        "url": spreadsheet_url,
        "rows_written": len(data_rows),
    }


# ──────────────────────────────────────────────
#  导出周报/月报到飞书云文档
# ──────────────────────────────────────────────

def export_report_to_feishu_doc(report: dict[str, Any], title: str = "工时报表") -> dict[str, Any]:
    """将报表导出到飞书云文档。

    流程：
    1. 调 docx.v1.documents.create 创建云文档
    2. 调 docx.v1.documents.blocks.children.add 添加内容块
    3. 返回文档 url

    需要权限：docx:document, drive:drive
    """
    import requests as _req

    from .config import get_settings
    _s = get_settings()

    # 拿 token
    tr = _req.post(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": _s.lark_app_id, "app_secret": _s.lark_app_secret},
        timeout=15,
    )
    token = tr.json()["tenant_access_token"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # 1. 创建云文档
    create_url = "https://open.feishu.cn/open-apis/docx/v1/documents"
    create_body = {"folder_token": ""}
    cr = _req.post(create_url, headers=headers, json=create_body, timeout=30)
    cj = cr.json()
    if cj.get("code") != 0:
        raise RuntimeError(f"创建云文档失败: {cj}")
    document_id = cj["data"]["document"]["document_id"]

    # 2. 添加标题块
    blocks_url = f"https://open.feishu.cn/open-apis/docx/v1/documents/{document_id}/blocks/{document_id}/children"
    blocks = [
        # 标题
        {
            "block_type": 2,  # heading1
            "heading1": {
                "elements": [{"text_run": {"content": title, "text_element_style": {}}}]
            }
        },
        # 概览
        {
            "block_type": 2,
            "heading2": {
                "elements": [{"text_run": {"content": "概览", "text_element_style": {}}}]
            }
        },
        {
            "block_type": 2,
            "heading3": {
                "elements": [{"text_run": {"content": f"总工时: {report.get('total_sec', 0)} 秒", "text_element_style": {}}}]
            }
        },
        {
            "block_type": 2,
            "heading3": {
                "elements": [{"text_run": {"content": f"条目数: {report.get('entry_count', 0)}", "text_element_style": {}}}]
            }
        },
    ]

    bb = {"children": blocks, "index": -1}
    br = _req.post(blocks_url, headers=headers, json=bb, timeout=30)
    if br.json().get("code") != 0:
        raise RuntimeError(f"添加标题块失败: {br.json()}")

    # 3. 添加项目明细
    by_project = report.get("by_project", [])
    if by_project:
        detail_blocks = [
            {
                "block_type": 2,
                "heading2": {
                    "elements": [{"text_run": {"content": "项目明细", "text_element_style": {}}}]
                }
            }
        ]
        for p in by_project[:10]:  # 最多展示 10 个项目
            name = p.get("project_name", "(无项目)")
            sec = p.get("total_sec", 0)
            count = p.get("count", 0)
            hours = sec / 3600
            detail_blocks.append({
                "block_type": 2,
                "heading3": {
                    "elements": [{"text_run": {
                        "content": f"• {name}: {hours:.2f}h ({count} 条)",
                        "text_element_style": {}
                    }}]
                }
            })
        db = {"children": detail_blocks, "index": -1}
        _req.post(blocks_url, headers=headers, json=db, timeout=30)

    # 4. 返回文档链接
    doc_url = f"https://feishu.cn/docx/{document_id}"
    return {
        "document_id": document_id,
        "url": doc_url,
    }


# ──────────────────────────────────────────────
#  工时超额检测
# ──────────────────────────────────────────────

def check_project_overrun(project_id: str, estimated_hours: float) -> dict[str, Any]:
    """检测项目工时是否超过预估。

    返回：
    {
        "project_id": str,
        "estimated_hours": float,
        "actual_sec": int,
        "actual_hours": float,
        "overrun": bool,
        "overrun_sec": int,  # 正值表示超额，负值表示未达
    }
    """
    # 拉取该项目所有时间条目
    filter_ = {
        "conjunction": "and",
        "conditions": [
            {"field_name": Field.TE_PROJECT, "operator": "is", "value": [project_id]}
        ],
    }
    entries = repo.search_records(TIME_ENTRIES_TABLE_ID, filter_=filter_, page_size=500)

    actual_sec = sum(_extract_int(e["fields"].get(Field.TE_DURATION)) for e in entries)
    actual_hours = actual_sec / 3600
    estimated_sec = estimated_hours * 3600
    overrun_sec = actual_sec - estimated_sec

    return {
        "project_id": project_id,
        "estimated_hours": estimated_hours,
        "actual_sec": actual_sec,
        "actual_hours": round(actual_hours, 2),
        "overrun": actual_sec > estimated_sec,
        "overrun_sec": int(overrun_sec),
        "entry_count": len(entries),
    }


# ──────────────────────────────────────────────
#  字段值提取辅助
# ──────────────────────────────────────────────

def _extract_int(value: Any) -> int:
    """从多维表格字段值中提取整数（duration/start/stop）。"""
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, dict):
        v = value.get("value") or value.get("text") or value.get("name")
        if v is None:
            return 0
        try:
            return int(v)
        except (ValueError, TypeError):
            return 0
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return 0
    return 0


def _extract_text(value: Any) -> str:
    """从多维表格字段值中提取文本。多维表格文本字段返回 [{'text': 'xxx', 'type': 'text'}]。"""
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


def _extract_list(value: Any) -> list[Any]:
    """从多维表格字段值中提取列表（多选/关联字段）。"""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]
