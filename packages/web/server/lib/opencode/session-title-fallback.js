/**
 * Server-side fallback for OpenCode session titles.
 *
 * OpenCode's own title agent generates a summary title from the first
 * exchange, but it fails silently in common situations (rate limits, missing
 * small model, empty LLM output) and the session then keeps its
 * "New session - <ISO>" placeholder forever. The web UI has a client-side
 * fallback (`maybeAutoGenerateTitle` in packages/ui/src/sync/sync-context.tsx),
 * but it only runs while a browser has that directory bootstrapped — sessions
 * driven from Discord or left in background directories never got a title.
 *
 * This runtime watches the shared global event hub: when a session goes idle
 * and — after a short grace period that gives OpenCode's title agent time to
 * land — the title is STILL the placeholder, it derives a title from the
 * first user message and writes it via PATCH /session/{id}. Deterministic,
 * no extra LLM call, runs wherever the server runs.
 */

const DEFAULT_GRACE_MS = 8_000;
const MAX_TITLE_LENGTH = 50;
const ATTEMPTED_CACHE_MAX = 1_000;

/**
 * OpenCode's auto-assigned parent placeholder ("New session - <ISO>").
 * Child sessions ("Child session - …") are intentionally excluded: OpenCode
 * never titles them either, and renaming subagent children would be noise.
 */
const PLACEHOLDER_TITLE_REGEX =
  /^new session\s*-\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/i;

export function isPlaceholderSessionTitle(title) {
  if (typeof title !== 'string') return false;
  return PLACEHOLDER_TITLE_REGEX.test(title.trim());
}

/**
 * Derive a session title from the first user message. Mirrors the client
 * fallback in sync-context.tsx, plus stripping the synthetic context blocks
 * the Discord bridge prepends to a session's first prompt
 * (`<project-memory>…</project-memory>`, `<scheduling>…</scheduling>`).
 */
export function deriveTitleFromUserText(rawText) {
  let text = String(rawText ?? '');
  // Drop leading <tag>…</tag> context wrappers (project memory, scheduling…).
  for (;;) {
    const next = text.replace(/^\s*<([\w-]+)>[\s\S]*?<\/\1>\s*/, '');
    if (next === text) break;
    text = next;
  }
  let title = text
    .replace(/\s+/g, ' ') // collapse whitespace
    .replace(/^@\S+\s*/, '') // strip leading file mentions like @src/foo.ts
    .trim();
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, title.lastIndexOf(' ', MAX_TITLE_LENGTH)) || title.slice(0, MAX_TITLE_LENGTH);
  }
  return title;
}

/** Extract the first real user message's text from GET /session/{id}/message. */
export function extractFirstUserText(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (const entry of list) {
    const info = entry?.info ?? entry;
    if (!info || info.role !== 'user') continue;
    const parts = Array.isArray(entry?.parts) ? entry.parts : [];
    for (const part of parts) {
      if (part?.type !== 'text') continue;
      if (part?.synthetic === true) continue;
      const text = typeof part.text === 'string' ? part.text.trim() : '';
      if (text) return text;
    }
  }
  return '';
}

export function createSessionTitleFallback({
  globalEventHub,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  fetchImpl = fetch,
  graceMs = DEFAULT_GRACE_MS,
  logger = console,
}) {
  /** Sessions we already wrote a fallback title for (or that have a real one). */
  const settled = new Set();
  /** sessionID → pending grace timer. */
  const pendingTimers = new Map();

  function markSettled(sessionId) {
    if (settled.size >= ATTEMPTED_CACHE_MAX) {
      const oldest = settled.values().next().value;
      if (oldest !== undefined) settled.delete(oldest);
    }
    settled.add(sessionId);
  }

  async function opencodeFetch(pathSuffix, init = {}) {
    const url = buildOpenCodeUrl(pathSuffix, '');
    const headers = {
      ...(init.headers ?? {}),
      ...(getOpenCodeAuthHeaders?.() ?? {}),
      'Content-Type': 'application/json',
    };
    return fetchImpl(url, { ...init, headers });
  }

  async function checkSession(sessionId, directory) {
    const dirParam = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const sessionRes = await opencodeFetch(`/session/${encodeURIComponent(sessionId)}${dirParam}`);
    if (!sessionRes.ok) return;
    const session = await sessionRes.json().catch(() => null);
    if (!session || session.parentID) return;
    if (!isPlaceholderSessionTitle(session.title)) {
      // OpenCode's title agent (or the web client fallback) already landed.
      markSettled(sessionId);
      return;
    }

    const messagesRes = await opencodeFetch(`/session/${encodeURIComponent(sessionId)}/message${dirParam}`);
    if (!messagesRes.ok) return;
    const messages = await messagesRes.json().catch(() => null);
    const firstUserText = extractFirstUserText(messages);
    if (!firstUserText) return;
    const title = deriveTitleFromUserText(firstUserText);
    if (!title) return;

    const patchRes = await opencodeFetch(`/session/${encodeURIComponent(sessionId)}${dirParam}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
    if (!patchRes.ok) {
      logger.warn?.(`[TitleFallback] PATCH /session/${sessionId} failed: ${patchRes.status}`);
      return;
    }
    markSettled(sessionId);
    logger.log?.(`[TitleFallback] Set fallback title for session ${sessionId}: "${title}"`);
  }

  function handleEvent(normalized) {
    const payload = normalized?.payload ?? normalized;
    if (!payload || typeof payload !== 'object') return;
    if (payload.type !== 'session.idle') return;
    const props = payload.properties ?? payload.props ?? payload;
    const sessionId = props?.sessionID ?? props?.sessionId ?? null;
    if (!sessionId || settled.has(sessionId)) return;
    const directory =
      typeof normalized?.directory === 'string' &&
      normalized.directory.length > 0 &&
      normalized.directory !== 'global'
        ? normalized.directory
        : null;

    // Debounce per session: repeated idles restart the grace window. The
    // delay gives OpenCode's async title agent time to publish its title so
    // we never race a real title with the truncated fallback.
    const existing = pendingTimers.get(sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingTimers.delete(sessionId);
      checkSession(sessionId, directory).catch((error) => {
        logger.warn?.(`[TitleFallback] Check failed for session ${sessionId}: ${error?.message ?? error}`);
      });
    }, graceMs);
    timer.unref?.();
    pendingTimers.set(sessionId, timer);
  }

  const unsubscribe = globalEventHub?.subscribeEvent?.(handleEvent) ?? null;

  return {
    stop() {
      unsubscribe?.();
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      pendingTimers.clear();
    },
    /** Test seams. */
    _handleEvent: handleEvent,
    _checkSession: checkSession,
  };
}
