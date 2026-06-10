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

async function run(text, { binding = null, surfaceMutators = makeMutators(), opencode = {} } = {}) {
  const command = parseLeadingCommand(text);
  const result = await executeMessengerCommand({
    command,
    ctx,
    opencode,
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

describe('/model + /status surface the OpenChamber default model', () => {
  const opencode = { listProviders: async () => [{ id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude-sonnet-4' }] }] };

  it('/model with no args shows the OpenChamber default when no override is set', async () => {
    const { result } = await run('/model', {
      opencode,
      binding: {
        globalDefaultModel: 'anthropic/claude-sonnet-4',
        projectDefaults: null,
      },
    });
    expect(result.reply).toContain('OpenChamber default');
    expect(result.reply).toContain('anthropic/claude-sonnet-4');
  });

  it('/model with no args explains nothing is set when there is no default anywhere', async () => {
    const { result } = await run('/model', { opencode, binding: {} });
    expect(result.reply).toMatch(/No default set/);
  });

  it('/status falls back to the OpenChamber default model + agent', async () => {
    const { result } = await run('/status', {
      binding: {
        globalDefaultModel: 'openai/gpt-5',
        globalDefaultAgent: 'build',
      },
    });
    expect(result.reply).toContain('`openai/gpt-5` _(OpenChamber default)_');
    expect(result.reply).toContain('`build` _(OpenChamber default)_');
  });

  it('/status prefers a surface override over the OpenChamber default', async () => {
    const { result } = await run('/status', {
      binding: { modelOverride: 'x/y', globalDefaultModel: 'openai/gpt-5' },
    });
    expect(result.reply).toContain('`x/y` _(this conversation)_');
    expect(result.reply).not.toContain('OpenChamber default');
  });
});

describe('/help includes verbosity and skill', () => {
  it('lists the /verbosity and /skill commands', async () => {
    const { result } = await run('/help');
    expect(result.reply).toContain('/verbosity');
    expect(result.reply).toContain('/skill');
  });
});

describe('/skill command', () => {
  const opencode = {
    listSkills: async () => [
      { name: 'theme-system', description: 'theme tokens' },
      { name: 'drag-to-reorder', description: 'dnd-kit lists' },
    ],
    sendPrompt: vi.fn(async () => ({ ok: true })),
  };

  it('lists available skills with no args', async () => {
    const { result } = await run('/skill', { opencode, binding: { projectPath: '/p' } });
    expect(result.reply).toContain('Available skills');
    expect(result.reply).toContain('theme-system');
    expect(result.reply).toContain('drag-to-reorder');
  });

  it('hands a named skill to the agent when a session exists', async () => {
    const sendPrompt = vi.fn(async () => ({ ok: true }));
    const { result } = await run('/skill theme-system', {
      opencode: { ...opencode, sendPrompt },
      binding: { sessionId: 'ses-1', projectPath: '/p' },
    });
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendPrompt.mock.calls[0][2]).toContain('theme-system');
    expect(result.reply).toMatch(/Handed the `theme-system` skill/);
  });

  it('rejects an unknown skill name', async () => {
    const { result } = await run('/skill nope', { opencode, binding: { sessionId: 'ses-1' } });
    expect(result.reply).toMatch(/Unknown skill/);
  });

  it('asks for a message first when no session is bound', async () => {
    const { result } = await run('/skill theme-system', { opencode, binding: { sessionId: null } });
    expect(result.reply).toMatch(/Send a regular message first/);
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
