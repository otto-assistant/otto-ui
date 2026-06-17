import fs from 'fs';
import path from 'path';
import os from 'os';

import { readJsonFile } from '../utils/index.js';

/**
 * OpenCode Go has no public usage API yet (the official `/zen/go/v1/usage`
 * endpoint from opencode#16513 is still unmerged and returns 404). The only way
 * to read the rolling/weekly/monthly usage windows is the authenticated console
 * dashboard, which embeds the data in its SolidJS SSR hydration output. This
 * module resolves the dashboard credentials, fetches the page, and parses the
 * `rollingUsage` / `weeklyUsage` / `monthlyUsage` objects out of the markup —
 * the same approach community tools (opencode-quota, pi-usage) use.
 */

const CONFIG_DIR = path.join(os.homedir(), '.config', 'opencode');

const CONFIG_FILE_PATHS = [
  path.join(CONFIG_DIR, 'opencode-go.json'),
  path.join(CONFIG_DIR, 'opencode-quota', 'opencode-go.json')
];

const DASHBOARD_URL = (workspaceId) =>
  `https://opencode.ai/workspace/${encodeURIComponent(workspaceId)}/go`;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SCRAPE_TIMEOUT_MS = 12_000;

const asNonEmpty = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/**
 * Resolve workspace ID + auth cookie from (in priority order) environment
 * variables, an explicit config path, and the known config file locations.
 *
 * @returns {{ workspaceId: string, authCookie: string, source: string } | null}
 */
export const resolveDashboardConfig = () => {
  const envWorkspaceId = asNonEmpty(process.env.OPENCODE_GO_WORKSPACE_ID);
  const envAuthCookie = asNonEmpty(process.env.OPENCODE_GO_AUTH_COOKIE);
  if (envWorkspaceId && envAuthCookie) {
    return { workspaceId: envWorkspaceId, authCookie: envAuthCookie, source: 'env' };
  }

  const candidatePaths = [];
  const explicitPath = asNonEmpty(process.env.OPENCODE_GO_QUOTA_CONFIG);
  if (explicitPath) {
    candidatePaths.push(explicitPath);
  }
  candidatePaths.push(...CONFIG_FILE_PATHS);

  for (const filePath of candidatePaths) {
    const data = readJsonFile(filePath);
    if (!data || typeof data !== 'object') {
      continue;
    }
    const workspaceId = asNonEmpty(data.workspaceId);
    const authCookie = asNonEmpty(data.authCookie);
    if (workspaceId && authCookie) {
      return { workspaceId, authCookie, source: filePath };
    }
  }

  return null;
};

const CONFIG_SAVE_PATH = path.join(CONFIG_DIR, 'opencode-go.json');

/**
 * Save dashboard credentials to the config file (cookie mode).
 * @param {{ workspaceId: string, authCookie: string }} config
 */
export const saveDashboardConfig = ({ workspaceId, authCookie }) => {
  if (!workspaceId || !authCookie) {
    throw new Error('workspaceId and authCookie are required');
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_SAVE_PATH, JSON.stringify({ mode: 'cookie', workspaceId, authCookie }, null, 2), 'utf8');
};

/**
 * Save anchor times to the config file (anchor mode).
 * The user enters "Resets in" values from the opencode.ai dashboard.
 * These are stored as seconds-until-reset and used with local DB data.
 *
 * @param {{ rolling?: number, weekly?: number, monthly?: number }} anchors
 *   seconds until reset for each window (e.g. 13920 for "3h 52m")
 */
export const saveAnchorConfig = (anchors) => {
  if (!anchors || typeof anchors !== 'object') {
    throw new Error('anchors object is required');
  }
  // At least one anchor needed
  if (!anchors.rolling && !anchors.weekly && !anchors.monthly) {
    throw new Error('At least one anchor value is required');
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_SAVE_PATH, JSON.stringify({ mode: 'anchor', anchors }, null, 2), 'utf8');
};

/**
 * Read anchor config from the config file.
 * @returns {{ rolling?: number, weekly?: number, monthly?: number } | null}
 */
export const resolveAnchorConfig = () => {
  for (const filePath of [CONFIG_SAVE_PATH, ...CONFIG_FILE_PATHS]) {
    const data = readJsonFile(filePath);
    if (!data || typeof data !== 'object') continue;
    if (data.mode === 'anchor' && data.anchors && typeof data.anchors === 'object') {
      const anchors = {};
      if (typeof data.anchors.rolling === 'number') anchors.rolling = data.anchors.rolling;
      if (typeof data.anchors.weekly === 'number') anchors.weekly = data.anchors.weekly;
      if (typeof data.anchors.monthly === 'number') anchors.monthly = data.anchors.monthly;
      if (Object.keys(anchors).length > 0) return anchors;
    }
  }
  return null;
};

