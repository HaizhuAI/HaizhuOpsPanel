/**
 * HaizhuOpsPanel 操作审计
 * 以追加写 JSONL 保存关键管理动作，避免在审计接口中记录密码、私钥或完整命令。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');

function write(event, details = {}) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const record = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      event,
      actor: details.actor || 'admin',
      ip: details.ip || '',
      target: details.target || '',
      result: details.result || 'accepted',
      meta: details.meta || {},
    };
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600 });
    return record;
  } catch (_) {
    return null;
  }
}

function list(limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  if (!fs.existsSync(AUDIT_FILE)) return [];
  const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-safeLimit).reverse().flatMap((line) => {
    try { return [JSON.parse(line)]; } catch (_) { return []; }
  });
}

module.exports = { write, list };
