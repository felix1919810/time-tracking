"""时间追踪应用主入口。

启动流程：
1. 加载配置
2. 初始化飞书 SDK 客户端（lark_client）
3. 注册路由（timer / projects / entries / reports / notify）
4. 启动 APScheduler 定时任务（智能提醒）
5. uvicorn 监听
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import get_settings


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # ── 启动 ──
    from .scheduler import start_scheduler
    start_scheduler()
    yield
    # ── 关闭 ──
    from .scheduler import shutdown_scheduler
    shutdown_scheduler()


settings = get_settings()
app = FastAPI(
    title="飞书时间追踪 (Toggl Track 复刻)",
    version="0.1.0",
    debug=settings.debug,
    lifespan=lifespan,
)


# ── 路由注册 ──
from .routers import timer, projects, entries, reports, notify, lark_webhook  # noqa: E402

app.include_router(timer.router, prefix="/api/timer", tags=["计时器"])
app.include_router(projects.router, prefix="/api/projects", tags=["项目"])
app.include_router(entries.router, prefix="/api/entries", tags=["时间条目"])
app.include_router(reports.router, prefix="/api/reports", tags=["报表"])
app.include_router(notify.router, prefix="/api/notify", tags=["提醒"])
app.include_router(lark_webhook.router, prefix="/api/lark", tags=["飞书回调"])


@app.get("/health")
def health():
    return {"status": "ok", "app_id": settings.lark_app_id[:12] + "..."}
