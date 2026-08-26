/**
 * 应用商店目录
 * 对标 kejilion.sh「应用市场」，将其中的应用做成可视化一键安装/卸载模块。
 *
 * 数据来源：
 *  - server/appmarket.json —— 从 kejilion.sh 应用市场自动提取的 82 款应用
 *    （单容器 docker run 与 docker compose 两类，命令已清洗、变量已解析）
 *  - 本文件内 CURATED —— 手工维护的面板脚本 / 代理脚本 / 表单类应用
 *
 * 应用类型 (kind):
 *  - docker  : 单容器，exec 控制台一键安装（自动确保已装 Docker）
 *  - compose : docker compose 编排应用，exec 控制台安装（确保 compose 插件）
 *  - script  : 交互式官方安装脚本，路由到「终端」由用户应答向导
 *  - form    : 需要用户填写参数（弹窗），例如一键 DD 重装
 * interactive=true 的应用统一路由到「终端」执行（可应答向导/输入域名）。
 */
const fs = require('fs');
const path = require('path');

const MARKET = JSON.parse(fs.readFileSync(path.join(__dirname, 'appmarket.json'), 'utf8'));

const CATEGORIES = [
  { id: 'panel', name: '面板管理' },
  { id: 'proxy', name: '代理与网络' },
  { id: 'ai', name: 'AI 大模型' },
  { id: 'storage', name: '存储与下载' },
  { id: 'media', name: '影音媒体' },
  { id: 'monitor', name: '监控探针' },
  { id: 'tools', name: '实用工具' },
  { id: 'system', name: '系统重装' },
];

// 确保远程主机已安装 Docker
const ENSURE_DOCKER = `if ! command -v docker >/dev/null 2>&1; then echo ">>> 未检测到 Docker，正在自动安装..."; curl -fsSL https://get.docker.com | sh && (systemctl enable --now docker 2>/dev/null || service docker start); fi
if ! command -v docker >/dev/null 2>&1; then echo "Docker 安装失败，请手动排查"; exit 1; fi
`;
// 确保 docker compose (v2 插件) 可用
const ENSURE_COMPOSE = ENSURE_DOCKER +
  `if ! docker compose version >/dev/null 2>&1; then echo ">>> 未检测到 docker compose 插件，请先升级 Docker 到最新版"; fi
`;
// 确保 git 可用（用于 clone 部署的应用）
const ENSURE_GIT = `command -v git >/dev/null 2>&1 || { echo ">>> 正在安装 git..."; apt-get install -y git 2>/dev/null || dnf install -y git 2>/dev/null || yum install -y git 2>/dev/null || apk add git 2>/dev/null; }
`;

/** 生成 clone + compose 部署型应用（如 grok2api / CLIProxyAPI）的安装命令 */
function cloneComposeInstall(name, dir, cloneCmd, port) {
  return ENSURE_COMPOSE + ENSURE_GIT +
    `echo ">>> 正在部署 ${name} ..."\n` +
    `mkdir -p /home/docker && cd /home/docker && rm -rf ${dir}\n` +
    cloneCmd.trim() + '\n' +
    `echo; echo "===== ${name} 部署完成 ====="` +
    (port ? `\necho ">>> 访问端口: ${port}"` : '');
}
function cloneComposeUninstall(name, dir) {
  return `[ -d /home/docker/${dir} ] && cd /home/docker/${dir} && (docker compose down --rmi all 2>/dev/null || docker-compose down --rmi all 2>/dev/null); rm -rf /home/docker/${dir}; echo "===== ${name} 已卸载 ====="`;
}

/** 生成预构建镜像 docker run 型应用的安装命令 */
function dockerRunInstall(name, container, runCmd, port, post) {
  return ENSURE_DOCKER +
    `echo ">>> 正在部署 ${name} ..."\n` +
    `docker rm -f ${container} >/dev/null 2>&1\n` +
    runCmd.trim() + '\n' +
    (post ? post.trim() + '\n' : '') +
    `echo; echo "===== ${name} 部署完成 ====="` +
    (port ? `\necho ">>> 访问端口: ${port}"` : '');
}
function dockerRunUninstall(name, container) {
  return `docker rm -f ${container} 2>/dev/null; rm -rf /home/docker/${container}; echo "===== ${name} 已卸载 ====="`;
}

