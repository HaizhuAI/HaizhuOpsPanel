/* ================= HaizhuOpsPanel 前端 ================= */
'use strict';

const state = {
  token: sessionStorage.getItem('haizhuopspanel_token') || '',
  mustChange: sessionStorage.getItem('haizhuopspanel_mustchange') === '1',
  catalog: null,
  hosts: [],
  currentHost: '',
  view: 'dashboard',
  ws: null,
  wsReady: false,
  runningExec: null,
  execSeq: 0,
  term: null,
  termFit: null,
  termOpen: false,
  termConnecting: false,
  sysinfoTimer: null,
  appCatalog: null,
  installedApps: [],
  pendingShellCmd: '',
  aiHistory: [],
  aiBusy: false,
  aiStatus: null,
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const icon = (name, className = 'ui-icon') =>
  `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;

/* ---------- API ---------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + state.token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && path !== '/api/login') {
    doLogout(true);
    throw new Error('会话已过期，请重新登录');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data.error) data.error = 'HTTP ' + res.status;
  return data;
}

/* ---------- Toast ---------- */
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toast-box').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

/* ---------- 登录 ---------- */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  btn.disabled = true;
  btn.textContent = '登录中...';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#login-username').value.trim(),
        password: $('#login-password').value,
      }),
    });
    if (!data.ok) throw new Error(data.error || '登录失败');
    state.token = data.token;
    state.mustChange = !!data.mustChange;
    sessionStorage.setItem('haizhuopspanel_token', data.token);
    sessionStorage.setItem('haizhuopspanel_mustchange', data.mustChange ? '1' : '0');
    $('#login-error').classList.add('hidden');
    await enterApp();
  } catch (err) {
    const box = $('#login-error');
    box.textContent = err.message;
    box.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '进入运维工作台';
  }
});

function doLogout(silent) {
  if (!silent) api('/api/logout', { method: 'POST' }).catch(() => {});
  state.token = '';
  sessionStorage.removeItem('haizhuopspanel_token');
  if (state.ws) { try { state.ws.close(); } catch (_) {} }
  clearInterval(state.sysinfoTimer);
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  $('#login-password').value = '';
}

$('#btn-logout').addEventListener('click', () => doLogout(false));

/* ---------- 进入主界面 ---------- */
async function enterApp() {
  const cat = await api('/api/ops');
  if (!cat.ok) throw new Error(cat.error || '加载失败');
  state.catalog = cat;
  const appCat = await api('/api/apps');
  if (appCat.ok) state.appCatalog = appCat;
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#banner-default-pass').classList.toggle('hidden', !state.mustChange);
  connectWS();
  renderNav();
  await refreshHosts();
  switchView('dashboard');
}

/* ---------- WebSocket ---------- */
function connectWS() {
  if (state.ws) { try { state.ws.close(); } catch (_) {} }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${state.token}`);
  state.ws = ws;
  ws.onopen = () => {
    state.wsReady = true;
    if (state.view === 'terminal' && state.term) requestTerminalSession();
  };
  ws.onclose = () => {
    state.wsReady = false;
    state.termOpen = false;
    state.termConnecting = false;
    if (state.term && state.view === 'terminal') {
      setTerminalStatus('连接已断开，正在自动重连...');
      state.term.write('\r\n\x1b[33m[连接已断开，正在自动重连...]\x1b[0m\r\n');
    }
    if (state.token) setTimeout(connectWS, 2500); // 自动重连
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    handleWS(msg);
  };
}

function handleWS(msg) {
  switch (msg.type) {
    case 'started':
      state.execDataSeen = false;
      consoleAppend(`\n┌── 开始执行: ${msg.name} ──\n`, 'sys');
      break;
    case 'data':
      if (msg.data && msg.data.length) state.execDataSeen = true;
      consoleWrite(msg.data);
      break;
    case 'exit':
      state.runningExec = null;
      setRunning(false);
      consoleFlush();
      if (!state.execDataSeen) consoleAppend('（命令执行完成，无输出）\n', 'sys');
      consoleAppend(`└── 执行结束 (退出码 ${msg.code == null ? '?' : msg.code}) ──\n`, msg.code === 0 ? 'ok' : 'err');
      break;
    case 'error':
      state.runningExec = null;
      setRunning(false);
      consoleAppend(`\n✘ 错误: ${msg.error}\n`, 'err');
      toast(msg.error, 'err');
      break;
    case 'shell-ready':
      state.termConnecting = false;
      state.termOpen = true;
      setTerminalStatus('终端已连接，可直接输入命令', true);
      if (state.term) state.term.focus();
      if (state.pendingShellCmd) {
        const cmd = state.pendingShellCmd;
        state.pendingShellCmd = '';
        setTimeout(() => {
          if (state.ws) state.ws.send(JSON.stringify({ type: 'shell-input', data: cmd + '\n' }));
        }, 400);
      }
      break;
    case 'shell-data':
      if (state.term) state.term.write(msg.data);
      break;
    case 'shell-error':
      state.termOpen = false;
      state.termConnecting = false;
      setTerminalStatus('终端连接失败，请点击重新连接');
      if (state.term) state.term.write(`\r\n\x1b[31m[终端连接失败: ${msg.error}]\x1b[0m\r\n`);
      toast(msg.error, 'err');
      break;
    case 'shell-closed':
      state.termOpen = false;
      state.termConnecting = false;
      setTerminalStatus('终端已断开');
      if (state.term) state.term.write('\r\n\x1b[33m[会话已断开，点击「重新连接」恢复]\x1b[0m\r\n');
      break;
  }
}

/* ---------- 控制台抽屉 ---------- */
let consoleCarry = '';

function stripAnsi(s) {
  // 去除 ANSI 转义序列（颜色/光标控制），保留文本
  return s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x07/g, '');
}

let lastLineNode = null;
function currentLine(out) {
  if (!lastLineNode || lastLineNode.parentNode !== out) {
    lastLineNode = document.createElement('span');
    out.appendChild(lastLineNode);
  }
  return lastLineNode;
}

