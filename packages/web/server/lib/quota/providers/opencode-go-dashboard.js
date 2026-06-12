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

  const windowKeys = { rolling: 'rollingUsage', weekly: 'weeklyUsage', monthly: 'monthlyUsage' };
  const result = {};

  for (const [key, token] of Object.entries(windowKeys)) {
    // From the token, skip to the first `{...}` object and capture its body.
    const match = html.match(new RegExp(`${token}[^{]*\\{([^}]*)\\}`));
    if (!match) {
      continue;
    }
    const body = match[1];
    const usagePercent = extractNumber(body, 'usagePercent');
    const resetInSec = extractNumber(body, 'resetInSec');
    if (usagePercent === null && resetInSec === null) {
      continue;
    }
    result[key] = { usagePercent, resetInSec, status: extractStatus(body) };
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
