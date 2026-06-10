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

  it('normal: shows reasoning text + tool details inline (no spoilers)', () => {
    expect(renderPartForMessenger({ type: 'text', text: 'hi' }, 'normal')).toBe('hi');
    const reasoning = renderPartForMessenger({ type: 'reasoning', text: 'deep thoughts' }, 'normal');
    expect(reasoning).toContain('┣ thinking');
    expect(reasoning).toContain('deep thoughts');  // full reasoning text visible inline
    expect(reasoning).not.toContain('||');          // no spoiler at normal

    const line = renderPartForMessenger(toolPart(), 'normal');
    expect(line).toContain('bash');
    expect(line).toContain('ls -la');    // command summary stays
    expect(line).toContain('total 0');   // output now visible inline at normal
    expect(line).not.toContain('||');    // no spoiler at normal
    // Multi-line now: one-liner + code block with tool details
    expect(line.split('\n').length).toBeGreaterThan(1);
  });

  it('verbose: appends input + output inline (never hidden behind a spoiler)', () => {
    const line = renderPartForMessenger(toolPart(), 'verbose');
    expect(line).toContain('⬦ bash');
    // Details are visible inline as-is, no click-to-reveal spoiler.
    expect(line).not.toContain('||');
    expect(line).toContain('"command": "ls -la"');
    expect(line).toContain('total 0');
  });

  it('verbose: error tools show the error inline', () => {
    const line = renderPartForMessenger(
      toolPart({ state: { status: 'error', input: { command: 'boom' }, error: 'exit 1' } }),
      'verbose',
    );
    expect(line.startsWith('✗ bash')).toBe(true);
    expect(line).not.toContain('||');
    expect(line).toContain('error: exit 1');
  });

  it('verbose: reasoning shows the thinking text inline (no spoiler)', () => {
    const out = renderPartForMessenger({ type: 'reasoning', text: 'deep thoughts' }, 'verbose');
    expect(out.startsWith('┣ thinking')).toBe(true);
    expect(out).not.toContain('||');
    expect(out).toContain('deep thoughts');
  });

  it('defaults to normal when verbosity is omitted or invalid', () => {
    const line = renderPartForMessenger(toolPart(), 'bogus');
    expect(line).not.toContain('||');
  });
});

describe('renderToolPart — code fence safety', () => {
  it('neutralises embedded code fences so the inline block cannot break early', () => {
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
    // The only real fences are the inline block's own; embedded ``` is replaced.
    expect(line).not.toContain('```js');
    expect(line).toContain("'''js");
  });
});
