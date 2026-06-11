import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMessengerOpencodeBridge } from './messenger-opencode-bridge.js';
import { createMessengerSyncRouter } from './messenger-sync.js';

/**
 * Regression coverage for the Discord approval flow: a button click must reply
 * to OpenCode WITH the correct directory, otherwise OpenCode can't match the
 * pending permission and it stays "pending" forever in the web UI.
 */

function makeFakeStore() {
  return {
    lookup: () => null,
    bind: () => {},
    touch: () => {},
    setOverrides: () => {},
    getVerbosityDefault: () => null,
    getProjectDefaults: () => null,
    lookupBySessionId: () => [],
  };
}

function makeBridge(overrides = {}) {
  return createMessengerOpencodeBridge({
    globalEventHub: { subscribeEvent: () => () => {} },
    buildOpenCodeUrl: (p) => `http://opencode${p}`,
    getOpenCodeAuthHeaders: () => ({}),
    broadcastEvent: () => {},
    store: makeFakeStore(),
    listProjects: async () => [],
    // Session is not tracked locally → exercise the reverse-lookup path used
    // after a listener restart.
    lookupMessengerTarget: () => ({
      type: 'discord',
      token: 'bot-token',
      targetKey: 'chan-123',
      threadId: null,
      projectPath: '/binding/project',
    }),
    ...overrides,
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('approval flow — reply directory', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'discord-msg-1' }),
      text: async () => '',
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function askPermission(bridge, envelopeDirectory, metadata = {}) {
    bridge._handleGlobalEvent({
      directory: envelopeDirectory,
      payload: {
        type: 'permission.asked',
        properties: {
          id: 'req-1',
          sessionID: 'ses-1',
          permission: 'bash',
          patterns: [],
          always: [],
          metadata,
        },
      },
    });
    await flush();
    const ids = [...bridge.approvalContexts.keys()];
    expect(ids.length).toBe(1);
    return ids[0];
  }

  it('uses the authoritative SSE envelope directory for the reply', async () => {
    const bridge = makeBridge();
    const respond = vi.fn(async () => {});
    bridge.initApprovalListener(respond);

    const approvalId = await askPermission(bridge, '/envelope/project');

    // The approval message was posted to Discord.
    expect(globalThis.fetch).toHaveBeenCalled();

    bridge.handleApprovalDecision(approvalId, 'approve');
    await flush();

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      sessionID: 'ses-1',
      requestID: 'req-1',
      reply: 'once',
      directory: '/envelope/project',
    });
  });

  it('falls back to the bound project path when the envelope is "global"', async () => {
    const bridge = makeBridge();
    const respond = vi.fn(async () => {});
    bridge.initApprovalListener(respond);

    const approvalId = await askPermission(bridge, 'global');
    bridge.handleApprovalDecision(approvalId, 'approve-always');
    await flush();

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ reply: 'always', directory: '/binding/project' }),
    );
  });

  it('is idempotent — a duplicate click does not double-reply', async () => {
    const bridge = makeBridge();
    const respond = vi.fn(async () => {});
    bridge.initApprovalListener(respond);

    const approvalId = await askPermission(bridge, '/p');
    bridge.handleApprovalDecision(approvalId, 'deny');
    bridge.handleApprovalDecision(approvalId, 'deny');
    await flush();

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ reply: 'reject' }));
  });
});

