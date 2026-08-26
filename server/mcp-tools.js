/**
 * MCP 工具层 —— 面板运维能力的统一封装
 * - 同时供两种入口复用：
 *   1) server/mcp-server.js : 标准 MCP stdio 服务器（Claude Desktop / Cursor / WorkBuddy 等）
 *   2) server/ai.js         : 面板内置 AI 助手（OpenAI 兼容 function calling）
 * - 所有工具调用统一写审计日志（audit.js）
 * - run_command 默认关闭，需设置环境变量 MCP_ALLOW_RAW_COMMAND=1 显式开启
 */
const ssh = require('./sshManager');
const store = require('./store');
const ops = require('./ops');
const apps = require('./apps');
const audit = require('./audit');
const { execFile } = require('child_process');

const MAX_OUTPUT = 20000; // 单次工具输出上限（超出截断）
const DEPLOY_TIMEOUT = 10 * 60 * 1000; // 部署类操作 10 分钟超时
const QUERY_TIMEOUT = 60 * 1000;

/**
 * HTTPS GET JSON —— fetch 优先，失败时（典型场景：系统走代理而 Node fetch 未启用
 * NODE_USE_ENV_PROXY）用 curl 兜底。返回 { status, data }。
 */
function curlGetJson(url, headers, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const args = ['-sS', '-m', String(Math.ceil(timeoutMs / 1000)), '-w', '\n%{http_code}'];
    for (const [k, v] of Object.entries(headers || {})) args.push('-H', `${k}: ${v}`);
    args.push(url);
    execFile('curl', args, { windowsHide: true, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      const idx = stdout.lastIndexOf('\n');
      const status = parseInt(stdout.slice(idx + 1).trim(), 10);
      let data = null;
      try { data = JSON.parse(stdout.slice(0, idx)); } catch (_) { /* 非 JSON 响应 */ }
      resolve({ status, data });
    });
  });
}

async function httpGetJson(url, headers = {}) {
  try {
    const res = await fetch(url, { headers });
    const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : null;
    return { status: res.status, data };
  } catch (fetchErr) {
    // fetch 直连失败（代理环境等），尝试 curl（自动读取 HTTP(S)_PROXY 环境变量）
    try {
      return await curlGetJson(url, headers);
    } catch (_) {
      throw new Error(`网络请求失败（fetch: ${fetchErr.message}；curl 兜底也不可用）。若本机走代理，可设置环境变量 NODE_USE_ENV_PROXY=1 后重启面板/MCP 服务。`);
    }
  }
}

/** 单引号转义：任何输入都当作字面量，防止命令注入 */
function q(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "'\\''") + "'";
}

/** 输出截断 */
function clip(text, max = MAX_OUTPUT) {
  const s = String(text == null ? '' : text).trim();
  if (s.length <= max) return s || '（无输出）';
  return s.slice(0, max) + `\n...（输出过长，已截断，完整长度 ${s.length} 字符）`;
}

/** 通过 id / 名称 / 地址模糊定位主机 */
function resolveHost(ref) {
  if (!ref) throw new Error('缺少 hostId 参数（可先用 list_hosts 查询主机列表）');
  const hosts = store.listHosts();
  const r = String(ref).trim();
  let hit = hosts.find((h) => h.id === r)
    || hosts.find((h) => h.name === r)
    || hosts.find((h) => h.host === r);
  if (hit) return hit;
  const lower = hosts.find((h) => h.name.toLowerCase().includes(r.toLowerCase()) || h.host.includes(r));
  if (lower) return lower;
  throw new Error(`未找到主机: ${ref}（可先用 list_hosts 查询）`);
}

/** 在远程主机执行命令并收集输出 */
async function run(hostRef, command, timeoutMs = QUERY_TIMEOUT) {
  const host = resolveHost(hostRef);
  const { code, stdout, stderr } = await ssh.execCollect(host.id, command, timeoutMs);
  const out = (stdout + (stderr ? (stdout ? '\n' : '') + stderr : '')).trim();
  return { host, code, text: out };
}

// ============================================================
// 工具定义（schema 为 MCP inputSchema 格式，可直接被
// OpenAI function calling 复用：name/description/parameters）
// ============================================================

