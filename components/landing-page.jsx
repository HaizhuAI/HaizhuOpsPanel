"use client";

import { useState } from "react";
import {
  Activity,
  ArchiveRestore,
  ArrowRight,
  BellRing,
  Bot,
  Box,
  Boxes,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  CircleCheck,
  Cloud,
  Code2,
  Container,
  Cpu,
  Database,
  Github,
  Globe2,
  HardDrive,
  KeyRound,
  Layers3,
  Menu,
  Network,
  PackageSearch,
  Play,
  Radar,
  Server,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  UsersRound,
  Workflow,
  X,
  Zap,
} from "lucide-react";

const repoUrl = "https://github.com/Liuhaizhu996/HaizhuOpsPanel";

const features = [
  {
    icon: Radar,
    title: "全局状态，一眼看清",
    description: "主机、容器、负载与网络状态集中呈现，异常信号不再藏在多个终端里。",
    tone: "mint",
  },
  {
    icon: TerminalSquare,
    title: "运维操作，可视化执行",
    description: "常用命令沉淀为安全操作卡片，执行过程实时回传，也保留完整 SSH 终端。",
    tone: "blue",
  },
  {
    icon: Box,
    title: "应用服务，一键部署",
    description: "内置 90+ 常用应用模板，从配置到启动一次完成，独立开发也能快速上线。",
    tone: "violet",
  },
  {
    icon: ShieldCheck,
    title: "敏感凭据，加密托管",
    description: "SSH 密码与私钥加密保存，高风险操作二次确认，把安全边界放在默认路径上。",
    tone: "amber",
  },
  {
    icon: BellRing,
    title: "异常事件，及时触达",
    description: "从负载波动到服务离线，建立清晰的事件上下文，减少无效排查时间。",
    tone: "rose",
  },
  {
    icon: Layers3,
    title: "一个工作台，持续扩展",
    description: "从一台 VPS 到多个项目环境，统一入口与一致体验随业务自然成长。",
    tone: "cyan",
  },
];

const workflows = [
  {
    id: "observe",
    label: "实时观测",
    title: "每一个服务，都有清晰的运行脉搏",
    description: "关键指标经过筛选后进入同一视图。无需在多个工具间切换，也能快速定位资源与服务异常。",
    bullets: ["5 秒自动刷新核心指标", "主机与容器状态联动", "异常状态语义化标记"],
  },
  {
    id: "deploy",
    label: "一键部署",
    title: "把重复配置，变成一次点击",
    description: "应用模板封装依赖、端口与运行参数，部署过程可追踪，结果可验证。",
    bullets: ["90+ 常用服务模板", "Docker / Compose 自动适配", "安装状态与访问入口同步"],
  },
  {
    id: "terminal",
    label: "安全终端",
    title: "需要深入时，终端始终在手边",
    description: "内置交互式 SSH 终端，既不牺牲灵活性，也让连接与权限管理保持集中。",
    bullets: ["浏览器内完整 SSH 会话", "敏感凭据 AES-256-GCM 加密", "高风险操作显式确认"],
  },
];

const faqs = [
  ["HaizhuOpsPanel 适合谁使用？", "它面向独立开发者、技术团队与需要统一管理多环境基础设施的企业。尤其适合希望兼顾可视化效率、SSH 灵活性与操作审计的用户。"],
  ["需要在每台服务器安装 Agent 吗？", "不需要。HaizhuOpsPanel 通过 SSH 安全连接远程主机，降低接入成本，也不会在业务服务器上常驻额外管理进程。"],
  ["我的服务器凭据安全吗？", "SSH 密码与私钥在服务端使用 AES-256-GCM 加密存储，接口不会返回明文。生产环境仍建议启用 HTTPS、限制访问来源并定期轮换凭据。"],
  ["支持哪些 Linux 发行版？", "常用操作已适配 apt、dnf、yum、apk 与 pacman 等包管理器，可覆盖主流 Debian、Ubuntu、CentOS、Alpine 和 Arch 系发行版。"],
];

