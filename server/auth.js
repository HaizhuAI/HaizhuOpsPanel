/**
 * 认证模块
 * - 管理员账号: admin，默认密码: admin123（首次启动自动初始化）
 * - 密码使用 scrypt 加盐哈希存储于 data/auth.json
 * - 登录成功签发随机 token（内存会话，24 小时有效）
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const DEFAULT_PASSWORD = 'admin123';
const TOKEN_TTL = 24 * 60 * 60 * 1000;
const SESSION_KEY_FILE = path.join(DATA_DIR, 'session.key');

const sessions = new Map(); // token -> expiresAt

function sessionKey() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SESSION_KEY_FILE)) {
    fs.writeFileSync(SESSION_KEY_FILE, crypto.randomBytes(32), { mode: 0o600 });
  }
  return fs.readFileSync(SESSION_KEY_FILE);
}

function signedToken(expiresAt) {
  const payload = `${expiresAt}.${crypto.randomBytes(24).toString('hex')}`;
  const signature = crypto.createHmac('sha256', sessionKey()).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function loadAuth() {
  if (!fs.existsSync(AUTH_FILE)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const { salt, hash } = hashPassword(DEFAULT_PASSWORD);
    const conf = { username: 'admin', salt, hash, mustChange: true };
    fs.writeFileSync(AUTH_FILE, JSON.stringify(conf, null, 2));
    return conf;
  }
  return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
}

function saveAuth(conf) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(conf, null, 2));
}

function verifyPassword(password) {
  const conf = loadAuth();
  const { hash } = hashPassword(password, conf.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(conf.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function login(username, password) {
  const conf = loadAuth();
  if (username !== conf.username || !verifyPassword(password)) return null;
  const expiresAt = Date.now() + TOKEN_TTL;
  const token = signedToken(expiresAt);
  sessions.set(token, expiresAt);
  return { token, mustChange: !!conf.mustChange };
}

function verifyToken(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (exp) {
    if (Date.now() > exp) { sessions.delete(token); return false; }
    return true;
  }
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, signature] = parts;
  const payload = `${expiresAt}.${nonce}`;
  const expected = crypto.createHmac('sha256', sessionKey()).update(payload).digest('hex');
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return Number(expiresAt) > Date.now() && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function logout(token) {
  sessions.delete(token);
}

function changePassword(oldPassword, newPassword) {
  if (!verifyPassword(oldPassword)) return { ok: false, error: '原密码不正确' };
  if (!newPassword || newPassword.length < 6) return { ok: false, error: '新密码长度至少 6 位' };
  if (newPassword === DEFAULT_PASSWORD) return { ok: false, error: '新密码不能与默认密码相同' };
  const conf = loadAuth();
  const { salt, hash } = hashPassword(newPassword);
  conf.salt = salt;
  conf.hash = hash;
  conf.mustChange = false;
  saveAuth(conf);
  return { ok: true };
}

// 定期清理过期会话
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (now > exp) sessions.delete(t);
}, 60 * 1000).unref();

module.exports = { login, logout, verifyToken, changePassword, loadAuth, DEFAULT_PASSWORD };
