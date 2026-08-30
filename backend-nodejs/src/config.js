/** 配置加载 —— 从 .env 读取所有配置。 */
require('dotenv').config();

const config = {
  larkAppId: process.env.LARK_APP_ID,
  larkAppSecret: process.env.LARK_APP_SECRET,
  larkBitableAppToken: process.env.LARK_BITABLE_APP_TOKEN,
  clientsTableId: process.env.LARK_CLIENTS_TABLE_ID || '',
  projectsTableId: process.env.LARK_PROJECTS_TABLE_ID || '',
  tagsTableId: process.env.LARK_TAGS_TABLE_ID || '',
  timeEntriesTableId: process.env.LARK_TIME_ENTRIES_TABLE_ID || '',
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '8000', 10),
  debug: process.env.DEBUG === 'true',
  larkNotifyChatId: process.env.LARK_NOTIFY_CHAT_ID || '',
  timezone: process.env.TIMEZONE || 'Asia/Shanghai',
};

module.exports = config;
