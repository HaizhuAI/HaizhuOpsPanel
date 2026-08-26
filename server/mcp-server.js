#!/usr/bin/env node
/**
 * HaizhuOpsPanel — MCP 服务器（stdio 传输）
 *
 * 将面板的远程主机运维能力（服务查看、容器管理、磁盘诊断、应用部署等）
 * 以标准 MCP（Model Context Protocol）工具形式暴露给任意 MCP 客户端
 * （Claude Desktop、Cursor、Cline、WorkBuddy 等）。
 *
 * 零第三方依赖：直接实现 JSON-RPC 2.0 over stdio（换行分隔 JSON）。
 *
 * 启动方式：
 *   node server/mcp-server.js
 *
 * 安全：
 *   - run_command 默认禁用，设置环境变量 MCP_ALLOW_RAW_COMMAND=1 开启
 *   - 所有工具调用写入 data/audit.jsonl 审计日志
 *   - 主机凭据沿用面板的 AES-256-GCM 加密存储，不经过网络
 */
const readline = require('readline');
const tools = require('./mcp-tools');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'haizhu-opspanel', version: '2.2.0' };

const log = (...a) => {
  // 日志走 stderr，不污染 stdio 上的 JSON-RPC 通道
  try { process.stderr.write('[mcp] ' + a.join(' ') + '\n'); } catch (_) {}
};

function makeResult(id, payload) {
  return { jsonrpc: '2.0', id, result: payload };
}

function makeError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function dispatch(msg) {
  const { id, method, params } = msg;
  const hasId = id !== undefined && id !== null;

  switch (method) {
    case 'initialize':
      return makeResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'HaizhuOpsPanel 运维工具集：先调用 list_hosts 获取主机列表，再用 hostId 调用其他工具查看服务/容器/磁盘状态或部署应用商店应用。所有变更类操作（启停服务、容器操作、应用部署/卸载）都会记录审计日志。',
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/roots/list_changed':
      return null; // 通知无需响应

    case 'ping':
      return makeResult(id, {});

    case 'tools/list':
      return makeResult(id, { tools: tools.mcpToolList() });

    case 'tools/call': {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (!name) return makeError(id, -32602, '缺少工具名');
      if (!tools.getTool(name)) return makeError(id, -32602, `未知工具: ${name}`);
      log(`tools/call ${name} args=${JSON.stringify(args).slice(0, 300)}`);
      const { ok, text } = await tools.callTool(name, args, 'mcp');
      return makeResult(id, {
        content: [{ type: 'text', text }],
        isError: !ok,
      });
    }

    case 'resources/list':
      return makeResult(id, { resources: [] });

    case 'prompts/list':
      return makeResult(id, { prompts: [] });

    default:
      if (hasId) return makeError(id, -32601, `未实现的方法: ${method}`);
      return null;
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function main() {
  log(`HaizhuOpsPanel MCP 服务器已启动 (stdio, protocol ${PROTOCOL_VERSION})`);
  log(`可用工具 ${tools.availableTools().length} 个: ${tools.availableTools().map((t) => t.name).join(', ')}`);
  log('run_command ' + (process.env.MCP_ALLOW_RAW_COMMAND === '1'
    ? '已启用（危险：允许任意命令）'
    : '已禁用（设置 MCP_ALLOW_RAW_COMMAND=1 可开启）'));

  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (_) {
      log('忽略无法解析的输入行');
      return;
    }
    const batch = Array.isArray(msg) ? msg : [msg];
    for (const one of batch) {
      Promise.resolve(dispatch(one))
        .then((res) => { if (res) send(res); })
        .catch((e) => {
          log('处理请求异常: ' + (e && e.message));
          if (one.id !== undefined && one.id !== null) {
            send(makeError(one.id, -32603, '内部错误: ' + (e && e.message)));
          }
        });
    }
  });

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

main().catch((e) => {
  log('启动失败: ' + (e && e.stack || e));
  process.exit(1);
});
