/** 多维表格表 ID 常量 + 字段名常量。对应 Python constants.py。 */
const config = require('./config');

const CLIENTS_TABLE_ID = config.clientsTableId;
const PROJECTS_TABLE_ID = config.projectsTableId;
const TAGS_TABLE_ID = config.tagsTableId;
const TIME_ENTRIES_TABLE_ID = config.timeEntriesTableId;

// 字段名常量（与数据模型设计一致，避免散落字符串）
const Field = {
  // 通用
  NAME: '名称',
  STATUS: '状态',
  CREATED_TIME: '创建时间',
  // clients
  CLIENT_NAME: '客户名称',
  CLIENT_CONTACT: '联系人',
  CLIENT_EMAIL: '邮箱',
  // projects
  PROJECT_NAME: '项目名称',
  PROJECT_CLIENT: '客户',
  PROJECT_COLOR: '颜色',
  PROJECT_BILLABLE: '是否计费',
  PROJECT_ESTIMATED_HOURS: '预估工时',
  // tags
  TAG_NAME: '标签名称',
  // time_entries
  TE_DESCRIPTION: '描述',
  TE_PROJECT: '项目',
  TE_TAGS: '标签',
  TE_START: '开始时间',
  TE_STOP: '结束时间',
  TE_DURATION: '时长(秒)',
  TE_USER: '用户',
  TE_BILLABLE: '是否计费',
  TE_STATE: '状态',
};

// 状态值
const STATUS_ACTIVE = 'active';
const STATUS_ARCHIVED = 'archived';
const STATE_RUNNING = 'running';
const STATE_STOPPED = 'stopped';

module.exports = {
  CLIENTS_TABLE_ID,
  PROJECTS_TABLE_ID,
  TAGS_TABLE_ID,
  TIME_ENTRIES_TABLE_ID,
  Field,
  STATUS_ACTIVE,
  STATUS_ARCHIVED,
  STATE_RUNNING,
  STATE_STOPPED,
};
