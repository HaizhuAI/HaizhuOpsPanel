# HaizhuOpsPanel MCP 使用指南

v2.1.0 起，HaizhuOpsPanel 提供 **MCP（Model Context Protocol）处理能力**：把面板的远程主机运维能力封装成 16 个标准 MCP 工具，供两类入口使用；v2.2.0 新增 GitHub 开源项目搜索与一键部署，部署范围不再局限于内置应用商店：

1. **外部 MCP 客户端**（Claude Desktop、Cursor、Cline、VS Code、WorkBuddy 等）：通过 stdio 直连 `server/mcp-server.js`
2. **面板内置 AI 运维助手**：网页端自然语言对话，自动调用同一套工具

两种方式执行的每一步都会写入 `data/audit.jsonl` 审计日志。

---

## 一、可用 MCP 工具一览

| 工具 | 说明 | 变更操作 |
| --- | --- | --- |
| `list_hosts` | 列出已纳管主机（获取 hostId） | 否 |
| `host_overview` | 系统概况：CPU/内存/磁盘/负载/运行时长 | 否 |
| `list_services` | systemd 服务列表（可按关键字过滤） | 否 |
| `service_action` | 服务 start/stop/restart/reload/enable/disable/status | **是** |
| `list_containers` | Docker 容器列表 | 否 |
| `container_action` | 容器 start/stop/restart/remove | **是** |
| `container_logs` | 查看容器日志 | 否 |
| `disk_usage` | 磁盘空间与大目录占用 | 否 |
| `top_processes` | CPU/内存进程排行 | 否 |
| `list_apps` | 搜索应用商店目录（80+ 应用） | 否 |
| `installed_apps` | 采集主机已安装应用 | 否 |
| `deploy_app` | 一键部署应用商店应用（自动装 Docker） | **是** |
| `uninstall_app` | 卸载应用 | **是** |
| `github_search` | 搜索 GitHub 开源项目（Star 排序，返回全名/简介/语言/更新时间） | 否 |
| `github_deploy` | 部署任意 GitHub 仓库：自动装 Git/Docker，智能识别 docker-compose / Dockerfile | **是** |
| `run_command` | 任意 shell 命令（**默认禁用**） | **是** |

`run_command` 需要在 MCP 服务器启动环境中设置 `MCP_ALLOW_RAW_COMMAND=1` 才会出现在工具列表中，否则不可见/不可调用。

### GitHub 搜索与部署（v2.2.0）

当内置应用商店（80+ 应用）没有用户想要的服务时，AI 会自动转向 GitHub：

1. `github_search` 调用 GitHub 官方搜索 API（`api.github.com`），按 Star 排序返回项目全名、简介、语言、最近更新、默认分支；支持编程语言过滤
2. `github_deploy` 在目标主机上执行智能部署流水线：
   - 自动安装 git / Docker / compose 插件
   - `git clone --depth 1` 拉取最新代码到 `/home/docker/<名称>`（先删旧目录，因此重复执行 = 更新到最新版）
   - 有 `docker-compose.yml / compose.yml` → `docker compose up -d`
   - 只有 `Dockerfile` → `docker build` + `docker run -d --restart unless-stopped`（可用 `port` 参数映射端口）
   - 都没有 → 仅克隆代码并提示查看 README 手动部署
   - 支持 `subDir` 参数定位 monorepo 中的 compose/Dockerfile 子目录，`branch` 指定分支

相关环境变量（可选）：

| 变量 | 说明 |
| --- | --- |
| `GITHUB_TOKEN` | GitHub Personal Access Token。不设也能用（匿名限流约 10 次搜索/分钟），设置后配额提升到 30 次/分钟 |
| `NODE_USE_ENV_PROXY=1` | 本机走 HTTP 代理且 GitHub 搜索超时时设置（Node 22+ 使内置 fetch 读取 HTTP(S)_PROXY 环境变量）；工具内部也内置了 curl 自动兜底 |

---

## 二、外部 MCP 客户端接入

### 前提

