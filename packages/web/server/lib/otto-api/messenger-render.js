/**
 * Pure rendering of OpenCode message parts into Discord markdown.
 *
 * Kept free of any I/O (no SQLite, no fetch) so it can be unit-tested in
 * isolation and reused by the bridge. `messenger-opencode-bridge.js` owns the
 * streaming/session plumbing and imports the renderers from here.
 *
 * Verbosity (`quiet` | `normal` | `verbose`) controls how much detail is
 * mirrored back — see `messenger-verbosity.js`. Reasoning and tool details are
 * always shown inline (never hidden behind a Discord spoiler), so thoughts and
 * tool usage are visible as-is without a click-to-reveal step.
 */

import { DEFAULT_VERBOSITY, normalizeVerbosity } from './messenger-verbosity.js';

/** Light markdown escaping — keep code-fence + backticks usable. */
export function escapeMd(s) {
  return String(s ?? '').replace(/[*_]/g, (c) => `\\${c}`);
}

export function shortFileName(p) {
  if (!p) return '';
  const last = String(p).split(/[\\/]/).pop();
  return last || String(p);
}

export function clipBlock(s, limit) {
  if (!s) return '';
  return s.length > limit ? s.slice(0, limit - 1) + '…' : s;
}

/**
 * Wrap arbitrary text in a Discord spoiler containing a code block so it stays
 * collapsed until clicked. Returns '' for empty input.
 *
 * The `||```\n…\n```||` form (markers flush against the fence) is the shape
 * Discord renders reliably for spoilered code blocks.
 */
export function spoilerBlock(raw, limit = 700) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  // Neutralise any embedded code-fence so it can't terminate ours early.
  const safe = clipBlock(text.replace(/```/g, "'''"), limit);
  return `||\`\`\`\n${safe}\n\`\`\`||`;
}

/** Build the shared tool detail lines (input + output/error) for a tool part. */
export function buildToolDetailLines(part) {
  const state = part.state ?? {};
  const lines = [];
  const input = state.input;
  if (input && typeof input === 'object' && Object.keys(input).length > 0) {
    let json;
    try {
      json = JSON.stringify(input, null, 2);
    } catch {
      json = String(input);
    }
    lines.push(`input: ${clipBlock(json, 700)}`);
  }
  if (state.status === 'completed' && typeof state.output === 'string' && state.output.trim()) {
    lines.push(`output: ${clipBlock(state.output.trim(), 700)}`);
  } else if (state.status === 'error' && state.error) {
    lines.push(`error: ${clipBlock(String(state.error).trim(), 700)}`);
  }
  return lines;
}

/** Build the collapsed detail spoiler (input + output/error) for a tool part. */
export function toolDetailSpoiler(part) {
  const lines = buildToolDetailLines(part);
  if (lines.length === 0) return '';
  return spoilerBlock(lines.join('\n\n'), 1500);
}

/** Build inline detail (input + output/error) for a tool part, no spoiler. */
export function toolDetailInline(part) {
  const lines = buildToolDetailLines(part);
  if (lines.length === 0) return '';
  // Neutralise any embedded code-fence so it can't terminate ours early.
  const safe = clipBlock(lines.join('\n\n').replace(/```/g, "'''"), 1500);
  return '```\n' + safe + '\n```';
}

/**
 * Render a PermissionRequest into a rich Discord prompt.
 * Mirrors the same tool-specific context as the web UI's PermissionCard.
 * Returns a plain text + markdown string suitable for an approval message footer.
 */
export function renderPermissionContext(permission) {
  if (!permission || typeof permission !== 'object') return '';
  const tool = String(permission.permission ?? '').toLowerCase();
  const meta = permission.metadata ?? {};

  const getStr = (keys, fallback = '') => {
    for (const key of keys) {
      const val = meta[key];
      if (typeof val === 'string' && val.length > 0) return val;
    }
    return fallback;
  };

  const clip = (s, limit) =>
    s && s.length > limit ? s.slice(0, limit - 1) + '…' : s ?? '';

  switch (tool) {
    case 'bash':
    case 'shell':
    case 'shell_command':
    case 'cmd':
    case 'terminal': {
      const cmd = getStr(['command', 'cmd', 'script']);
      const desc = getStr(['description']);
      if (!cmd && !desc) return '';
      const parts = [];
      if (desc) parts.push(`> *${clip(desc, 200)}*`);
      if (cmd) parts.push('```bash\n' + clip(cmd, 800) + '\n```');
      return parts.join('\n');
    }
    case 'edit':
    case 'multiedit':
    case 'str_replace':
    case 'str_replace_based_edit_tool':
    case 'apply_patch': {
      const fp = getStr(['path', 'file_path', 'filename', 'filePath', 'file']);
      const oldS = getStr(['old_string', 'oldString', 'changes', 'diff']);
      const newS = getStr(['new_string', 'newString']);
      if (!fp && !oldS && !newS) return '';
      const parts = [];
      if (fp) parts.push(`**File:** \`${fp}\``);
      if (oldS) {
        parts.push('**Replace:**\n```diff\n- ' + clip(oldS, 400) + '\n+ ' + clip(newS || '', 400) + '\n```');
      } else if (newS) {
        parts.push('**New content:**\n```\n' + clip(newS, 600) + '\n```');
      }
      return parts.join('\n');
    }
    case 'write':
    case 'create':
    case 'file_write': {
      const fp = getStr(['path', 'file_path', 'filename', 'filePath', 'file']);
      const content = getStr(['content', 'text', 'data']);
      if (!fp && !content) return '';
      const parts = [];
      if (fp) parts.push(`**File:** \`${fp}\``);
      if (content) parts.push('```\n' + clip(content, 600) + '\n```');
      return parts.join('\n');
    }
    case 'webfetch':
    case 'fetch':
    case 'curl':
    case 'wget': {
      const url = getStr(['url', 'uri', 'endpoint']);
      const method = getStr(['method']) || 'GET';
      if (!url) return '';
      return `**URL:** \`${method.toUpperCase()}\` ${url}`;
    }
    case 'read': {
      const fp = getStr(['filePath', 'file_path', 'path', 'file', 'filename']);
      const dir = getStr(['parentDir', 'parent_dir', 'directory']);
      if (!fp && !dir) return '';
      const parts = [];
      if (fp) parts.push(`**Reading:** \`${fp}\``);
      if (dir) parts.push(`**Directory:** \`${dir}\``);
      return parts.join('\n');
    }
    case 'list':
    case 'ls': {
      const p = getStr(['path', 'directory', 'filePath']);
      return p ? `**Listing:** \`${p}\`` : '';
    }
    case 'glob': {
      const p = getStr(['pattern', 'glob']);
      return p ? `**Pattern:** \`${p}\`` : '';
    }
    case 'grep': {
      const p = getStr(['pattern', 'query']);
      return p ? `**Search:** \`${p}\`` : '';
    }
    case 'external_directory': {
      const fp = getStr(['filepath', 'path', 'directory']);
      const par = getStr(['parentDir', 'parent_dir']);
      const parts = [];
      if (fp) parts.push(`**Path:** \`${fp}\``);
      if (par) parts.push(`**Parent:** \`${par}\``);
      return parts.join('\n');
    }
    case 'task':
    case 'subagent': {
      const desc = getStr(['description', 'prompt']);
      return desc ? `> ${clip(desc, 300)}` : '';
    }
    default: {
      const desc = getStr(['description', 'action', 'operation', 'command']);
      if (desc) return `> *${clip(desc, 300)}*`;
      const keys = Object.keys(meta).filter((k) => !['sessionID', 'id', 'type'].includes(k));
      if (keys.length > 0) {
        const preview = keys.slice(0, 3).map((k) => `${k}: ${String(meta[k]).slice(0, 60)}`).join('\n');
        return '```\n' + clip(preview, 400) + '\n```';
      }
      return '';
    }
  }
}

