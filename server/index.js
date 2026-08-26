/**
 * HaizhuOpsPanel - 企业级可视化远程主机运维平台
 * HTTP API + WebSocket(实时命令输出 / Web 终端)
 * v2.1.0 新增：
 *   - AI 运维助手（自然语言 → MCP 工具调用 → SSH 执行）
 *   - MCP 工具清单查询接口（配合外部 MCP 客户端使用，见 server/mcp-server.js）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const auth = require('./auth');
const store = require('./store');
const ssh = require('./sshManager');
const ops = require('./ops');
const apps = require('./apps');
const audit = require('./audit');
const ai = require('./ai');
const mcpTools = require('./mcp-tools');

// ---------- .env 轻量加载（无需 dotenv 依赖） ----------
(function loadEnv() {
  const envFile = path.join(__dirname, '..', '.env');
  try {
    if (fs.existsSync(envFile)) {
      for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        let val = m[2].replace(/^['"]|['"]$/g, '');
        if (!(m[1] in process.env)) process.env[m[1]] = val;
      }
    }
  } catch (_) { /* .env 读取失败不影响启动 */ }
})();

const PORT = parseInt(process.env.PANEL_PORT || '8899', 10);
const app = express();
app.use(express.json({ limit: '1mb' }));
// 静态资源禁用强缓存（仅协商缓存/ETag），确保面板更新后浏览器立即拿到最新前端
app.use(express.static(path.join(__dirname, '..', 'legacy-public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  },
}));

// ---------- 认证 ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const result = auth.login(username || 'admin', password || '');
  if (!result) {
    audit.write('auth.login', { actor: username || 'admin', ip: req.ip, result: 'denied' });
    return res.status(401).json({ ok: false, error: '用户名或密码错误' });
  }
  audit.write('auth.login', { actor: username || 'admin', ip: req.ip, result: 'success' });
  res.json({ ok: true, ...result });
});

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!auth.verifyToken(token)) return res.status(401).json({ ok: false, error: '未登录或会话已过期' });
  req.token = token;
  next();
}

app.post('/api/logout', requireAuth, (req, res) => {
  auth.logout(req.token);
  audit.write('auth.logout', { ip: req.ip, result: 'success' });
  res.json({ ok: true });
});

app.post('/api/password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const result = auth.changePassword(oldPassword || '', newPassword || '');
  if (!result.ok) {
    audit.write('auth.password.change', { ip: req.ip, result: 'denied' });
    return res.status(400).json(result);
  }
  audit.write('auth.password.change', { ip: req.ip, result: 'success' });
  res.json(result);
});

// ---------- 操作目录 ----------
app.get('/api/ops', requireAuth, (req, res) => {
  res.json({ ok: true, ...ops.catalog() });
});

app.get('/api/audit', requireAuth, (req, res) => {
  res.json({ ok: true, records: audit.list(req.query.limit) });
});

// ---------- 应用商店 ----------
app.get('/api/apps', requireAuth, (req, res) => {
  res.json({ ok: true, ...apps.catalog() });
});