describe('discord project sync persistence', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('persists project channel bindings immediately after sync-projects', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/guilds/guild-1/channels')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: 'chan-otto-ui', name: 'otto-ui', type: 0, position: 1 }],
          text: async () => '',
        };
      }
      if (u.includes('/channels/chan-otto-ui/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'msg-1' }),
          text: async () => '',
        };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    });

    const persistSettings = vi.fn(async () => {});
    const app = express();
    app.use(
      '/',
      createMessengerSyncRouter({
        broadcastEvent: () => {},
        readSettings: async () => ({
          discord: { botToken: 'old-token', guildId: 'guild-1', defaultChannelId: 'general' },
          projects: [{ id: 'proj-1', path: '/data/projects/otto-ui', label: 'Otto Ui' }],
        }),
        persistSettings,
        sanitizeProjects: (projects) => projects,
      }).router,
    );

    const res = await request(app)
      .post('/discord/sync-projects')
      .send({
        token: 'bot-token',
        guildId: 'guild-1',
        createThreads: false,
        projects: [{ id: 'proj-1', label: 'Otto Ui', body: 'sync body' }],
        mappings: [],
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.channels[0]).toMatchObject({
      projectId: 'proj-1',
      projectPath: '/data/projects/otto-ui',
      channelId: 'chan-otto-ui',
    });
    expect(persistSettings).toHaveBeenCalledWith({
      discord: expect.objectContaining({
        botToken: 'bot-token',
        guildId: 'guild-1',
        defaultChannelId: 'general',
        projectBindings: [
          { channelId: 'chan-otto-ui', projectPath: '/data/projects/otto-ui', projectLabel: 'Otto Ui' },
        ],
      }),
    });
  });
});

