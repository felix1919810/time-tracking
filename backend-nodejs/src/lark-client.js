/** 飞书 SDK 客户端封装。对应 Python lark_client.py。 */
const lark = require('@larksuiteoapi/node-sdk');
const config = require('./config');

// 单例 client —— 开启 token 自动刷新
const larkClient = new lark.Client({
  appId: config.larkAppId,
  appSecret: config.larkAppSecret,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

const APP_TOKEN = config.larkBitableAppToken;

module.exports = { larkClient, APP_TOKEN };
