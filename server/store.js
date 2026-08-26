/**
 * 主机凭据存储
 * - 主机列表持久化到 data/hosts.json
 * - 密码/私钥使用 AES-256-GCM 加密，密钥保存在 data/secret.key（首次启动生成）
 * - 对外接口永不返回明文凭据
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HOSTS_FILE = path.join(DATA_DIR, 'hosts.json');
const KEY_FILE = path.join(DATA_DIR, 'secret.key');

function getKey() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32));
    try { fs.chmodSync(KEY_FILE, 0o600); } catch (_) {}
  }
  return fs.readFileSync(KEY_FILE);
}

function encrypt(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

function decrypt(data) {
  if (!data) return '';
  const buf = Buffer.from(data, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function loadHosts() {
  if (!fs.existsSync(HOSTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HOSTS_FILE, 'utf8'));
  } catch (_) {
    return [];
  }
}

function saveHosts(hosts) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HOSTS_FILE, JSON.stringify(hosts, null, 2));
}

/** 前端安全视图：不含任何凭据密文/明文 */
function publicView(h) {
  return {
    id: h.id,
    name: h.name,
    host: h.host,
    port: h.port,
    username: h.username,
    authType: h.authType,
  };
}

function listHosts() {
  return loadHosts().map(publicView);
}

function addHost({ name, host, port, username, authType, password, privateKey, passphrase }) {
  const hosts = loadHosts();
  const record = {
    id: crypto.randomBytes(8).toString('hex'),
    name: name || host,
    host,
    port: parseInt(port, 10) || 22,
    username: username || 'root',
    authType: authType === 'key' ? 'key' : 'password',
    password: encrypt(password || ''),
    privateKey: encrypt(privateKey || ''),
    passphrase: encrypt(passphrase || ''),
    createdAt: new Date().toISOString(),
  };
  hosts.push(record);
  saveHosts(hosts);
  return publicView(record);
}

function updateHost(id, patch) {
  const hosts = loadHosts();
  const h = hosts.find((x) => x.id === id);
  if (!h) return null;
  if (patch.name !== undefined) h.name = patch.name;
  if (patch.host !== undefined) h.host = patch.host;
  if (patch.port !== undefined) h.port = parseInt(patch.port, 10) || 22;
  if (patch.username !== undefined) h.username = patch.username;
  if (patch.authType !== undefined) h.authType = patch.authType === 'key' ? 'key' : 'password';
  if (patch.password) h.password = encrypt(patch.password);
  if (patch.privateKey) h.privateKey = encrypt(patch.privateKey);
  if (patch.passphrase) h.passphrase = encrypt(patch.passphrase);
  saveHosts(hosts);
  return publicView(h);
}

function removeHost(id) {
  const hosts = loadHosts();
  const next = hosts.filter((x) => x.id !== id);
  saveHosts(next);
  return next.length !== hosts.length;
}

/** 供 SSH 模块使用：返回含解密凭据的完整记录 */
function getHostWithSecrets(id) {
  const h = loadHosts().find((x) => x.id === id);
  if (!h) return null;
  return {
    ...h,
    password: decrypt(h.password),
    privateKey: decrypt(h.privateKey),
    passphrase: decrypt(h.passphrase),
  };
}

module.exports = { listHosts, addHost, updateHost, removeHost, getHostWithSecrets };
