import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessengerOpencodeBridge } from './messenger-opencode-bridge.js';

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

function makeBridge() {
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