const TOOLS = [
  {
    name: 'list_hosts',
    description: '列出面板已纳管的全部远程主机（id、名称、地址、用户名）。后续工具调用都需要用 hostId 参数指定目标主机。',
    inputSchema: { type: 'object', properties: {}, required: [] },
    danger: false,
    async run() {
      const hosts = store.listHosts();
      if (!hosts.length) return '面板中还没有纳管任何主机，请先在 HaizhuOpsPanel 网页端「主机管理」添加主机。';
      return '已纳管主机列表：\n' + hosts.map((h, i) =>
        `${i + 1}. hostId=${h.id}  名称=${h.name}  地址=${h.username}@${h.host}:${h.port || 22}  认证=${h.authType === 'key' ? '密钥' : '密码'}`
      ).join('\n');
    },
  },

  {
    name: 'host_overview',
    description: '查看指定主机的系统概况：操作系统、CPU、内存、磁盘、负载、运行时长等运行指标。',
    inputSchema: {
      type: 'object',
      properties: { hostId: { type: 'string', description: '主机 ID、名称或地址（先 list_hosts 查询）' } },
      required: ['hostId'],
    },
    danger: false,
    async run(args) {
      const host = resolveHost(args.hostId);
      const { stdout } = await ssh.execCollect(host.id, ops.SYSINFO_SCRIPT, 30000);
      const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
      return `主机 ${host.name} (${host.host}) 系统概况：\n` + lines.map((l) => '· ' + l).join('\n');
    },
  },

  {
    name: 'list_services',
    description: '列出指定主机上的 systemd 服务及运行状态。可通过关键字过滤（如 nginx、docker、mysql）。',
    inputSchema: {
      type: 'object',
      properties: {
        hostId: { type: 'string', description: '主机 ID、名称或地址' },
        keyword: { type: 'string', description: '服务名关键字过滤（可选）' },
        all: { type: 'boolean', description: 'true 时列出全部服务（默认只列出运行中的）' },
      },
      required: ['hostId'],
    },
    danger: false,
    async run(args) {
      const filter = args.keyword ? ` | grep -i ${q(String(args.keyword))}` : '';
      const state = args.all ? '--all' : '--state=running';
      const { host, code, text } = await run(args.hostId,
        `systemctl list-units --type=service ${state} --no-pager --no-legend 2>/dev/null | awk '{print $1, $3, $4}'${filter} | head -100`,
        QUERY_TIMEOUT);
      if (code !== 0 && !text) throw new Error('systemctl 执行失败，主机可能不是 systemd 系统');
      if (!text) return `主机 ${host.name} 上${args.keyword ? `没有匹配「${args.keyword}」的` : '没有运行中的'} systemd 服务。`;
      return `主机 ${host.name} 服务列表（名称 状态 子状态）：\n` + clip(text);
    },
  },

  {
    name: 'service_action',
    description: '对指定主机上的 systemd 服务执行操作：status(查看状态) / start(启动) / stop(停止) / restart(重启) / reload(重载) / enable(开机自启) / disable(关闭自启)。除 status 外均为变更操作。',
    inputSchema: {
      type: 'object',
      properties: {
        hostId: { type: 'string', description: '主机 ID、名称或地址' },
        service: { type: 'string', description: '服务名，如 nginx、docker、mysql' },
        action: { type: 'string', enum: ['status', 'start', 'stop', 'restart', 'reload', 'enable', 'disable'], description: '要执行的操作' },
      },
      required: ['hostId', 'service', 'action'],
    },
    danger: true,
    async run(args) {
      const service = String(args.service || '').replace(/[^a-zA-Z0-9_.@-]/g, '');
      if (!service) throw new Error('服务名无效');
      const action = String(args.action || 'status').toLowerCase();
      const { host, code, text } = await run(args.hostId,
        `systemctl ${action} ${q(service)} --no-pager 2>&1; echo "---"; systemctl is-active ${q(service)} 2>&1`,
        QUERY_TIMEOUT);
      return `主机 ${host.name} 执行 systemctl ${action} ${service}（退出码 ${code}）：\n` + clip(text);
    },
  },

  {
    name: 'list_containers',
    description: '列出指定主机上的 Docker 容器（含已停止的），显示容器名、镜像、状态、端口映射。',
    inputSchema: {
      type: 'object',
      properties: { hostId: { type: 'string', description: '主机 ID、名称或地址' } },
      required: ['hostId'],
    },
    danger: false,
    async run(args) {
      const { host, code, text } = await run(args.hostId,
        `if ! command -v docker >/dev/null 2>&1; then echo "未安装 Docker"; exit 0; fi; docker ps -a --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}'`,
        QUERY_TIMEOUT);
      if (code !== 0) throw new Error('docker 命令执行失败: ' + text.slice(0, 200));
      if (!text || text.includes('未安装')) return `主机 ${host.name} 未安装 Docker。`;
      return `主机 ${host.name} 容器列表：\n` + clip(text);
    },
  },

  {
    name: 'container_action',
    description: '对指定主机上的 Docker 容器执行操作：start(启动) / stop(停止) / restart(重启) / remove(删除容器)。',
    inputSchema: {
      type: 'object',
      properties: {
        hostId: { type: 'string', description: '主机 ID、名称或地址' },
        container: { type: 'string', description: '容器名或容器 ID' },
        action: { type: 'string', enum: ['start', 'stop', 'restart', 'remove'], description: '要执行的操作' },
      },
      required: ['hostId', 'container', 'action'],
    },
    danger: true,
    async run(args) {
      const container = String(args.container || '').replace(/[^a-zA-Z0-9_.-]/g, '');
      if (!container) throw new Error('容器名无效');
      const action = String(args.action || '').toLowerCase();
      const extra = action === 'remove' ? ' -f' : '';
      const { host, code, text } = await run(args.hostId,
        `docker ${action}${extra} ${q(container)} 2>&1; echo "---"; docker ps -a --filter name=${q(container)} --format '{{.Names}}  {{.Status}}'`,
        QUERY_TIMEOUT);
      return `主机 ${host.name} 执行 docker ${action} ${container}（退出码 ${code}）：\n` + clip(text);
    },
  },

  {
    name: 'container_logs',
    description: '查看指定主机上某个 Docker 容器的日志（默认最近 100 行）。',
    inputSchema: {
      type: 'object',
      properties: {
        hostId: { type: 'string', description: '主机 ID、名称或地址' },
        container: { type: 'string', description: '容器名或容器 ID' },
        tail: { type: 'integer', description: '显示最后 N 行日志，默认 100' },
      },
      required: ['hostId', 'container'],
    },
    danger: false,
    async run(args) {
      const container = String(args.container || '').replace(/[^a-zA-Z0-9_.-]/g, '');
      if (!container) throw new Error('容器名无效');
      const tail = Math.min(Math.max(parseInt(args.tail, 10) || 100, 1), 1000);
      const { host, text } = await run(args.hostId, `docker logs --tail ${tail} ${q(container)} 2>&1`, QUERY_TIMEOUT);
      return `主机 ${host.name} 容器 ${container} 最近 ${tail} 行日志：\n` + clip(text);
    },
  },

  {
    name: 'disk_usage',
    description: '查看指定主机的磁盘空间使用情况（df -h）以及 /home/docker、/var/lib/docker 等目录占用。',
    inputSchema: {
      type: 'object',
      properties: { hostId: { type: 'string', description: '主机 ID、名称或地址' } },
      required: ['hostId'],
    },
    danger: false,
    async run(args) {
      const { host, text } = await run(args.hostId,
        `df -h; echo '---大目录占用---'; du -sh /var/lib/docker /home/docker /var/log /www 2>/dev/null`,
        QUERY_TIMEOUT);
      return `主机 ${host.name} 磁盘使用情况：\n` + clip(text);
    },
  },

  {
    name: 'top_processes',
    description: '查看指定主机上 CPU 或内存占用最高的进程（默认 CPU TOP 15）。',
    inputSchema: {
      type: 'object',
      properties: {
        hostId: { type: 'string', description: '主机 ID、名称或地址' },
        sortBy: { type: 'string', enum: ['cpu', 'mem'], description: '按 CPU 还是内存排序，默认 cpu' },
      },
      required: ['hostId'],
    },
    danger: false,
    async run(args) {
      const sort = args.sortBy === 'mem' ? '%mem' : '%cpu';
      const { host, text } = await run(args.hostId,
        `ps aux --sort=-${sort} | head -16`,
        QUERY_TIMEOUT);
      return `主机 ${host.name} 进程排行（按${args.sortBy === 'mem' ? '内存' : 'CPU'}）：\n` + clip(text);
    },
  },

  {
    name: 'list_apps',
    description: '查询面板应用商店目录（80+ 应用，含 Open WebUI、Ollama、LobeChat、Nginx、1Panel 等）。可用关键字搜索，返回应用 id、名称、简介、类型。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键字（可选），如 ai、webui、数据库' },
        category: { type: 'string', description: '分类过滤（可选）：panel/proxy/ai/storage/media/monitor/tools/system' },
      },
      required: [],
    },
    danger: false,
    async run(args) {
      const { categories, apps: all } = apps.catalog();
      let list = all;
      if (args.category) list = list.filter((a) => a.category === args.category);
      if (args.keyword) {
        const k = String(args.keyword).toLowerCase();
        list = list.filter((a) => a.id.includes(k) || a.name.toLowerCase().includes(k) || (a.desc || '').toLowerCase().includes(k));
      }
      if (!list.length) return '没有匹配的应用。可尝试关键字：ai / web / nginx / 面板 / 监控 等。';
      return `应用商店匹配到 ${list.length} 个应用（分类：${categories.map((c) => `${c.id}=${c.name}`).join('、')}）：\n`
        + list.slice(0, 40).map((a) => `· id=${a.id}  [${a.kind}]${a.port ? ' 端口:' + a.port : ''}  ${a.name} —— ${a.desc}`)
          .join('\n') + (list.length > 40 ? `\n...（共 ${list.length} 个，仅显示前 40，请用关键字缩小范围）` : '');
    },
  },

  {
    name: 'installed_apps',
    description: '采集指定主机上已安装的应用（Docker 容器 + /home/docker 目录 + 常见面板），并匹配应用商店条目。',
    inputSchema: {
      type: 'object',
      properties: { hostId: { type: 'string', description: '主机 ID、名称或地址' } },
      required: ['hostId'],
    },
    danger: false,
    async run(args) {
      const host = resolveHost(args.hostId);
      const { stdout } = await ssh.execCollect(host.id, apps.STATUS_SCRIPT, 30000);
      const keys = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!keys.length) return `主机 ${host.name} 上未发现已安装的应用（无 Docker 容器、无 /home/docker 目录）。`;
      const containers = keys.filter((k) => k.startsWith('C:')).map((k) => k.slice(2));
      const dirs = keys.filter((k) => k.startsWith('DIR:')).map((k) => k.slice(4));
      const panels = keys.filter((k) => k.startsWith('P:')).map((k) => k.slice(2));
      let out = `主机 ${host.name} 已安装应用：\n`;
      if (containers.length) out += `· Docker 容器: ${containers.join('、')}\n`;
      if (dirs.length) out += `· Compose 应用目录(/home/docker): ${dirs.join('、')}\n`;
      if (panels.length) out += `· 面板/系统组件: ${panels.join('、')}\n`;
      return out.trim();
    },
  },

  {
    name: 'deploy_app',
    description: '在指定主机上一键部署应用商店里的应用（自动安装 Docker/Compose 依赖）。安装可能需要数分钟。注意：interactive=true 的交互式应用不适合此工具，会提示改用终端。',
    inputSchema: {
      type: 'object',
      properties: {
        hostId: { type: 'string', description: '主机 ID、名称或地址' },
        appId: { type: 'string', description: '应用商店应用 id（先 list_apps 查询）' },
        params: { type: 'object', description: 'form 类应用需要的参数（可选）' },
      },
      required: ['hostId', 'appId'],
    },
    danger: true,
    async run(args) {
      const app = apps.getApp(args.appId);
      if (!app) throw new Error(`未知应用: ${args.appId}（先 list_apps 查询）`);
      if (app.interactive) throw new Error(`应用「${app.name}」是交互式安装（安装向导需要人工应答），请通过面板终端手动执行。`);
      const command = apps.buildCommand(args.appId, 'install', args.params || {});
      const host = resolveHost(args.hostId);
      const { code, stdout, stderr } = await ssh.execCollect(host.id, command, DEPLOY_TIMEOUT);
      const out = (stdout + '\n' + stderr).trim();
      const head = `在主机 ${host.name} 部署应用「${app.name}」（${app.id}）${app.port ? `，服务端口 ${app.port}` : ''}，退出码 ${code}。`;
      return head + '\n部署输出：\n' + clip(out, MAX_OUTPUT);
    },
  },

  {
    name: 'uninstall_app',
    description: '从指定主机上卸载应用商店部署的应用（停止并删除容器/目录）。',
    inputSchema: {
      type: 'object',
      properties: {
        hostId: { type: 'string', description: '主机 ID、名称或地址' },
        appId: { type: 'string', description: '应用商店应用 id（先 installed_apps / list_apps 查询）' },
      },
      required: ['hostId', 'appId'],
    },
    danger: true,
    async run(args) {
      const app = apps.getApp(args.appId);
      if (!app) throw new Error(`未知应用: ${args.appId}`);
      const command = apps.buildCommand(args.appId, 'uninstall', {});
      const host = resolveHost(args.hostId);
      const { code, stdout, stderr } = await ssh.execCollect(host.id, command, DEPLOY_TIMEOUT);
      return `在主机 ${host.name} 卸载应用「${app.name}」，退出码 ${code}。\n输出：\n` + clip((stdout + '\n' + stderr).trim());
    },
  },

  {
    name: 'github_search',
    description: '在 GitHub 上搜索开源项目（当内置应用商店没有用户想要的应用时使用）。按 Star 排序返回项目全名、简介、语言、最近更新与默认分支，选中后可用 github_deploy 部署。建议用英文关键字搜索。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键字，英文效果更好，如 "self-hosted dashboard"' },
        limit: { type: 'integer', description: '返回条数，默认 8，最大 15' },
        language: { type: 'string', description: '按编程语言过滤（可选），如 Python、Go、TypeScript' },
      },
      required: ['keyword'],
    },
    danger: false,
    async run(args) {
      const kw = String(args.keyword || '').trim();
      if (!kw) throw new Error('缺少 keyword 参数');
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 8, 1), 15);
      let query = encodeURIComponent(kw);
      if (args.language) query += '+language:' + encodeURIComponent(String(args.language));
      const url = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=${limit}`;
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'HaizhuOpsPanel-MCP' };
      if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
      const { status, data } = await httpGetJson(url, headers);
      if (status === 403 || status === 429) {
        throw new Error('GitHub API 限流。可设置环境变量 GITHUB_TOKEN 提升配额，或稍后重试。');
      }
      if (status !== 200 || !data) {
        throw new Error('GitHub API 返回 ' + status);
      }
      const items = (data.items || []).slice(0, limit);
      if (!items.length) return `GitHub 上没有匹配「${kw}」的项目，建议换成英文关键字重试（如 webui / dashboard / proxy）。`;
      return `GitHub 搜索「${kw}」结果（按 Star 排序，用 github_deploy 可一键部署）：\n`
        + items.map((r, i) =>
          `${i + 1}. ${r.full_name}  ⭐${r.stargazers_count}  ${r.language || '-'}  最近更新 ${(r.pushed_at || '').slice(0, 10)}  默认分支 ${r.default_branch}\n`
          + `   简介: ${r.description ? String(r.description).slice(0, 140) : '（无）'}\n`
          + `   ${r.html_url}`
        ).join('\n');
    },
  },

  {
    name: 'github_deploy',
    description: '将任意 GitHub 仓库一键部署到指定主机（突破内置应用商店范围）：自动安装 Git/Docker，clone 仓库后智能选择部署方式 —— 有 docker-compose.yml 则 docker compose up -d；有 Dockerfile 则构建镜像并运行（可用 port 参数指定端口）；两者都没有则仅克隆到 /home/docker 并提示手动部署。重复执行同名部署等于先删后重新部署（更新到最新版）。',
    inputSchema: {
      type: 'object',
      properties: {
        hostId: { type: 'string', description: '主机 ID、名称或地址' },
        repo: { type: 'string', description: '仓库全名（owner/repo）或完整 git 克隆地址' },
        branch: { type: 'string', description: '分支（可选，默认仓库默认分支）' },
        subDir: { type: 'string', description: 'compose/Dockerfile 所在子目录（可选，monorepo 场景，如 docker-compose/local）' },
        port: { type: 'string', description: '容器对外端口（可选，仅 Dockerfile 构建时映射，如 8080）' },
        name: { type: 'string', description: '部署名称/容器名（可选，默认取仓库名）' },
      },
      required: ['hostId', 'repo'],
    },
    danger: true,
    async run(args) {
      const raw = String(args.repo || '').trim();
      if (!raw) throw new Error('缺少 repo 参数');
      let url;
      let name = String(args.name || '').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
      const m = raw.match(/^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
      if (m) {
        url = `https://github.com/${m[1]}/${m[2]}.git`;
        if (!name) name = m[2].toLowerCase().replace(/[^a-z0-9_.-]/g, '');
      } else if (/^https?:\/\/|^git@/.test(raw)) {
        url = raw;
        if (!name) name = (raw.split('/').pop() || 'app').replace(/\.git.*$/, '').toLowerCase().replace(/[^a-z0-9_.-]/g, '');
      } else {
        throw new Error('无法识别的仓库地址（应形如 owner/repo 或 https://github.com/owner/repo）: ' + raw);
      }
      if (!name) throw new Error('无法解析部署名称');
      const branch = String(args.branch || '').replace(/[^a-zA-Z0-9_.\/-]/g, '');
      const subDir = String(args.subDir || '').replace(/[^a-zA-Z0-9_.\/-]/g, '').replace(/^\/+|\/+$/g, '');
      const port = String(args.port || '').replace(/[^0-9]/g, '');
      if (args.port && !port) throw new Error('端口无效');

      const command = [
        // 确保依赖：git + docker/compose
        `command -v git >/dev/null 2>&1 || { echo '>>> 正在安装 git...'; apt-get install -y git 2>/dev/null || dnf install -y git 2>/dev/null || yum install -y git 2>/dev/null || apk add git 2>/dev/null; }`,
        `command -v docker >/dev/null 2>&1 || { echo '>>> 正在安装 Docker...'; curl -fsSL https://get.docker.com | sh && (systemctl enable --now docker 2>/dev/null || service docker start); }`,
        `command -v docker >/dev/null 2>&1 || { echo 'Docker 安装失败'; exit 1; }`,
        // 克隆（先删旧版 = 重复执行即更新）
        `echo '>>> 正在拉取 ${name} ...'`,
        `mkdir -p /home/docker && cd /home/docker && rm -rf ${q(name)}`,
        `git clone --depth 1 ${branch ? '--branch ' + q(branch) + ' ' : ''}${q(url)} ${q(name)}`,
        `cd ${q('/home/docker/' + name + (subDir ? '/' + subDir : ''))}`,
        // 智能选择部署方式
        `if ls docker-compose.y*ml compose.y*ml 2>/dev/null | head -1 | grep -q .; then`,
        `  echo '>>> 检测到 docker compose 配置，启动编排...'`,
        `  docker compose up -d`,
        `elif [ -f Dockerfile ]; then`,
        `  echo '>>> 检测到 Dockerfile，构建镜像并运行...'`,
        `  docker build -t ${q(name + ':latest')} .`,
        `  docker rm -f ${q(name)} 2>/dev/null`,
        `  docker run -d --name ${q(name)} --restart unless-stopped ${port ? '-p ' + port + ':' + port : ''} ${q(name + ':latest')}`,
        `else`,
        `  echo '>>> 未检测到 docker-compose / Dockerfile，代码已克隆到 /home/docker/${name}，请查看项目 README 确定部署方式（可用 run_command 或面板终端手动执行）'`,
        `fi`,
        `echo '--- 当前容器状态 ---'`,
        `docker ps -a --filter name=${q(name)} --format '{{.Names}}  {{.Image}}  {{.Status}}  {{.Ports}}'`,
      ].join('\n');

      const host = resolveHost(args.hostId);
      const { code, stdout, stderr } = await ssh.execCollect(host.id, command, DEPLOY_TIMEOUT);
      const out = (stdout + '\n' + stderr).trim();
      const head = `在主机 ${host.name} 部署 GitHub 仓库 ${url}${branch ? '（分支 ' + branch + '）' : ''}，退出码 ${code}。${port ? `Dockerfile 部署端口 ${port}。` : ''}`;
      return head + '\n部署输出：\n' + clip(out, MAX_OUTPUT);
    },
  },

  {
    name: 'run_command',
    description: '（默认关闭）在指定主机上执行任意 shell 命数命令。需要在启动 MCP 服务时设置环境变量 MCP_ALLOW_RAW_COMMAND=1 才可用。',
    inputSchema: {
      type: 'object',
      properties: {
        hostId: { type: 'string', description: '主机 ID、名称或地址' },
        command: { type: 'string', description: '要执行的 shell 命令' },
        timeoutSeconds: { type: 'integer', description: '超时秒数，默认 60' },
      },
      required: ['hostId', 'command'],
    },
    danger: true,
    enabled: () => process.env.MCP_ALLOW_RAW_COMMAND === '1',
    async run(args) {
      if (process.env.MCP_ALLOW_RAW_COMMAND !== '1') {
        throw new Error('run_command 已被管理员禁用。如需启用，请设置环境变量 MCP_ALLOW_RAW_COMMAND=1 后重启 MCP 服务。');
      }
      const timeout = Math.min(Math.max(parseInt(args.timeoutSeconds, 10) || 60, 1), 600) * 1000;
      const { host, code, text } = await run(args.hostId, String(args.command), timeout);
      return `主机 ${host.name} 命令执行完成（退出码 ${code}）：\n` + clip(text);
    },
  },

  {
    name: 'audit_log',
    description: '查询面板审计日志（登录、主机变更、应用部署、MCP 工具调用等操作记录）。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '返回条数，默认 20，最大 100' } },
      required: [],
    },
    danger: false,
    async run(args) {
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 100);
      const records = audit.list(limit);
      if (!records.length) return '暂无审计记录。';
      return `最近 ${records.length} 条审计日志：\n` + records.map((r) =>
        `[${r.time}] ${r.action}  目标=${r.target || '-'}  IP=${r.ip || '-'}${r.meta ? '  ' + JSON.stringify(r.meta) : ''}`
      ).join('\n');
    },
  },
];