describe('web session mirroring', () => {
  let originalFetch;

  // A fetch mock that distinguishes thread creation from message posting so
  // tests can assert the project-channel → per-session-thread routing.
  function installFetchMock() {
    let threadSeq = 0;
    let msgSeq = 0;
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith('/threads')) {
        threadSeq += 1;
        const id = `thread-${threadSeq}`;
        return { ok: true, status: 200, json: async () => ({ id, name: 'web' }), text: async () => '' };
      }
      msgSeq += 1;
      return { ok: true, status: 200, json: async () => ({ id: `msg-${msgSeq}` }), text: async () => '' };
    });
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    installFetchMock();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function makeWebBridge(extra = {}) {
    return makeBridge({
      lookupMessengerTarget: () => null,
      getDefaultMessengerTarget: async ({ projectPath }) => ({
        type: 'discord',
        token: 'bot-token',
        channelId: 'project-chan',
        threadId: null,
        projectPath,
        projectLabel: 'My Project',
      }),
      ...extra,
    });
  }

  async function emitUserMessage(bridge, { sessionId, messageId, partId, text }) {
    // role lives on message.updated, not on the part — mirror real OpenCode.
    await bridge._handleGlobalEvent({
      directory: '/web/project',
      payload: { type: 'message.updated', properties: { info: { id: messageId, role: 'user', sessionID: sessionId } } },
    });
    await bridge._handleGlobalEvent({
      directory: '/web/project',
      payload: {
        type: 'message.part.updated',
        properties: { part: { id: partId, type: 'text', messageID: messageId, sessionID: sessionId, text } },
      },
    });
  }

  async function emitAssistantMessage(bridge, { sessionId, messageId, partId, text }) {
    await bridge._handleGlobalEvent({
      directory: '/web/project',
      payload: { type: 'message.updated', properties: { info: { id: messageId, role: 'assistant', sessionID: sessionId } } },
    });
    await bridge._handleGlobalEvent({
      directory: '/web/project',
      payload: {
        type: 'message.part.updated',
        properties: {
          part: { id: partId, type: 'text', messageID: messageId, sessionID: sessionId, text, time: { end: Date.now() } },
        },
      },
    });
  }

  it('routes a web conversation into a per-session thread under the project channel', async () => {
    const bridge = makeWebBridge();

    await emitUserMessage(bridge, {
      sessionId: 'web-ses-1',
      messageId: 'm-user-1',
      partId: 'usr-1',
      text: 'hello from web',
    });
    await emitAssistantMessage(bridge, {
      sessionId: 'web-ses-1',
      messageId: 'm-ast-1',
      partId: 'ast-1',
      text: 'hello from assistant',
    });

    // A thread was created in the PROJECT channel (not posted to #general).
    const threadCalls = globalThis.fetch.mock.calls.filter(([url]) =>
      String(url).includes('/channels/project-chan/threads'),
    );
    expect(threadCalls).toHaveLength(1);

    // Both the user echo and the assistant reply went into that thread.
    const threadMessageCalls = globalThis.fetch.mock.calls.filter(([url]) =>
      String(url).includes('/channels/thread-1/messages'),
    );
    expect(threadMessageCalls).toHaveLength(2);
    expect(JSON.parse(threadMessageCalls[0][1].body).content).toContain('hello from web');
    expect(JSON.parse(threadMessageCalls[0][1].body).content).toContain('Web');
    expect(JSON.parse(threadMessageCalls[1][1].body).content).toContain('hello from assistant');
  });

  it('mirrors a web user message when the part arrives before the role event', async () => {
    const bridge = makeWebBridge();

    await bridge._handleGlobalEvent({
      directory: '/web/project',
      payload: {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'usr-late-role',
            type: 'text',
            messageID: 'm-late-role',
            sessionID: 'web-ses-late-role',
            text: 'part arrived first',
          },
        },
      },
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await bridge._handleGlobalEvent({
      directory: '/web/project',
      payload: {
        type: 'message.updated',
        properties: { info: { id: 'm-late-role', role: 'user', sessionID: 'web-ses-late-role' } },
      },
    });

    const userEchoes = globalThis.fetch.mock.calls
      .filter(([url]) => String(url).includes('/messages'))
      .map(([, init]) => JSON.parse(init.body).content)
      .filter((content) => content.includes('Web'));
    expect(userEchoes).toHaveLength(1);
    expect(userEchoes[0]).toContain('part arrived first');
  });

  it('mirrors a follow-up web user message in the same session (no second thread)', async () => {
    const bridge = makeWebBridge();

    await emitUserMessage(bridge, { sessionId: 'web-ses-2', messageId: 'm-u1', partId: 'u1', text: 'first' });
    await emitAssistantMessage(bridge, { sessionId: 'web-ses-2', messageId: 'm-a1', partId: 'a1', text: 'reply one' });
    await emitUserMessage(bridge, { sessionId: 'web-ses-2', messageId: 'm-u2', partId: 'u2', text: 'second question' });

    // Only one thread for the whole session.
    const threadCalls = globalThis.fetch.mock.calls.filter(([url]) =>
      String(url).includes('/threads'),
    );
    expect(threadCalls).toHaveLength(1);

    const userEchoes = globalThis.fetch.mock.calls
      .filter(([url]) => String(url).includes('/messages'))
      .map(([, init]) => JSON.parse(init.body).content)
      .filter((c) => c.includes('Web'));
    expect(userEchoes.some((c) => c.includes('first'))).toBe(true);
    expect(userEchoes.some((c) => c.includes('second question'))).toBe(true);
  });

  it('does not mirror unbound web parts when no default target is configured', async () => {
    const bridge = makeBridge({
      lookupMessengerTarget: () => null,
      getDefaultMessengerTarget: async () => null,
    });

    await emitAssistantMessage(bridge, {
      sessionId: 'web-ses-3',
      messageId: 'm-x',
      partId: 'ast-x',
      text: 'not mirrored',
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('discord inbound mirroring', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('does not echo a Discord user part when role is nested on the message', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'msg-1' }),
      text: async () => '',
    }));

    const bridge = makeBridge({
      store: {
        ...makeFakeStore(),
        lookupBySessionId: (sessionId) =>
          sessionId === 'discord-ses-1'
            ? [{ type: 'discord', botTokenHash: 'hash', targetKey: 'thread-1', sessionId }]
            : [],
      },
      getDefaultMessengerTarget: async () => ({
        type: 'discord',
        token: 'bot-token',
        channelId: 'fallback-channel',
        threadId: null,
        projectPath: '/project',
      }),
    });

    await bridge._handleGlobalEvent({
      directory: '/project',
      payload: {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'discord-user-part',
            type: 'text',
            sessionID: 'discord-ses-1',
            message: { id: 'discord-user-message', role: 'user' },
            text: 'message typed in discord',
            time: { end: Date.now() },
          },
        },
      },
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('adds the Discord author to the thread via REST and replies without echoing them', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push([String(url), init]);
      const u = String(url);
      if (u.includes('/messages/source-msg/threads')) {
        return { ok: true, status: 200, json: async () => ({ id: 'thread-1', name: 'hello' }), text: async () => '' };
      }
      if (u.includes('/thread-members/user-1')) {
        return { ok: true, status: 204, json: async () => null, text: async () => '' };
      }
      if (u === 'http://opencode/session?directory=%2Fproject') {
        return { ok: true, status: 200, json: async () => ({ id: 'discord-ses-2' }), text: async () => '' };
      }
      if (u.includes('/session/discord-ses-2/prompt_async')) {
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      }
      if (u.includes('/channels/thread-1/messages')) {
        return { ok: true, status: 200, json: async () => ({ id: 'reply-1' }), text: async () => '' };
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    });

    const bridge = makeBridge({
      store: {
        ...makeFakeStore(),
        lookup: () => null,
        bind: () => {},
      },
    });

    const routed = await bridge.routeInbound({
      type: 'discord',
      token: 'bot-token',
      channelId: 'channel-1',
      threadId: null,
      sourceMessageId: 'source-msg',
      text: 'hello',
      projectPath: '/project',
      projectLabel: 'Project',
      from: { id: 'user-1', username: 'alice' },
    });
    expect(routed.ok).toBe(true);

    // The user was added to the new thread via the REST thread-members endpoint.
    const addMemberCalls = calls.filter(
      ([url, init]) => url.includes('/channels/thread-1/thread-members/user-1') && init.method === 'PUT',
    );
    expect(addMemberCalls).toHaveLength(1);

    await bridge._handleGlobalEvent({
      directory: '/project',
      payload: {
        type: 'message.updated',
        properties: { info: { id: 'assistant-message', role: 'assistant', sessionID: 'discord-ses-2' } },
      },
    });
    await bridge._handleGlobalEvent({
      directory: '/project',
      payload: {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'assistant-part',
            type: 'text',
            messageID: 'assistant-message',
            sessionID: 'discord-ses-2',
            text: 'assistant reply',
            time: { end: Date.now() },
          },
        },
      },
    });

    // The assistant reply is posted as-is — no mention prefix, no echo of the
    // user's own message.
    const threadMessages = calls
      .filter(([url]) => url.includes('/channels/thread-1/messages'))
      .map(([, init]) => JSON.parse(init.body).content);
    expect(threadMessages).toEqual(['assistant reply']);
  });

  it('does not echo a Discord reply back into a web-created thread (mixed surface)', async () => {
    // Scenario: a thread was created from the web UI (so the session ctx is a
    // web-mirror), but the user then answers FROM Discord inside that thread.
    // The user's own prompt must NOT bounce straight back to them.
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push([String(url), init]);
      const u = String(url);
      if (u === 'http://opencode/session') {
        return { ok: true, status: 200, json: async () => ({ id: 'mixed-ses' }), text: async () => '' };
      }
      if (u.includes('/session/mixed-ses/prompt_async')) {
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      }
      // Discord thread message posts + standalone thread creation.
      if (u.endsWith('/threads')) {
        return { ok: true, status: 200, json: async () => ({ id: 'web-thread', name: 'web' }), text: async () => '' };
      }
      return { ok: true, status: 200, json: async () => ({ id: 'm' }), text: async () => '' };
    });

    // A store that binds the web thread to the session, so the inbound Discord
    // reply resolves to the SAME session created by the web flow.
    const bound = { sessionId: 'mixed-ses', projectPath: '/web/project', projectLabel: 'Web' };
    const bridge = makeBridge({
      store: {
        ...makeFakeStore(),
        // The inbound Discord reply resolves to the SAME session the web flow
        // created (bound to the web thread's id). lookupBySessionId stays empty
        // so the first web user message still creates + mirrors into the thread.
        lookup: ({ targetKey }) => (targetKey === 'web-thread' ? bound : null),
      },
      getDefaultMessengerTarget: async ({ projectPath }) => ({
        type: 'discord',
        token: 'bot-token',
        channelId: 'project-chan',
        threadId: null,
        projectPath,
        projectLabel: 'Web',
      }),
    });

    // 1. Web user message → creates the web thread + mirrors a **Web** block.
    await bridge._handleGlobalEvent({
      directory: '/web/project',
      payload: { type: 'message.updated', properties: { info: { id: 'm-web', role: 'user', sessionID: 'mixed-ses' } } },
    });
    await bridge._handleGlobalEvent({
      directory: '/web/project',
      payload: {
        type: 'message.part.updated',
        properties: { part: { id: 'p-web', type: 'text', messageID: 'm-web', sessionID: 'mixed-ses', text: 'from web' } },
      },
    });

    const beforeReply = calls.filter(([url]) => url.includes('/channels/web-thread/messages')).length;

    // 2. The user now replies FROM Discord inside that same thread.
    await bridge.routeInbound({
      type: 'discord',
      token: 'bot-token',
      channelId: 'web-thread',
      threadId: null,
      sourceMessageId: null,
      text: 'reply from discord',
      from: { id: 'user-1', username: 'alice' },
    });

    // 3. OpenCode echoes that prompt back as a `user` part on the same session.
    await bridge._handleGlobalEvent({
      directory: '/web/project',
      payload: { type: 'message.updated', properties: { info: { id: 'm-dc', role: 'user', sessionID: 'mixed-ses' } } },
    });
    await bridge._handleGlobalEvent({
      directory: '/web/project',
      payload: {
        type: 'message.part.updated',
        properties: { part: { id: 'p-dc', type: 'text', messageID: 'm-dc', sessionID: 'mixed-ses', text: 'reply from discord' } },
      },
    });

    const threadMessages = calls
      .filter(([url]) => url.includes('/channels/web-thread/messages'))
      .map(([, init]) => JSON.parse(init.body).content);
    // The Discord-originated prompt must not be mirrored back into the thread.
    expect(threadMessages.some((c) => c.includes('reply from discord'))).toBe(false);
    // ...while the earlier genuine web prompt still was mirrored once.
    expect(beforeReply).toBeGreaterThan(0);
  });
});