function consoleWrite(chunk) {
  const out = $('#console-output');
  let text = consoleCarry + chunk;
  consoleCarry = '';
  // 暂存结尾未完成的 ANSI 转义序列（ESC 开头、尚未遇到结束字母）
  const esc = text.match(/\x1b\[?[0-9;?]*$/);
  if (esc && esc[0]) { consoleCarry = esc[0]; text = text.slice(0, text.length - esc[0].length); }
  // 去除 ANSI 颜色 / 控制序列
  text = stripAnsi(text);
  // 暂存结尾单独的 CR（可能是被分片切断的 CRLF），避免误清行
  if (text.endsWith('\r')) { consoleCarry = '\r' + consoleCarry; text = text.slice(0, -1); }
  // 关键修复：PTY 输出以 CRLF 结尾，将 \r\n 归一为 \n，防止行内容被 \r 清空而“消失”
  text = text.replace(/\r\n/g, '\n');
  for (const ch of text) {
    if (ch === '\n') {
      out.appendChild(document.createTextNode('\n'));
      lastLineNode = document.createElement('span');
      out.appendChild(lastLineNode);
    } else if (ch === '\r') {
      currentLine(out).textContent = ''; // 独立 CR：回到行首覆盖（进度条场景）
    } else {
      currentLine(out).textContent += ch;
    }
  }
  trimConsole(out);
  out.scrollTop = out.scrollHeight;
}

// 命令结束时刷新残留的暂存内容（未完成的转义 / 尾部 CR）
function consoleFlush() {
  if (!consoleCarry) return;
  const out = $('#console-output');
  const rest = stripAnsi(consoleCarry).replace(/[\r\n]+$/, '');
  consoleCarry = '';
  for (const ch of rest) currentLine(out).textContent += ch;
  out.scrollTop = out.scrollHeight;
}

// 限制控制台最大长度，超长输出时丢弃最早内容，避免卡顿
function trimConsole(out) {
  const MAX = 400000;
  if (out.textContent.length > MAX) {
    while (out.textContent.length > MAX * 0.8 && out.firstChild) out.removeChild(out.firstChild);
    lastLineNode = null;
  }
}

function consoleAppend(text, cls) {
  const out = $('#console-output');
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  out.appendChild(span);
  lastLineNode = null;
  out.scrollTop = out.scrollHeight;
}

function setRunning(running, taskName) {
  $('#console-spinner').classList.toggle('hidden', !running);
  $('#btn-kill').classList.toggle('hidden', !running);
  $('#console-task').textContent = running ? `· ${taskName || '执行中'}` : '';
}

function openConsole() {
  $('#console').classList.remove('collapsed');
  $('#btn-toggle-console').textContent = '▼';
}

$('#console-head').addEventListener('click', (e) => {
  if (e.target.closest('button') && e.target.id !== 'btn-toggle-console') return;
  const c = $('#console');
  c.classList.toggle('collapsed');
  $('#btn-toggle-console').textContent = c.classList.contains('collapsed') ? '▲' : '▼';
});

$('#btn-clear').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#console-output').textContent = '';
  lastLineNode = null;
});

$('#btn-kill').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state.runningExec && state.ws) {
    state.ws.send(JSON.stringify({ type: 'kill', execId: state.runningExec }));
    consoleAppend('\n[已发送终止信号]\n', 'err');
  }
});

/* ---------- 执行操作 ---------- */
function runOp(opId, params, opName) {
  if (!state.currentHost) return toast('请先在左侧添加并选择主机', 'err');
  if (!state.wsReady) return toast('连接尚未就绪，请稍候重试', 'err');
  if (state.runningExec) return toast('有任务正在执行，请等待完成或先终止', 'err');
  const execId = 'e' + (++state.execSeq) + Date.now();
  state.runningExec = execId;
  setRunning(true, opName);
  openConsole();
  state.ws.send(JSON.stringify({ type: 'exec', hostId: state.currentHost, opId, params, execId }));
}

function runRaw(command) {
  if (!state.currentHost) return toast('请先在左侧添加并选择主机', 'err');
  if (!state.wsReady) return toast('连接尚未就绪，请稍候重试', 'err');
  if (state.runningExec) return toast('有任务正在执行，请等待完成或先终止', 'err');
  const execId = 'e' + (++state.execSeq) + Date.now();
  state.runningExec = execId;
  setRunning(true, '自定义命令');
  openConsole();
  state.ws.send(JSON.stringify({ type: 'raw', hostId: state.currentHost, command, execId }));
}

/* ---------- 导航 ---------- */
const NAV_ICONS = {
  dashboard: 'dashboard', hosts: 'server', appstore: 'store', ai: 'bot', maintain: 'tool', network: 'network', docker: 'container',
  firewall: 'shield', system: 'settings', inspect: 'activity', terminal: 'terminal',
};

function renderNav() {
  const nav = $('#nav');
  const items = [
    { id: 'dashboard', name: '系统概览' },
    { id: 'hosts', name: '主机管理' },
    { id: 'appstore', name: '应用商店' },
    { id: 'ai', name: 'AI 运维助手' },
    { sep: '运维操作' },
    ...state.catalog.categories,
    { sep: '高级' },
    { id: 'terminal', name: '交互式终端' },
  ];
  nav.innerHTML = items.map((it) => it.sep
    ? `<div class="nav-sep">${esc(it.sep)}</div>`
    : `<button type="button" class="nav-item" data-view="${it.id}"><span class="nav-icon">${icon(NAV_ICONS[it.id] || 'chevron')}</span><span>${esc(it.name)}</span><span class="nav-arrow">${icon('chevron')}</span></button>`
  ).join('');
  nav.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', () => { switchView(el.dataset.view); closeSidebar(); });
  });
}

/* ---------- 移动端侧栏 ---------- */
function openSidebar() {
  $('#sidebar').classList.add('open');
  $('#sidebar-backdrop').classList.add('show');
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-backdrop').classList.remove('show');
}
document.addEventListener('DOMContentLoaded', () => {});
$('#btn-menu').addEventListener('click', openSidebar);
$('#sidebar-backdrop').addEventListener('click', closeSidebar);
$('#btn-mobile-console').addEventListener('click', () => {
  const c = $('#console');
  c.classList.toggle('collapsed');
  $('#btn-toggle-console').textContent = c.classList.contains('collapsed') ? '▲' : '▼';
});

function switchView(view) {
  const previousView = state.view;
  if (previousView === 'terminal' && view !== 'terminal') closeTerminalSession();
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  clearInterval(state.sysinfoTimer);
  if (view === 'dashboard') renderDashboard();
  else if (view === 'hosts') renderHosts();
  else if (view === 'appstore') renderAppStore();
  else if (view === 'ai') renderAI();
  else if (view === 'terminal') renderTerminal();
  else renderCategory(view);
}

/* ---------- 主机管理 ---------- */
async function refreshHosts() {
  const data = await api('/api/hosts');
  state.hosts = data.hosts || [];
  const sel = $('#host-select');
  sel.innerHTML = state.hosts.length
    ? state.hosts.map((h) => `<option value="${h.id}">${esc(h.name)} (${esc(h.host)})</option>`).join('')
    : '<option value="">— 请先添加主机 —</option>';
  if (!state.hosts.find((h) => h.id === state.currentHost)) {
    state.currentHost = state.hosts[0] ? state.hosts[0].id : '';
  }
  sel.value = state.currentHost;
}

$('#host-select').addEventListener('change', (e) => {
  state.currentHost = e.target.value;
  $('#host-status').textContent = '';
  $('#host-status').className = 'host-status';
  if (state.view === 'dashboard') renderDashboard();
  else if (state.view === 'appstore') renderAppStore();
  else if (state.view === 'terminal') renderTerminal();
});

