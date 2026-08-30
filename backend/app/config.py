"""配置加载 —— 从环境变量 / .env 文件读取所有配置。"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # 飞书应用凭证
    lark_app_id: str
    lark_app_secret: str

    # 多维表格
    lark_bitable_app_token: str
    lark_clients_table_id: str = ""
    lark_projects_table_id: str = ""
    lark_tags_table_id: str = ""
    lark_time_entries_table_id: str = ""

    # 服务器
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True

    # 消息机器人推送目标
    lark_notify_chat_id: str = ""

    # 时区
    timezone: str = "Asia/Shanghai"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
