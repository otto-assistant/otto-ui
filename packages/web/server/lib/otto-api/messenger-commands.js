/**
 * Text-prefix command system for Discord + Telegram bots.
 *
 * Mirrors the slash commands available in the OpenChamber web chat input
 * (`/undo`, `/redo`, `/compact`, `/summary`, `/init`, `/review` + dynamic
 * project commands) and adds the kimaki-inspired session-control set
 * (`/abort`, `/new`, `/model`, `/agent`, `/sessions`, `/status`, `/help`).
 *
 * Why text-prefix instead of native Discord slash commands:
 *   - Telegram doesn't have native slash commands — BotFather just hints
 *     at them in the autocomplete, the actual dispatch is plain text parsing.
 *     So we'd need text parsing for Telegram anyway.
 *   - Native Discord slash command registration requires per-bot writes to
 *     `PUT /applications/:app_id/commands`, has guild scope vs global scope
 *     decisions, and re-registration after every bot restart. Skipping that
 *     keeps a fresh bot working out of the box. Native registration can be
 *     a follow-up.
 *
 * Resolution model:
 *   - Per-surface (channel + thread) overrides for `model` and `agent` are
 *     stored in the bridge SQLite store. When a `prompt_async` is sent, the
 *     bridge picks them up.
 *   - `/abort`, `/undo`, `/redo`, `/compact`, `/summary` operate on the
 *     CURRENT bound session for the surface (via OpenCode REST).
 *   - `/new` unbinds the surface so the next prompt creates a fresh session.
 *   - `/init`, `/review`, and any other registered OpenCode command pass
 *     through to `POST /session/:id/command`.
 *   - `/help`, `/status`, `/sessions`, `/model`, `/agent` (no args) reply
 *     with text — they don't reach OpenCode.
 */

import crypto from 'node:crypto';

// Commands we recognise. The `usage` text is shown by /help so order matters.
const COMMAND_HELP = [
  { name: 'help', usage: '/help', summary: 'Show this list' },
  {
    name: 'status',
    usage: '/status',
    summary: 'Show the current session, project, model and agent for this conversation',
  },
  { name: 'abort', usage: '/abort', summary: 'Stop the current OpenCode turn' },
  {
    name: 'new',
    usage: '/new',
    summary: 'Drop the current session and start a fresh one on the next message',
  },
  { name: 'undo', usage: '/undo', summary: 'Revert one user message' },
  { name: 'redo', usage: '/redo', summary: 'Step forward through undo' },
  {
    name: 'compact',
    usage: '/compact',
    summary: 'Summarise + compact the session history (destructive)',
  },
  {
    name: 'summary',
    usage: '/summary [topic]',
    summary: 'Non-destructive summary of the session',
  },
  { name: 'init', usage: '/init', summary: 'Run OpenCode `init` (creates/updates AGENTS.md)' },
  { name: 'review', usage: '/review', summary: 'Run OpenCode `review` workflow' },
  {
    name: 'model',
    usage: '/model [provider/model]',
    summary:
      'Without args: list providers + models. With args: set this conversation\'s model.',
  },
  {
    name: 'agent',
    usage: '/agent [name]',
    summary: 'Without args: list agents. With args: set this conversation\'s agent.',
  },
  {
    name: 'sessions',
    usage: '/sessions',
    summary: 'List recent OpenCode sessions for this project',
  },
];

const KNOWN_TOP_LEVEL = new Set(COMMAND_HELP.map((c) => c.name));

/**
 * Extract the leading slash command from a user message. Returns `null`
 * when the message is a normal prompt.
 *
 * Mirrors kimaki's extractLeadingOpencodeCommand — only the FIRST non-empty
 * line matters. Multi-line messages where the first line is a `/cmd` are
 * still treated as commands so users can paste context after a `/init`.
 */
export function parseLeadingCommand(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const firstLine = trimmed.split('\n')[0];
  const m = firstLine.match(/^\/([A-Za-z][A-Za-z0-9_-]*)\b\s*(.*)$/);
  if (!m) return null;
  return {
    name: m[1].toLowerCase(),
    args: (m[2] ?? '').trim(),
    // Everything AFTER the first line — for /init / /review style commands
    // where the user pasted additional context.
    body: trimmed.includes('\n') ? trimmed.split('\n').slice(1).join('\n').trim() : '',
  };
}