// 构建应用安装/卸载命令（供交互式应用在终端执行）
app.post('/api/apps/:id/command', requireAuth, (req, res) => {
  const { action, params } = req.body || {};
  try {
    const command = apps.buildCommand(req.params.id, action === 'uninstall' ? 'uninstall' : 'install', params);
    audit.write('app.command.build', { ip: req.ip, target: req.params.id, meta: { action: action === 'uninstall' ? 'uninstall' : 'install' } });
    res.json({ ok: true, command });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// 采集当前主机的应用安装状态
app.get('/api/hosts/:id/apps/status', requireAuth, async (req, res) => {
  try {
    const { stdout } = await ssh.execCollect(req.params.id, apps.STATUS_SCRIPT, 15000);
    const installed = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    res.json({ ok: true, installed });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ---------- 主机管理 ----------
app.get('/api/hosts', requireAuth, (req, res) => {
  res.json({ ok: true, hosts: store.listHosts() });
});

app.post('/api/hosts', requireAuth, (req, res) => {
  const { host, username } = req.body || {};
  if (!host || !username) return res.status(400).json({ ok: false, error: '主机地址和用户名必填' });
  const record = store.addHost(req.body);
  audit.write('host.create', { ip: req.ip, target: record.id, meta: { name: record.name, host: record.host } });
  res.json({ ok: true, host: record });
});

app.put('/api/hosts/:id', requireAuth, (req, res) => {
  const record = store.updateHost(req.params.id, req.body || {});
  if (!record) return res.status(404).json({ ok: false, error: '主机不存在' });
  ssh.disconnect(req.params.id); // 凭据可能变更，重置连接
  audit.write('host.update', { ip: req.ip, target: req.params.id, meta: { name: record.name, host: record.host } });
  res.json({ ok: true, host: record });
});

app.delete('/api/hosts/:id', requireAuth, (req, res) => {
  ssh.disconnect(req.params.id);
  const removed = store.removeHost(req.params.id);
  audit.write('host.delete', { ip: req.ip, target: req.params.id, result: removed ? 'success' : 'not_found' });
  res.json({ ok: removed, error: removed ? undefined : '主机不存在' });
});

app.post('/api/hosts/:id/test', requireAuth, async (req, res) => {
  try {
    const result = await ssh.testConnection(req.params.id);
    res.json({ ok: result.ok, banner: result.banner, error: result.error });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ---------- AI 运维助手（MCP 工具驱动） ----------
app.get('/api/ai/status', requireAuth, (req, res) => {
  res.json({ ok: true, ...ai.status() });
});

app.post('/api/ai/chat', requireAuth, async (req, res) => {
  const { message, history } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ ok: false, error: '消息不能为空' });
  }
  try {
    const result = await ai.chat(Array.isArray(history) ? history : [], String(message));
    res.json(result);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ---------- MCP 工具清单（供文档 / 调试 / 第三方接入） ----------
app.get('/api/mcp/tools', requireAuth, (req, res) => {
  res.json({ ok: true, transport: 'stdio (node server/mcp-server.js)', tools: mcpTools.mcpToolList() });
});

// ---------- 系统信息仪表盘 ----------
app.get('/api/hosts/:id/sysinfo', requireAuth, async (req, res) => {
  try {
    const { stdout } = await ssh.execCollect(req.params.id, ops.SYSINFO_SCRIPT, 25000);
    const info = {};
    for (const line of stdout.split('\n')) {
      const idx = line.indexOf('|');
      if (idx > 0) info[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    res.json({ ok: true, info });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ---------- HTTP + WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws' || !auth.verifyToken(url.searchParams.get('token'))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  // The HTTP upgrade request is only available when the connection event
  // explicitly receives it. Capture the address once so task handlers never
  // depend on an out-of-scope `req` reference.
  const clientIp = req?.socket?.remoteAddress || 'unknown';
  const execs = new Map(); // execId -> stream
  let shellStream = null;

  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

    try {
      // 一键执行预置操作
      if (msg.type === 'exec') {
        const op = ops.getOp(msg.opId);
        if (!op) return send({ type: 'error', execId: msg.execId, error: '未知操作' });
        let command;
        try {
          command = op.build(msg.params || {});
        } catch (e) {
          return send({ type: 'error', execId: msg.execId, error: e.message });
        }
        audit.write('operation.execute', { ip: clientIp, target: msg.hostId, meta: { opId: msg.opId, danger: !!op.danger } });
        const stream = await ssh.exec(msg.hostId, command, {
          onData: (d) => send({ type: 'data', execId: msg.execId, data: d.toString('utf8') }),
          onClose: (code) => {
            execs.delete(msg.execId);
            send({ type: 'exit', execId: msg.execId, code });
          },
          onError: (e) => send({ type: 'error', execId: msg.execId, error: e.message }),
        });
        execs.set(msg.execId, stream);
        send({ type: 'started', execId: msg.execId, name: op.name });
      }

      // 自定义命令
      else if (msg.type === 'raw') {
        if (typeof msg.command !== 'string' || !msg.command.trim()) {
          return send({ type: 'error', execId: msg.execId, error: '命令不能为空' });
        }
        const stream = await ssh.exec(msg.hostId, msg.command, {
          onData: (d) => send({ type: 'data', execId: msg.execId, data: d.toString('utf8') }),
          onClose: (code) => {
            execs.delete(msg.execId);
            send({ type: 'exit', execId: msg.execId, code });
          },
          onError: (e) => send({ type: 'error', execId: msg.execId, error: e.message }),
        });
        execs.set(msg.execId, stream);
        send({ type: 'started', execId: msg.execId, name: '自定义命令' });
      }

      // 终止正在执行的操作
      else if (msg.type === 'kill') {
        const stream = execs.get(msg.execId);
        if (stream) {
          try { stream.write('\x03'); } catch (_) {}
          setTimeout(() => { try { stream.close(); } catch (_) {} }, 300);
        }
      }

      // 交互式终端
      else if (msg.type === 'shell-open') {
        if (shellStream) { try { shellStream.close(); } catch (_) {} }
        shellStream = await ssh.shell(msg.hostId, { cols: msg.cols, rows: msg.rows });
        shellStream.on('data', (d) => send({ type: 'shell-data', data: d.toString('utf8') }));
        shellStream.stderr.on('data', (d) => send({ type: 'shell-data', data: d.toString('utf8') }));
        shellStream.on('close', () => {
          shellStream = null;
          send({ type: 'shell-closed' });
        });
        send({ type: 'shell-ready' });
      } else if (msg.type === 'shell-input') {
        if (shellStream) shellStream.write(msg.data);
      } else if (msg.type === 'shell-resize') {
        if (shellStream) shellStream.setWindow(msg.rows, msg.cols, 0, 0);
      } else if (msg.type === 'shell-close') {
        if (shellStream) { try { shellStream.close(); } catch (_) {} shellStream = null; }
      }
    } catch (e) {
      send({ type: 'error', execId: msg.execId, error: e.message });
    }
  });

  ws.on('close', () => {
    for (const stream of execs.values()) { try { stream.close(); } catch (_) {} }
    execs.clear();
    if (shellStream) { try { shellStream.close(); } catch (_) {} }
  });
});

server.listen(PORT, () => {
  const conf = auth.loadAuth();
  console.log('=========================================================');
  console.log('  HaizhuOpsPanel 企业级可视化运维平台 已启动');
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log(`  管理员账号: admin`);
  if (conf.mustChange) {
    console.log(`  默认密码: ${auth.DEFAULT_PASSWORD}  (登录后请立即修改!)`);
  }
  console.log(`  AI 运维助手: ${ai.isConfigured() ? '已启用 (' + ai.status().model + ')' : '未配置 (设置环境变量 AI_API_KEY 启用)'}`);
  console.log('  MCP 服务器: node server/mcp-server.js (stdio, 供 Claude Desktop / Cursor 等接入)');
  console.log('=========================================================');
});