const enterpriseModules = [
  { icon: Building2, title: "多主机资产中心", desc: "按组织、项目、环境与标签管理主机，集中维护连接入口和资产指纹。", meta: "资产 / 分组 / 标签" },
  { icon: Globe2, title: "网站与证书", desc: "统一盘点 Nginx、Apache、Caddy 站点与 SSL 到期状态，降低证书事故风险。", meta: "站点 / 域名 / SSL" },
  { icon: Database, title: "数据库管理", desc: "发现 MySQL、PostgreSQL、Redis、MongoDB 实例，关联端口、服务与容器。", meta: "实例 / 连接 / 备份" },
  { icon: Boxes, title: "容器与应用", desc: "容器、镜像、网络、堆栈与应用模板统一管理，状态与访问入口自动联动。", meta: "Docker / Compose" },
  { icon: CalendarClock, title: "任务编排", desc: "聚合 Cron、systemd Timers 与脚本任务，统一查看周期、状态与执行日志。", meta: "计划 / 脚本 / 日志" },
  { icon: ArchiveRestore, title: "备份与恢复", desc: "追踪备份新鲜度、存储容量与配置快照，为变更提供可验证回滚点。", meta: "快照 / 校验 / 恢复" },
  { icon: ShieldCheck, title: "安全基线", desc: "检查 SSH、账户、sudo、防火墙、开放端口与失败登录，输出明确风险上下文。", meta: "基线 / 风险 / 加固" },
  { icon: UsersRound, title: "权限与审计", desc: "围绕团队协作建立凭据、操作确认、执行记录和 SSH 密钥指纹审计。", meta: "RBAC Ready / Audit" },
  { icon: Bot, title: "AI 运维助手", desc: "聚合故障上下文与日志线索，为性能、安全和服务异常提供辅助诊断路径。", meta: "诊断 / 建议 / Runbook" },
];

const aiProjects = [
  { name: "DeerFlow 2.0", vendor: "ByteDance", desc: "具备沙箱、记忆、子 Agent 与 Skills 的 SuperAgent。", tag: "SuperAgent", hot: "Trending" },
  { name: "Wegent", vendor: "wecode-ai", desc: "定义、组织并运行智能 Agent 团队的 AI 原生操作系统。", tag: "Agent OS", hot: "New" },
  { name: "InsForge", vendor: "InsForge", desc: "为 Agentic Coding 提供数据库、认证、存储和 AI Gateway。", tag: "Backend", hot: "New" },
  { name: "OpenAgent", vendor: "Open Agent", desc: "集成 RAG、Computer Use、Browser Use 与 MCP 的个人助手。", tag: "Assistant", hot: "Self-hosted" },
  { name: "RuFlo", vendor: "ruvnet", desc: "面向 Claude 与 Codex 的多 Agent Swarm 编排平台。", tag: "Swarm", hot: "Trending" },
  { name: "CLASP", vendor: "jedarden", desc: "让 Claude Code 连接 OpenAI、OpenRouter、Ollama 与 vLLM。", tag: "AI Gateway", hot: "Docker" },
];

function Logo() {
  return (
    <a className="brand" href="#top" aria-label="HaizhuOpsPanel 首页">
      <span className="brand-mark"><Activity size={20} aria-hidden="true" /></span>
      <span>HaizhuOpsPanel</span>
    </a>
  );
}

function DashboardPreview({ mode }) {
  const terminalMode = mode === "terminal";
  const deployMode = mode === "deploy";

  return (
    <div className="product-window" aria-label="HaizhuOpsPanel 产品界面预览">
      <div className="window-topbar">
        <div className="traffic-lights" aria-hidden="true"><span /><span /><span /></div>
        <div className="window-address"><ShieldCheck size={13} /> console.haizhuops.dev</div>
        <div className="live-pill"><span className="pulse-dot" /> LIVE</div>
      </div>
      <div className="dashboard-shell">
        <aside className="preview-sidebar">
          <div className="mini-logo"><Activity size={16} /></div>
          {[Radar, Server, Container, Database, TerminalSquare].map((Icon, index) => (
            <span className={index === (terminalMode ? 4 : deployMode ? 2 : 0) ? "active" : ""} key={index}>
              <Icon size={16} />
            </span>
          ))}
        </aside>
        <div className="preview-main">
          <div className="preview-heading">
            <div><p>工作区 / production</p><h3>{terminalMode ? "安全终端" : deployMode ? "应用部署" : "运行概览"}</h3></div>
            <div className="healthy"><CircleCheck size={14} /> 系统健康</div>
          </div>

          {terminalMode ? <TerminalPanel /> : deployMode ? <DeployPanel /> : <OverviewPanel />}
        </div>
      </div>
    </div>
  );
}