1. 本机已安装 Node.js ≥ 22
2. 已在面板网页端（`npm run start:legacy` 启动的运维面板）「主机管理」中添加过主机 —— MCP 服务器直接读取面板 `data/hosts.json` 中的加密凭据，主机信息两边共用

### Claude Desktop

编辑配置文件（Windows: `%APPDATA%\Claude\claude_desktop_config.json`，macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "haizhu-opspanel": {
      "command": "node",
      "args": ["C:/path/to/HaizhuOpsPanel/server/mcp-server.js"]
    }
  }
}
```

重启 Claude Desktop 后，对话中即可直接说：

> "看看我生产机的 nginx 服务状态，挂了就帮我重启"
> "帮我在这台机器上部署 open-webui"
> "磁盘是不是快满了？帮我看看哪个目录占的"

### Cursor

在项目或全局设置中添加（`.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "haizhu-opspanel": {
      "command": "node",
      "args": ["C:/path/to/HaizhuOpsPanel/server/mcp-server.js"]
    }
  }
}
```

### VS Code（MCP 扩展 / Copilot）

`.vscode/mcp.json`：

```json
{
  "servers": {
    "haizhu-opspanel": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/HaizhuOpsPanel/server/mcp-server.js"]
    }
  }
}
```

### 通用说明

- 手动启动测试：`npm run start:mcp`（或 `node server/mcp-server.js`），日志输出在 stderr，JSON-RPC 走 stdout
- 危险开关：给配置加 `"env": { "MCP_ALLOW_RAW_COMMAND": "1" }` 可启用 `run_command`（允许任意命令，务必谨慎）
- 验证工具清单（需面板运行中）：

```bash
curl -H "Authorization: Bearer <登录token>" http://localhost:8899/api/mcp/tools
```

---

## 三、面板内置 AI 运维助手

面板网页端左侧导航新增「AI 运维助手」：直接用自然语言描述需求，助手通过 function calling 自动选择工具执行，并展示每一步工具调用与输出。

### 配置模型（必需）

助手支持任何 **OpenAI 兼容** 的 Chat Completions 接口。在项目根目录创建 `.env` 文件（面板启动时自动读取），或直接设置进程环境变量：

```ini
# .env 示例
AI_API_KEY=sk-xxxx
AI_BASE_URL=https://api.deepseek.com/v1   # 不填默认 https://api.openai.com/v1
AI_MODEL=deepseek-chat                     # 不填默认 gpt-4o-mini
```

常见服务商：

| 服务商 | AI_BASE_URL | 推荐模型 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` / `gpt-4o` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 智谱 AI | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash`（免费）/ `glm-4-plus` |
| 月之暗面 | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| Ollama 本地 | `http://localhost:11434/v1` | `qwen2.5:7b` 等 |

然后重启面板：`npm run start:legacy`。启动横幅会显示 `AI 运维助手: 已启用 (模型名)`。

### 使用示例

- "查看当前主机的运行状态"
- "nginx 服务好像挂了，帮我看看，挂了就重启"
- "列出所有容器，顺便看看 redis 容器最近的日志"
- "帮我部署 open-webui，部署完告诉我访问端口"
- "磁盘快满了，帮我找出最占空间的目录"
- "在 GitHub 上找一个最新的 uptime 监控项目，帮我部署到生产机"（触发 `github_search` → 确认 → `github_deploy`）
- "帮我部署 https://github.com/glanceapp/glance"（直接给出仓库地址时跳过搜索）

---

## 四、安全设计

- **凭据不出库**：主机密码/私钥沿用面板 AES-256-GCM 加密存储，MCP/AI 层只拿主机 ID
- **审计留痕**：每次工具调用记录 `mcp.tool.call`（工具名、目标主机、是否危险、耗时、结果）到 `data/audit.jsonl`
- **危险默认关闭**：`run_command` 必须显式开启环境变量才可用
- **AI 确认策略**：系统提示词要求 LLM 在执行变更类操作前先向用户确认（用户已明确要求时除外）
- **输出截断**：单次工具输出上限 2 万字符，防止 token 爆炸
- **面板鉴权**：`/api/ai/*` 接口与面板其他接口一样需要 Bearer Token 登录态