/** 构建 docker/compose 应用的安装命令 */
/** Quote a validated value for a POSIX shell assignment. */
function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function marketInstall(app) {
  const head = app.kind === 'compose' ? ENSURE_COMPOSE : ENSURE_DOCKER;
  return head +
    `echo ">>> 正在部署 ${app.name} ..."\n` +
    (app.kind === 'docker' ? `docker rm -f ${app.container} >/dev/null 2>&1\n` : '') +
    app.install.trim() + '\n' +
    (app.post ? app.post.trim() + '\n' : '') +
    `echo; echo "===== ${app.name} 部署完成 ====="` +
    (app.port ? `\necho ">>> 访问端口: ${app.port}"` : '');
}

/** 构建 docker/compose 应用的卸载命令 */
function marketUninstall(app) {
  if (app.kind === 'compose') {
    return `[ -d /home/docker/${app.container} ] && cd /home/docker/${app.container} && (docker compose down --rmi all 2>/dev/null || docker-compose down --rmi all 2>/dev/null); rm -rf /home/docker/${app.container}; echo "===== ${app.name} 已卸载 ====="`;
  }
  return `docker rm -f ${app.container} 2>/dev/null; rm -rf /home/docker/${app.container}; echo "===== ${app.name} 已卸载（含数据目录）====="`;
}

