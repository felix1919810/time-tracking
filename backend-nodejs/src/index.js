/** 时间追踪应用主入口。对应 Python main.py。
 *
 * 启动流程：
 * 1. 加载配置（config.js）
 * 2. 创建 Express 应用
 * 3. 注册路由（timer / projects / entries / reports / notify / lark-webhook）
 * 4. 启动定时任务调度器（scheduler.js）
 * 5. 监听端口
 */
const express = require('express');
const config = require('./config');
const { startScheduler, shutdownScheduler } = require('./scheduler');

// ──────────────────────────────────────────────
//  Express 应用
// ──────────────────────────────────────────────

const app = express();

// 解析 JSON 请求体
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 简单请求日志
app.use((req, _res, next) => {
  if (config.debug) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});

// ──────────────────────────────────────────────
//  健康检查
// ──────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    app_id: config.larkAppId ? config.larkAppId.slice(0, 12) + '...' : '(unset)',
    version: '1.0.0',
  });
});

// ──────────────────────────────────────────────
//  路由注册（与 Python 版 prefix 一致：/api/<module>）
// ──────────────────────────────────────────────

app.use('/api/timer', require('./routers/timer'));
app.use('/api/projects', require('./routers/projects'));
app.use('/api/entries', require('./routers/entries'));
app.use('/api/reports', require('./routers/reports'));
app.use('/api/notify', require('./routers/notify'));
app.use('/api/lark', require('./routers/lark-webhook'));

// ──────────────────────────────────────────────
//  全局错误处理
// ──────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ detail: err.message || 'internal server error' });
});

// ──────────────────────────────────────────────
//  启动
// ──────────────────────────────────────────────

const server = app.listen(config.port, config.host, () => {
  console.log(`\n🚀 飞书时间追踪后端 (Node.js) 已启动`);
  console.log(`   监听: http://${config.host}:${config.port}`);
  console.log(`   健康: http://${config.host}:${config.port}/health`);
  console.log(`   调试: ${config.debug ? 'ON' : 'off'}\n`);

  // 启动定时任务调度器
  startScheduler();
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n🛑 收到 SIGINT，正在关闭…');
  shutdownScheduler();
  server.close(() => {
    console.log('✅ 已关闭');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 收到 SIGTERM，正在关闭…');
  shutdownScheduler();
  server.close(() => {
    console.log('✅ 已关闭');
    process.exit(0);
  });
});

module.exports = { app, server };
