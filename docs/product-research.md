# HaizhuOpsPanel 产品与功能调研

调研时间：2026-07-13

## 运维面板能力归纳

### 宝塔面板

宝塔官方文档覆盖网站、数据库、FTP、SSL、防火墙、Docker、监控、计划任务、安全检测、终端与一键部署。企业能力还包括 WAF、系统加固、网站监控报表、异常推送、多节点管理、备份恢复、证书自动续签和节点分发。

- 官方文档：https://docs.bt.cn/
- 官方产品页：https://www.bt.cn/

### 1Panel

1Panel 官方文档重点包括多机管理、主机监控、文件、数据库、容器、网站、应用商店、防火墙、日志审计、备份恢复，以及 Ollama/vLLM、AI 网关、GPU 监控等 AI 基础设施能力。v2 还增加了文件对传、自定义仓库、负载均衡与脚本库。

- 官方文档：https://1panel.cn/docs/v2/
- 更新记录：https://1panel.cn/docs/v2/changelog/

### 青龙面板

青龙定位为支持 Python、JavaScript、Shell、TypeScript 的定时任务管理平台。其高频体验包括任务、环境变量、依赖、脚本、日志与周期执行管理。

- 官方仓库：https://github.com/whyour/qinglong

### GMSSH

GMSSH 强调 SSH 原生、无额外管理端口、低侵入的多主机访问体验，核心包括主机资产、连接管理、分组标签、多环境组织、统一入口、团队协作、权限控制与安全访问。

- 官方仓库：https://github.com/GMSSH/GMSSH

## HaizhuOpsPanel 取舍

HaizhuOpsPanel 保留 GMSSH 式 SSH 原生接入，同时吸收宝塔和 1Panel 的资产、站点、数据库、容器、任务、备份与安全能力。第一阶段优先实现只读发现、风险巡检、可审计执行和变更前快照；会直接修改生产状态的操作继续要求显式确认。

## 近期 AI 项目收录

以下项目具有近期活跃度或趋势信号，并提供官方自托管路径：

| 项目 | 能力 | 部署依据 |
| --- | --- | --- |
| DeerFlow 2.0 | SuperAgent、沙箱、记忆、子 Agent、MCP、Skills | https://github.com/bytedance/deer-flow |
| Wegent | Agent 团队、群聊、长期记忆、沙箱 | https://github.com/wecode-ai/Wegent |
| InsForge | Agentic Coding 后端、认证、存储、AI Gateway | https://github.com/InsForge/InsForge |
| OpenAgent | RAG、Computer Use、Browser Use、MCP | https://github.com/the-open-agent/openagent |
| RuFlo | Claude/Codex 多 Agent Swarm、RAG、记忆 | https://github.com/ruvnet/ruflo |
| CLASP | Claude Code 多模型代理与本地模型接入 | https://github.com/jedarden/CLASP |

部署模板仅使用项目公开的官方安装方式。涉及模型 API Key、Cookie、SSO Token 等凭据时，HaizhuOpsPanel 不写入仓库，部署后由用户在目标主机配置。
