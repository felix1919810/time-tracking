/** 飞书事件回调路由。对应 Python routers/lark_webhook.py 的 router 部分。
 *
 * 复用 src/webhook.js 的 larkWebhook handler。
 */
const express = require('express');
const { larkWebhook } = require('../webhook');

const router = express.Router();

// 飞书事件回调主入口
router.post('/webhook', larkWebhook);

module.exports = router;
