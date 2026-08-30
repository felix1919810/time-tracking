"""自动创建多维表格里的 4 张数据表 + 所有字段（v2）。

v1 的问题：batch_create 接口忽略了 fields 参数，只建了表壳。
v2 方案：batch_create 建空表 → 逐个 create_field 补业务字段。

用法：
    .venv/Scripts/python.exe -m app.scripts.create_bitable <APP_TOKEN>
"""
from __future__ import annotations

import json
import sys

import requests

from ..config import get_settings


# ──────────────────────────────────────────────
#  飞书 REST API
# ──────────────────────────────────────────────

def get_token() -> str:
    s = get_settings()
    r = requests.post(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": s.lark_app_id, "app_secret": s.lark_app_secret},
        timeout=15,
    )
    return r.json()["tenant_access_token"]


def batch_create_tables(app_token: str, names: list[str]) -> list[str]:
    """批量创建空表，返回 table_id 列表。"""
    token = get_token()
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/batch_create"
    payload = {"tables": [{"name": n} for n in names]}
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=30,
    )
    j = r.json()
    if j.get("code") != 0:
        raise RuntimeError(f"batch_create_tables failed: {j}")
    return j["data"]["table_ids"]


def create_field(app_token: str, table_id: str, field: dict) -> dict:
    """在指定表里创建一个字段。"""
    token = get_token()
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields"
    r = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=field,
        timeout=30,
    )
    j = r.json()
    if j.get("code") != 0:
        raise RuntimeError(f"create_field {field.get('field_name')} failed: {j}")
    return j["data"]["field"]


def rename_first_field(app_token: str, table_id: str, new_name: str) -> None:
    """把表里第一个字段（batch_create 默认建的'多行文本'）重命名为 new_name。"""
    token = get_token()
    # 列出字段，找第一个
    list_url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields"
    r = requests.get(list_url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    j = r.json()
    if j.get("code") != 0 or not j["data"]["items"]:
        raise RuntimeError(f"rename: list fields failed: {j}")
    first_field = j["data"]["items"][0]
    field_id = first_field["field_id"]
    field_type = first_field["type"]

    # PUT 更新字段名（必须带 type）
    put_url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields/{field_id}"
    r2 = requests.put(
        put_url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"field_name": new_name, "type": field_type},
        timeout=30,
    )
    j2 = r2.json()
    if j2.get("code") != 0:
        raise RuntimeError(f"rename field to {new_name} failed: {j2}")


def list_tables(app_token: str) -> list[dict]:
    """列出所有表 [{table_id, name}]。"""
    token = get_token()
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables"
    r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    j = r.json()
    if j.get("code") != 0:
        raise RuntimeError(f"list_tables failed: {j}")
    return [{"table_id": t["table_id"], "name": t.get("name", "")} for t in j["data"].get("items", [])]