function hostFormHTML(h = {}) {
  return `
    <div class="field"><label>备注名称</label><input id="hf-name" value="${esc(h.name || '')}" placeholder="例如 生产服务器-01"></div>
    <div class="row">
      <div class="field" style="flex:2"><label>主机地址 *</label><input id="hf-host" value="${esc(h.host || '')}" placeholder="IP 或域名"></div>
      <div class="field"><label>SSH 端口</label><input id="hf-port" value="${esc(h.port || 22)}"></div>
    </div>
    <div class="field"><label>用户名 *（建议 root）</label><input id="hf-user" value="${esc(h.username || 'root')}"></div>
    <div class="field"><label>认证方式</label>
      <select id="hf-authtype">
        <option value="password" ${h.authType !== 'key' ? 'selected' : ''}>密码认证</option>
        <option value="key" ${h.authType === 'key' ? 'selected' : ''}>密钥认证</option>
      </select>
    </div>
    <div class="field" id="hf-pass-wrap"><label>密码 ${h.id ? '（留空则不修改）' : '*'}</label><input type="password" id="hf-pass" placeholder="SSH 登录密码"></div>
    <div class="field hidden" id="hf-key-wrap">
      <label>私钥内容 ${h.id ? '（留空则不修改）' : '*'}</label>
      <textarea id="hf-key" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
      <label style="margin-top:8px">私钥口令（可选）</label><input type="password" id="hf-passphrase">
    </div>
    <div class="modal-actions">
      <button class="btn" id="hf-cancel">取消</button>
      <button class="btn btn-primary" id="hf-save">${h.id ? '保存修改' : '添加主机'}</button>
    </div>`;
}

function bindAuthTypeToggle() {
  const sel = $('#hf-authtype');
  const upd = () => {
    $('#hf-pass-wrap').classList.toggle('hidden', sel.value === 'key');
    $('#hf-key-wrap').classList.toggle('hidden', sel.value !== 'key');
  };
  sel.addEventListener('change', upd);
  upd();
}

function showHostModal(existing) {
  showModal(existing ? '编辑主机' : '添加主机', hostFormHTML(existing || {}));
  bindAuthTypeToggle();
  $('#hf-cancel').addEventListener('click', hideModal);
  $('#hf-save').addEventListener('click', async () => {
    const payload = {
      name: $('#hf-name').value.trim(),
      host: $('#hf-host').value.trim(),
      port: $('#hf-port').value.trim(),
      username: $('#hf-user').value.trim(),
      authType: $('#hf-authtype').value,
      password: $('#hf-pass').value,
      privateKey: $('#hf-key').value,
      passphrase: $('#hf-passphrase').value,
    };
    if (!payload.host || !payload.username) return toast('主机地址和用户名必填', 'err');
    if (!existing && payload.authType === 'password' && !payload.password) return toast('请填写密码', 'err');
    if (!existing && payload.authType === 'key' && !payload.privateKey) return toast('请填写私钥', 'err');
    const data = existing
      ? await api('/api/hosts/' + existing.id, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/api/hosts', { method: 'POST', body: JSON.stringify(payload) });
    if (!data.ok) return toast(data.error || '保存失败', 'err');
    hideModal();
    toast(existing ? '主机已更新' : '主机已添加', 'ok');
    await refreshHosts();
    if (!existing && data.host) {
      state.currentHost = data.host.id;
      $('#host-select').value = data.host.id;
    }
    if (state.view === 'hosts') renderHosts();
  });
}

async function testHost(id, dotEl, statusEl) {
  if (dotEl) dotEl.className = 'dot';
  if (statusEl) { statusEl.textContent = '正在测试连接...'; statusEl.className = 'host-status'; }
  const data = await api('/api/hosts/' + id + '/test', { method: 'POST' });
  if (data.ok) {
    if (dotEl) dotEl.className = 'dot ok';
    if (statusEl) { statusEl.textContent = '✔ 连接正常'; statusEl.className = 'host-status ok'; }
    toast('SSH 连接测试成功', 'ok');
  } else {
    if (dotEl) dotEl.className = 'dot bad';
    if (statusEl) { statusEl.textContent = '✘ ' + (data.error || '连接失败'); statusEl.className = 'host-status bad'; }
    toast('连接失败: ' + (data.error || '未知错误'), 'err');
  }
  return data.ok;
}

function renderHosts() {
  const c = $('#content');
  const rows = state.hosts.map((h) => `
    <div class="host-row" data-id="${h.id}">
      <div class="host-card-head">
        <span class="host-icon">${icon('server')}</span>
        <div class="host-meta">
          <div class="name">${esc(h.name)}</div>
          <div class="addr">${esc(h.username)}@${esc(h.host)}</div>
        </div>
        <span class="host-runtime"><i class="dot"></i>待检测</span>
      </div>
      <div class="host-specs">
        <div><span>SSH 端口</span><strong>${h.port}</strong></div>
        <div><span>认证方式</span><strong>${h.authType === 'key' ? '密钥认证' : '密码认证'}</strong></div>
        <div><span>资产角色</span><strong>Linux 节点</strong></div>
        <div><span>连接策略</span><strong>服务端加密</strong></div>
      </div>
      <div class="btns">
        <button class="btn btn-sm" data-act="test">测试连接</button>
        <button class="btn btn-sm" data-act="edit">编辑</button>
        <button class="btn btn-sm btn-danger" data-act="del">删除</button>
      </div>
    </div>`).join('');
  c.innerHTML = `
    <div class="page-head">
      <div><span class="page-eyebrow">INFRASTRUCTURE</span><h1 class="page-title">主机资产</h1><p class="page-desc">统一维护 SSH 连接、认证方式与资产可用性，凭据在服务端加密保存。</p></div>
      <button class="btn btn-primary" id="btn-add-host">${icon('plus')}添加主机</button>
    </div>
    <div class="section-summary"><span><b>${state.hosts.length}</b> 台已纳管主机</span><span>认证信息 AES-256-GCM 加密</span><span>操作全程审计留痕</span><span>卡片视图</span></div>
    <div class="host-list">${rows || `<div class="empty"><div class="empty-icon">${icon('server')}</div><h2>尚未纳管主机</h2><p>添加第一台 Linux 主机，开始统一监控与运维。</p></div>`}</div>`;
  $('#btn-add-host').addEventListener('click', () => showHostModal(null));
  c.querySelectorAll('.host-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-act=test]').addEventListener('click', async () => {
      const ok = await testHost(id, row.querySelector('.dot'));
      const runtime = row.querySelector('.host-runtime');
      runtime.innerHTML = `<i class="dot ${ok ? 'ok' : 'bad'}"></i>${ok ? '运行中' : '连接异常'}`;
    });
    row.querySelector('[data-act=edit]').addEventListener('click', () => showHostModal(state.hosts.find((h) => h.id === id)));
    row.querySelector('[data-act=del]').addEventListener('click', () => {
      const h = state.hosts.find((x) => x.id === id);
      confirmDanger(`确认删除主机 <b>${esc(h.name)}</b> (${esc(h.host)}) 吗？此操作只删除面板中的连接信息，不影响远程主机本身。`, async () => {
        const data = await api('/api/hosts/' + id, { method: 'DELETE' });
        if (data.ok) { toast('已删除', 'ok'); await refreshHosts(); renderHosts(); }
        else toast(data.error || '删除失败', 'err');
      });
    });
  });
}

