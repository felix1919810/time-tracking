"""飞书 SDK 客户端封装。

单例 `lark_client` 在应用启动时初始化，提供：
- `client.bitable`  多维表格读写
- `client.im`       消息机器人推送
"""
import lark_oapi as lark

from .config import get_settings

_settings = get_settings()

# 全局 client —— 通过 lark.Client.builder() 创建，开启 token 自动刷新
lark_client: lark.Client = (
    lark.Client.builder()
    .app_id(_settings.lark_app_id)
    .app_secret(_settings.lark_app_secret)
    .log_level(lark.LogLevel.DEBUG if _settings.debug else lark.LogLevel.INFO)
    .build()
)

APP_TOKEN = _settings.lark_bitable_app_token