function tokenHash(token) {
  if (!token) return '';
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

function targetKey({ type, channelId, threadId }) {
  if (type === 'discord') return threadId ? `${threadId}` : `${channelId}`;
  return threadId ? `${channelId}:${threadId}` : `${channelId}`;
}

function fmtTable(rows, columns) {
  // Compact markdown-ish list (no real table — Discord doesn't render them).
  const lines = [];
  for (const r of rows) {
    const parts = columns.map((c) => {
      const v = r[c.key];
      if (v == null || v === '') return null;
      if (c.code) return `\`${String(v)}\``;
      if (c.italic) return `_${String(v)}_`;
      return String(v);
    }).filter(Boolean);
    lines.push(parts.join(' · '));
  }
  return lines.join('\n');
}

/**
 * Run a leading slash command for a messenger message.
 *
 * @param {object} args
 * @param {{ name: string, args: string, body: string }} args.command - parsed result
 * @param {object} args.ctx - { type, token, channelId, threadId, sourceMessageId }
 * @param {{
 *   listProviders: () => Promise<Array<{ id, name, models: Array<{ id, name }> }>>,
 *   listAgents: () => Promise<Array<{ name, description?, model?, hidden? }>>,
 *   listSessions: (directory?: string) => Promise<Array<any>>,
 *   abortSession: (sessionId: string) => Promise<{ ok, error? }>,
 *   revertSession: (sessionId: string, messageId?: string) => Promise<{ ok, error? }>,
 *   unrevertSession: (sessionId: string) => Promise<{ ok, error? }>,
 *   summarizeSession: (sessionId: string, modelRef: string) => Promise<{ ok, error? }>,
 *   sendOpencodeCommand: (sessionId: string, name: string, argumentsText: string) => Promise<{ ok, error? }>,
 *   sendPrompt: (sessionId: string, projectPath: string | null, text: string) => Promise<{ ok, error? }>,
 * }} args.opencode - small adapter passed in by the bridge
 * @param {object} args.binding - current binding for this surface
 *   { sessionId?, projectPath?, projectLabel?, modelOverride?, agentOverride? }
 * @param {{
 *   setOverrides: (changes: { modelOverride?: string|null, agentOverride?: string|null }) => Promise<void>,
 *   unbindSession: () => Promise<void>,
 * }} args.surfaceMutators
 * @returns {Promise<null | { reply: string }>} - null means "not a command, pass through".
 */
export async function executeMessengerCommand({
  command,
  ctx,
  opencode,
  binding,
  surfaceMutators,
}) {
  if (!command || !KNOWN_TOP_LEVEL.has(command.name)) {
    // Pass through — let OpenCode itself decide (e.g. user-defined `/changelog`).
    // We return null so the bridge forwards as a prompt; OpenCode's
    // session.command machinery handles registered custom commands when the
    // text starts with /name on its own line.
    return null;
  }

  const cmd = command.name;
  const sessionId = binding?.sessionId ?? null;

  switch (cmd) {
    case 'help': {
      const lines = ['**Otto messenger commands**', ''];
      for (const c of COMMAND_HELP) lines.push(`\`${c.usage}\` — ${c.summary}`);
      lines.push('');
      lines.push(
        'Free text is sent to OpenCode as a normal chat prompt. The mapped project, model and agent are picked from the channel/thread automatically.',
      );
      return { reply: lines.join('\n') };
    }

    case 'status': {
      const lines = ['**Otto status**'];
      lines.push(
        `Project: ${binding?.projectLabel ?? binding?.projectPath ?? '_not bound — reply `clone <url>`, `path </abs>` or `new <name>` to set up_'}`,
      );
      lines.push(`Session: ${sessionId ? `\`${sessionId}\`` : '_none yet — first prompt creates one_'}`);
      lines.push(`Model: ${binding?.modelOverride ? `\`${binding.modelOverride}\`` : '_OpenCode default_'}`);
      lines.push(`Agent: ${binding?.agentOverride ? `\`${binding.agentOverride}\`` : '_OpenCode default_'}`);
      lines.push(`Surface: ${ctx.type} · channel \`${ctx.channelId}\`${ctx.threadId ? ` thread \`${ctx.threadId}\`` : ''}`);
      return { reply: lines.join('\n') };
    }

    case 'abort': {
      if (!sessionId) return { reply: '✗ No session is active on this conversation.' };
      const r = await opencode.abortSession(sessionId);
      return { reply: r.ok ? `✓ Aborted session \`${sessionId}\`.` : `✗ Could not abort: ${r.error ?? 'unknown error'}` };
    }

    case 'new': {
      await surfaceMutators.unbindSession();
      return {
        reply:
          '✓ Session cleared. The next message you send will start a fresh OpenCode session in the same project.',
      };
    }

    case 'undo': {
      if (!sessionId) return { reply: '✗ No session is active on this conversation.' };
      const r = await opencode.revertSession(sessionId);
      return { reply: r.ok ? '✓ Reverted one turn.' : `✗ Revert failed: ${r.error ?? 'unknown error'}` };
    }

    case 'redo': {
      if (!sessionId) return { reply: '✗ No session is active on this conversation.' };
      const r = await opencode.unrevertSession(sessionId);
      return { reply: r.ok ? '✓ Stepped forward.' : `✗ Redo failed: ${r.error ?? 'unknown error'}` };
    }

    case 'compact': {
      if (!sessionId) return { reply: '✗ No session is active on this conversation.' };
      const modelRef = binding?.modelOverride ?? '';
      const r = await opencode.summarizeSession(sessionId, modelRef);
      return {
        reply: r.ok
          ? '✓ Compaction requested. The next assistant turn will run on the compacted context.'
          : `✗ Compaction failed: ${r.error ?? 'unknown error'}`,
      };
    }

    case 'summary': {
      if (!sessionId) return { reply: '✗ No session is active on this conversation.' };
      const topic = command.args.trim();
      const synthetic =
        topic.length > 0
          ? `Please write a short markdown summary of this session focused on: ${topic}. Mention unrelated threads only briefly.`
          : 'Please write a short markdown summary of this session: key requests, decisions, files touched, and open follow-ups.';
      const r = await opencode.sendPrompt(sessionId, binding?.projectPath ?? null, synthetic);
      return {
        reply: r.ok
          ? '⏳ Summary requested — Otto is writing it now.'
          : `✗ Could not request summary: ${r.error ?? 'unknown error'}`,
      };
    }

    case 'init':
    case 'review': {
      if (!sessionId) {
        return { reply: `✗ Send a regular message first so I can spin up a session, then \`/${cmd}\`.` };
      }
      const r = await opencode.sendOpencodeCommand(sessionId, cmd, command.args + (command.body ? `\n${command.body}` : ''));
      return {
        reply: r.ok
          ? `⏳ Running \`/${cmd}\` against the current session…`
          : `✗ \`/${cmd}\` failed: ${r.error ?? 'unknown error'}`,
      };
    }

    case 'model': {
      if (!command.args) {
        // List view.
        const providers = await opencode.listProviders().catch(() => []);
        if (!providers || providers.length === 0) {
          return { reply: '_(no providers configured — see Settings → Providers in the web UI.)_' };
        }
        const lines = ['**Available models** — set with `/model provider/model`', ''];
        for (const p of providers.slice(0, 12)) {
          const ms = (p.models ?? []).slice(0, 8).map((m) => `\`${p.id}/${m.id}\``).join(' · ');
          lines.push(`**${p.name ?? p.id}** — ${ms || '_no models_'}`);
        }
        if (binding?.modelOverride) {
          lines.push('', `Current override on this conversation: \`${binding.modelOverride}\``);
        }
        return { reply: lines.join('\n') };
      }
      // Set view.
      const value = command.args.trim();
      if (value === 'reset' || value === 'clear' || value === 'default') {
        await surfaceMutators.setOverrides({ modelOverride: null });
        return { reply: '✓ Model override cleared — using OpenCode default.' };
      }
      if (!/^[^/]+\/[^/]+$/.test(value)) {
        return {
          reply:
            '✗ Use `/model provider/model` (e.g. `/model anthropic/claude-sonnet-4`). Run `/model` with no args to see the list.',
        };
      }
      await surfaceMutators.setOverrides({ modelOverride: value });
      return { reply: `✓ Model set to \`${value}\` for this conversation.` };
    }

    case 'agent': {
      if (!command.args) {
        const agents = await opencode.listAgents().catch(() => []);
        const visible = agents.filter((a) => !a.hidden);
        if (visible.length === 0) {
          return { reply: '_(no agents configured — see Settings → Agents in the web UI.)_' };
        }
        const lines = ['**Available agents** — set with `/agent name`', ''];
        for (const a of visible.slice(0, 20)) {
          const tail = [a.model ? `model \`${a.model}\`` : null, a.description ?? null]
            .filter(Boolean)
            .join(' · ');
          lines.push(`\`${a.name}\`${tail ? ` — ${tail}` : ''}`);
        }
        if (binding?.agentOverride) {
          lines.push('', `Current override on this conversation: \`${binding.agentOverride}\``);
        }
        return { reply: lines.join('\n') };
      }
      const value = command.args.trim();
      if (value === 'reset' || value === 'clear' || value === 'default') {
        await surfaceMutators.setOverrides({ agentOverride: null });
        return { reply: '✓ Agent override cleared — using OpenCode default.' };
      }
      await surfaceMutators.setOverrides({ agentOverride: value });
      return { reply: `✓ Agent set to \`${value}\` for this conversation.` };
    }

    case 'sessions': {
      const sessions = await opencode.listSessions(binding?.projectPath ?? null).catch(() => []);
      if (!sessions || sessions.length === 0) {
        return {
          reply: binding?.projectPath
            ? `_(no sessions yet in ${binding.projectPath})_`
            : '_(no sessions found)_',
        };
      }
      const top = sessions.slice(0, 10);
      const lines = [`**Recent sessions** ${binding?.projectLabel ? `(${binding.projectLabel})` : ''}`, ''];
      const rows = top.map((s) => ({
        when: s.time?.updated ? new Date(s.time.updated).toLocaleString() : (s.updatedAt ?? ''),
        id: (s.id ?? s.sessionID ?? '').slice(0, 22),
        title: s.title ?? '(untitled)',
      }));
      lines.push(
        fmtTable(rows, [
          { key: 'when', italic: true },
          { key: 'title' },
          { key: 'id', code: true },
        ]),
      );
      return { reply: lines.join('\n') };
    }

    default:
      return null;
  }
}

export { COMMAND_HELP, tokenHash, targetKey };