/* ---------- 系统概览 ---------- */
function meterClass(pct) {
  return pct >= 90 ? 'meter crit' : pct >= 70 ? 'meter warn' : 'meter';
}

async function renderDashboard() {
  const c = $('#content');
  if (!state.currentHost) {
    c.innerHTML = `
      <div class="page-head"><div><span class="page-eyebrow">COMMAND CENTER</span><h1 class="page-title">系统概览</h1><p class="page-desc">远程主机健康、容量与运行状态的统一视图。</p></div></div>
      <div class="empty"><div class="empty-icon">${icon('server')}</div><h2>还没有主机连接</h2><p>请先纳管一台服务器，再查看实时运行指标。</p>
      <button class="btn btn-primary" id="go-hosts">${icon('plus')}添加第一台主机</button></div>`;
    $('#go-hosts').addEventListener('click', () => switchView('hosts'));
    return;
  }
  c.innerHTML = `
    <div class="page-head">
      <div><span class="page-eyebrow">COMMAND CENTER</span><h1 class="page-title">系统概览</h1><p class="page-desc">${esc(currentHostName())} · 每 15 秒自动采集运行指标</p></div>
      <button class="btn" id="btn-refresh-info">${icon('refresh')}立即刷新</button>
    </div>
    <div id="dash-body"><div class="dashboard-skeleton" aria-label="正在采集主机信息"><span></span><span></span><span></span><span></span></div></div>`;
  $('#btn-refresh-info').addEventListener('click', loadSysinfo);
  await loadSysinfo();
  state.sysinfoTimer = setInterval(loadSysinfo, 15000);
}

async function loadSysinfo() {
  if (!state.currentHost || state.view !== 'dashboard') return;
  const body = $('#dash-body');
  if (!body) return;
  try {
    const data = await api('/api/hosts/' + state.currentHost + '/sysinfo');
    if (!data.ok) throw new Error(data.error || '采集失败');
    const i = data.info;
    const [memUsed, memTotal] = [(i.MEM || '0|0').split('|')[0], (i.MEM || '0|0').split('|')[1]];
    const [swapUsed, swapTotal] = [(i.SWAP || '0|0').split('|')[0], (i.SWAP || '0|0').split('|')[1]];
    const diskParts = (i.DISK || '0|0|0%').split('|');
    const cpuPct = parseInt(i.CPU_USAGE || '0', 10);
    const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
    const diskPct = parseInt((diskParts[2] || '0').replace('%', ''), 10);
    const dockerCount = parseInt(i.DOCKER || '-1', 10);
    body.innerHTML = `
      <section class="resource-callout">
        <div class="resource-copy"><span class="resource-icon">${icon('server')}</span><div><h2>计算资源</h2><p>集中管理服务器、实时容量与标准化运维任务。</p></div></div>
        <div class="resource-actions"><button class="btn" id="go-managed-hosts">管理主机</button><button class="btn btn-primary" id="go-automation">执行任务</button></div>
      </section>
      <div class="health-strip"><span><i class="status-dot"></i><b>主机在线</b></span><span>最近更新 ${esc(i.TIME || '刚刚')}</span><span>自动刷新 15s</span></div>
      <div class="dash-grid">
        <div class="stat-card">
          <div class="stat-label"><span>CPU 使用率</span><span class="metric-meta">${i.CPU_CORES || '?'} 核</span></div>
          <div class="stat-value">${cpuPct}%</div>
          <div class="${meterClass(cpuPct)}"><i style="width:${Math.min(cpuPct, 100)}%"></i></div>
        </div>
        <div class="stat-card">
          <div class="stat-label"><span>内存使用率</span><span class="metric-meta">${memUsed} / ${memTotal} MB</span></div>
          <div class="stat-value">${memPct}%</div>
          <div class="${meterClass(memPct)}"><i style="width:${Math.min(memPct, 100)}%"></i></div>
        </div>
        <div class="stat-card">
          <div class="stat-label"><span>系统盘使用率</span><span class="metric-meta">${(diskParts[0] / 1024).toFixed(1)} / ${(diskParts[1] / 1024).toFixed(1)} GB</span></div>
          <div class="stat-value">${diskPct}%</div>
          <div class="${meterClass(diskPct)}"><i style="width:${Math.min(diskPct, 100)}%"></i></div>
        </div>
        <div class="stat-card">
          <div class="stat-label"><span>系统负载</span><span class="metric-meta">1 / 5 / 15 分钟</span></div>
          <div class="stat-value sm" style="font-size:17px">${esc(i.LOAD || '-')}</div>
          <div class="stat-label" style="margin-top:10px"><span>运行时间</span></div>
          <div class="stat-value sm">${esc(i.UPTIME || '-')}</div>
        </div>
      </div>
      <div class="panel-heading"><div><h2>资产与系统信息</h2><p>当前节点的基础设施指纹与运行环境</p></div><span class="panel-badge">LIVE</span></div>
      <div class="table-wrap"><table class="info-table">
        <tr><td>主机名</td><td>${esc(i.HOSTNAME || '-')}</td></tr>
        <tr><td>操作系统</td><td>${esc(i.OS || '-')} (${esc(i.ARCH || '-')})</td></tr>
        <tr><td>内核版本</td><td>${esc(i.KERNEL || '-')}</td></tr>
        <tr><td>CPU 型号</td><td>${esc(i.CPU_MODEL || '-')}</td></tr>
        <tr><td>公网 IP</td><td>${esc(i.IP_PUBLIC || '-')}　<span style="color:var(--text-dim)">内网:</span> ${esc(i.IP_LOCAL || '-')}</td></tr>
        <tr><td>TCP 拥塞控制</td><td>${esc(i.TCP_CC || '-')} / ${esc(i.QDISC || '-')} ${i.TCP_CC === 'bbr' ? '<span style="color:var(--green)">（BBR 已开启）</span>' : ''}</td></tr>
        <tr><td>虚拟内存 Swap</td><td>${swapUsed} / ${swapTotal} MB</td></tr>
        <tr><td>Docker 容器</td><td>${dockerCount < 0 ? '未安装 Docker' : '运行中 ' + dockerCount + ' 个'}</td></tr>
        <tr><td>系统时间</td><td>${esc(i.TIME || '-')}</td></tr>
      </table></div>`;
    $('#go-managed-hosts').addEventListener('click', () => switchView('hosts'));
    $('#go-automation').addEventListener('click', () => {
      const firstCategory = state.catalog.categories[0];
      switchView(firstCategory ? firstCategory.id : 'hosts');
    });
  } catch (err) {
    body.innerHTML = `<div class="empty empty-error"><div class="empty-icon">${icon('alert')}</div><h2>主机信息采集失败</h2><p>${esc(err.message)}</p>
      <button class="btn" id="retry-info">${icon('refresh')}重新采集</button></div>`;
    const r = $('#retry-info');
    if (r) r.addEventListener('click', loadSysinfo);
  }
}