/** 获取可用工具列表（应用 enabled 开关） */
function availableTools() {
  return TOOLS.filter((t) => !t.enabled || t.enabled());
}

function getTool(name) {
  return availableTools().find((t) => t.name === name) || null;
}

/** MCP 格式的工具清单 */
function mcpToolList() {
  return availableTools().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

/** OpenAI function calling 格式的工具清单 */
function openaiToolList() {
  return availableTools().map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/**
 * 统一执行入口（MCP 服务器与 AI 助手共用）
 * @param {string} name 工具名
 * @param {object} args 参数
 * @param {string} actor 调用来源（mcp / ai）
 * @returns {{ ok: boolean, text: string }}
 */
async function callTool(name, args, actor = 'mcp') {
  const tool = getTool(name);
  if (!tool) return { ok: false, text: `未知工具: ${name}` };
  const t0 = Date.now();
  let result;
  try {
    result = { ok: true, text: await tool.run(args || {}) };
  } catch (e) {
    result = { ok: false, text: `工具执行失败: ${e.message}` };
  }
  audit.write('mcp.tool.call', {
    actor: actor === 'ai' ? 'ai-assistant' : 'mcp-client',
    target: (args && args.hostId) || null,
    meta: { tool: name, danger: !!tool.danger, ok: result.ok, ms: Date.now() - t0 },
  });
  return result;
}

module.exports = { mcpToolList, openaiToolList, getTool, callTool, availableTools };
