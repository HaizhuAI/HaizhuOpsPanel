/**
 * AI 运维助手 —— 自然语言 → MCP 工具调用
 *
 * 工作方式（OpenAI 兼容 function calling 循环）：
 *   1. 用户用自然语言描述需求（"看看生产机上 nginx 状态" / "帮我部署 open-webui"）
 *   2. LLM 从 mcp-tools 的工具清单中选择工具并生成参数
 *   3. 服务端执行工具（SSH 到目标主机），把结果回传给 LLM
 *   4. 循环直到 LLM 给出最终自然语言答复（最多 MAX_ROUNDS 轮）
 *
 * 配置（环境变量，或项目根目录 .env 文件，与 npm start 同进程读取）：
 *   AI_BASE_URL  OpenAI 兼容接口地址，默认 https://api.openai.com/v1
 *                （DeepSeek: https://api.deepseek.com/v1  智谱: https://open.bigmodel.cn/api/paas/v4 等）
 *   AI_API_KEY   API 密钥（必填，否则 AI 助手不可用；MCP 外部客户端不受影响）
 *   AI_MODEL     模型名，默认 gpt-4o-mini（DeepSeek 可用 deepseek-chat，智谱可用 glm-4-flash 等）
 *
 * 未配置 AI 时接口返回 ok:false 与配置指引，面板前端会显示引导。
 */
const tools = require('./mcp-tools');
const audit = require('./audit');

const MAX_ROUNDS = 8; // 最多工具调用轮数，防止死循环
const MAX_STEPS = 12; // 返回给前端的步骤记录上限

const SYSTEM_PROMPT = `你是 HaizhuOpsPanel 的 AI 运维助手，通过调用工具帮用户管理远程 Linux 主机。

规则：
1. 用户的意图如果涉及某台主机的查看或操作，先调用 list_hosts 确认主机，除非用户已明确给出主机名/ID。
2. 查看服务用 list_services / service_action(status)；容器用 list_containers / container_logs；磁盘、进程分别用 disk_usage / top_processes。
3. 部署应用：优先在应用商店（list_apps）查找并 deploy_app；商店没有时用 github_search 搜索 GitHub 最新项目（用英文关键字，展示 Star/语言/最近更新），用户确认后用 github_deploy 部署（自动识别 docker-compose / Dockerfile；monorepo 记得问 subDir，纯 Dockerfile 项目问对外端口）。卸载用 uninstall_app。
4. 变更类操作（启停服务、重启容器、部署、卸载）执行前必须先用一句话向用户确认，除非用户本轮消息中已明确要求执行（如"帮我重启 nginx"视为已确认）。
5. 工具结果要提炼成人话：关键指标、异常项、下一步建议。不要原样粘贴大段命令输出。
6. 工具报错时解释原因并给出建议，不要编造结果。
7. 用简体中文回答，简洁分点。`;

function loadConfig() {
  const cfg = {
    baseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
  };
  return cfg;
}

/** 面板 AI 助手是否已配置可用 */
function isConfigured() {
  return !!loadConfig().apiKey;
}

function status() {
  const cfg = loadConfig();
  return {
    configured: !!cfg.apiKey,
    model: cfg.apiKey ? cfg.model : null,
    baseUrl: cfg.apiKey ? cfg.baseUrl : null,
    toolCount: tools.availableTools().length,
  };
}

/** 调用一次 chat completions */
async function chatCompletion(cfg, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        tools: tools.openaiToolList(),
        tool_choice: 'auto',
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AI 接口返回 ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const choice = data.choices && data.choices[0];
    if (!choice) throw new Error('AI 接口返回格式异常（无 choices）');
    return choice.message;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 处理一轮对话
 * @param {Array} history  [{role:'user'|'assistant', content}] 之前的对话（不含本轮）
 * @param {string} message 本轮用户输入
 * @returns {{ok, reply, steps}} steps: [{tool, args, ok, output}]
 */
async function chat(history, message) {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    return {
      ok: false,
      error: 'AI 助手未配置。请在启动面板的服务器上设置环境变量 AI_API_KEY（可选 AI_BASE_URL、AI_MODEL）后重启面板。',
    };
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(Array.isArray(history) ? history.slice(-16) : []),
    { role: 'user', content: String(message || '') },
  ];

  const steps = [];
  let reply = '';
  let round = 0;

  while (round < MAX_ROUNDS) {
    round += 1;
    const msg = await chatCompletion(cfg, messages);
    messages.push(msg);

    // 无工具调用 → 最终回答
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      reply = msg.content || '（模型未返回内容）';
      break;
    }

    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch (_) {}
      const step = { tool: call.function.name, args, ok: true, output: '' };
      steps.push(step);
      if (steps.length <= MAX_STEPS) {
        // 执行工具（内部已写审计）
        const result = await tools.callTool(call.function.name, args, 'ai');
        step.ok = result.ok;
        step.output = result.text.length > 4000 ? result.text.slice(0, 4000) + '…（截断）' : result.text;
      } else {
        step.ok = false;
        step.output = '已达单轮对话工具调用上限，请缩小问题范围后重试。';
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: step.output,
      });
    }
  }

  if (!reply) reply = '（本轮工具调用已达上限，以上是已完成的操作结果，可继续提问。）';

  audit.write('ai.chat', { actor: 'ai-assistant', meta: { rounds: round, tools: steps.map((s) => s.tool) } });
  return { ok: true, reply, steps };
}

module.exports = { chat, status, isConfigured };