/* ---------- AI 运维助手 ---------- */
const AI_QUICK_PROMPTS = [
  '查看当前主机的运行状态',
  '列出运行中的服务和容器',
  '看看磁盘空间够不够',
  '在 GitHub 上找最新的自托管面板并帮我部署',
];

async function renderAI() {
  const c = $('#content');
  if (!state.aiStatus) {
    state.aiStatus = await api('/api/ai/status').catch(() => null);
  }
  const st = state.aiStatus || { configured: false, toolCount: 14 };
  const banner = st.configured
    ? `<div class="ai-status ok"><i class="status-dot"></i>已连接模型 <code>${esc(st.model)}</code> · ${st.toolCount} 个运维工具可用 · 当前主机：${esc(currentHostName())}</div>`
    : `<div class="ai-status warn">${icon('alert')}AI 助手尚未配置模型密钥。在面板服务器上设置环境变量 <code>AI_API_KEY</code>（可选 <code>AI_BASE_URL</code> / <code>AI_MODEL</code>）并重启后即可使用。外部 MCP 客户端接入方式见项目 README。</div>`;

  c.innerHTML = `
    <div class="page-head">
      <div><span class="page-eyebrow">AI OPS ASSISTANT</span><h1 class="page-title title-with-icon">${icon('bot')}AI 运维助手</h1><p class="page-desc">用自然语言描述需求，助手会自动选择运维工具（MCP）在目标主机上执行查询与部署。</p></div>
      <button class="btn" id="btn-ai-clear">清空对话</button>
    </div>
    ${banner}
    <div class="ai-chat" id="ai-chat">
      <div class="ai-welcome">
        <div class="empty-icon">${icon('bot')}</div>
        <h2>你好，我是 AI 运维助手</h2>
        <p>可以直接让我：查看主机状态 / 重启某个服务 / 排查容器日志 / 一键部署应用商店的应用。</p>
        <div class="ai-chips">
          ${AI_QUICK_PROMPTS.map((p) => `<button type="button" class="chip" data-prompt="${esc(p)}">${esc(p)}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="ai-inputbar">
      <textarea id="ai-input" rows="1" placeholder="描述你的运维需求，例如：帮我看看 nginx 的状态，不对劲就重启它" aria-label="输入运维需求"></textarea>
      <button class="btn btn-primary" id="btn-ai-send" aria-label="发送">${icon('send')}发送</button>
    </div>`;

  $('#btn-ai-clear').addEventListener('click', () => {
    state.aiHistory = [];
    renderAI();
  });
  $('#btn-ai-send').addEventListener('click', sendAIMessage);
  const input = $('#ai-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIMessage(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  });
  c.querySelectorAll('[data-prompt]').forEach((chip) => {
    chip.addEventListener('click', () => {
      input.value = chip.dataset.prompt;
      sendAIMessage();
    });
  });
}

function aiScrollBottom() {
  const chat = $('#ai-chat');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

function aiUserBubble(text) {
  const chat = $('#ai-chat');
  const welcome = chat.querySelector('.ai-welcome');
  if (welcome) welcome.remove();
  const el = document.createElement('div');
  el.className = 'ai-msg user';
  el.innerHTML = `<div class="ai-bubble">${esc(text)}</div>`;
  chat.appendChild(el);
  aiScrollBottom();
}

function aiAssistantBubble() {
  const chat = $('#ai-chat');
  const el = document.createElement('div');
  el.className = 'ai-msg bot';
  el.innerHTML = `<div class="ai-bubble"><span class="spinner"></span> 正在思考并调用工具…</div>`;
  chat.appendChild(el);
  aiScrollBottom();
  return el;
}

function aiToolStepHTML(step) {
  const args = JSON.stringify(step.args || {});
  return `
    <details class="ai-tool ${step.ok ? '' : 'err'}">
      <summary>
        <span class="ai-tool-badge">${esc(step.tool)}</span>
        <span class="ai-tool-args">${esc(args)}</span>
        <span class="ai-tool-state">${step.ok ? '✔' : '✘'}</span>
      </summary>
      <pre>${esc(step.output || '')}</pre>
    </details>`;
}

function aiRenderAnswer(el, reply, steps) {
  const toolHTML = (steps && steps.length)
    ? `<div class="ai-tools">${steps.map(aiToolStepHTML).join('')}</div>` : '';
  el.innerHTML = `<div class="ai-bot-head">${icon('bot')} Haizhu 助手</div>${toolHTML}<div class="ai-bubble">${esc(reply).replace(/\n/g, '<br>')}</div>`;
  aiScrollBottom();
}

function aiRenderError(el, message) {
  el.innerHTML = `<div class="ai-bot-head">${icon('bot')} Haizhu 助手</div><div class="ai-bubble ai-err">${esc(message)}</div>`;
  aiScrollBottom();
}

async function sendAIMessage() {
  const input = $('#ai-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || state.aiBusy) return;
  input.value = '';
  input.style.height = 'auto';
  aiUserBubble(text);
  state.aiHistory.push({ role: 'user', content: text });
  state.aiBusy = true;
  const btn = $('#btn-ai-send');
  if (btn) btn.disabled = true;
  const el = aiAssistantBubble();
  try {
    const data = await api('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message: text, history: state.aiHistory.slice(0, -1) }),
    });
    if (!data.ok) throw new Error(data.error || 'AI 助手请求失败');
    aiRenderAnswer(el, data.reply, data.steps);
    state.aiHistory.push({ role: 'assistant', content: data.reply });
    if (state.aiHistory.length > 20) state.aiHistory = state.aiHistory.slice(-20);
  } catch (e) {
    aiRenderError(el, e.message);
  } finally {
    state.aiBusy = false;
    if (btn) btn.disabled = false;
    if (input) input.focus();
  }
}

/* ---------- 分类操作页 ---------- */
function renderCategory(catId) {
  const c = $('#content');
  const cat = state.catalog.categories.find((x) => x.id === catId);
  const opsList = state.catalog.ops.filter((o) => o.category === catId);
  c.innerHTML = `
    <div class="page-head"><div><span class="page-eyebrow">AUTOMATION CATALOG</span><h1 class="page-title title-with-icon">${icon(NAV_ICONS[catId] || 'tool')} ${esc(cat ? cat.name : catId)}</h1><p class="page-desc">在当前主机执行标准化运维任务；高风险操作需要二次确认，过程输出实时写入控制台。</p></div><span class="page-counter">${opsList.length} 个任务</span></div>
    <div class="grid">${opsList.map(opCardHTML).join('')}</div>`;
  c.querySelectorAll('.op-card').forEach((card) => {
    const opId = card.dataset.op;
    const op = state.catalog.ops.find((o) => o.id === opId);
    card.querySelector('.op-run').addEventListener('click', () => {
      const params = {};
      let valid = true;
      (op.params || []).forEach((p) => {
        const el = card.querySelector(`[data-param="${p.key}"]`);
        params[p.key] = el ? el.value.trim() : '';
        if (p.required && !params[p.key]) {
          toast(`请填写「${p.label}」`, 'err');
          if (el) el.focus();
          valid = false;
        }
      });
      if (!valid) return;
      if (op.danger) {
        confirmDanger(
          `确认在主机 <b>${esc(currentHostName())}</b> 上执行高危操作 <b>${esc(op.name)}</b> 吗？<br><span style="color:var(--text-dim)">${esc(op.desc)}</span>`,
          () => runOp(op.id, params, op.name)
        );
      } else {
        runOp(op.id, params, op.name);
      }
    });
  });
}

function opCardHTML(op) {
  const paramsHTML = (op.params || []).map((p) => {
    if (p.type === 'select') {
      return `<select data-param="${p.key}">${p.options.map((o) =>
        `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`;
    }
    return `<input type="${p.type === 'password' ? 'password' : 'text'}" data-param="${p.key}" placeholder="${esc(p.label)}${p.placeholder ? ' · ' + p.placeholder : ''}">`;
  }).join('');
  return `
    <div class="op-card ${op.danger ? 'danger' : ''}" data-op="${op.id}">
      <div class="op-head">
        <span class="op-name">${esc(op.name)}</span>
        ${op.danger ? '<span class="tag tag-danger">高危</span>' : ''}
      </div>
      <div class="op-desc">${esc(op.desc)}</div>
      ${paramsHTML ? `<div class="op-params">${paramsHTML}</div>` : ''}
      <button class="btn ${op.danger ? 'btn-danger' : 'btn-primary'} op-run">${icon('play')}执行任务</button>
    </div>`;
}

