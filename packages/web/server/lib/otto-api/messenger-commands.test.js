import { describe, it, expect, vi } from 'vitest';
import { parseLeadingCommand, executeMessengerCommand } from './messenger-commands.js';

const ctx = { type: 'discord', token: 't', channelId: 'c1', threadId: null };

function makeMutators() {
  return {
    setOverrides: vi.fn(async () => {}),
    setVerbosityDefault: vi.fn(async () => {}),
    setProjectDefaults: vi.fn(async () => {}),
    unbindSession: vi.fn(async () => {}),
  };
}

async function run(text, { binding = null, surfaceMutators = makeMutators() } = {}) {
  const command = parseLeadingCommand(text);
  const result = await executeMessengerCommand({
    command,
    ctx,
    opencode: {},
    binding,
    surfaceMutators,
  });
  return { result, surfaceMutators };
}

describe('parseLeadingCommand', () => {
  it('extracts /verbosity with args', () => {
    expect(parseLeadingCommand('/verbosity verbose')).toMatchObject({
      name: 'verbosity',
      args: 'verbose',
    });
  });
  it('returns null for plain prompts', () => {
    expect(parseLeadingCommand('just a message')).toBeNull();
  });
});

describe('/verbosity command', () => {
  it('lists levels and marks the effective one when called with no args', async () => {
    const { result, surfaceMutators } = await run('/verbosity', {
      binding: { verbosityDefault: 'verbose' },
    });
    expect(result.reply).toContain('Output verbosity');
    expect(result.reply).toContain('quiet');
    expect(result.reply).toContain('verbose');
    // effective marker (➤) appears on the default level
    expect(result.reply).toContain('➤ `verbose`');
    expect(surfaceMutators.setOverrides).not.toHaveBeenCalled();
  });

  it('sets a per-conversation override', async () => {
    const { result, surfaceMutators } = await run('/verbosity verbose');
    expect(surfaceMutators.setOverrides).toHaveBeenCalledWith({ verbosityOverride: 'verbose' });
    expect(result.reply).toMatch(/Verbosity set to `verbose`/);
  });

  it('accepts aliases (high -> verbose, low -> quiet)', async () => {
    const a = await run('/verbosity high');
    expect(a.surfaceMutators.setOverrides).toHaveBeenCalledWith({ verbosityOverride: 'verbose' });
    const b = await run('/verbosity low');
    expect(b.surfaceMutators.setOverrides).toHaveBeenCalledWith({ verbosityOverride: 'quiet' });
  });

  it('sets the messenger-wide default with `default <level>`', async () => {
    const { surfaceMutators } = await run('/verbosity default quiet');
    expect(surfaceMutators.setVerbosityDefault).toHaveBeenCalledWith('quiet');
  });

  it('clears the conversation override with reset', async () => {
    const { surfaceMutators } = await run('/verbosity reset');
    expect(surfaceMutators.setOverrides).toHaveBeenCalledWith({ verbosityOverride: null });
  });

  it('clears the default with `default reset`', async () => {
    const { surfaceMutators } = await run('/verbosity default reset');
    expect(surfaceMutators.setVerbosityDefault).toHaveBeenCalledWith(null);
  });

  it('rejects unknown levels without mutating', async () => {
    const { result, surfaceMutators } = await run('/verbosity loud');
    expect(result.reply).toMatch(/Unknown level/);
    expect(surfaceMutators.setOverrides).not.toHaveBeenCalled();
  });
});

describe('/help includes verbosity', () => {
  it('lists the /verbosity command', async () => {
    const { result } = await run('/help');
    expect(result.reply).toContain('/verbosity');
  });
});

describe('/abort and /model still resolve as known commands', () => {
  it('abort without a session replies with a friendly error (not pass-through)', async () => {
    const { result } = await run('/abort', { binding: { sessionId: null } });
    expect(result).not.toBeNull();
    expect(result.reply).toMatch(/No session/);
  });
  it('unknown commands pass through (null) for OpenCode to handle', async () => {
    const { result } = await run('/changelog');
    expect(result).toBeNull();
  });
});