/**
 * Read the current config mode.
 * @returns { 'cookie' | 'anchor' | null }
 */
export const resolveConfigMode = () => {
  for (const filePath of [CONFIG_SAVE_PATH, ...CONFIG_FILE_PATHS]) {
    const data = readJsonFile(filePath);
    if (!data || typeof data !== 'object') continue;
    if (data.mode === 'anchor') return 'anchor';
    if (data.mode === 'cookie' || (data.workspaceId && data.authCookie)) return 'cookie';
  }
  return null;
};

/**
 * Remove the dashboard/anchors config file.
 */
export const clearDashboardConfig = () => {
  try {
    fs.unlinkSync(CONFIG_SAVE_PATH);
  } catch {
    // File may not exist — ignore.
  }
};

const extractNumber = (body, field) => {
  // Tolerates `usagePercent:65`, `"usagePercent":65`, and escaped `\"usagePercent\":65`.
  const match = body.match(new RegExp(`${field}\\\\?["']?\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : null;
};

const extractStatus = (body) => {
  const match = body.match(/status\\?["']?\s*:\s*\\?["']([a-z-]+)\\?["']/i);
  return match ? match[1] : null;
};

/**
 * Extract a balanced-brace object body starting after the given field name.
 * Handles nested objects (unlike a flat `{[^}]*}` regex).
 *
 * @param {string} html
 * @param {string} fieldName  e.g. "rollingUsage", "weeklyUsage", "monthlyUsage"
 * @returns {string|null} the text between the outer `{` and its matching `}`, or null.
 */
const extractObjectBody = (html, fieldName) => {
  // Find the position of fieldName followed by `{` (with optional chars in between).
  const startRe = new RegExp(`${fieldName}[^{]*\\{`);
  const startMatch = startRe.exec(html);
  if (!startMatch) return null;

  const openIdx = startMatch.index + startMatch[0].length - 1; // position of `{`
  let depth = 0;
  for (let i = openIdx; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(openIdx + 1, i);
    }
  }
  return null;
};

/**
 * Parse the OpenCode Go dashboard HTML for the usage windows.
 *
 * The SolidJS SSR hydration serializes each window as e.g.
 * `rollingUsage:$R[12]={status:"ok",resetInSec:2520,usagePercent:65}` (field
 * order varies). This finds each window's object body and pulls the numbers,
 * tolerant to field ordering and quoting.
 *
 * @param {string} html
 * @returns {{ rolling?: object, weekly?: object, monthly?: object } | null}
 */
export const parseDashboardUsage = (html) => {
  if (typeof html !== 'string' || !html) {
    return null;
  }

  // Try multiple possible token names in case the dashboard changes its naming.
  const windowKeys = {
    rolling: ['rollingUsage', 'rolling_usage', 'rolling'],
    weekly: ['weeklyUsage', 'weekly_usage', 'weekly'],
    monthly: ['monthlyUsage', 'monthly_usage', 'monthly'],
  };
  const result = {};

  for (const [key, tokens] of Object.entries(windowKeys)) {
    let objBody = null;
    for (const token of tokens) {
      objBody = extractObjectBody(html, token);
      if (objBody) break;
    }
    if (!objBody) continue;

    const usagePercent = extractNumber(objBody, 'usagePercent');
    const resetInSec = extractNumber(objBody, 'resetInSec');
    if (usagePercent === null && resetInSec === null) continue;
    result[key] = { usagePercent, resetInSec, status: extractStatus(objBody) };
  }

  return Object.keys(result).length > 0 ? result : null;
};

/**
 * Fetch and parse OpenCode Go usage windows from the console dashboard.
 *
 * @param {{ workspaceId: string, authCookie: string }} config
 * @returns {Promise<{ rolling?: object, weekly?: object, monthly?: object }>}
 * @throws {Error} when the request fails or the markup can't be parsed.
 */
export const fetchDashboardUsage = async ({ workspaceId, authCookie }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const response = await fetch(DASHBOARD_URL(workspaceId), {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
        Cookie: `auth=${authCookie}`
      },
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Dashboard request failed (${response.status}). Refresh your OpenCode Go auth cookie.`);
    }

    const html = await response.text();
    const parsed = parseDashboardUsage(html);
    if (!parsed) {
      throw new Error('Could not read usage from the OpenCode Go dashboard. The dashboard markup may have changed, or the cookie/workspace is invalid.');
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
};
