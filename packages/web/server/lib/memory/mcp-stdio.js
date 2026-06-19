import { spawn } from 'child_process';

/**
 * Minimal MCP stdio client.
 *
 * Spawns an MCP server (e.g. `npx -y @mempalace/core mcp`), performs the
 * JSON-RPC `initialize` handshake, optionally calls a sequence of tools, then
 * shuts the server down. Intended for low-frequency settings/CRUD operations,
 * not hot paths.
 *
 * Returns the results of each requested tool call. Tool result content is
 * returned as-is (MCP content array); callers parse the text payloads.
 */
export async function withMcpStdio(command, args, run, { env, timeoutMs = 90000 } = {}) {
  const child = spawn(command, args, {
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  let fatalError = null;

  const cleanup = () => {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  };

  const overallTimer = setTimeout(() => {
    fatalError = new Error(`MCP server timed out after ${timeoutMs}ms`);
    for (const { reject } of pending.values()) reject(fatalError);
    pending.clear();
    cleanup();
  }, timeoutMs);

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'MCP error'));
        else resolve(msg.result);
      }
    }
  });

  child.on('error', (error) => {
    fatalError = error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  });

  const send = (method, params) => new Promise((resolve, reject) => {
    if (fatalError) { reject(fatalError); return; }
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };

  const callTool = async (name, args2 = {}) => {
    const result = await send('tools/call', { name, arguments: args2 });
    return result;
  };

  const listTools = async () => {
    const result = await send('tools/list', {});
    return result?.tools || [];
  };

  try {
    await send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'openchamber-memory', version: '1.0.0' },
    });
    notify('notifications/initialized', {});
    const out = await run({ callTool, listTools });
    return out;
  } finally {
    clearTimeout(overallTimer);
    cleanup();
  }
}

/**
 * Extract concatenated text from an MCP tool result's content array.
 */
export function mcpResultText(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n');
}