function currentHostName() {
  const h = state.hosts.find((x) => x.id === state.currentHost);
  return h ? `${h.name} (${h.host})` : '未选择';
}

/* ---------- 应用商店 ---------- */
function currentHostObj() {
  return state.hosts.find((x) => x.id === state.currentHost) || null;
}

async function renderAppStore() {
  const c = $('#content');
  if (!state.appCatalog) {
    c.innerHTML = '<div class="empty">应用目录加载失败</div>';
    return;
  }
  if (!state.currentHost) {
    c.innerHTML = `
      <div class="page-head"><div><span class="page-eyebrow">APPLICATION PLATFORM</span><h1 class="page-title title-with-icon">${icon('store')}应用市场</h1><p class="page-desc">面向自托管与 AI 工作负载的一键部署目录。</p></div></div>
      <div class="empty"><div class="empty-icon">${icon('server')}</div><h2>需要先选择部署目标</h2><p>纳管并选择一台主机后，即可开始部署应用。</p>
      <button class="btn btn-primary" id="go-hosts2">${icon('plus')}添加主机</button></div>`;
    $('#go-hosts2').addEventListener('click', () => switchView('hosts'));
    return;
  }
  c.innerHTML = `
    <div class="page-head"><div><span class="page-eyebrow">APPLICATION PLATFORM</span><h1 class="page-title title-with-icon">${icon('store')}应用市场</h1><p class="page-desc">在 ${esc(currentHostName())} 部署经过整理的自托管服务与 AI 应用。</p></div><button class="btn" id="btn-refresh-apps">${icon('refresh')}刷新状态</button></div>
    <div class="section-summary"><span><b>${state.appCatalog.apps.length}</b> 款应用</span><span>Docker / Compose 自动编排</span><span>交互式部署向导</span></div>
    <div class="app-toolbar">
      <div class="search-field">${icon('search')}<input id="app-search" aria-label="搜索应用" placeholder="搜索名称或功能，例如：面板、监控、Gitea"></div>
      <div class="app-cat-chips" id="app-cat-chips">
        <span class="chip active" data-cat="">全部</span>
        ${state.appCatalog.categories.map((cat) => {
          const n = state.appCatalog.apps.filter((a) => a.category === cat.id).length;
          return n ? `<span class="chip" data-cat="${cat.id}">${esc(cat.name)} ${n}</span>` : '';
        }).join('')}
      </div>
    </div>
    <div id="appstore-body"></div>`;
  $('#btn-refresh-apps').addEventListener('click', () => loadAppStatus(true));
  const search = $('#app-search');
  search.addEventListener('input', () => renderAppSections(search.value.trim(), state.appFilterCat || ''));
  $('#app-cat-chips').querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $('#app-cat-chips').querySelectorAll('.chip').forEach((c2) => c2.classList.remove('active'));
      chip.classList.add('active');
      state.appFilterCat = chip.dataset.cat;
      renderAppSections(search.value.trim(), chip.dataset.cat);
    });
  });
  state.appFilterCat = '';
  renderAppSections('', '');
  loadAppStatus(false);
}

function renderAppSections(keyword, catId) {
  const kw = (keyword || '').toLowerCase();
  const cats = state.appCatalog.categories.filter((c) => !catId || c.id === catId);
  const sections = cats.map((cat) => {
    let list = state.appCatalog.apps.filter((a) => a.category === cat.id);
    if (kw) list = list.filter((a) => (a.name + ' ' + a.desc + ' ' + a.id).toLowerCase().includes(kw));
    if (!list.length) return '';
    return `<div class="app-sec-title">${esc(cat.name)} <span class="app-sec-count">${list.length}</span></div>
      <div class="grid">${list.map(appCardHTML).join('')}</div>`;
  }).join('');
  $('#appstore-body').innerHTML = sections || `<div class="empty"><div class="empty-icon">${icon('search')}</div><h2>没有匹配的应用</h2><p>尝试更换关键词或清除分类筛选。</p></div>`;
  bindAppCards();
  refreshAppBadges();
}

function appCardHTML(a) {
  const badges = [];
  if (a.kind === 'docker') badges.push('<span class="tag tag-docker">Docker</span>');
  if (a.kind === 'compose') badges.push('<span class="tag tag-compose">Compose</span>');
  if (a.id === 'haizhugrok') badges.push('<span class="tag tag-compose">Compose Stack</span>');
  if (a.interactive) badges.push('<span class="tag tag-wizard">向导</span>');
  if (a.danger) badges.push('<span class="tag tag-danger">高危</span>');
  return `
    <div class="op-card app-card ${a.danger ? 'danger' : ''}" data-app="${a.id}">
      <div class="op-head">
        <span class="op-name">${esc(a.name)}</span>
        <span class="app-badges">${badges.join('')}</span>
      </div>
      <div class="op-desc">${esc(a.desc)}</div>
      <div class="app-foot">
        <span class="app-status" data-status>—</span>
        <span class="app-btns">
          ${a.port ? `<button class="btn btn-sm app-visit hidden" data-act="visit">🔗 访问 :${a.port}</button>` : ''}
          ${a.canUninstall ? `<button class="btn btn-sm btn-danger app-uninstall hidden" data-act="uninstall">卸载</button>` : ''}
          <button class="btn btn-sm ${a.danger ? 'btn-danger' : 'btn-primary'} app-install" data-act="install">${a.id === 'haizhugrok' ? '一键部署' : (a.kind === 'form' ? '配置并执行' : '安装')}</button>
        </span>
      </div>
    </div>`;
}

