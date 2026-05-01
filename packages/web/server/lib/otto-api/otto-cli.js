import { spawnSync } from 'child_process';

const DEFAULT_BUFFER = Math.max(Number(process.env.OTTO_CLI_MAX_BUFFER) || 0, 20 * 1024 * 1024);

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
