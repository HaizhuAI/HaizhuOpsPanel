/**
 * SSH 连接管理
 * - 基于 ssh2，按主机 ID 复用连接（10 分钟空闲自动断开）
 * - exec: 以 PTY 方式执行命令并流式回传输出
 * - shell: 打开交互式终端（配合前端 xterm.js）
 */
const { Client } = require('ssh2');
const store = require('./store');

const IDLE_TIMEOUT = 10 * 60 * 1000;
const pool = new Map(); // hostId -> { conn, lastUsed, timer }

function buildConfig(host) {
  const cfg = {
    host: host.host,
    port: host.port || 22,
    username: host.username || 'root',
    readyTimeout: 15000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 4,
  };
  if (host.authType === 'key' && host.privateKey) {
    cfg.privateKey = host.privateKey;
    if (host.passphrase) cfg.passphrase = host.passphrase;
  } else {
    cfg.password = host.password;
    // 兼容开启键盘交互认证的服务器
    cfg.tryKeyboard = true;
  }
  return cfg;
}

function scheduleIdle(hostId) {
  const entry = pool.get(hostId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    try { entry.conn.end(); } catch (_) {}
    pool.delete(hostId);
  }, IDLE_TIMEOUT);
  entry.timer.unref();
}

function connect(host) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    conn.on('keyboard-interactive', (name, instr, lang, prompts, finish) => {
      finish(prompts.map(() => host.password || ''));
    });
    conn.on('ready', () => {
      settled = true;
      resolve(conn);
    });
    conn.on('error', (err) => {
      if (!settled) reject(err);
    });
    conn.connect(buildConfig(host));
  });
}

async function getConnection(hostId) {
  const cached = pool.get(hostId);
  if (cached) {
    cached.lastUsed = Date.now();
    scheduleIdle(hostId);
    return cached.conn;
  }
  const host = store.getHostWithSecrets(hostId);
  if (!host) throw new Error('主机不存在');
  const conn = await connect(host);
  conn.on('close', () => pool.delete(hostId));
  conn.on('error', () => pool.delete(hostId));
  pool.set(hostId, { conn, lastUsed: Date.now(), timer: null });
  scheduleIdle(hostId);
  return conn;
}

/** 测试连接（不入池） */
async function testConnection(hostId) {
  const host = store.getHostWithSecrets(hostId);
  if (!host) throw new Error('主机不存在');
  const conn = await connect(host);
  return new Promise((resolve) => {
    conn.exec('echo OPSPANEL_OK && uname -a', (err, stream) => {
      if (err) {
        conn.end();
        return resolve({ ok: false, error: err.message });
      }
      let out = '';
      stream.on('data', (d) => (out += d.toString()));
      stream.on('close', () => {
        conn.end();
        resolve({ ok: out.includes('OPSPANEL_OK'), banner: out.trim() });
      });
    });
  });
}

/**
 * 执行命令（PTY 模式，stdout/stderr 合流，保留颜色）
 * 返回 stream，调用方可 stream.close() 终止
 */
async function exec(hostId, command, { onData, onClose, onError }) {
  const conn = await getConnection(hostId);
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: { term: 'xterm-256color', cols: 120, rows: 30 } }, (err, stream) => {
      if (err) return reject(err);
      stream.on('data', (d) => onData && onData(d));
      stream.stderr.on('data', (d) => onData && onData(d));
      stream.on('close', (code, signal) => onClose && onClose(code, signal));
      stream.on('error', (e) => onError && onError(e));
      resolve(stream);
    });
  });
}

/** 打开交互式 shell */
async function shell(hostId, { cols = 120, rows = 30 } = {}) {
  const conn = await getConnection(hostId);
  return new Promise((resolve, reject) => {
    conn.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
      if (err) return reject(err);
      resolve(stream);
    });
  });
}

/** 一次性执行并收集全部输出（用于系统信息等结构化查询） */
async function execCollect(hostId, command, timeoutMs = 30000) {
  const conn = await getConnection(hostId);
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      const timer = setTimeout(() => {
        try { stream.close(); } catch (_) {}
        reject(new Error('命令执行超时'));
      }, timeoutMs);
      stream.on('data', (d) => (out += d.toString()));
      stream.stderr.on('data', (d) => (errOut += d.toString()));
      stream.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout: out, stderr: errOut });
      });
    });
  });
}

function disconnect(hostId) {
  const entry = pool.get(hostId);
  if (entry) {
    try { entry.conn.end(); } catch (_) {}
    clearTimeout(entry.timer);
    pool.delete(hostId);
  }
}

module.exports = { getConnection, testConnection, exec, shell, execCollect, disconnect };
