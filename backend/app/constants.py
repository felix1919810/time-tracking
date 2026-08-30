"""多维表格表 ID 常量。

表 ID 从 Settings 读取（.env 配置），启动时加载一次。
"""
from .config import get_settings

_settings = get_settings()

# 多维表格中各数据表的 table_id
CLIENTS_TABLE_ID = _settings.lark_clients_table_id
PROJECTS_TABLE_ID = _settings.lark_projects_table_id
TAGS_TABLE_ID = _settings.lark_tags_table_id
TIME_ENTRIES_TABLE_ID = _settings.lark_time_entries_table_id

# 字段名常量（与数据模型设计一致，避免散落字符串）
class Field:
    # 通用
    NAME = "名称"
    STATUS = "状态"
    CREATED_TIME = "创建时间"

    # clients
    CLIENT_NAME = "客户名称"
    CLIENT_CONTACT = "联系人"
    CLIENT_EMAIL = "邮箱"

    # projects
    PROJECT_NAME = "项目名称"
    PROJECT_CLIENT = "客户"
    PROJECT_COLOR = "颜色"
    PROJECT_BILLABLE = "是否计费"
    PROJECT_ESTIMATED_HOURS = "预估工时"

    # tags
    TAG_NAME = "标签名称"

    # time_entries
    TE_DESCRIPTION = "描述"
    TE_PROJECT = "项目"
    TE_TAGS = "标签"
    TE_START = "开始时间"
    TE_STOP = "结束时间"
    TE_DURATION = "时长(秒)"
    TE_USER = "用户"
    TE_BILLABLE = "是否计费"
    TE_STATE = "状态"  # running / stopped

# 状态值
STATUS_ACTIVE = "active"
STATUS_ARCHIVED = "archived"
STATE_RUNNING = "running"
STATE_STOPPED = "stopped"