// -------- 手工维护的特殊应用（面板脚本 / 代理脚本 / 表单） --------
const CURATED = [
  {
    id: '1panel', name: '1Panel 管理面板', category: 'panel', kind: 'script', interactive: true,
    statusKey: 'P:1panel',
    desc: '新一代 Linux 服务器运维管理面板，图形化管理网站/数据库/容器/文件（官方交互式安装）',
    install: () => `bash -c "$(curl -sSL https://resource.fit2cloud.com/1panel/package/v2/quick_start.sh)"`,
    uninstallCmd: () => `1pctl uninstall`,
  },
  {
    id: 'bt', name: '宝塔面板', category: 'panel', kind: 'script', interactive: true,
    statusKey: 'P:bt',
    desc: '国内最流行的服务器运维面板，图形化建站与管理（官方交互式安装）',
    install: () => `curl -sSO https://download.bt.cn/install/install_panel.sh && bash install_panel.sh ed8484bec`,
  },
  {
    id: 'aapanel', name: 'aaPanel 宝塔国际版', category: 'panel', kind: 'script', interactive: true,
    statusKey: 'P:bt',
    desc: '宝塔面板国际版 aaPanel，英文界面的服务器运维面板（官方交互式安装）',
    install: () => `URL=https://www.aapanel.com/script/install_7.0_en.sh; curl -ksSO "$URL" || wget --no-check-certificate -O install_7.0_en.sh "$URL"; bash install_7.0_en.sh aapanel`,
  },
  {
    id: 'amh', name: 'AMH 主机面板', category: 'panel', kind: 'script', interactive: true,
    desc: 'AMH 主机建站管理面板（官方交互式安装）',
    install: () => `wget https://dl.amh.sh/amh.sh && bash amh.sh`,
  },
  {
    id: 'jumpserver', name: 'JumpServer 堡垒机', category: 'panel', kind: 'script', interactive: true,
    desc: '开源堡垒机，集中管控服务器/数据库/云等资产的运维审计平台（官方交互式安装）',
    install: () => `curl -sSL https://github.com/jumpserver/jumpserver/releases/latest/download/quick_start.sh | bash`,
    uninstallCmd: () => `cd /opt/jumpserver-installer-* 2>/dev/null && ./jmsctl.sh uninstall`,
  },
  // ---- AI API 网关 / 中转（用户新增需求）----
  {
    id: 'sub2api', name: 'Sub2API 订阅中转', category: 'ai', kind: 'script', interactive: true,
    desc: '开源 AI 订阅中转平台，将 Claude / OpenAI / Gemini / Antigravity 订阅统一成单一 API 端点，支持拼车共享、计费与负载均衡（官方一键脚本，默认端口 8080）',
    install: () => `curl -sSL https://raw.githubusercontent.com/Wei-Shaw/sub2api/main/deploy/docker-deploy.sh -o /tmp/sub2api_deploy.sh && bash /tmp/sub2api_deploy.sh`,
  },
  {
    id: 'cpa', name: 'CLIProxyAPI (CPA)', category: 'ai', kind: 'compose', interactive: false,
    port: 8317, statusKey: 'DIR:CLIProxyAPI', canUninstall: true,
    desc: '将 Claude Code / Codex / Gemini CLI / Grok 等封装为 OpenAI/Claude/Gemini 兼容 API 网关，可接入 Cursor / Cline / Continue 等工具（主端口 8317）',
    _install: () => cloneComposeInstall('CLIProxyAPI',
      'CLIProxyAPI',
      'git clone https://github.com/router-for-me/CLIProxyAPI.git && cd CLIProxyAPI && docker compose up -d',
      8317),
    _uninstall: () => cloneComposeUninstall('CLIProxyAPI', 'CLIProxyAPI'),
  },
  {
    id: 'grok2api', name: 'Grok2API 网关', category: 'ai', kind: 'compose', interactive: false,
    port: 8000, statusKey: 'DIR:grok2api', canUninstall: true,
    desc: '基于 FastAPI 的 Grok 网关，将 Grok Web 能力转换为 OpenAI 兼容 API（默认端口 8000，部署后需在 .env / 面板配置 SSO Token）',
    _install: () => cloneComposeInstall('Grok2API',
      'grok2api',
      'git clone https://github.com/chenyme/grok2api.git && cd grok2api && cp .env.example .env && docker compose up -d',
      8000),
    _uninstall: () => cloneComposeUninstall('Grok2API', 'grok2api'),
  },
  {
    id: 'haizhugrok', name: 'HaizhuGrok API 网关', category: 'ai', kind: 'form', interactive: false,
    port: 3000, statusKey: 'DIR:haizhugrok', canUninstall: true,
    desc: 'HaizhuGrok 企业级 Grok API 网关，将 Grok OIDC 转换为 OpenAI / Anthropic 兼容接口；一键部署应用、PostgreSQL 与 Redis，管理入口 /admin。',
    params: [
      {
        key: 'adminPassword', label: '管理后台密码', type: 'password', required: true,
        placeholder: '8-128 位，支持字母、数字和 ._@!#%+=-',
      },
      {
        key: 'workers', label: 'API Worker 数量', type: 'select', required: true, defaultValue: '2',
        options: [
          { value: '2', label: '2（推荐，2-4 核）' },
          { value: '4', label: '4（4-8 核）' },
          { value: '6', label: '6（8-12 核）' },
          { value: '8', label: '8（12 核以上）' },
        ],
      },
    ],
    build: (p) => {
      const adminPassword = String(p.adminPassword || '');
      if (adminPassword.length < 8 || adminPassword.length > 128) {
        throw new Error('管理密码长度必须为 8-128 位');
      }
      if (!/^[A-Za-z0-9._@!#%+=-]+$/.test(adminPassword)) {
        throw new Error('管理密码仅支持字母、数字和 ._@!#%+=-');
      }
      const workers = String(p.workers || '2');
      if (!['2', '4', '6', '8'].includes(workers)) throw new Error('Worker 数量无效');

      return ENSURE_COMPOSE + `set -eu
BASE=/home/docker/haizhugrok
mkdir -p "$BASE/data" "$BASE/turnstile_logs"
cd "$BASE"
DB_PASSWORD=""
if [ -f .env ]; then
  DB_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | head -n 1)"
fi
if [ -z "$DB_PASSWORD" ]; then
  DB_PASSWORD="$(openssl rand -hex 18 2>/dev/null || dd if=/dev/urandom bs=18 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')"
fi
ADMIN_PASSWORD=${shellQuote(adminPassword)}
printf 'GROK2API_ADMIN_PASSWORD=%s\nPOSTGRES_PASSWORD=%s\nGROK2API_WORKERS=%s\n' "$ADMIN_PASSWORD" "$DB_PASSWORD" '${workers}' > .env
chmod 600 .env
cat > compose.yaml <<'HAIZHUGROK_COMPOSE'
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: grok2api
      POSTGRES_USER: grok2api
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U grok2api -d grok2api"]
      interval: 5s
      timeout: 3s
      retries: 20

  haizhugrok:
    image: ghcr.io/liuhaizhu996/haizhugrok:2.0.1
    restart: unless-stopped
    ports:
      - "3000:3000"
    shm_size: 1gb
    security_opt:
      - seccomp:unconfined
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
    environment:
      GROK2API_ADMIN_PASSWORD: \${GROK2API_ADMIN_PASSWORD}
      GROK2API_STORE_BACKEND: hybrid
      GROK2API_REQUIRE_SHARED_STORES: "1"
      GROK2API_REDIS_URL: redis://redis:6379/0
      GROK2API_DATABASE_URL: postgresql://grok2api:\${POSTGRES_PASSWORD}@postgres:5432/grok2api
      GROK2API_WORKERS: \${GROK2API_WORKERS}
      GROK2API_CAPTCHA_PROVIDER: local
      GROK2API_INLINE_SOLVER: "1"
      TURNSTILE_THREAD: "4"
      TURNSTILE_LAZY: "1"
    volumes:
      - ./data:/app/data
      - ./turnstile_logs:/app/turnstile_logs

volumes:
  redis_data:
  postgres_data:
HAIZHUGROK_COMPOSE
docker compose -p haizhugrok pull
docker compose -p haizhugrok up -d
echo
echo "===== HaizhuGrok 部署完成 ====="
echo ">>> 管理后台: http://<主机IP>:3000/admin"
echo ">>> API 地址: http://<主机IP>:3000/v1"
echo ">>> 数据目录: $BASE"
echo ">>> PostgreSQL / Redis 仅在容器内部网络开放"`;
    },
    _uninstall: () => `if [ -d /home/docker/haizhugrok ]; then
  cd /home/docker/haizhugrok
  docker compose -p haizhugrok down --rmi all -v 2>/dev/null || true
fi
rm -rf /home/docker/haizhugrok
echo "===== HaizhuGrok 已卸载（含数据库、缓存和持久化数据）====="`,
  },
  // ---- 更多 AI API / 2api 项目（用户新增需求）----
  {
    id: 'deepseek-free-api', name: 'DeepSeek Free API', category: 'ai', kind: 'docker', interactive: false,
    port: 8210, statusKey: 'C:deepseek-free-api', canUninstall: true,
    desc: 'DeepSeek 网页转 OpenAI 兼容 API，含 Web 管理界面（/admin）。部署后请在管理面板填入账号凭据',
    _install: () => dockerRunInstall('DeepSeek Free API', 'deepseek-free-api',
      `mkdir -p /home/docker/deepseek-free-api && touch /home/docker/deepseek-free-api/config.json
docker run -d --name deepseek-free-api --restart=always -p 8210:8000 \\
  -v /home/docker/deepseek-free-api/config.json:/app/config.json ghcr.io/fly143/deepseek-free-api:latest`,
      8210, `echo ">>> Web 管理界面: http://<主机IP>:8210/admin"`),
    _uninstall: () => dockerRunUninstall('DeepSeek Free API', 'deepseek-free-api'),
  },
  {
    id: 'grok2api-new', name: 'Grok2API New', category: 'ai', kind: 'docker', interactive: false,
    port: 8211, statusKey: 'C:grok2api-new', canUninstall: true,
    desc: 'Grok 网页转 OpenAI 兼容 API（Tomiya233 版），含管理面板（/admin），首次启动自动初始化 data/logs',
    _install: () => dockerRunInstall('Grok2API New', 'grok2api-new',
      `docker run -d --name grok2api-new --restart=unless-stopped -p 8211:8000 \\
  -v /home/docker/grok2api-new/data:/app/data -v /home/docker/grok2api-new/logs:/app/logs \\
  ghcr.io/tomiya233/grok2api_new:latest`,
      8211, `echo ">>> Web 管理界面: http://<主机IP>:8211/admin"`),
    _uninstall: () => dockerRunUninstall('Grok2API New', 'grok2api-new'),
  },
  {
    id: 'cpa-manager-plus', name: 'CPA Manager Plus', category: 'ai', kind: 'docker', interactive: false,
    port: 18317, statusKey: 'C:cpa-manager-plus', canUninstall: true,
    desc: 'CLIProxyAPI (CPA) 的可视化管理面板，请求监控 / 用量分析 / 模型定价（管理界面 /management.html）',
    _install: () => dockerRunInstall('CPA Manager Plus', 'cpa-manager-plus',
      `docker run -d --name cpa-manager-plus --restart=unless-stopped -p 18317:18317 \\
  -v cpa-manager-plus-data:/data seakee/cpa-manager-plus:latest`,
      18317, `echo ">>> 管理界面: http://<主机IP>:18317/management.html"`),
    _uninstall: () => `docker rm -f cpa-manager-plus 2>/dev/null; docker volume rm cpa-manager-plus-data 2>/dev/null; echo "===== CPA Manager Plus 已卸载 ====="`,
  },
  {
    id: 'tabbit2api', name: 'Tabbit2API', category: 'ai', kind: 'docker', interactive: false,
    port: 50124, statusKey: 'C:tabbit2api', canUninstall: true,
    desc: 'Tabbit 转 API 网关（npm 项目，容器化运行），默认端口 50124，健康检查 /health',
    _install: () => dockerRunInstall('Tabbit2API', 'tabbit2api',
      `docker run -d --name tabbit2api --restart=always -p 50124:50124 \\
  node:20-alpine sh -c "npm i -g tabbit2api && tabbit2api start --port 50124"`,
      50124, `echo ">>> 首次启动需拉取 npm 依赖，请稍候；健康检查: http://<主机IP>:50124/health"`),
    _uninstall: () => dockerRunUninstall('Tabbit2API', 'tabbit2api'),
  },
  {
    id: 'chatgpt2api', name: 'ChatGPT2API', category: 'ai', kind: 'compose', interactive: true,
    port: 3000, statusKey: 'DIR:chatgpt2api', canUninstall: true,
    desc: 'ChatGPT 网页转 OpenAI 兼容 API，含 Web 管理面板（端口 3000）。部署后在面板设置 auth-key',
    _install: () => cloneComposeInstall('ChatGPT2API', 'chatgpt2api',
      'git clone https://github.com/basketikun/chatgpt2api.git && cd chatgpt2api && docker compose up -d', 3000),
    _uninstall: () => cloneComposeUninstall('ChatGPT2API', 'chatgpt2api'),
  },
  {
    id: 'qwen-2api', name: 'Qwen 2API', category: 'ai', kind: 'compose', interactive: true,
    port: 8082, statusKey: 'DIR:Qwen-2api', canUninstall: true,
    desc: '通义千问 Qwen 网页转 API（Nginx+FastAPI，端口 8082）。⚠ 需在 .env 填入 Cookie 与 x-xsrf-token 后重启',
    _install: () => cloneComposeInstall('Qwen 2API', 'Qwen-2api',
      `docker network create shared_network 2>/dev/null; git clone https://github.com/lza6/Qwen-2api.git && cd Qwen-2api && cp .env.example .env 2>/dev/null; docker compose up -d --build
echo ">>> 请编辑 /home/docker/Qwen-2api/.env 填入 Cookie/x-xsrf-token 后执行 docker compose up -d 重启"`, 8082),
    _uninstall: () => cloneComposeUninstall('Qwen 2API', 'Qwen-2api'),
  },
  {
    id: 'kimi-ai-2api', name: 'Kimi 2API', category: 'ai', kind: 'compose', interactive: true,
    port: 8088, statusKey: 'DIR:kimi-ai-2api', canUninstall: true,
    desc: 'Kimi 网页转 OpenAI 兼容 API（Nginx+FastAPI，端口 8088）。⚠ 需在 .env 设置 API_MASTER_KEY 等后重启',
    _install: () => cloneComposeInstall('Kimi 2API', 'kimi-ai-2api',
      `git clone https://github.com/lza6/kimi-ai-2api.git && cd kimi-ai-2api && cp .env.example .env 2>/dev/null; docker compose up -d --build
echo ">>> 请编辑 /home/docker/kimi-ai-2api/.env 配置密钥/Cookie 后执行 docker compose up -d 重启"`, 8088),
    _uninstall: () => cloneComposeUninstall('Kimi 2API', 'kimi-ai-2api'),
  },
  {
    id: 'hermes-2api', name: 'Hermes 2API', category: 'ai', kind: 'compose', interactive: true,
    port: 8089, statusKey: 'DIR:hermes-2api', canUninstall: true,
    desc: 'Hermes 网页转 API（Nginx+FastAPI）。⚠ 需在 .env 设置 HERMES_COOKIE 与 API_MASTER_KEY 后重启',
    _install: () => cloneComposeInstall('Hermes 2API', 'hermes-2api',
      `git clone https://github.com/lza6/hermes-2api.git && cd hermes-2api && cp .env.example .env 2>/dev/null; echo "NGINX_PORT=8089" >> .env; docker compose up -d --build
echo ">>> 请编辑 /home/docker/hermes-2api/.env 填入 HERMES_COOKIE/API_MASTER_KEY 后执行 docker compose up -d 重启"`, 8089),
    _uninstall: () => cloneComposeUninstall('Hermes 2API', 'hermes-2api'),
  },
  {
    id: 'mimo-2api', name: 'MiMo 2API', category: 'ai', kind: 'compose', interactive: true,
    port: 8090, statusKey: 'DIR:mimo-2api', canUninstall: true,
    desc: '小米 MiMo 网页转 API（端口 8090）。⚠ 需在 docker-compose.yml 填入 Cookie 与 apikey 后重启',
    _install: () => cloneComposeInstall('MiMo 2API', 'mimo-2api',
      `git clone https://github.com/rong6/mimo-2api.git && cd mimo-2api && docker compose up -d --build
echo ">>> 请编辑 /home/docker/mimo-2api/docker-compose.yml 填入 cookie/apikey 后执行 docker compose up -d 重启"`, 8090),
    _uninstall: () => cloneComposeUninstall('MiMo 2API', 'mimo-2api'),
  },
  {
    id: 'glm2api', name: 'GLM2API', category: 'ai', kind: 'script', interactive: true,
    statusKey: 'DIR:GLM2API', canUninstall: true,
    desc: '智谱 GLM (Z.ai) 网页转 OpenAI 兼容 API（默认端口 8788），官方 Linux 部署脚本（交互式）',
    install: () => ENSURE_GIT + `mkdir -p /home/docker && cd /home/docker && rm -rf GLM2API && git clone https://github.com/pei-lin-001/GLM2API.git && cd GLM2API && bash scripts/deploy-zai-linux.sh`,
    uninstallCmd: () => `rm -rf /home/docker/GLM2API; echo "===== GLM2API 目录已删除（如有 systemd 服务请手动停用）====="`,
  },
  // ---- 2026 热门开源 AI / Agent 项目（官方自托管方式）----
  {
    id: 'wegent', name: 'Wegent AI Agent OS', category: 'ai', kind: 'script', interactive: true,
    port: 3000, statusKey: 'C:wegent-standalone', canUninstall: true,
    desc: '开源 AI 原生操作系统，支持多模型群聊、Agent 团队、长期记忆、文件解析与沙箱执行；使用官方安装脚本部署单容器版本',
    install: () => `curl -fsSL https://raw.githubusercontent.com/wecode-ai/Wegent/main/install.sh -o /tmp/wegent-install.sh && bash /tmp/wegent-install.sh`,
    uninstallCmd: () => `docker rm -f wegent-standalone 2>/dev/null; docker volume ls -q | grep '^wegent' | xargs -r docker volume rm; echo "===== Wegent 已卸载 ====="`,
  },
  {
    id: 'insforge', name: 'InsForge Agent Backend', category: 'ai', kind: 'compose', interactive: false,
    port: 7130, statusKey: 'DIR:insforge', canUninstall: true,
    desc: '面向 Agentic Coding 的开源后端平台，集成数据库、认证、存储、计算、托管与 AI Gateway，采用官方生产 Compose 配置',
    _install: () => cloneComposeInstall('InsForge', 'insforge',
      'git clone https://github.com/InsForge/InsForge.git insforge && cd insforge && cp -n .env.example .env && docker compose -f docker-compose.prod.yml up -d', 7130),
    _uninstall: () => `[ -d /home/docker/insforge ] && cd /home/docker/insforge && docker compose -f docker-compose.prod.yml down --remove-orphans; rm -rf /home/docker/insforge; echo "===== InsForge 已卸载 ====="`,
  },
  {
    id: 'openagent', name: 'OpenAgent', category: 'ai', kind: 'compose', interactive: false,
    port: 14000, statusKey: 'DIR:openagent', canUninstall: true,
    desc: '可自托管个人 AI 助手，支持 RAG、Agent Loop、Computer Use、Browser Use、Coding Agent 与 MCP 工具',
    _install: () => cloneComposeInstall('OpenAgent', 'openagent',
      'git clone https://github.com/the-open-agent/openagent.git && cd openagent && docker compose up -d', 14000),
    _uninstall: () => cloneComposeUninstall('OpenAgent', 'openagent'),
  },
  {
    id: 'deer-flow', name: 'DeerFlow 2.0', category: 'ai', kind: 'script', interactive: true,
    port: 2026, statusKey: 'DIR:deer-flow', canUninstall: true,
    desc: '字节跳动开源 SuperAgent，具备沙箱执行、持久记忆、子 Agent、MCP 与 Skills 扩展；首次部署需配置模型密钥',
    install: () => ENSURE_DOCKER + ENSURE_GIT + `mkdir -p /home/docker && cd /home/docker && rm -rf deer-flow && git clone https://github.com/bytedance/deer-flow.git && cd deer-flow && cp config.example.yaml config.yaml && make docker-init
echo ">>> DeerFlow 环境已初始化。请编辑 /home/docker/deer-flow/config.yaml 配置模型，然后执行 make docker-start"`,
    uninstallCmd: () => `[ -d /home/docker/deer-flow ] && cd /home/docker/deer-flow && make docker-stop 2>/dev/null || true; rm -rf /home/docker/deer-flow; echo "===== DeerFlow 已卸载 ====="`,
  },
  {
    id: 'ruflo', name: 'RuFlo Agent Swarm', category: 'ai', kind: 'script', interactive: true,
    statusKey: 'DIR:ruflo', canUninstall: true,
    desc: 'Claude/Codex 多 Agent 编排平台，支持 Swarm、RAG、持久记忆、MCP 与本地自托管 Web UI；使用官方安装脚本',
    install: () => `curl -fsSL https://cdn.jsdelivr.net/gh/ruvnet/ruflo@main/scripts/install.sh -o /tmp/ruflo-install.sh && bash /tmp/ruflo-install.sh`,
    uninstallCmd: () => `rm -rf /home/docker/ruflo ~/.ruflo 2>/dev/null; echo "===== RuFlo 数据目录已移除；全局 CLI 请按安装器提示卸载 ====="`,
  },
  {
    id: 'clasp-ai', name: 'CLASP AI Proxy', category: 'ai', kind: 'docker', interactive: false,
    port: 8180, statusKey: 'C:clasp-ai', canUninstall: true,
    desc: 'Claude Code 多模型代理，可连接 OpenAI、Azure、OpenRouter、Ollama 与 vLLM；部署后通过环境变量配置模型提供商',
    _install: () => dockerRunInstall('CLASP AI Proxy', 'clasp-ai',
      `docker run -d --name clasp-ai --restart=unless-stopped -p 8180:8080 \
  -e CLASP_HOST=0.0.0.0 ghcr.io/jedarden/clasp:latest`, 8180,
      `echo ">>> 请通过 docker 环境变量配置 OPENAI_API_KEY / AZURE_API_KEY / CUSTOM_BASE_URL 等提供商凭据"`),
    _uninstall: () => dockerRunUninstall('CLASP AI Proxy', 'clasp-ai'),
  },
  {
    id: 'x-ui', name: '3X-UI 面板', category: 'proxy', kind: 'script', interactive: true,
    statusKey: 'P:x-ui',
    desc: 'Xray 多协议多用户可视化管理面板（3X-UI），支持 VLESS/VMess/Trojan 等，官方交互式安装向导',
    install: () => `curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh -o /tmp/3xui_install.sh && bash /tmp/3xui_install.sh`,
    uninstallCmd: () => `x-ui uninstall`,
  },
  {
    id: 'v2ray', name: '快捷协议脚本 (v2ray.sh)', category: 'proxy', kind: 'script', interactive: true,
    statusKey: 'P:v2ray',
    desc: '经典 v2ray.sh 一键脚本，交互式菜单快速搭建 V2Ray 各类协议',
    install: () => `curl -s -L https://git.io/v2ray.sh -o /tmp/v2ray_install.sh && bash /tmp/v2ray_install.sh`,
  },
  {
    id: 'dd-reinstall', name: '一键 DD 重装系统', category: 'system', kind: 'form', interactive: false,
    danger: true,
    desc: '使用 reinstall.sh 一键重装远程主机操作系统。⚠ 会清空磁盘全部数据，请务必提前备份！重装后主机将以新系统、新密码、新 SSH 端口重启。',
    params: [
      {
        key: 'system', label: '目标系统', type: 'select', required: true,
        options: [
          { value: 'debian 12', label: 'Debian 12' },
          { value: 'debian 11', label: 'Debian 11' },
          { value: 'ubuntu 24.04', label: 'Ubuntu 24.04' },
          { value: 'ubuntu 22.04', label: 'Ubuntu 22.04' },
          { value: 'ubuntu 20.04', label: 'Ubuntu 20.04' },
          { value: 'centos 9', label: 'CentOS Stream 9' },
          { value: 'rocky 9', label: 'Rocky Linux 9' },
          { value: 'almalinux 9', label: 'AlmaLinux 9' },
          { value: 'alpine', label: 'Alpine Linux' },
          { value: 'fedora 40', label: 'Fedora 40' },
        ],
      },
      { key: 'password', label: '新系统 root 密码', type: 'password', placeholder: '重装后的登录密码', required: true },
      { key: 'sshPort', label: '新 SSH 端口', placeholder: '例如 39003', required: true },
    ],
    build: (p) => {
      const allowed = ['debian 12', 'debian 11', 'ubuntu 24.04', 'ubuntu 22.04', 'ubuntu 20.04',
        'centos 9', 'rocky 9', 'almalinux 9', 'alpine', 'fedora 40'];
      if (!allowed.includes(p.system)) throw new Error('不支持的系统版本');
      if (!p.password || p.password.length < 6) throw new Error('密码长度至少 6 位');
      const port = parseInt(p.sshPort, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口无效（1-65535）');
      const pw = "'" + String(p.password).replace(/'/g, "'\\''") + "'";
      return `echo ">>> 即将 DD 重装为 ${p.system}，SSH 端口 ${port}，主机将在准备完成后自动重启..."
cd /root 2>/dev/null || cd ~
curl -O https://raw.githubusercontent.com/bin456789/reinstall/main/reinstall.sh || wget -O reinstall.sh https://raw.githubusercontent.com/bin456789/reinstall/main/reinstall.sh
bash reinstall.sh ${p.system} --password ${pw} --ssh-port ${port}
echo ">>> reinstall 已触发，主机重启后请使用新密码与端口 ${port} 重新连接"`;
    },
  },
];

// 归一化市场应用为统一结构
const MARKET_APPS = MARKET.map((a) => ({
  ...a,
  interactive: !!a.interactive,
  statusKey: a.kind === 'compose' ? 'DIR:' + a.container : 'C:' + a.container,
  canUninstall: true,
  _install: () => marketInstall(a),
  _uninstall: () => marketUninstall(a),
}));

// 合并（CURATED 优先，避免与市场应用重名冲突）
const curatedIds = new Set(CURATED.map((a) => a.id));
const ALL_APPS = [
  ...CURATED,
  ...MARKET_APPS.filter((a) => !curatedIds.has(a.id)),
];

/** 采集应用安装状态：C:<容器> / DIR:<目录> / P:<面板标记> */
const STATUS_SCRIPT = `
if command -v docker >/dev/null 2>&1; then
  for c in $(docker ps -a --format '{{.Names}}' 2>/dev/null); do echo "C:$c"; done
fi
if [ -d /home/docker ]; then for d in /home/docker/*/; do [ -d "$d" ] && echo "DIR:$(basename "$d")"; done; fi
command -v 1pctl >/dev/null 2>&1 && echo "P:1panel"
[ -d /www/server/panel ] && echo "P:bt"
command -v x-ui >/dev/null 2>&1 && echo "P:x-ui"
{ command -v v2ray >/dev/null 2>&1 || [ -d /etc/v2ray ] || [ -d /usr/local/etc/v2ray ]; } && echo "P:v2ray"
`;

function getApp(id) {
  return ALL_APPS.find((a) => a.id === id) || null;
}

/** 构建安装/卸载命令（服务端统一校验参数） */
function buildCommand(id, action, params) {
  const app = getApp(id);
  if (!app) throw new Error('未知应用');
  if (action === 'uninstall') {
    if (app._uninstall) return app._uninstall();
    if (app.uninstallCmd) return app.uninstallCmd();
    throw new Error('该应用不支持一键卸载，请手动处理');
  }
  // install
  if (app._install) return app._install();
  if (app.kind === 'form') return app.build(params || {});
  if (app.kind === 'script') return app.install();
  throw new Error('该应用不支持一键安装');
}

/** 前端目录：不含函数字段 */
function catalog() {
  return {
    categories: CATEGORIES,
    apps: ALL_APPS.map((a) => ({
      id: a.id, name: a.name, desc: a.desc, category: a.category,
      kind: a.kind, interactive: !!a.interactive, port: a.port || null,
      danger: !!a.danger, statusKey: a.statusKey || null,
      params: a.params || null,
      canUninstall: !!(a.canUninstall || a.uninstallCmd || a._uninstall),
    })),
  };
}

module.exports = { catalog, getApp, buildCommand, STATUS_SCRIPT };
