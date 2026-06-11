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
import { parseVerbosityLevel, VERBOSITY_LEVELS } from './messenger-verbosity.js';

const VERBOSITY_DESCRIPTIONS = {
  quiet: 'final answer only — hides reasoning and tool activity',
  normal: 'compact activity feed — tool names + a thinking marker, no payloads (default)',
  verbose: 'full detail — commands, diffs, outputs and reasoning, formatted for reading',
};

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
    usage: '/model [provider/model | default provider/model | reset]',
    summary:
      'List models / set this conversation\'s model / `default provider/model` sets a project-wide default.',
  },
  {
    name: 'agent',
    usage: '/agent [name | default name | reset]',
    summary: 'List agents / set this conversation\'s agent / `default name` sets a project-wide default.',
  },
  {
    name: 'verbosity',
    usage: '/verbosity [quiet | normal | verbose | default <level> | reset]',
    summary:
      'How much Otto streams back: `quiet` = answer only, `normal` = tool names + thinking marker, `verbose` = full commands/diffs/outputs. `default <level>` sets the messenger-wide default.',
  },
  {
    name: 'skill',
    usage: '/skill [name]',
    summary:
      'List the skills available to the agent / hand one to Otto for the next turn. On Discord, run `/skill` for a dropdown picker.',
  },
  {
    name: 'sessions',
    usage: '/sessions',
    summary: 'List recent OpenCode sessions for this project',
  },
  {
    name: 'session',
    usage: '/session <prompt>',
    summary: 'Start a brand-new session (and thread) with the given prompt',
  },
  {
    name: 'resume',
    usage: '/resume [n | session-id]',
    summary: 'Resume a previous session — `/resume` lists candidates, `/resume 2` opens one in a new thread',
  },
  {
    name: 'fork',
    usage: '/fork [n]',
    summary: 'Branch from an earlier user message — `/fork` lists messages, `/fork 2` forks in a new thread',
  },
  { name: 'share', usage: '/share', summary: 'Generate a public URL for the current session' },
  { name: 'unshare', usage: '/unshare', summary: 'Revoke the public URL for the current session' },
  {
    name: 'queue',
    usage: '/queue <message>',
    summary: 'Queue a message to send automatically after the current response finishes',
  },
  { name: 'clear-queue', usage: '/clear-queue', summary: 'Clear all queued messages for this conversation' },
  {
    name: 'mention-mode',
    usage: '/mention-mode',
    summary: 'Toggle mention-only mode — when on, new sessions in this channel need an @mention',
  },
  {
    name: 'new-worktree',
    usage: '/new-worktree [name]',
    summary: 'Create an isolated git worktree + branch and work there in a new thread',
  },
  {
    name: 'merge-worktree',
    usage: '/merge-worktree',
    summary: 'Squash-merge this worktree\'s commits into the default branch',
  },
  {
    name: 'schedule',
    usage: '/schedule <when> [model=p/m] [agent=name] <prompt> | list | delete <id>',
    summary:
      'Schedule a prompt — `when` is a UTC ISO date (2026-03-01T09:00:00Z) or cron (`0 9 * * 1`, UTC). In a thread it continues that conversation; in a channel it starts a new chat.',
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
 *   abortSession: (sessionId: string, directory?: string) => Promise<{ ok, error? }>,
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
  bridgeOps = null,
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
      const surfaceModel = binding?.modelOverride;
      const projectModel = binding?.projectDefaults?.modelDefault;
      const globalModel = binding?.globalDefaultModel;
      lines.push(
        `Model: ${
          surfaceModel
            ? `\`${surfaceModel}\` _(this conversation)_`
            : projectModel
              ? `\`${projectModel}\` _(project default)_`
              : globalModel
                ? `\`${globalModel}\` _(OpenChamber default)_`
                : '_OpenCode default_'
        }`,
      );
      const surfaceAgent = binding?.agentOverride;
      const projectAgent = binding?.projectDefaults?.agentDefault;
      const globalAgent = binding?.globalDefaultAgent;
      lines.push(
        `Agent: ${
          surfaceAgent
            ? `\`${surfaceAgent}\` _(this conversation)_`
            : projectAgent
              ? `\`${projectAgent}\` _(project default)_`
              : globalAgent
                ? `\`${globalAgent}\` _(OpenChamber default)_`
                : '_OpenCode default_'
        }`,
      );
      lines.push(`Surface: ${ctx.type} · channel \`${ctx.channelId}\`${ctx.threadId ? ` thread \`${ctx.threadId}\`` : ''}`);
      return { reply: lines.join('\n') };
    }

    case 'abort': {
      if (!sessionId) return { reply: '✗ No session is active on this conversation.' };
      const r = await opencode.abortSession(sessionId, binding?.projectPath ?? undefined);
      // kimaki parity: aborting clears any queued messages for the surface.
      let clearedNote = '';
      if (r.ok && bridgeOps?.clearQueue) {
        const cleared = await bridgeOps.clearQueue().catch(() => 0);
        if (cleared > 0) clearedNote = ` Cleared ${cleared} queued message${cleared === 1 ? '' : 's'}.`;
      }
      return { reply: r.ok ? `🛑 Aborted session \`${sessionId}\`.${clearedNote}` : `✗ Could not abort: ${r.error ?? 'unknown error'}` };
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
        const providers = await opencode.listProviders().catch(() => []);
        if (!providers || providers.length === 0) {
          return { reply: '_(no providers configured — see Settings → Providers in the web UI.)_' };
        }
        const lines = [
          '**Available models** — set with `/model provider/model` (this conversation) or `/model default provider/model` (project-wide)',
          '',
        ];
        for (const p of providers.slice(0, 12)) {
          const ms = (p.models ?? []).slice(0, 8).map((m) => `\`${p.id}/${m.id}\``).join(' · ');
          lines.push(`**${p.name ?? p.id}** — ${ms || '_no models_'}`);
        }
        if (binding?.modelOverride) {
          lines.push('', `Surface override: \`${binding.modelOverride}\``);
        }
        if (binding?.projectDefaults?.modelDefault) {
          lines.push(`Project default: \`${binding.projectDefaults.modelDefault}\``);
        }
        if (binding?.globalDefaultModel) {
          lines.push(`OpenChamber default: \`${binding.globalDefaultModel}\``);
        }
        if (
          !binding?.modelOverride &&
          !binding?.projectDefaults?.modelDefault &&
          !binding?.globalDefaultModel
        ) {
          lines.push('', '_No default set — OpenCode picks the model. Set one above or in Settings → Defaults._');
        }
        return { reply: lines.join('\n') };
      }
      const raw = command.args.trim();
      const defaultMatch = raw.match(/^default\s+(.+)$/i);
      if (defaultMatch) {
        const value = defaultMatch[1].trim();
        if (!binding?.projectPath) {
          return {
            reply:
              '✗ This conversation has no project bound yet. Send a regular message first (or run the bootstrap dialogue) before setting project defaults.',
          };
        }
        if (value === 'reset' || value === 'clear') {
          await surfaceMutators.setProjectDefaults({ modelDefault: null });
          return {
            reply: `✓ Project default model cleared for *${binding.projectLabel ?? binding.projectPath}*.`,
          };
        }
        if (!/^[^/]+\/[^/]+$/.test(value)) {
          return {
            reply:
              '✗ Use `/model default provider/model` (e.g. `/model default anthropic/claude-sonnet-4`).',
          };
        }
        await surfaceMutators.setProjectDefaults({ modelDefault: value });
        return {
          reply: `✓ Project default model set to \`${value}\` for *${binding.projectLabel ?? binding.projectPath}*. Every Discord session in this project uses it unless overridden.`,
        };
      }
      if (raw === 'reset' || raw === 'clear') {
        await surfaceMutators.setOverrides({ modelOverride: null });
        return { reply: '✓ Surface model override cleared — falling back to project default / OpenCode default.' };
      }
      if (!/^[^/]+\/[^/]+$/.test(raw)) {
        return {
          reply:
            '✗ Use `/model provider/model` (e.g. `/model anthropic/claude-sonnet-4`), or `/model default provider/model` for project-wide. Run `/model` with no args to see the list.',
        };
      }
      await surfaceMutators.setOverrides({ modelOverride: raw });
      return { reply: `✓ Model set to \`${raw}\` for this conversation.` };
    }

    case 'agent': {
      if (!command.args) {
        const agents = await opencode.listAgents().catch(() => []);
        const visible = agents.filter((a) => !a.hidden);
        if (visible.length === 0) {
          return { reply: '_(no agents configured — see Settings → Agents in the web UI.)_' };
        }
        const lines = [
          '**Available agents** — set with `/agent name` (this conversation) or `/agent default name` (project-wide)',
          '',
        ];
        for (const a of visible.slice(0, 20)) {
          const tail = [a.model ? `model \`${a.model}\`` : null, a.description ?? null]
            .filter(Boolean)
            .join(' · ');
          lines.push(`\`${a.name}\`${tail ? ` — ${tail}` : ''}`);
        }
        if (binding?.agentOverride) {
          lines.push('', `Surface override: \`${binding.agentOverride}\``);
        }
        if (binding?.projectDefaults?.agentDefault) {
          lines.push(`Project default: \`${binding.projectDefaults.agentDefault}\``);
        }
        return { reply: lines.join('\n') };
      }
      const raw = command.args.trim();
      const defaultMatch = raw.match(/^default\s+(.+)$/i);
      if (defaultMatch) {
        const value = defaultMatch[1].trim();
        if (!binding?.projectPath) {
          return {
            reply:
              '✗ This conversation has no project bound yet. Send a regular message first before setting project defaults.',
          };
        }
        if (value === 'reset' || value === 'clear') {
          await surfaceMutators.setProjectDefaults({ agentDefault: null });
          return {
            reply: `✓ Project default agent cleared for *${binding.projectLabel ?? binding.projectPath}*.`,
          };
        }
        await surfaceMutators.setProjectDefaults({ agentDefault: value });
        return {
          reply: `✓ Project default agent set to \`${value}\` for *${binding.projectLabel ?? binding.projectPath}*.`,
        };
      }
      if (raw === 'reset' || raw === 'clear') {
        await surfaceMutators.setOverrides({ agentOverride: null });
        return { reply: '✓ Surface agent override cleared — falling back to project default / OpenCode default.' };
      }
      await surfaceMutators.setOverrides({ agentOverride: raw });
      return { reply: `✓ Agent set to \`${raw}\` for this conversation.` };
    }

    case 'verbosity': {
      const effective =
        binding?.verbosityOverride ?? binding?.verbosityDefault ?? 'normal';
      if (!command.args) {
        const lines = [
          '**Output verbosity** — how much of each turn Otto mirrors back here',
          '',
        ];
        for (const level of VERBOSITY_LEVELS) {
          const marker = level === effective ? '➤ ' : '· ';
          lines.push(`${marker}\`${level}\` — ${VERBOSITY_DESCRIPTIONS[level]}`);
        }
        lines.push('');
        lines.push(
          'Set with `/verbosity verbose` (this conversation) or `/verbosity default verbose` (every channel/chat on this bot). `/verbosity reset` clears the conversation override.',
        );
        if (binding?.verbosityOverride) {
          lines.push('', `Conversation override: \`${binding.verbosityOverride}\``);
        }
        if (binding?.verbosityDefault) {
          lines.push(`Messenger default: \`${binding.verbosityDefault}\``);
        }
        return { reply: lines.join('\n') };
      }

      const raw = command.args.trim();
      const defaultMatch = raw.match(/^default\s+(.+)$/i);
      if (defaultMatch) {
        const value = defaultMatch[1].trim();
        if (value === 'reset' || value === 'clear') {
          await surfaceMutators.setVerbosityDefault(null);
          return { reply: '✓ Messenger default verbosity cleared — falling back to `normal`.' };
        }
        const level = parseVerbosityLevel(value);
        if (!level) {
          return {
            reply: `✗ Unknown level. Use one of: ${VERBOSITY_LEVELS.map((l) => `\`${l}\``).join(', ')}.`,
          };
        }
        await surfaceMutators.setVerbosityDefault(level);
        return {
          reply: `✓ Messenger default verbosity set to \`${level}\` — ${VERBOSITY_DESCRIPTIONS[level]}.`,
        };
      }

      if (raw === 'reset' || raw === 'clear') {
        await surfaceMutators.setOverrides({ verbosityOverride: null });
        return { reply: '✓ Conversation verbosity override cleared — falling back to the messenger default.' };
      }

      const level = parseVerbosityLevel(raw);
      if (!level) {
        return {
          reply: `✗ Unknown level. Use one of: ${VERBOSITY_LEVELS.map((l) => `\`${l}\``).join(', ')}, or \`/verbosity default <level>\`.`,
        };
      }
      await surfaceMutators.setOverrides({ verbosityOverride: level });
      return {
        reply: `✓ Verbosity set to \`${level}\` for this conversation — ${VERBOSITY_DESCRIPTIONS[level]}.`,
      };
    }

    case 'skill': {
      const projectPath = binding?.projectPath ?? null;
      const skills = await (opencode.listSkills
        ? opencode.listSkills(projectPath)
        : Promise.resolve([])
      ).catch(() => []);
      if (!command.args) {
        if (!skills || skills.length === 0) {
          return {
            reply:
              '_(no skills available for this conversation — install some via the Skills catalog in the web UI.)_',
          };
        }
        const lines = [
          '**Available skills** — hand one to Otto with `/skill <name>` (on Discord, `/skill` opens a dropdown)',
          '',
        ];
        for (const s of skills.slice(0, 25)) {
          const desc = (s.description || '').trim();
          lines.push(`\`${s.name}\`${desc ? ` — ${desc}` : ''}`);
        }
        return { reply: lines.join('\n') };
      }
      const wanted = command.args.trim();
      const match =
        skills.find((s) => s.name === wanted) ||
        skills.find((s) => (s.name ?? '').toLowerCase() === wanted.toLowerCase());
      if (!match) {
        return { reply: `✗ Unknown skill \`${wanted}\`. Run \`/skill\` to see what's available.` };
      }
      if (!sessionId) {
        return {
          reply: `✗ Send a regular message first so I can spin up a session, then \`/skill ${match.name}\`.`,
        };
      }
      const desc = (match.description || '').trim();
      const prompt = desc
        ? `Use the "${match.name}" skill for this task.\n\nSkill: ${match.name} — ${desc}`
        : `Use the "${match.name}" skill for this task.`;
      const r = await opencode.sendPrompt(sessionId, projectPath, prompt);
      return {
        reply: r.ok
          ? `▶ Handed the \`${match.name}\` skill to Otto.`
          : `✗ Could not run skill: ${r.error ?? 'unknown error'}`,
      };
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

    case 'session': {
      const prompt = [command.args, command.body].filter(Boolean).join('\n').trim();
      if (!prompt) {
        return { reply: '✗ Usage: `/session <prompt>` — e.g. `/session Add user authentication`.' };
      }
      if (!bridgeOps?.startSession) {
        return { reply: '✗ `/session` is not available on this surface.' };
      }
      const r = await bridgeOps.startSession({ prompt });
      return {
        reply: r.ok
          ? `🚀 Starting OpenCode session${r.threadId ? ` in <#${r.threadId}>` : ''}…`
          : `✗ Could not start session: ${r.error ?? 'unknown error'}`,
      };
    }

    case 'resume': {
      if (!bridgeOps?.resumeSession || !bridgeOps?.listResumeCandidates) {
        return { reply: '✗ `/resume` is not available on this surface.' };
      }
      const ref = command.args.trim();
      if (!ref) {
        const candidates = await bridgeOps.listResumeCandidates().catch(() => []);
        if (!candidates || candidates.length === 0) {
          return { reply: '_(no resumable sessions found for this project)_' };
        }
        const lines = ['**Resume a session** — reply `/resume <n>` or `/resume <session-id>`', ''];
        candidates.slice(0, 10).forEach((s, i) => {
          lines.push(`**${i + 1}.** ${s.title ?? '(untitled)'} — _${s.when ?? ''}_ \`${s.id}\``);
        });
        return { reply: lines.join('\n') };
      }
      const r = await bridgeOps.resumeSession({ ref });
      if (!r.ok) return { reply: `✗ Could not resume: ${r.error ?? 'unknown error'}` };
      return {
        reply: `✓ Session resumed${r.title ? `: **${r.title}**` : ''}${r.threadId ? ` — continue in <#${r.threadId}>` : ''}.${r.loadedNote ? ` ${r.loadedNote}` : ''}`,
      };
    }

    case 'fork': {
      if (!sessionId) return { reply: '✗ No session is active on this conversation — nothing to fork.' };
      if (!bridgeOps?.forkSession || !bridgeOps?.listForkCandidates) {
        return { reply: '✗ `/fork` is not available on this surface.' };
      }
      const arg = command.args.trim();
      if (!arg) {
        const candidates = await bridgeOps.listForkCandidates().catch(() => []);
        if (!candidates || candidates.length === 0) {
          return { reply: '_(no user messages found in this session to fork from)_' };
        }
        const lines = ['**Fork this session** — reply `/fork <n>` to branch from that message', ''];
        candidates.slice(0, 25).forEach((m, i) => {
          lines.push(`**${i + 1}.** ${m.preview} — _${m.when ?? ''}_`);
        });
        return { reply: lines.join('\n') };
      }
      const index = Number.parseInt(arg, 10);
      if (!Number.isFinite(index) || index < 1) {
        return { reply: '✗ Usage: `/fork <n>` where `n` comes from the `/fork` list.' };
      }
      const r = await bridgeOps.forkSession({ index });
      if (!r.ok) return { reply: `✗ Fork failed: ${r.error ?? 'unknown error'}` };
      return {
        reply: `✓ Session forked${r.threadId ? ` — continue in <#${r.threadId}>` : ''}. The fork continues as if later messages were never sent.`,
      };
    }

    case 'share': {
      if (!sessionId) return { reply: '✗ No session is active on this conversation.' };
      const r = await opencode.shareSession(sessionId, binding?.projectPath ?? undefined);
      if (!r.ok) return { reply: `✗ Share failed: ${r.error ?? 'unknown error'}` };
      return {
        reply: r.url
          ? `🔗 Session shared: ${r.url}\n_Anyone with the link can view the full transcript._`
          : '✓ Session shared, but OpenCode returned no URL.',
      };
    }

    case 'unshare': {
      if (!sessionId) return { reply: '✗ No session is active on this conversation.' };
      const r = await opencode.unshareSession(sessionId, binding?.projectPath ?? undefined);
      return { reply: r.ok ? '✓ Share link revoked.' : `✗ Unshare failed: ${r.error ?? 'unknown error'}` };
    }

    case 'queue': {
      const text = [command.args, command.body].filter(Boolean).join('\n').trim();
      if (!text) return { reply: '✗ Usage: `/queue <message>`' };
      if (!bridgeOps?.queueMessage) {
        return { reply: '✗ `/queue` is not available on this surface.' };
      }
      const r = await bridgeOps.queueMessage({ text });
      if (!r.ok) return { reply: `✗ Could not queue: ${r.error ?? 'unknown error'}` };
      return {
        reply: r.queued
          ? `✓ Message queued (position: ${r.position}). It will be sent after the current response.`
          : `» Sent immediately — no response is currently running.`,
      };
    }

    case 'clear-queue': {
      if (!bridgeOps?.clearQueue) {
        return { reply: '✗ `/clear-queue` is not available on this surface.' };
      }
      const cleared = await bridgeOps.clearQueue().catch(() => 0);
      return {
        reply: cleared > 0
          ? `🗑 Cleared ${cleared} queued message${cleared === 1 ? '' : 's'}.`
          : '_(the queue was already empty)_',
      };
    }

    case 'mention-mode': {
      if (!bridgeOps?.toggleMentionMode) {
        return { reply: '✗ `/mention-mode` is not available on this surface.' };
      }
      const enabled = await bridgeOps.toggleMentionMode();
      return {
        reply: enabled
          ? '✓ Mention mode **enabled** — new sessions in this channel now require an @mention of the bot. Existing threads keep working without it.'
          : '✓ Mention mode **disabled** — the bot responds to every message in this channel again.',
      };
    }

    case 'new-worktree': {
      if (!bridgeOps?.newWorktree) {
        return { reply: '✗ `/new-worktree` is not available on this surface.' };
      }
      if (!binding?.projectPath) {
        return { reply: '✗ This channel is not bound to a project yet — send a message first so I can set one up.' };
      }
      const r = await bridgeOps.newWorktree({ name: command.args.trim() || null });
      if (!r.ok) return { reply: `✗ Worktree failed: ${r.error ?? 'unknown error'}` };
      return {
        reply: [
          `🌳 Worktree: \`${r.branch}\``,
          `📁 \`${r.path}\``,
          `🌿 Branch: \`${r.branch}\``,
          r.threadId ? `Continue in <#${r.threadId}> — everything there happens inside the worktree.` : '',
        ].filter(Boolean).join('\n'),
      };
    }

    case 'schedule': {
      if (!bridgeOps?.scheduleTask || !bridgeOps?.listSchedules || !bridgeOps?.deleteSchedule) {
        return { reply: '✗ `/schedule` is not available on this surface.' };
      }
      const argsText = [command.args, command.body].filter(Boolean).join('\n').trim();

      if (!argsText || argsText === 'list') {
        const tasks = await bridgeOps.listSchedules();
        if (!tasks || tasks.length === 0) {
          return {
            reply: [
              '_(no scheduled tasks)_',
              '',
              'Create one with `/schedule <when> [model=provider/model] [agent=name] <prompt>`:',
              '• one-time (UTC ISO): `/schedule 2026-03-01T09:00:00Z Review open PRs`',
              '• recurring (cron, UTC): `/schedule 0 9 * * 1 Run the weekly test suite`',
              'In a thread the prompt continues that conversation; in a channel it starts a new chat.',
            ].join('\n'),
          };
        }
        const lines = ['**Scheduled tasks**', ''];
        for (const t of tasks) {
          const status = t.enabled
            ? (t.nextRunAt ? `next ${new Date(t.nextRunAt).toISOString()}` : 'pending')
            : `done${t.lastStatus ? ` (${t.lastStatus})` : ''}`;
          lines.push(`\`${t.id}\` — ${bridgeOps.describeSchedule ? bridgeOps.describeSchedule(t) : t.scheduleSpec} — _${status}_`);
          lines.push(`> ${t.prompt.split('\n')[0].slice(0, 120)}`);
        }
        lines.push('', 'Remove with `/schedule delete <id>`.');
        return { reply: lines.join('\n') };
      }

      const deleteMatch = argsText.match(/^delete\s+(\S+)$/);
      if (deleteMatch) {
        const removed = await bridgeOps.deleteSchedule(deleteMatch[1]);
        return { reply: removed ? `🗑 Deleted scheduled task \`${deleteMatch[1]}\`.` : `✗ No scheduled task \`${deleteMatch[1]}\`.` };
      }

      // Grammar: <when> [model=p/m] [agent=name] <prompt…>
      // <when> is either an ISO-UTC token or a 5-field cron expression.
      const tokens = argsText.split(/\s+/);
      let when = tokens.shift() ?? '';
      if (!/^\d{4}-\d{2}-\d{2}T/.test(when)) {
        // Assume cron: consume up to 5 fields while they look cron-ish.
        const cronFields = [when];
        while (cronFields.length < 5 && tokens.length > 0 && /^[\d*,/\-A-Za-z]+$/.test(tokens[0]) && !tokens[0].includes('=')) {
          cronFields.push(tokens.shift());
        }
        if (cronFields.length === 5) when = cronFields.join(' ');
        else tokens.unshift(...cronFields.slice(1));
      }
      let model = null;
      let agent = null;
      while (tokens.length > 0 && /^(model|agent)=/.test(tokens[0])) {
        const [key, ...rest] = tokens.shift().split('=');
        if (key === 'model') model = rest.join('=');
        if (key === 'agent') agent = rest.join('=');
      }
      const prompt = tokens.join(' ').trim();
      if (!when || !prompt) {
        return {
          reply: '✗ Usage: `/schedule <when> [model=provider/model] [agent=name] <prompt>` — e.g. `/schedule 0 9 * * 1 model=anthropic/claude-sonnet-4 Run the weekly tests`.',
        };
      }

      const r = await bridgeOps.scheduleTask({ when, prompt, model, agent });
      if (!r.ok) return { reply: `✗ Could not schedule: ${r.error ?? 'unknown error'}` };
      const t = r.task;
      return {
        reply: [
          `⏰ Scheduled \`${t.id}\` — ${t.scheduleKind === 'once' ? `once at ${t.scheduleSpec}` : `cron \`${t.scheduleSpec}\` (UTC)`}`,
          t.threadId ? 'Target: this thread (continues the current conversation).' : 'Target: a new chat in this channel.',
          model || agent ? `Pinned: ${[model && `model \`${model}\``, agent && `agent \`${agent}\``].filter(Boolean).join(', ')}` : '',
          `Next run: ${t.nextRunAt ? new Date(t.nextRunAt).toISOString() : 'n/a'} · manage with \`/schedule list\` / \`/schedule delete ${t.id}\``,
        ].filter(Boolean).join('\n'),
      };
    }

    case 'merge-worktree': {
      if (!bridgeOps?.mergeWorktree) {
        return { reply: '✗ `/merge-worktree` is not available on this surface.' };
      }
      const r = await bridgeOps.mergeWorktree();
      if (r.ok) return { reply: `✓ ${r.summary ?? 'Worktree merged.'}` };
      if (r.conflict) {
        return {
          reply: `⚠ Merge conflict detected — ${r.error ?? ''}\n${r.promptSent ? 'I asked the model to resolve the conflicts; once it finishes run `/merge-worktree` again.' : 'Resolve the conflicts, then run `/merge-worktree` again.'}`,
        };
      }
      return { reply: `✗ Merge failed: ${r.error ?? 'unknown error'}` };
    }

    default:
      return null;
  }
}

export { COMMAND_HELP, tokenHash, targetKey };