def delete_table(app_token: str, table_id: str) -> None:
    token = get_token()
    url = f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}"
    r = requests.delete(url, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    j = r.json()
    if j.get("code") != 0:
        raise RuntimeError(f"delete_table {table_id} failed: {j}")


def cleanup(app_token: str, names: set[str]) -> None:
    """删除同名旧表（幂等）。"""
    for t in list_tables(app_token):
        if t["name"] in names:
            try:
                delete_table(app_token, t["table_id"])
                print(f"  删除 [{t['name']}]")
            except RuntimeError as e:
                print(f"  删除 [{t['name']}] 失败: {e}")


# ──────────────────────────────────────────────
#  字段定义（飞书 REST API 格式）
#  type: 1=多行文本 2=数字 3=单选 5=日期 7=复选框 11=人员 21=双向关联
# ──────────────────────────────────────────────

# 每张表的业务字段（不含 batch_create 自动建的"多行文本"和关联字段）
FIELDS_DEF = {
    "客户": [
        {"field_name": "联系人", "type": 1},
        {"field_name": "邮箱", "type": 1},
        {"field_name": "状态", "type": 3, "property": {"options": [{"name": "active"}, {"name": "archived"}]}},
    ],
    "项目": [
        {"field_name": "颜色", "type": 3, "property": {"options": [
            {"name": "blue"}, {"name": "green"}, {"name": "red"},
            {"name": "yellow"}, {"name": "purple"}, {"name": "orange"},
        ]}},
        {"field_name": "是否计费", "type": 7},
        {"field_name": "预估工时", "type": 2, "property": {"formatter": "0"}},
        {"field_name": "状态", "type": 3, "property": {"options": [{"name": "active"}, {"name": "archived"}]}},
    ],
    "标签": [],  # 标签表只需要名称字段（batch_create 默认建的"多行文本"就是名称）
    "时间条目": [
        {"field_name": "描述", "type": 1},
        {"field_name": "开始时间", "type": 5, "property": {"date_formatter": "yyyy/MM/dd HH:mm", "auto_fill": False}},
        {"field_name": "结束时间", "type": 5, "property": {"date_formatter": "yyyy/MM/dd HH:mm", "auto_fill": False}},
        {"field_name": "时长(秒)", "type": 2, "property": {"formatter": "0"}},
        {"field_name": "用户", "type": 11, "property": {"multiple": False}},
        {"field_name": "是否计费", "type": 7},
        {"field_name": "状态", "type": 3, "property": {"options": [{"name": "running"}, {"name": "stopped"}]}},
    ],
}

# 表创建顺序（先建无关联的，再建有关联的）
TABLE_NAMES = ["客户", "标签", "项目", "时间条目"]


# ──────────────────────────────────────────────
#  主流程
# ──────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) < 2:
        print("用法: python -m app.scripts.create_bitable <APP_TOKEN>")
        sys.exit(1)

    app_token = sys.argv[1]
    print(f"app_token: {app_token}\n")

    # 第 0 步：清理旧表
    print("清理同名旧表...")
    cleanup(app_token, set(TABLE_NAMES))
    print()

    # 第 1 步：batch_create 建空表
    print("批量创建 4 张空表...")
    table_ids = batch_create_tables(app_token, TABLE_NAMES)
    name_to_id = dict(zip(TABLE_NAMES, table_ids))
    for n, tid in name_to_id.items():
        print(f"  {n:8} table_id = {tid}")
    print()

    # 第 2 步：重命名每张表的第一个字段（batch_create 默认建的"多行文本"）
    print("重命名默认字段...")
    rename_map = {
        "客户": "客户名称",
        "标签": "标签名称",
        "项目": "项目名称",
        "时间条目": "多行文本",  # 时间条目表第一个字段保留默认名，业务字段单独建
    }
    for tname, new_name in rename_map.items():
        tid = name_to_id[tname]
        try:
            rename_first_field(app_token, tid, new_name)
            print(f"  [{tname}] 第一个字段 -> {new_name}")
        except RuntimeError as e:
            print(f"  [{tname}] 重命名失败: {e}")
    print()

    # 第 3 步：逐表补业务字段
    print("补建业务字段...")
    for table_name, fields in FIELDS_DEF.items():
        tid = name_to_id[table_name]
        if not fields:
            print(f"  [{table_name}] 无需补字段")
            continue
        for f in fields:
            try:
                create_field(app_token, tid, f)
                print(f"  [{table_name}] + {f['field_name']} (type={f['type']})")
            except RuntimeError as e:
                print(f"  [{table_name}] {f['field_name']} 失败: {e}")
    print()

    # 第 3 步：输出 .env
    print("=== 完成 ===\n")
    print("填入 .env：\n")
    print(f"LARK_BITABLE_APP_TOKEN={app_token}")
    print(f"LARK_CLIENTS_TABLE_ID={name_to_id['客户']}")
    print(f"LARK_PROJECTS_TABLE_ID={name_to_id['项目']}")
    print(f"LARK_TAGS_TABLE_ID={name_to_id['标签']}")
    print(f"LARK_TIME_ENTRIES_TABLE_ID={name_to_id['时间条目']}")


if __name__ == "__main__":
    main()
