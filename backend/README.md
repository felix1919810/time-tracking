# 飞书时间追踪 (Toggl Track 复刻 MVP)

在飞书上复现 Toggl Track 的核心能力：计时、数据组织、报表分析、智能提醒、飞书原生集成。

## 架构

```
飞书客户端 (PC/Mobile)
    ├── 网页应用 (H5)  ← 工作台入口，计时器/项目/报表 UI
    ├── 消息机器人     ← 指令交互 + 卡片回调 + 定时推送
    └── 多维表格       ← 数据存储 + 可视化仪表盘
         │
         ▼
后端服务 (FastAPI + Python)
    ├── /api/timer     计时器启停
    ├── /api/projects  项目/客户/标签 CRUD
    ├── /api/entries   时间条目 CRUD
    ├── /api/reports   周月报/聚合/CSV 导出
    ├── /api/notify    消息推送 + 手动触发提醒
    └── /api/lark      飞书事件订阅回调 (webhook)
         │
         ▼
飞书多维表格 (4 张表)
    ├── clients       客户
    ├── projects      项目 (关联客户)
    ├── tags          标签
    └── time_entries  时间条目 (关联项目+标签)
```

## 快速开始

### 1. 创建飞书应用

前往 [飞书开放平台](https://open.feishu.cn/app/) 创建企业自建应用，获取：
- `App ID` + `App Secret`（凭证与基础信息页）
- 开启机器人能力（应用能力 → 机器人）
- 开启网页应用能力（应用能力 → 网页应用，首页 URL 填 `https://your-domain/`）

### 2. 开通权限

应用权限管理 → 开通以下权限：

**多维表格**
- `bitable:app` — 查看、评论、编辑和管理多维表格

**消息**
- `im:message` — 获取与发送单聊、群组消息
- `im:message:send_as_bot` — 以应用身份发消息
- `im:resource` — 读取消息中的资源

**通讯录**（如需按用户推送）
- `contact:user.base:readonly` — 获取用户基本信息

### 3. 创建多维表格并建表

在飞书云文档新建多维表格，按 [数据模型设计](#数据模型) 创建 4 张表，然后从表格 URL 提取：
- `app_token` — URL 中 `/base/{app_token}` 部分
- 各表的 `table_id` — URL 中 `/table/{table_id}` 部分

### 4. 配置环境变量

```bash
cd backend
cp .env.example .env
# 编辑 .env，填入：
#   LARK_APP_ID, LARK_APP_SECRET
#   LARK_BITABLE_APP_TOKEN
#   LARK_CLIENTS_TABLE_ID, LARK_PROJECTS_TABLE_ID, LARK_TAGS_TABLE_ID, LARK_TIME_ENTRIES_TABLE_ID
#   LARK_NOTIFY_CHAT_ID (群聊 chat_id，用于推送)
```

### 5. 安装依赖并启动

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

启动后访问：
- 健康检查: http://localhost:8000/health
- API 文档 (Swagger): http://localhost:8000/docs

### 6. 配置事件回调（可选，用于机器人交互）

飞书开放平台 → 事件与回调 → 事件配置：
- 请求地址: `https://your-domain/api/lark/webhook`
- 订阅事件:
  - `im.message.receive_v1` — 接收用户消息
  - `card.action.trigger` — 卡片按钮点击（需在卡片按钮里声明）

## 机器人指令

在飞书里 @机器人 或私聊机器人发送指令：

| 指令 | 说明 | 示例 |
|---|---|---|
| `开始 <描述>` | 开始计时 | `开始 编写登录模块` |
| `停止` | 停止当前计时 | `停止` |
| `当前` | 查看正在计时的条目 | `当前` |
| `日报` | 推送今日工时报表 | `日报` |
| `周报` | 推送本周工时报表 | `周报` |
| `帮助` | 显示指令列表 | `帮助` |

## 智能提醒（定时任务）

后端使用 APScheduler 定时推送，启动后自动运行：

| 任务 | 时间 | 说明 |
|---|---|---|
| 未停止计时器检测 | 每小时 :05 | 扫描所有 `running` 条目，运行超 8h 则提醒 |
| 工时超额检测 | 每天 10:00 | 对比项目实际工时与预估工时，超额发预警 |
| 日报推送 | 每天 18:00 | 汇总当日工时，发消息卡片到群聊 |
| 周报推送 | 每周一 09:00 | 汇总上周工时，发消息卡片到群聊 |

手动触发：`POST /api/notify/{daily,weekly,running,overrun}`

## 数据模型

### clients 客户表
| 字段 | 类型 | 说明 |
|---|---|---|
| 客户名称 | 多行文本 | 唯一 |
| 联系人 | 多行文本 | 可选 |
| 邮箱 | 多行文本 | 可选 |
| 状态 | 单选 | active / archived |

### projects 项目表
| 字段 | 类型 | 说明 |
|---|---|---|
| 项目名称 | 多行文本 | |
| 客户 | 关联 clients | |
| 颜色 | 单选 | 图表标识 |
| 是否计费 | 复选框 | |
| 预估工时 | 数字 | 小时，用于超额检测 |
| 状态 | 单选 | active / archived |

### tags 标签表
| 字段 | 类型 | 说明 |
|---|---|---|
| 标签名称 | 多行文本 | 唯一 |

### time_entries 时间条目表（核心）
| 字段 | 类型 | 说明 |
|---|---|---|
| 描述 | 多行文本 | 任务描述 |
| 项目 | 关联 projects | |
| 标签 | 多选关联 tags | |
| 开始时间 | 日期(带时分秒) | 毫秒时间戳 |
| 结束时间 | 日期(带时分秒) | 毫秒时间戳 |
| 时长(秒) | 数字 | 停止时自动计算 |
| 用户 | 人员 | 计时人 open_id |
| 是否计费 | 复选框 | 继承项目 |
| 状态 | 单选 | running / stopped |

## API 速览

### 计时器
```http
POST /api/timer/start
  {"user_id":"ou_xxx", "description":"写文档", "project_id":"recxxx"}

POST /api/timer/stop
  {"record_id":"recxxx"}

GET  /api/timer/current?user_id=ou_xxx
```

### 项目 / 客户 / 标签
```http
POST   /api/projects              {"name":"新项目","billable":true}
GET    /api/projects?status=active
PATCH  /api/projects/{id}         {"name":"改名"}
POST   /api/projects/{id}/archive
DELETE /api/projects/{id}

POST   /api/projects/clients      {"name":"Acme"}
GET    /api/projects/clients

POST   /api/projects/tags         {"name":"紧急"}
GET    /api/projects/tags
DELETE /api/projects/tags/{id}
```

### 时间条目
```http
POST   /api/entries               {"user_id":"ou_xxx","start_at_ms":...,"stop_at_ms":...}
GET    /api/entries?user_id=ou_xxx&start_ms=...&end_ms=...
PATCH  /api/entries/{id}          {"description":"改描述"}
DELETE /api/entries/{id}
```

### 报表
```http
GET /api/reports/weekly?user_id=ou_xxx
GET /api/reports/monthly
GET /api/reports/custom?start_ms=...&end_ms=...
GET /api/reports/export?start_ms=...&end_ms=...   # CSV 下载
GET /api/reports/project-overrun?project_id=recxxx&estimated_hours=40
```

### 提醒
```http
POST /api/notify/text    {"text":"你好"}
POST /api/notify/card    {"card":{...}}
POST /api/notify/daily
POST /api/notify/weekly
POST /api/notify/running
POST /api/notify/overrun
```

### 飞书回调
```http
POST /api/lark/webhook   # 飞书事件订阅入口
```

## 项目结构

```
backend/
├── .env.example
├── requirements.txt
└── app/
    ├── main.py              # FastAPI 入口 + lifespan
    ├── config.py            # Pydantic Settings
    ├── constants.py         # 表 ID + 字段名常量
    ├── lark_client.py       # 飞书 SDK 单例
    ├── bitable_repo.py      # 多维表格数据访问层
    ├── timer_service.py     # 计时核心逻辑
    ├── report_service.py    # 报表聚合 + CSV 导出
    ├── notify_service.py    # 消息卡片模板 + 推送
    ├── scheduler.py         # APScheduler 定时任务
    └── routers/
        ├── timer.py         # /api/timer
        ├── projects.py      # /api/projects
        ├── entries.py       # /api/entries
        ├── reports.py       # /api/reports
        ├── notify.py        # /api/notify
        └── lark_webhook.py  # /api/lark/webhook
```

## 后续迭代路线

| 阶段 | 内容 |
|---|---|
| **MVP (本仓库)** | 计时 + 数据组织 + 报表 + 提醒 + 机器人交互 |
| **迭代 1** | 团队工作量看板（多人聚合 + 权限） |
| **迭代 2** | 飞书日历自动导入（日历 v4 API） |
| **迭代 3** | 飞书小程序原生前端（替代 H5） |
| **迭代 4** | 跨工作空间/多团队支持 |

## 许可证

MIT