/**
 * Render an OpenCode message part for a Discord surface. Returns
 * `null` when nothing should be posted (e.g. empty text, pending tools).
 *
  * `verbosity` controls how much detail is mirrored:
  *   - `quiet`   — only assistant text (reasoning/tool parts return null here)
  *   - `normal`  — text + full reasoning text + tool one-liner with input/output inline
  *   - `verbose` — same as normal; reasoning + tool details are shown inline (never
  *                 hidden behind a collapsed Discord spoiler)
 */
export function renderPartForMessenger(part, verbosity = DEFAULT_VERBOSITY) {
  if (!part || typeof part !== 'object') return null;
  const level = normalizeVerbosity(verbosity);

  if (part.type === 'reasoning') {
    if (level === 'quiet') return null;
    if (!part.text || !String(part.text).trim()) return null;
    // normal + verbose: show full reasoning text inline (never hidden behind a spoiler).
    // Neutralise any embedded code-fence so it can't terminate ours early.
    const text = clipBlock(String(part.text).trim().replace(/```/g, "'''"), 1500);
    return `┣ thinking\n\`\`\`\n${text}\n\`\`\``;
  }

  if (part.type === 'text') {
    const text = typeof part.text === 'string' ? part.text : '';
    if (!text.trim()) return null;
    // We only render text when streaming has settled (part.time.end set).
    // The caller guards this; here we just format.
    return text;
  }

  if (part.type === 'tool') {
    if (level === 'quiet') return null;
    return renderToolPart(part, level);
  }

  return null;
}

export function renderToolPart(part, verbosity = DEFAULT_VERBOSITY) {
  const tool = String(part.tool ?? 'tool');
  const status = part.state?.status ?? 'running';
  const input = part.state?.input ?? {};

  // Tool title — usually a one-word context (e.g. "build", "test").
  const title = typeof part.state?.title === 'string' ? part.state.title : '';
  const titlePart = title ? ` _${escapeMd(title)}_` : '';

  const summary = (() => {
    switch (tool) {
      case 'read': {
        const file = shortFileName(input.filePath);
        return file ? `*${escapeMd(file)}*` : '';
      }
      case 'edit':
      case 'multiedit':
      case 'apply_patch': {
        const file = shortFileName(input.filePath);
        const oldStr = typeof input.oldString === 'string' ? input.oldString : '';
        const newStr = typeof input.newString === 'string' ? input.newString : '';
        const removed = oldStr ? oldStr.split('\n').length : 0;
        const added = newStr ? newStr.split('\n').length : 0;
        const delta = added || removed ? ` (+${added}-${removed})` : '';
        return file ? `*${escapeMd(file)}*${delta}` : delta.trim();
      }
      case 'write': {
        const file = shortFileName(input.filePath);
        return file ? `*${escapeMd(file)}*` : '';
      }
      case 'bash':
      case 'shell': {
        const cmd = (input.command ?? '').toString().split('\n')[0];
        return cmd ? `\`${clipBlock(cmd, 150)}\`` : '';
      }
      case 'glob': {
        const pattern = input.pattern ?? '';
        const count = part.state?.metadata?.count;
        return `\`${clipBlock(pattern, 80)}\`${typeof count === 'number' ? ` (${count} match${count === 1 ? '' : 'es'})` : ''}`;
      }
      case 'grep': {
        const pattern = input.pattern ?? '';
        const count = part.state?.metadata?.count;
        return `\`${clipBlock(pattern, 80)}\`${typeof count === 'number' ? ` (${count} hit${count === 1 ? '' : 's'})` : ''}`;
      }
      case 'list':
      case 'ls': {
        const path = input.path ?? '';
        return path ? `*${escapeMd(shortFileName(path))}*` : '';
      }
      case 'webfetch':
      case 'fetch': {
        return input.url ? `<${input.url}>` : '';
      }
      case 'task':
      case 'subagent': {
        const desc = input.description ?? input.prompt ?? '';
        return desc ? `_${escapeMd(clipBlock(desc, 100))}_` : '';
      }
      case 'todowrite':
      case 'todoread': {
        const count = Array.isArray(input.todos) ? input.todos.length : null;
        return count != null ? `(${count} todo${count === 1 ? '' : 's'})` : '';
      }
      default: {
        // Unknown tool — show the first useful input string field.
        const candidate =
          input.filePath ?? input.path ?? input.command ?? input.url ?? input.query ?? '';
        if (typeof candidate === 'string' && candidate.length > 0) {
          return `*${escapeMd(shortFileName(candidate))}*`;
        }
        return '';
      }
    }
  })();

  let icon = '┣';
  if (status === 'error') icon = '✗';
  else if (tool === 'edit' || tool === 'write' || tool === 'multiedit' || tool === 'apply_patch') {
    icon = '◼︎';
  } else if (tool === 'bash' || tool === 'shell') {
    icon = '⬦';
  } else if (tool === 'read') {
    icon = '📖';
  }

  let line = `${icon} ${tool}${titlePart}`;
  if (summary) line += ` ${summary}`;
  if (status === 'error') {
    const errMsg = part.state?.error ?? '';
    if (errMsg) line += ` — ${escapeMd(clipBlock(String(errMsg), 200))}`;
  }

  // `normal` + `verbose` both show the one-liner + full input/output inline
  // (never hidden behind a click-to-reveal Discord spoiler).
  const detail = toolDetailInline(part);
  if (detail) line += `\n${detail}`;
  return line;
}

// ── Thread naming from OpenCode session titles (kimaki parity) ─────────────

const DISCORD_THREAD_NAME_MAX = 100;

/** Thread-name prefixes that must survive a rename (worktree marker etc.). */
const PRESERVED_THREAD_PREFIXES = ['⬦ ', 'Fork: ', 'Resume: '];

/**
 * Decide whether (and how) to rename a Discord thread based on an OpenCode
 * session title. Mirrors kimaki's deriveThreadNameFromSessionTitle:
 *   - skip empty titles and OpenCode's "New session - …" placeholder
 *   - preserve a recognised prefix from the current thread name
 *   - cap at Discord's 100-char thread-name limit
 *   - return undefined when nothing should change
 */
export function deriveThreadNameFromSessionTitle({ sessionTitle, currentName }) {
  const trimmed = typeof sessionTitle === 'string' ? sessionTitle.trim() : '';
  if (!trimmed) {
    return undefined;
  }
  if (/^new session\s*-/i.test(trimmed)) {
    return undefined;
  }
  const current = typeof currentName === 'string' ? currentName : '';
  const matchedPrefix = PRESERVED_THREAD_PREFIXES.find((p) => current.startsWith(p)) ?? '';
  const candidate = `${matchedPrefix}${trimmed}`.slice(0, DISCORD_THREAD_NAME_MAX);
  if (candidate === current) {
    return undefined;
  }
  return candidate;
}
