import { describe, it, expect, vi } from 'vitest';
import {
  createSessionTitleFallback,
  isPlaceholderSessionTitle,
  deriveTitleFromUserText,
  extractFirstUserText,
} from './session-title-fallback.js';

describe('isPlaceholderSessionTitle', () => {
  it('matches OpenCode parent placeholders with and without milliseconds', () => {
    expect(isPlaceholderSessionTitle('New session - 2026-06-12T07:08:41.381Z')).toBe(true);
    expect(isPlaceholderSessionTitle('New session - 2026-06-12T07:08:41Z')).toBe(true);
    expect(isPlaceholderSessionTitle('  New session - 2026-06-12T07:08:41.381Z  ')).toBe(true);
  });

  it('does not match real or child titles', () => {
    expect(isPlaceholderSessionTitle('Fix login bug')).toBe(false);
    expect(isPlaceholderSessionTitle('New session about the roadmap')).toBe(false);
    expect(isPlaceholderSessionTitle('Child session - 2026-06-12T07:08:41.381Z')).toBe(false);
    expect(isPlaceholderSessionTitle('')).toBe(false);
    expect(isPlaceholderSessionTitle(null)).toBe(false);
  });
});

describe('deriveTitleFromUserText', () => {
  it('collapses whitespace and clips at a word boundary', () => {
    expect(deriveTitleFromUserText('  fix   the\nlogin bug ')).toBe('fix the login bug');
    const long = 'word '.repeat(30).trim();
    const title = deriveTitleFromUserText(long);
    expect(title.length).toBeLessThanOrEqual(50);
    expect(title.endsWith('word')).toBe(true);
  });

  it('strips leading file mentions and bridge context blocks', () => {
    expect(deriveTitleFromUserText('@src/foo.ts please refactor this')).toBe('please refactor this');
    const wrapped = '<project-memory>\nstuff\n</project-memory>\n\n<scheduling>\nstuff\n</scheduling>\n\ndeploy the app';
    expect(deriveTitleFromUserText(wrapped)).toBe('deploy the app');
  });
});

describe('extractFirstUserText', () => {
  it('finds the first user message text part and skips synthetic parts', () => {
    const messages = [
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'hello!' }] },
      {
        info: { role: 'user' },
        parts: [
          { type: 'file', text: 'ignored' },
          { type: 'text', text: 'injected', synthetic: true },
          { type: 'text', text: 'real question' },
        ],
      },
    ];
    expect(extractFirstUserText(messages)).toBe('real question');
    expect(extractFirstUserText([])).toBe('');
    expect(extractFirstUserText(null)).toBe('');
  });
});

function makeHub() {
  const subscribers = new Set();
  return {
    subscribeEvent(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    emit(event) {
      for (const fn of subscribers) fn(event);
    },
  };
}

function jsonResponse(data, ok = true, status = 200) {
  return { ok, status, json: async () => data, text: async () => '' };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createSessionTitleFallback', () => {
  function makeRuntime({ session, messages, graceMs = 0 }) {
    const hub = makeHub();
    const calls = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ?? null });
      if (init.method === 'PATCH') return jsonResponse({ ok: true });
      if (String(url).includes('/message')) return jsonResponse(messages);
      return jsonResponse(session);
    });
    const runtime = createSessionTitleFallback({
      globalEventHub: hub,
      buildOpenCodeUrl: (p) => `http://opencode${p}`,
      getOpenCodeAuthHeaders: () => ({}),
      fetchImpl,
      graceMs,
      logger: { log: () => {}, warn: () => {} },
    });
    return { hub, runtime, fetchImpl, calls };
  }

  it('writes a fallback title when the placeholder survives the grace period', async () => {
    const { hub, calls } = makeRuntime({
      session: { id: 'ses-1', title: 'New session - 2026-06-12T07:08:41.381Z' },
      messages: [
        { info: { role: 'user' }, parts: [{ type: 'text', text: 'fix the login redirect bug' }] },
        { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'on it' }] },
      ],
    });

    hub.emit({
      directory: '/proj',
      payload: { type: 'session.idle', properties: { sessionID: 'ses-1' } },
    });
    await flush();
    await flush();

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(patch.url).toContain('/session/ses-1');
    expect(patch.url).toContain('directory=%2Fproj');
    expect(JSON.parse(patch.body)).toEqual({ title: 'fix the login redirect bug' });
  });

  it('does nothing when the title agent already produced a real title', async () => {
    const { hub, calls } = makeRuntime({
      session: { id: 'ses-2', title: 'Login redirect fix' },
      messages: [],
    });

    hub.emit({ directory: '/proj', payload: { type: 'session.idle', properties: { sessionID: 'ses-2' } } });
    await flush();
    await flush();

    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(calls.some((c) => c.url.includes('/message'))).toBe(false);
  });

  it('skips child sessions', async () => {
    const { hub, calls } = makeRuntime({
      session: { id: 'ses-3', parentID: 'ses-parent', title: 'New session - 2026-06-12T07:08:41.381Z' },
      messages: [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'subagent work' }] }],
    });

    hub.emit({ directory: '/proj', payload: { type: 'session.idle', properties: { sessionID: 'ses-3' } } });
    await flush();
    await flush();

    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('only attempts once per session across repeated idles', async () => {
    const { hub, calls } = makeRuntime({
      session: { id: 'ses-4', title: 'New session - 2026-06-12T07:08:41.381Z' },
      messages: [{ info: { role: 'user' }, parts: [{ type: 'text', text: 'do a thing' }] }],
    });

    hub.emit({ directory: '/p', payload: { type: 'session.idle', properties: { sessionID: 'ses-4' } } });
    await flush();
    await flush();
    hub.emit({ directory: '/p', payload: { type: 'session.idle', properties: { sessionID: 'ses-4' } } });
    await flush();
    await flush();

    expect(calls.filter((c) => c.method === 'PATCH').length).toBe(1);
  });
});