function OverviewPanel() {
  return (
    <>
      <div className="metric-row">
        {[
          [Cpu, "CPU 负载", "18.4%", "+2.1%"],
          [Database, "内存使用", "3.8 GB", "47.5%"],
          [HardDrive, "磁盘空间", "68.2 GB", "34.1%"],
        ].map(([Icon, label, value, trend]) => (
          <div className="metric-card" key={label}>
            <div className="metric-label"><Icon size={14} /> {label}</div>
            <strong>{value}</strong><span>{trend}</span>
          </div>
        ))}
      </div>
      <div className="chart-card">
        <div className="chart-header"><div><span>资源趋势</span><small>最近 24 小时</small></div><b>实时</b></div>
        <svg className="line-chart" viewBox="0 0 600 170" role="img" aria-label="过去 24 小时 CPU 与内存使用率平稳">
          <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#62e6b7" stopOpacity=".25"/><stop offset="1" stopColor="#62e6b7" stopOpacity="0"/></linearGradient></defs>
          {[35, 75, 115, 155].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#253b36" strokeWidth="1" />)}
          <path d="M0 128 C45 120 65 90 110 99 S175 130 220 105 S290 55 345 76 S410 120 458 83 S535 48 600 61 L600 170 L0 170Z" fill="url(#area)" />
          <path d="M0 128 C45 120 65 90 110 99 S175 130 220 105 S290 55 345 76 S410 120 458 83 S535 48 600 61" fill="none" stroke="#62e6b7" strokeWidth="3" strokeLinecap="round" />
          <path d="M0 145 C60 130 82 138 130 120 S210 112 260 126 S345 102 400 116 S510 93 600 104" fill="none" stroke="#5a7ef2" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 6" />
        </svg>
        <div className="chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>现在</span></div>
      </div>
      <div className="service-row">
        {["gateway", "postgres", "worker"].map((name, index) => <div key={name}><span className={index === 2 ? "status-warn" : "status-ok"} /><b>{name}</b><small>{index === 2 ? "检查中" : "运行中"}</small></div>)}
      </div>
    </>
  );
}

function DeployPanel() {
  return (
    <div className="deploy-grid">
      {[
        [Globe2, "Uptime Kuma", "服务状态监控", "已运行"],
        [Container, "Docker", "容器运行环境", "已安装"],
        [Code2, "Code Server", "云端开发环境", "可部署"],
        [Cloud, "OpenList", "文件聚合服务", "可部署"],
      ].map(([Icon, name, desc, state], index) => (
        <div className="deploy-card" key={name}>
          <div className="app-icon"><Icon size={20} /></div>
          <div><b>{name}</b><small>{desc}</small></div>
          <button className={index < 2 ? "installed" : ""}>{state}</button>
        </div>
      ))}
    </div>
  );
}

function TerminalPanel() {
  return (
    <div className="terminal-panel">
      <div className="terminal-title"><span /><span /><span /><b>root@production:~</b></div>
      <div className="terminal-lines">
        <p><i>$</i> docker ps --format &quot;table {'{{'}.Names{'}}'}\t{'{{'}.Status{'}}'}&quot;</p>
        <p><em>NAMES</em><em>STATUS</em></p>
        <p><span>haizhuops-api</span><small>Up 12 days (healthy)</small></p>
        <p><span>postgres</span><small>Up 12 days (healthy)</small></p>
        <p><span>worker</span><small>Up 4 hours</small></p>
        <p><i>$</i> <b className="cursor-block" /></p>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [workflow, setWorkflow] = useState("observe");
  const activeWorkflow = workflows.find((item) => item.id === workflow);

  return (
    <main id="top">
      <a href="#content" className="skip-link">跳到主要内容</a>
      <header className="site-header">
        <div className="nav-shell">
          <Logo />
          <nav className="desktop-nav" aria-label="主导航">
            <a href="#enterprise">企业能力</a><a href="#workflow">工作方式</a><a href="#ai-market">AI 应用</a><a href="#open-source">开源</a>
          </nav>
          <div className="nav-actions">
            <a className="github-link" href={repoUrl} target="_blank" rel="noreferrer"><Github size={17} /> GitHub</a>
            <a className="button button-small" href="#open-source">免费开始 <ArrowRight size={16} /></a>
          </div>
          <button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-controls="mobile-menu" aria-label={menuOpen ? "关闭菜单" : "打开菜单"}>
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
        {menuOpen && <nav id="mobile-menu" className="mobile-menu" aria-label="移动端导航">
          {[['#enterprise','企业能力'],['#workflow','工作方式'],['#ai-market','AI 应用'],['#open-source','开源'],['#faq','常见问题']].map(([href,label]) => <a key={href} href={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
          <a href={repoUrl} target="_blank" rel="noreferrer"><Github size={18} /> GitHub 仓库</a>
        </nav>}
      </header>

      <div id="content">
        <section className="hero section-shell">
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-copy">
            <a className="eyebrow" href="#enterprise"><Sparkles size={15} /> 从个人主机到企业基础设施 <ArrowRight size={14} /></a>
            <h1><span className="hero-line">一块面板，统一掌控</span><span className="hero-accent">所有基础设施</span></h1>
            <p className="hero-description">统一管理主机、站点、数据库、容器、任务、备份与安全审计，并把热门 AI 项目变成可追踪的一键部署服务。</p>
            <div className="hero-actions">
              <a className="button" href={repoUrl} target="_blank" rel="noreferrer"><Github size={18} /> 获取 HaizhuOpsPanel <ArrowRight size={17} /></a>
              <a className="button button-secondary" href="#workflow"><Play size={17} fill="currentColor" /> 查看产品演示</a>
            </div>
            <div className="trust-row">
              <span><Check size={15} /> SSH 原生接入</span><span><Check size={15} /> 数据自托管</span><span><Check size={15} /> 操作可审计</span>
            </div>
          </div>
          <div className="hero-product"><DashboardPreview mode="observe" /></div>
        </section>

        <section className="signal-strip" aria-label="产品关键指标">
          <div className="section-shell signal-grid">
            <div><strong>100+</strong><span>预置应用与 AI 模板</span></div>
            <div><strong>&lt; 60s</strong><span>完成首台主机接入</span></div>
            <div><strong>9</strong><span>企业运维能力域</span></div>
            <div><strong>24 / 7</strong><span>基础设施持续可见</span></div>
          </div>
        </section>

        <section className="section section-shell" id="features">
          <div className="section-heading centered">
            <div className="kicker"><Zap size={15} /> 更少切换，更快解决</div>
            <h2>运维不该是<br className="mobile-only" />分散工具的堆叠</h2>
            <p>围绕真实的企业运维路径设计，把分散的资产、命令、状态、风险与执行记录收进一个可信赖的工作台。</p>
          </div>
          <div className="feature-grid">
            {features.map(({ icon: Icon, title, description, tone }) => (
              <article className="feature-card" key={title}>
                <div className={`feature-icon ${tone}`}><Icon size={22} /></div>
                <h3>{title}</h3><p>{description}</p>
                <a href="#workflow" aria-label={`了解${title}`}>了解更多 <ArrowRight size={15} /></a>
              </article>
            ))}
          </div>
        </section>

        <section className="section enterprise-section" id="enterprise">
          <div className="section-shell">
            <div className="section-heading split-heading enterprise-heading">
              <div><div className="kicker"><Building2 size={15} /> 企业能力地图</div><h2>从服务器入口，<br />延伸到完整运维闭环</h2></div>
              <p>参考成熟运维面板的高频能力，同时保留 SSH 原生、低侵入的架构优势。每个模块都有明确的资产对象、状态信号与操作路径。</p>
            </div>
            <div className="enterprise-grid">
              {enterpriseModules.map(({ icon: Icon, title, desc, meta }, index) => (
                <article className="enterprise-card" key={title}>
                  <div className="enterprise-card-top"><span>0{index + 1}</span><Icon size={21} /></div>
                  <h3>{title}</h3><p>{desc}</p><small>{meta}</small>
                </article>
              ))}
            </div>
            <div className="enterprise-proof">
              <div><KeyRound size={20} /><span><b>无 Agent 接入</b><small>基于 SSH 建立统一资产入口</small></span></div>
              <div><ShieldCheck size={20} /><span><b>默认安全路径</b><small>加密凭据与高危操作确认</small></span></div>
              <div><Workflow size={20} /><span><b>操作全链路</b><small>从发现、诊断到执行与回滚</small></span></div>
            </div>
          </div>
        </section>

        <section className="section workflow-section" id="workflow">
          <div className="section-shell">
            <div className="section-heading split-heading">
              <div><div className="kicker"><Activity size={15} /> 从概览到行动</div><h2>复杂留给系统，<br />清晰留给你</h2></div>
              <p>信息不是越多越好。HaizhuOpsPanel 把状态、风险与操作放在同一上下文，并让下一步始终明确。</p>
            </div>
            <div className="workflow-tabs" role="tablist" aria-label="产品工作方式">
              {workflows.map((item, index) => <button key={item.id} role="tab" aria-selected={workflow === item.id} onClick={() => setWorkflow(item.id)}><span>0{index + 1}</span>{item.label}</button>)}
            </div>
            <div className="workflow-content">
              <div className="workflow-copy">
                <h3>{activeWorkflow.title}</h3><p>{activeWorkflow.description}</p>
                <ul>{activeWorkflow.bullets.map((item) => <li key={item}><CircleCheck size={18} /> {item}</li>)}</ul>
              </div>
              <DashboardPreview mode={workflow} />
            </div>
          </div>
        </section>

        <section className="section ai-market-section" id="ai-market">
          <div className="section-shell">
            <div className="section-heading split-heading ai-market-heading">
              <div><div className="kicker"><PackageSearch size={15} /> AI 应用市场</div><h2>把热门开源 AI，<br />变成可管理的服务</h2></div>
              <p>基于项目官方自托管方式制作部署模板。安装、运行状态、访问端口与卸载路径统一进入 HaizhuOpsPanel 管理闭环。</p>
            </div>
            <div className="ai-project-grid">
              {aiProjects.map((project) => (
                <article className="ai-project-card" key={project.name}>
                  <div className="ai-project-head"><div className="ai-logo"><Bot size={20} /></div><span>{project.hot}</span></div>
                  <h3>{project.name}</h3><small>{project.vendor}</small><p>{project.desc}</p>
                  <div className="ai-project-foot"><span>{project.tag}</span><button type="button" aria-label={`${project.name} 已收录到应用市场`}><CircleCheck size={15} /> 已收录</button></div>
                </article>
              ))}
            </div>
            <div className="market-summary"><span><Boxes size={18} /> Docker / Compose / 官方脚本</span><span><ShieldCheck size={18} /> 部署前确认配置与风险</span><span><Activity size={18} /> 安装状态自动发现</span></div>
          </div>
        </section>

        <section className="section section-shell steps-section">
          <div className="section-heading centered"><div className="kicker"><Network size={15} /> 三步开始</div><h2>从连接到掌控，只需几分钟</h2></div>
          <div className="steps-grid">
            {[
              [Server, "01", "添加主机", "输入 SSH 连接信息，HaizhuOpsPanel 会完成连通性、身份与环境检查。"],
              [Radar, "02", "自动识别", "系统、资源、容器与服务状态自动聚合，无需手动配置仪表盘。"],
              [Zap, "03", "开始运维", "通过可视化操作或安全终端，部署服务并处理日常任务。"],
            ].map(([Icon, no, title, desc]) => <article className="step-card" key={no}><span className="step-no">{no}</span><div className="step-icon"><Icon size={24} /></div><h3>{title}</h3><p>{desc}</p></article>)}
          </div>
        </section>

        <section className="section section-shell" id="open-source">
          <div className="open-source-card">
            <div className="source-copy">
              <div className="kicker light"><Github size={15} /> 开源，自由，可掌控</div>
              <h2>你的基础设施，<br />始终属于你</h2>
              <p>HaizhuOpsPanel 采用 MIT 许可证开放源代码。可以部署在自己的服务器，按实际需要扩展，也可以参与共建。</p>
              <div className="source-actions"><a className="button button-light" href={repoUrl} target="_blank" rel="noreferrer"><Github size={18} /> 查看 GitHub <ArrowRight size={17} /></a><a href={`${repoUrl}#readme`} target="_blank" rel="noreferrer">阅读部署文档</a></div>
            </div>
            <div className="code-card" aria-label="HaizhuOpsPanel 安装命令">
              <div className="code-top"><div><span /><span /><span /></div><small>Terminal</small></div>
              <pre><code><i>$</i> git clone {repoUrl}.git{"\n"}<i>$</i> cd HaizhuOpsPanel{"\n"}<i>$</i> npm install{"\n"}<i>$</i> npm run dev{"\n\n"}<span>✓ HaizhuOpsPanel is ready on localhost:3000</span></code></pre>
              <div className="source-badges"><span><ShieldCheck size={14} /> MIT License</span><span><Code2 size={14} /> Next.js</span><span><Sparkles size={14} /> Open Source</span></div>
            </div>
          </div>
        </section>

        <section className="section section-shell faq-section" id="faq">
          <div className="faq-intro"><div className="kicker"><Sparkles size={15} /> 常见问题</div><h2>开始之前，<br />你可能想了解</h2><p>还有其他问题？欢迎在 GitHub 发起讨论。</p><a href={`${repoUrl}/issues`} target="_blank" rel="noreferrer">前往 GitHub Issues <ArrowRight size={15} /></a></div>
          <div className="faq-list">{faqs.map(([q, a]) => <details key={q}><summary>{q}<ChevronDown size={19} /></summary><p>{a}</p></details>)}</div>
        </section>

        <section className="section-shell final-cta">
          <div className="cta-orbit" aria-hidden="true" />
          <div className="kicker light"><Activity size={15} /> 现在开始</div>
          <h2>把复杂留给系统，<br />把全局交给 HaizhuOpsPanel</h2>
          <p>无需信用卡，从开源版本开始管理你的第一台服务器。</p>
          <a className="button button-light" href={repoUrl} target="_blank" rel="noreferrer"><Github size={18} /> 免费获取 HaizhuOpsPanel <ArrowRight size={17} /></a>
        </section>
      </div>

      <footer className="site-footer">
        <div className="section-shell footer-grid"><div><Logo /><p>企业级可视化服务器运维与 AI 应用部署工作台。</p></div><div className="footer-links"><div><b>产品</b><a href="#enterprise">企业能力</a><a href="#workflow">工作方式</a></div><div><b>资源</b><a href={`${repoUrl}#readme`} target="_blank" rel="noreferrer">部署文档</a><a href={`${repoUrl}/issues`} target="_blank" rel="noreferrer">问题反馈</a></div><div><b>开源</b><a href={repoUrl} target="_blank" rel="noreferrer">GitHub</a><a href={`${repoUrl}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a></div></div></div>
        <div className="section-shell footer-bottom"><span>© 2026 HaizhuOpsPanel. Enterprise operations, made visible.</span><span><span className="status-ok" /> All systems operational</span></div>
      </footer>
    </main>
  );
}