function bindAppCards() {
  document.querySelectorAll('.app-card').forEach((card) => {
    const app = state.appCatalog.apps.find((a) => a.id === card.dataset.app);
    const iBtn = card.querySelector('[data-act=install]');
    if (iBtn) iBtn.addEventListener('click', () => installApp(app));
    const uBtn = card.querySelector('[data-act=uninstall]');
    if (uBtn) uBtn.addEventListener('click', () => uninstallApp(app));
    const vBtn = card.querySelector('[data-act=visit]');
    if (vBtn) vBtn.addEventListener('click', () => {
      const h = currentHostObj();
      if (h) window.open(`http://${h.host}:${app.port}`, '_blank');
    });
  });
}

async function loadAppStatus(showToast) {
  if (!state.currentHost || state.view !== 'appstore') return;
  try {
    const data = await api('/api/hosts/' + state.currentHost + '/apps/status');
    state.installedApps = data.ok ? (data.installed || []) : [];
    if (showToast) toast('已刷新安装状态', 'ok');
  } catch (_) {
    state.installedApps = [];
  }
  refreshAppBadges();
}

function refreshAppBadges() {
  const set = new Set(state.installedApps);
  document.querySelectorAll('.app-card').forEach((card) => {
    const app = state.appCatalog.apps.find((a) => a.id === card.dataset.app);
    if (!app) return;
    const installed = app.statusKey && set.has(app.statusKey);
    const statusEl = card.querySelector('[data-status]');
    const visitBtn = card.querySelector('[data-act=visit]');
    const uninstBtn = card.querySelector('[data-act=uninstall]');
    const instBtn = card.querySelector('[data-act=install]');
    if (installed) {
      statusEl.innerHTML = '<span class="dot ok"></span> 已安装';
      if (visitBtn) visitBtn.classList.remove('hidden');
      if (uninstBtn) uninstBtn.classList.remove('hidden');
      if (instBtn) instBtn.textContent = '重新安装';
    } else {
      statusEl.innerHTML = app.statusKey ? '<span class="dot"></span> 未安装' : '';
      if (visitBtn) visitBtn.classList.add('hidden');
      if (uninstBtn) uninstBtn.classList.add('hidden');
      if (instBtn) instBtn.textContent = app.id === 'haizhugrok' ? '一键部署' : (app.kind === 'form' ? '配置并执行' : '安装');
    }
  });
}

async function fetchAppCommand(appId, action, params) {
  const data = await api(`/api/apps/${appId}/command`, {
    method: 'POST',
    body: JSON.stringify({ action, params: params || {} }),
  });
  if (!data.ok) throw new Error(data.error || '命令构建失败');
  return data.command;
}

function runAppCommand(app, command) {
  if (app.interactive) {
    // 交互式：路由到终端，由用户应答安装向导
    state.pendingShellCmd = command;
    switchView('terminal');
    toast('已在终端启动安装向导，请按提示操作', 'ok');
  } else {
    // 非交互：在底部控制台执行
    runRaw(command);
    toast('已开始执行，输出见底部控制台', 'ok');
  }
}

function installApp(app) {
  if (!state.currentHost) return toast('请先选择主机', 'err');
  // 表单类应用：先弹窗收集参数
  if (app.kind === 'form') {
    showAppForm(app);
    return;
  }
  const proceed = async () => {
    try {
      const cmd = await fetchAppCommand(app.id, 'install');
      runAppCommand(app, cmd);
    } catch (e) { toast(e.message, 'err'); }
  };
  if (app.danger) {
    confirmDanger(`确认在主机 <b>${esc(currentHostName())}</b> 安装 <b>${esc(app.name)}</b> 吗？<br><span style="color:var(--text-dim)">${esc(app.desc)}</span>`, proceed);
  } else {
    proceed();
  }
}

function uninstallApp(app) {
  if (app.id === 'haizhugrok') {
    confirmDanger(
      `确认从主机 <b>${esc(currentHostName())}</b> 卸载 <b>${esc(app.name)}</b> 吗？<br><b>将同时删除 PostgreSQL、Redis 与 <code>/home/docker/haizhugrok</code> 中的全部持久化数据。</b>`,
      async () => {
        try {
          const cmd = await fetchAppCommand(app.id, 'uninstall');
          runAppCommand({ ...app, interactive: false }, cmd);
        } catch (e) { toast(e.message, 'err'); }
      }
    );
    return;
  }
  confirmDanger(
    `确认从主机 <b>${esc(currentHostName())}</b> 卸载 <b>${esc(app.name)}</b> 吗？${app.kind === 'docker' ? '<br>将删除容器及其 <code>/home/docker/' + esc(app.id) + '</code> 数据目录。' : ''}`,
    async () => {
      try {
        const cmd = await fetchAppCommand(app.id, 'uninstall');
        runAppCommand({ ...app, interactive: false }, cmd);
      } catch (e) { toast(e.message, 'err'); }
    }
  );
}

