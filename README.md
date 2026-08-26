# HaizhuOpsPanel

面向独立开发者、技术团队与企业的可视化服务器运维及 AI 应用部署平台。对外落地页使用 Next.js、React 与 Tailwind CSS 构建；后端通过 SSH 提供多主机资产、站点证书、数据库、容器、任务、备份、安全审计与应用市场能力。

**v2.1.0 新增 MCP 处理能力，v2.2.0 扩展 GitHub 部署**：面板运维能力封装为 16 个标准 MCP 工具（服务查看、容器管理、磁盘诊断、应用部署、GitHub 开源项目搜索与一键部署等），支持两种使用方式 —— 外部 MCP 客户端（Claude Desktop / Cursor / VS Code 等）直连，或使用面板内置 AI 运维助手自然语言对话。应用部署不再局限于内置商店的 80 款应用，可搜索 GitHub 最新项目直接拉取部署。详见 [docs/mcp.md](docs/mcp.md)。

## 快速开始（运维面板 + MCP / AI 能力）

```bash
npm install
npm run start:legacy        # 启动运维面板 http://localhost:8899（默认 admin / admin123）
npm run start:mcp           # （可选）启动 MCP 服务器（stdio，供外部 AI 客户端接入）
```

启用面板内置 AI 助手：项目根目录创建 `.env` 写入 `AI_API_KEY=sk-xxx`（可选 `AI_BASE_URL`、`AI_MODEL`），重启面板后在左侧「AI 运维助手」中用自然语言描述运维需求即可。外部 MCP 客户端接入配置见 [docs/mcp.md](docs/mcp.md) 与 [scripts/mcp-config.json](scripts/mcp-config.json)。

## 技术栈

- Next.js 15（App Router）
- React 19
- Tailwind CSS 4
- Lucide React
- 原有 Express / SSH / WebSocket 运维后端保留在 `server/`

## 本地开发

```bash
npm install
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)。

## 生产构建

```bash
npm run build
npm start
```

## 质量检查

```bash
npm run lint
npm run build
```

## 项目结构

```text
├─ app/                     # Next.js 页面、元信息与全局设计样式
├─ components/              # 落地页组件与交互式产品演示
├─ design-system/haizhuopspanel/ # ui-ux-pro-max 生成的企业设计系统
├─ legacy-public/           # 升级前的原生面板前端，完整保留（含 AI 运维助手）
├─ server/                  # Express API、SSH 与 WebSocket 后端
│  ├─ mcp-tools.js          # MCP 工具层（16 个运维工具，共用执行入口）
│  ├─ mcp-server.js         # stdio MCP 服务器（外部 AI 客户端接入）
│  └─ ai.js                 # 面板内置 AI 助手（OpenAI 兼容 function calling）
├─ scripts/mcp-config.json  # 各 MCP 客户端接入配置示例
├─ docs/mcp.md              # MCP 与 AI 助手使用指南
├─ postcss.config.mjs       # Tailwind CSS PostCSS 配置
└─ package.json
```

## MCP 处理能力（v2.1.0 / v2.2.0）

用户用自然语言描述需求，AI 通过 MCP 工具在远程主机上执行 CLI 完成服务查看与运维部署：

- **16 个标准 MCP 工具**：主机列表、系统概况、systemd 服务查看/启停、Docker 容器列表/操作/日志、磁盘诊断、进程排行、应用商店搜索、应用部署/卸载、GitHub 项目搜索/部署、审计查询
- **GitHub 任意仓库部署（v2.2.0）**：内置商店没有的应用自动转向 GitHub 搜索（Star 排序），确认后一键部署 —— 自动装 Git/Docker，智能识别 docker-compose / Dockerfile，monorepo 支持子目录，重复执行即更新到最新版
- **两种入口**：
  - 外部 MCP 客户端（Claude Desktop、Cursor、Cline、VS Code、WorkBuddy 等）通过 `npm run start:mcp` 接入
  - 面板内置「AI 运维助手」对话界面（OpenAI / DeepSeek / 智谱等任意兼容接口）
- **安全设计**：主机凭据 AES-256-GCM 加密不出库、全部工具调用写入审计日志、`run_command` 默认禁用、AI 执行变更操作前先确认

配置方法与示例见 [docs/mcp.md](docs/mcp.md)。

## 设计与体验

- 专业、简洁的深绿运维视觉，使用语义化状态色而非纯装饰色
- 响应式适配 375px、768px、1024px 与大屏桌面
- 移动端导航和可切换的产品工作流演示
- 44px 以上触控目标、清晰键盘焦点、合理标题层级
- 支持 `prefers-reduced-motion`，避免不必要的动态效果
- 静态预渲染首页，保持较小的客户端负载

## 企业运维能力

- 多主机资产指纹与异常服务巡检
- Nginx、Apache、Caddy 站点及 SSL 证书到期盘点
- MySQL、PostgreSQL、Redis、MongoDB 实例发现
- Docker 容器、镜像、网络与 Compose 应用管理
- Cron、系统 Cron 与 systemd Timers 统一任务总览
- 备份新鲜度巡检与变更前配置快照
- SSH、账户、sudo、防火墙、端口与失败登录安全基线
- SSH 公钥指纹和文件权限审计
- 登录、主机变更、应用部署与运维操作 JSONL 审计记录

## 新增 AI 应用模板

应用市场新增 DeerFlow 2.0、Wegent、InsForge、OpenAgent、RuFlo 与 CLASP，并保留原有 Open WebUI、Ollama、RAGFlow、LobeChat、New API 等模板。新增项目均使用项目官方公开的 Docker、Compose 或安装脚本路径。

调研依据见 [产品与功能调研](docs/product-research.md)。

## 原运维面板

升级前的前端已移动至 `legacy-public/`，后端实现仍保留在 `server/`。如需继续运行旧面板，可执行：

```bash
npm run start:legacy
```

旧服务已改为从 `legacy-public/` 加载静态资源，因此与新的 Next.js 落地页可以并行维护。

## License

MIT
