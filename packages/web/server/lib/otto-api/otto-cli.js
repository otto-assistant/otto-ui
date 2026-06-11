import { spawn, spawnSync } from 'child_process';

const DEFAULT_BUFFER = Math.max(Number(process.env.OTTO_CLI_MAX_BUFFER) || 0, 20 * 1024 * 1024);
const DEFAULT_ASYNC_TIMEOUT_MS = 120_000;

/**
 * Otto CLI prints prefixed log lines followed by optional JSON payloads.
 * Strip boxed "│ …" chatter so parsers can reliably find trailing JSON/objects.
 *
 * @param {string | undefined | null} text
 */
export const stripOttoLogLines = (text) => {
  if (!text || typeof text !== 'string') {
    return '';
  }

  const lines = text.split('\n').filter((line) => !/^\s*(?:┃|│|├|└|❯)\s/i.test(line));
  return lines.join('\n').trim();
};

/**
 * @typedef {object} OttoCliResult
 * @property {number | null} code
 * @property {string} stdout
 * @property {string} stderr
 * @property {string} combined
 */

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string|undefined> }} [options]
 * @returns {OttoCliResult}
 */
export const runOttoCli = (args, options = {}) => {
  const result = spawnSync('otto', args, {
    encoding: 'utf8',
    maxBuffer: DEFAULT_BUFFER,
    env: { ...process.env, ...options.env },
    cwd: options.cwd,
  });

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return {
    code: typeof result.status === 'number' ? result.status : null,
    stdout,
    stderr,
    combined: `${stdout}\n${stderr}`.trim(),
  };
};

/**
 * Async variant of {@link runOttoCli}. Spawns a command without blocking the
 * event loop — required for long-running commands such as `otto upgrade`.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string|undefined>, timeoutMs?: number }} [options]
 * @returns {Promise<OttoCliResult>}
 */
export const runCommandAsync = (command, args, options = {}) => {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (code) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        code,
        stdout,
        stderr,
        combined: `${stdout}\n${stderr}`.trim(),
      });
    };

    let child;
    try {
      child = spawn(command, args, {
        env: { ...process.env, ...options.env },
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      finish(null);
      return;
    }

    const timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
      }
      finish(null);
    }, options.timeoutMs ?? DEFAULT_ASYNC_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', () => {
      clearTimeout(timeout);
      finish(null);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      finish(typeof code === 'number' ? code : null);
    });
  });
};

/**
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string|undefined>, timeoutMs?: number }} [options]
 * @returns {Promise<OttoCliResult>}
 */
export const runOttoCliAsync = (args, options = {}) => runCommandAsync('otto', args, options);

/**
 * Parse the first JSON object embedded in Otto CLI output.
 *
 * @param {string} raw
 * @returns {Record<string, unknown> | null}
 */
export const parseOttoJsonObject = (raw) => {
  const cleaned = stripOttoLogLines(raw).trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
};

/**
 * @returns {string | null}
 */
export const readOttoCliVersion = () => {
  const { code, combined } = runOttoCli(['--version']);
  if (code !== 0) {
    return null;
  }
  const line = stripOttoLogLines(combined).split('\n').find((entry) => entry.trim().length > 0);
  return line ? line.trim() : null;
};
