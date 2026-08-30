## 飞书多维表格 API 文档摘要

根据对飞书开放平台文档的分析，以下是实现飞书版 Toggl Track 的关键 API 和架构建议：

### 1. 核心架构：小程序 + 后端服务 + 多维表格

建议从以下 MIA（最小可行产品）组合起步：
- **飞书小程序**：用于前端交互，提供计时功能、报表和智能提醒
- **后端服务**：处理计时逻辑、数据存储和业务逻辑
- **多维表格**：作为核心数据存储，管理时间记录、项目、任务等

### 2. 关键 API 接口

#### 2.1 多维表格操作

- **创建多维表格**：`POST /open-apis/bitable/v1/apps` (需 `base:app:create` 权限)
- **获取多维表格元数据**：`GET /open-apis/bitable/v1/apps/:app_token` (需 `base:app:read` 权限)
- **列出数据表**：`GET /open-apis/bitable/v1/apps/:app_token/tables` (需 `base:app:read` 权限)
- **创建数据表**：`POST /open-apis/bitable/v1/apps/:app_token/tables` (需 `base:app:write` 权限)
- **列出视图/创建视图**：`GET/POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/views`
- **管理记录**：
    - 列出记录：`GET /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records`
    - 创建/更新记录：`POST/PUT /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records`

#### 2.2 访问凭证

- **`tenant_access_token`**：应用身份，用于访问应用自有资源（应用创建的多维表格）
- **`user_access_token`**：用户身份，用于访问用户自有资源（用户创建的多维表格）

#### 2.3 字段类型

- **文本**：type=1, ui_type="Text"
- **数字**：type=2, ui_type="Number"
- **进度**：type=2, ui_type="Progress"
- **日期**：type=5, ui_type="DateTime"
- **人员**：type=11, ui_type="User"
- **复选框**：type=7, ui_type="Checkbox"

### 3. 实现主功能建议

#### 3.1 计时功能

- 在小程序中实现开始/暂停/停止计时按钮
- 后端记录计时数据到多维表格
- 使用 `record_id` 和 `field_id` 更新时间记录 

#### 3.2 数据组织

- 创建项目、任务和时间记录的多维表格
- 使用「日期」字段记录时间起始和终止时间
- 使用「人员」字段记录操作者
- 使用「复选框」字段记录任务状态

#### 3.3 报表与分析

- 创建视图（Grid, Kanban, Gantt）展示数据
- 使用公式字段计算总时间、平均时间等
- 通过 API 查询并导出数据

#### 3.4 智能提醒

- 在小程序中实现定时提醒
- 使用飞书机器人发送通知
- 通过 API 查询待办事项

#### 3.5 飞书集成

- 通过小程序与多维表格数据联动
- 使用飞书机器人实现外部系统集成（如考勤系统）
- 通过 webhook 实现数据同步

### 4. 开发步骤建议

1. 创建多维表格模板（项目、任务、时间记录等）
2. 开发后端服务，提供 API 接口
3. 开发小程序前端，实现计时功能
4. 实现报表和分析功能
5. 集成智能提醒功能
6. 测试和优化

### 5. 开发示例

```python
import requests

# 获取 access token
access_token = "your_access_token"

# 获取多维表格元数据
url = "https://open.feishu.cn/open-apis/bitable/v1/apps/your_app_token"
headers = {"Authorization": f"Bearer {access_token}