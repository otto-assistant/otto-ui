import { describe, it, expect } from 'vitest';
import { renderPartForMessenger, renderToolPart } from './messenger-render.js';

const toolPart = (overrides = {}) => ({
  type: 'tool',
  id: 'prt_1',
  tool: 'bash',
  state: {
    status: 'completed',
    input: { command: 'ls -la' },
    output: 'total 0\ndrwxr-xr-x  2 user staff   64 file',
    ...(overrides.state ?? {}),
  },
  ...overrides,
});

describe('renderPartForMessenger — verbosity gating', () => {
  it('quiet: returns only assistant text, hides reasoning + tools', () => {
    expect(renderPartForMessenger({ type: 'text', text: 'hello' }, 'quiet')).toBe('hello');
    expect(renderPartForMessenger({ type: 'reasoning', text: 'thinking…' }, 'quiet')).toBeNull();
    expect(renderPartForMessenger(toolPart(), 'quiet')).toBeNull();
  });

  it('normal: text + thinking marker + compact tool one-liner (no spoiler)', () => {
    expect(renderPartForMessenger({ type: 'text', text: 'hi' }, 'normal')).toBe('hi');
    expect(renderPartForMessenger({ type: 'reasoning', text: 'x' }, 'normal')).toBe('┣ thinking');
    const line = renderPartForMessenger(toolPart(), 'normal');
    expect(line).toContain('bash');
    expect(line).toContain('ls -la');
    expect(line).not.toContain('||');
  });

  it('verbose: appends a collapsed spoiler with input + output', () => {
    const line = renderPartForMessenger(toolPart(), 'verbose');
    expect(line).toContain('⬦ bash');
    // Spoiler markers + the captured input/output.
    expect(line).toContain('||```');
    expect(line).toContain('```||');
    expect(line).toContain('"command": "ls -la"');
    expect(line).toContain('total 0');
  });

  it('verbose: error tools show the error under the spoiler', () => {
    const line = renderPartForMessenger(
      toolPart({ state: { status: 'error', input: { command: 'boom' }, error: 'exit 1' } }),
      'verbose',
    );
    expect(line.startsWith('✗ bash')).toBe(true);
    expect(line).toContain('error: exit 1');
  });

  it('verbose: reasoning shows the thinking text under a spoiler', () => {
    const out = renderPartForMessenger({ type: 'reasoning', text: 'deep thoughts' }, 'verbose');
    expect(out.startsWith('┣ thinking')).toBe(true);
    expect(out).toContain('||```');
    expect(out).toContain('deep thoughts');
  });

  it('defaults to normal when verbosity is omitted or invalid', () => {
    const line = renderPartForMessenger(toolPart(), 'bogus');
    expect(line).not.toContain('||');
  });
});

describe('renderToolPart — spoiler safety', () => {
  it('neutralises embedded code fences so the spoiler cannot break early', () => {
    const line = renderToolPart(
      {
        tool: 'write',
        state: {
          status: 'completed',
          input: { filePath: 'a.md', content: '```js\ncode\n```' },
          output: 'ok',
        },
      },
      'verbose',
    );
    // The only real fences are the spoiler's own; embedded ``` is replaced.
    expect(line).not.toContain('```js');
    expect(line).toContain("'''js");
  });
});
