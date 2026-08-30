"""报表与分析 REST 路由。

GET  /api/reports/weekly              本周报（可选 ?user_id=）
GET  /api/reports/monthly             本月报（可选 ?user_id=）
GET  /api/reports/custom              自定义时间范围（start_ms/end_ms，可选 user_id）
GET  /api/reports/export              导出 CSV（同 custom 参数）
GET  /api/reports/export-xlsx         导出 Excel (.xlsx)
POST /api/reports/export-feishu       导出到飞书电子表格
POST /api/reports/export-doc          导出周报/月报到飞书云文档
GET  /api/reports/project-overrun     工时超额检测（?project_id=&estimated_hours=）
"""
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel

from .. import report_service as svc

router = APIRouter()


# ──────────────────────────────────────────────
#  周报 / 月报 / 自定义
# ──────────────────────────────────────────────

@router.get("/weekly")
def weekly_report(user_id: str | None = Query(None)):
    try:
        return {"ok": True, "report": svc.generate_weekly_report(user_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/monthly")
def monthly_report(user_id: str | None = Query(None)):
    try:
        return {"ok": True, "report": svc.generate_monthly_report(user_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/custom")
def custom_report(
    start_ms: int = Query(..., description="起始时间戳(毫秒)"),
    end_ms: int = Query(..., description="结束时间戳(毫秒)"),
    user_id: str | None = Query(None),
):
    if end_ms <= start_ms:
        raise HTTPException(status_code=400, detail="end_ms 必须大于 start_ms")
    try:
        return {"ok": True, "report": svc.generate_custom_report(start_ms, end_ms, user_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
#  导出 CSV
# ──────────────────────────────────────────────

@router.get("/export", response_class=PlainTextResponse)
def export_csv(
    start_ms: int = Query(...),
    end_ms: int = Query(...),
    user_id: str | None = Query(None),
):
    try:
        entries = svc.fetch_entries_in_range(start_ms, end_ms, user_id)
        csv_text = svc.export_entries_csv(entries)
        return PlainTextResponse(
            content=csv_text,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=time_entries.csv"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
#  导出 Excel (.xlsx)
# ──────────────────────────────────────────────

@router.get("/export-xlsx")
def export_xlsx(
    start_ms: int = Query(...),
    end_ms: int = Query(...),
    user_id: str | None = Query(None),
):
    try:
        entries = svc.fetch_entries_in_range(start_ms, end_ms, user_id)
        xlsx_bytes = svc.export_entries_xlsx(entries)
        return Response(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=time_entries.xlsx"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
#  导出到飞书电子表格
# ──────────────────────────────────────────────

class ExportFeishuReq(BaseModel):
    start_ms: int
    end_ms: int
    user_id: str | None = None
    title: str = "时间条目导出"


@router.post("/export-feishu")
def export_to_feishu(req: ExportFeishuReq):
    try:
        entries = svc.fetch_entries_in_range(req.start_ms, req.end_ms, req.user_id)
        result = svc.export_to_feishu_sheet(entries, req.title)
        return {"ok": True, "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
#  导出周报/月报到飞书云文档
# ──────────────────────────────────────────────

class ExportDocReq(BaseModel):
    period: str = "weekly"  # weekly / monthly / custom
    start_ms: int | None = None
    end_ms: int | None = None
    user_id: str | None = None
    title: str = "工时报表"


@router.post("/export-doc")
def export_to_doc(req: ExportDocReq):
    try:
        if req.period == "weekly":
            report = svc.generate_weekly_report(req.user_id)
        elif req.period == "monthly":
            report = svc.generate_monthly_report(req.user_id)
        elif req.period == "custom":
            if req.start_ms is None or req.end_ms is None:
                raise HTTPException(status_code=400, detail="custom 模式需要 start_ms 和 end_ms")
            report = svc.generate_custom_report(req.start_ms, req.end_ms, req.user_id)
        else:
            raise HTTPException(status_code=400, detail="period 必须是 weekly/monthly/custom")

        result = svc.export_report_to_feishu_doc(report, req.title)
        return {"ok": True, "result": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────
#  工时超额检测（供智能提醒调用）
# ──────────────────────────────────────────────

@router.get("/project-overrun")
def project_overrun(
    project_id: str = Query(...),
    estimated_hours: float = Query(..., gt=0),
):
    try:
        return {"ok": True, "result": svc.check_project_overrun(project_id, estimated_hours)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