describe('thread renaming from OpenCode session titles', () => {
  let originalFetch;
  let calls;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push([String(url), init]);
      const method = init.method ?? 'GET';
      if (String(url).includes('discord.com') && method === 'GET') {
        // The bound surface is a public thread named with the user's prompt.
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'thread-9', type: 11, name: 'fix the auth' }),
          text: async () => '',
        };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const sessionUpdated = (bridge, title) =>
    bridge._handleGlobalEvent({
      payload: {
        type: 'session.updated',
        properties: { info: { id: 'ses-9', title } },
      },
    });

  function makeRenameBridge() {
    return makeBridge({
      lookupMessengerTarget: () => ({
        type: 'discord',
        token: 'bot-token',
        targetKey: 'thread-9',
        threadId: null,
        projectPath: '/p',
      }),
    });
  }

  it('renames the bound thread when OpenCode generates a real title', async () => {
    const bridge = makeRenameBridge();
    await sessionUpdated(bridge, 'Fix auth bug');
    await flush();
    const patches = calls.filter(([url, init]) => init.method === 'PATCH' && url.includes('/channels/thread-9'));
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0][1].body)).toEqual({ name: 'Fix auth bug' });
  });

  it('ignores the "New session -" placeholder title', async () => {
    const bridge = makeRenameBridge();
    await sessionUpdated(bridge, 'New session - 2026-06-11T13:00:00.000Z');
    await flush();
    expect(calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(0);
  });

  it('renames at most once per distinct title (Discord rate-limit protection)', async () => {
    const bridge = makeRenameBridge();
    await sessionUpdated(bridge, 'Fix auth bug');
    await sessionUpdated(bridge, 'Fix auth bug');
    await sessionUpdated(bridge, 'Fix auth bug');
    await flush();
    expect(calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(1);
  });

  it('never renames a plain text channel', async () => {
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push([String(url), init]);
      if ((init.method ?? 'GET') === 'GET' && String(url).includes('discord.com')) {
        return { ok: true, status: 200, json: async () => ({ id: 'chan-1', type: 0, name: 'general' }), text: async () => '' };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    });
    const bridge = makeBridge({
      lookupMessengerTarget: () => ({ type: 'discord', token: 'bot-token', targetKey: 'chan-1', threadId: null, projectPath: '/p' }),
    });
    await sessionUpdated(bridge, 'Fix auth bug');
    await flush();
    expect(calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(0);
  });
});