/* 表单类应用（如 DD 重装）：弹窗收集参数 */
function showAppForm(app) {
  const fields = (app.params || []).map((p) => {
    if (p.type === 'select') {
      return `<div class="field"><label>${esc(p.label)}${p.required ? ' *' : ''}</label>
        <select data-ap="${p.key}">${p.options.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(p.defaultValue || '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
    }
    return `<div class="field"><label>${esc(p.label)}${p.required ? ' *' : ''}</label>
      <input type="${p.type === 'password' ? 'password' : 'text'}" data-ap="${p.key}" placeholder="${esc(p.placeholder || '')}" value="${esc(p.defaultValue || '')}"></div>`;
  }).join('');
  const warn = app.danger
    ? `<div class="confirm-danger">⚠ <b>${esc(app.name)}</b> 会${app.id === 'dd-reinstall' ? '<b>清空磁盘上的全部数据并重装操作系统</b>，此操作不可逆！请务必提前备份重要数据。重装过程中主机会重启、当前连接会断开，请在重装完成后使用新密码与新 SSH 端口重新连接。' : '执行高危操作。'}</div>`
    : '';
  showModal(app.name, `${warn}${fields}
    <div class="modal-actions">
      <button class="btn" id="af-cancel">取消</button>
      <button class="btn ${app.danger ? 'btn-danger' : 'btn-primary'}" id="af-run">确认执行</button>
    </div>`);
  $('#af-cancel').addEventListener('click', hideModal);
  $('#af-run').addEventListener('click', async () => {
    const params = {};
    let valid = true;
    (app.params || []).forEach((p) => {
      const el = document.querySelector(`[data-ap="${p.key}"]`);
      params[p.key] = el ? el.value.trim() : '';
      if (p.required && !params[p.key]) { toast(`请填写「${p.label}」`, 'err'); valid = false; }
    });
    if (!valid) return;
    try {
      const cmd = await fetchAppCommand(app.id, 'install', params);
      hideModal();
      runAppCommand(app, cmd);
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ---------- 交互式终端 ---------- */
function renderTerminal() {
  const c = $('#content');
  c.innerHTML = `
    <div class="page-head"><div><span class="page-eyebrow">SECURE SHELL</span><h1 class="page-title title-with-icon">${icon('terminal')}交互式终端</h1><p class="page-desc">直接在下方终端光标处输入命令，按 Enter 执行；支持 Tab 补全、方向键历史与 Ctrl+C。</p></div><span class="page-counter">加密通道</span></div>
    <div class="term-toolbar">
      <span class="term-status" id="term-status"><span class="status-dot"></span>正在连接终端...</span>
      <button class="btn" id="btn-term-reconnect">${icon('refresh')}重新连接</button>
    </div>
    <div class="term-wrap" id="term-wrap"><div id="terminal"></div></div>`;
  $('#btn-term-reconnect').addEventListener('click', () => requestTerminalSession(true));
  $('#term-wrap').addEventListener('click', () => { if (state.term) state.term.focus(); });
  openTerminal();
}

function closeTerminalSession() {
  if (state.wsReady && state.ws && state.ws.readyState === WebSocket.OPEN && (state.termOpen || state.termConnecting)) {
    state.ws.send(JSON.stringify({ type: 'shell-close' }));
  }
  state.termOpen = false;
  state.termConnecting = false;
  if (state.term) { try { state.term.dispose(); } catch (_) {} }
  state.term = null;
  state.termFit = null;
}

function setTerminalStatus(text, ready = false) {
  const el = $('#term-status');
  if (!el) return;
  el.classList.toggle('is-ready', ready);
  const textNode = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = text;
}

function requestTerminalSession(force = false) {
  if (!state.currentHost) { toast('请先添加并选择主机', 'err'); return; }
  if (!state.term || !state.wsReady || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
    setTerminalStatus('等待安全连接...');
    if (force) toast('连接尚未就绪，正在自动重连', 'err');
    return;
  }
  if (state.termConnecting && !force) return;
  state.termOpen = false;
  state.termConnecting = true;
  setTerminalStatus('正在连接终端...');
  state.term.write(force ? '\r\n\x1b[36m[正在重新连接终端...]\x1b[0m\r\n' : '\x1b[36m[正在建立 SSH 终端...]\x1b[0m\r\n');
  try {
    state.ws.send(JSON.stringify({ type: 'shell-open', hostId: state.currentHost, cols: state.term.cols, rows: state.term.rows }));
  } catch (_) {
    state.termConnecting = false;
    setTerminalStatus('终端连接失败，请重试');
  }
}

function openTerminal() {
  if (!state.currentHost) { toast('请先添加并选择主机', 'err'); return; }
  if (!window.Terminal) {
    $('#terminal').innerHTML = '<div style="color:var(--text-dim);padding:20px">终端组件(xterm.js)未能从 CDN 加载，请检查网络后刷新页面。</div>';
    return;
  }
  if (state.term) { try { state.term.dispose(); } catch (_) {} }
  const term = new Terminal({
    fontFamily: 'JetBrains Mono, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    theme: { background: '#050b14', foreground: '#dbe7f3', cursor: '#34d399', selectionBackground: '#1f6f5f80' },
  });
  const fit = new (window.FitAddon.FitAddon)();
  term.loadAddon(fit);
  term.open($('#terminal'));
  fit.fit();
  state.term = term;
  state.termFit = fit;
  state.termOpen = false;
  state.termConnecting = false;
  term.onData((data) => {
    if (!state.termOpen || !state.wsReady || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify({ type: 'shell-input', data }));
  });
  term.onResize(({ cols, rows }) => {
    if (state.termOpen && state.wsReady && state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'shell-resize', cols, rows }));
    }
  });
  const observer = new ResizeObserver(() => {
    if (!state.termFit || state.view !== 'terminal') return;
    try { state.termFit.fit(); } catch (_) {}
  });
  observer.observe($('#term-wrap'));
  term.onDispose(() => observer.disconnect());
  term.focus();
  requestTerminalSession();
}

/* ---------- 模态框 ---------- */
let modalReturnFocus = null;
function showModal(title, bodyHTML) {
  modalReturnFocus = document.activeElement;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  $('#modal').classList.remove('hidden');
  requestAnimationFrame(() => {
    const first = $('#modal').querySelector('input, select, textarea, button');
    if (first) first.focus();
  });
}
function hideModal() {
  $('#modal').classList.add('hidden');
  $('#modal-body').innerHTML = '';
  if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') modalReturnFocus.focus();
  modalReturnFocus = null;
}
$('#modal-close').addEventListener('click', hideModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') hideModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) hideModal();
});

function confirmDanger(html, onConfirm) {
  showModal('高风险操作确认', `
    <div class="confirm-danger">${html}</div>
    <div class="modal-actions">
      <button class="btn" id="cf-cancel">取消</button>
      <button class="btn btn-danger" id="cf-ok">确认执行</button>
    </div>`);
  $('#cf-cancel').addEventListener('click', hideModal);
  $('#cf-ok').addEventListener('click', () => { hideModal(); onConfirm(); });
}

/* ---------- 修改密码 ---------- */
$('#btn-change-pass').addEventListener('click', () => {
  showModal('修改管理员密码', `
    <div class="field"><label>原密码</label><input type="password" id="cp-old" placeholder="当前登录密码"></div>
    <div class="field"><label>新密码</label><input type="password" id="cp-new" placeholder="至少 6 位"></div>
    <div class="field"><label>确认新密码</label><input type="password" id="cp-new2" placeholder="再次输入新密码"></div>
    <div class="modal-actions">
      <button class="btn" id="cp-cancel">取消</button>
      <button class="btn btn-primary" id="cp-save">确认修改</button>
    </div>`);
  $('#cp-cancel').addEventListener('click', hideModal);
  $('#cp-save').addEventListener('click', async () => {
    const oldPassword = $('#cp-old').value;
    const newPassword = $('#cp-new').value;
    if (newPassword !== $('#cp-new2').value) return toast('两次输入的新密码不一致', 'err');
    const data = await api('/api/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    if (!data.ok) return toast(data.error || '修改失败', 'err');
    hideModal();
    state.mustChange = false;
    sessionStorage.setItem('haizhuopspanel_mustchange', '0');
    $('#banner-default-pass').classList.add('hidden');
    toast('密码修改成功', 'ok');
  });
});

/* ---------- 启动 ---------- */
(async function init() {
  if (state.token) {
    try {
      await enterApp();
      return;
    } catch (_) {
      state.token = '';
      sessionStorage.removeItem('haizhuopspanel_token');
    }
  }
  $('#login-view').classList.remove('hidden');
})();
