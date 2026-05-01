import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { RelayAllowlists } from './allowlist.js';

export type LoadedRelayConfig = Readonly<{
  discordBotToken: string;
  openchamberBaseUrl: string;
  sessionId: string;
  authorization: string | null;
  workspaceDirectory?: string;
  allowlists: RelayAllowlists;
}>;

type RelayJsonSlice = Readonly<{
  sessionId?: string;
  channelIds?: unknown;
  userAllowlist?: unknown;
  /** legacy alias */
  users?: unknown;
  workspaceDirectory?: string;
  openchamberBaseUrl?: string;
  ipcBearerToken?: string;
  opencodeServerPassword?: string;
  authorization?: string;
}>;

const trimEnv = (key: string) => {
  const value = process.env[key];
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const parseCsvSet = (value: string): Set<string> => {
  const set = new Set<string>();
  for (const chunk of value.split(',')) {
    const trimmed = chunk.trim();
    if (trimmed.length > 0) {
      set.add(trimmed);
    }
  }
  return set;
};

const coerceStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length > 0) {
      out.push(trimmed);
    }
  }
  return out;
};

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

const readJsonFile = (filePath: string): unknown | null => {
  try {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const extractRelaySlice = (root: unknown): RelayJsonSlice | null => {
  if (!root || typeof root !== 'object') {
    return null;
  }
  const obj = root as Record<string, unknown>;
  const direct = obj.discordRelay;
  if (direct && typeof direct === 'object') {
    return direct as RelayJsonSlice;
  }
  const oc = obj.openchamber;
  if (oc && typeof oc !== 'object') {
    return null;
  }
  const nested =
    oc && typeof oc === 'object' ? (oc as Record<string, unknown>).discordRelay : undefined;
  if (!nested || typeof nested !== 'object') {
    return null;
  }
  return nested as RelayJsonSlice;
};

const authorizationFromSources = ({
  authorization,
  bearerToken,
  password,
}: Readonly<{ authorization?: string; bearerToken?: string; password?: string }>): string | null => {
  const direct = typeof authorization === 'string' ? authorization.trim() : '';
  if (direct.length > 0) return direct;

  const bearer = typeof bearerToken === 'string' ? bearerToken.trim() : '';
  if (bearer.length > 0) {
    return bearer.startsWith('Bearer ') ? bearer : `Bearer ${bearer}`;
  }

  const opencodePassword = typeof password === 'string' ? password.trim() : '';
  if (opencodePassword.length === 0) {
    return null;
  }

  const credentials = Buffer.from(`opencode:${opencodePassword}`, 'utf8').toString('base64');
  return `Basic ${credentials}`;
};

type JsonMergeSnapshot = Readonly<{
  sessionId?: string;
  channelIds?: Set<string>;
  userIds?: Set<string>;
  workspaceDirectory?: string;
  openchamberBaseUrl?: string;
  authorization?: string;
}>;

const relayJsonCandidates = (): string[] => {
  const cwd = process.cwd();
  const explicit = trimEnv('DISCORD_RELAY_OPENCODE_JSON');
  const home = os.homedir();

  // Lower precedence first; later paths override earlier ones.
  const ordered = [
    path.join(home, '.config', 'opencode', 'opencode.json'),
    path.join(cwd, '.opencode', 'opencode.json'),
    path.join(cwd, 'opencode.json'),
    ...(explicit.length > 0 ? [explicit] : []),
  ];

  return Array.from(new Set(ordered));
};

const mergeRelaySliceIntoState = (
  slice: RelayJsonSlice,
  mutable: JsonMergeSnapshot,
): JsonMergeSnapshot => {
  const next: Record<string, unknown> = { ...mutable };

  if (typeof slice.sessionId === 'string' && slice.sessionId.trim().length > 0) {
    next.sessionId = slice.sessionId.trim();
  }

  const channelCsv = coerceStringArray(slice.channelIds);
  if (channelCsv.length > 0) {
    next.channelIds = new Set(channelCsv);
  }

  const userCsv = [
    ...coerceStringArray(slice.userAllowlist),
    ...coerceStringArray(slice.users),
  ];
  if (userCsv.length > 0) {
    next.userIds = new Set(userCsv);
  }

  if (typeof slice.workspaceDirectory === 'string' && slice.workspaceDirectory.trim().length > 0) {
    next.workspaceDirectory = slice.workspaceDirectory.trim();
  }

  if (typeof slice.openchamberBaseUrl === 'string' && slice.openchamberBaseUrl.trim().length > 0) {
    next.openchamberBaseUrl = normalizeBaseUrl(slice.openchamberBaseUrl.trim());
  }

  const nextAuth = authorizationFromSources({
    authorization: slice.authorization ?? undefined,
    bearerToken: slice.ipcBearerToken ?? undefined,
    password: slice.opencodeServerPassword ?? undefined,
  });
  if (nextAuth) {
    next.authorization = nextAuth;
  }

  return Object.freeze(next) as JsonMergeSnapshot;
};

export function loadDiscordRelayConfig(): LoadedRelayConfig {
  let sessionIdJson: string | undefined;
  let channelIdsJson: Set<string> | undefined;
  let userIdsJson: Set<string> | undefined;
  let workspaceDirectoryJson: string | undefined;
  let baseUrlJson: string | undefined;
  let authorizationJson: string | undefined;

  let mergedJson: JsonMergeSnapshot = {};

  for (const filePath of relayJsonCandidates()) {
    const root = readJsonFile(filePath);
    const slice = extractRelaySlice(root);
    if (!slice) {
      continue;
    }

    mergedJson = mergeRelaySliceIntoState(slice, mergedJson);
  }

  sessionIdJson = mergedJson.sessionId;
  channelIdsJson = mergedJson.channelIds;
  userIdsJson = mergedJson.userIds;
  workspaceDirectoryJson = mergedJson.workspaceDirectory;
  baseUrlJson = mergedJson.openchamberBaseUrl;
  authorizationJson = mergedJson.authorization;

  const discordBotToken = trimEnv('DISCORD_BOT_TOKEN');
  const sessionEnv = trimEnv('DISCORD_RELAY_SESSION_ID');
  const channelsEnvCsv = trimEnv('DISCORD_RELAY_CHANNEL_IDS');
  const usersEnvCsv = trimEnv('DISCORD_RELAY_USER_IDS');

  const openchamberBaseUrlRaw = trimEnv('OPENCHAMBER_BASE_URL') ||
    trimEnv('DISCORD_RELAY_OPENCHAMBER_URL') ||
    baseUrlJson ||
    '';
  const openchamberBaseUrl = normalizeBaseUrl(openchamberBaseUrlRaw.length > 0 ? openchamberBaseUrlRaw : 'http://127.0.0.1:3000');

  const sessionId = sessionEnv || sessionIdJson || '';

  let channelAllowlist = channelIdsJson;
  const channelsParsed = channelsEnvCsv.length > 0 ? parseCsvSet(channelsEnvCsv) : null;
  if (channelsParsed && channelsParsed.size > 0) {
    channelAllowlist = channelsParsed;
  }

  let userAllowlistMerged = usersEnvCsv.length > 0 ? parseCsvSet(usersEnvCsv) : undefined;
  if (!userAllowlistMerged && userIdsJson) {
    userAllowlistMerged = new Set(userIdsJson);
  }

  const workspaceEnv = trimEnv('DISCORD_RELAY_OPENCODE_DIRECTORY');
  const workspaceResolved: string | undefined =
    workspaceEnv.length > 0 ? workspaceEnv : workspaceDirectoryJson;

  const authorizationFromEnv = authorizationFromSources({
    authorization: trimEnv('DISCORD_RELAY_AUTHORIZATION') || undefined,
    bearerToken:
      trimEnv('DISCORD_RELAY_BEARER_TOKEN') ||
      trimEnv('DISCORD_RELAY_IPC_BEARER_TOKEN') ||
      undefined,
    password: trimEnv('OPENCODE_SERVER_PASSWORD') || undefined,
  });

  let authorizationMerged = authorizationFromEnv ?? authorizationJson ?? null;
  authorizationMerged = authorizationMerged && authorizationMerged.length > 0 ? authorizationMerged : null;

  if (discordBotToken.length === 0) {
    throw new Error(
      'Discord relay config error: DISCORD_BOT_TOKEN is required (Discord bot OAuth token)',
    );
  }

  if (sessionId.trim().length === 0) {
    throw new Error(
      [
        'Discord relay config error: OpenCode/OpenChamber session id is required.',
        'Set DISCORD_RELAY_SESSION_ID or discordRelay.sessionId in opencode.json.',
      ].join(' '),
    );
  }

  if (!userAllowlistMerged || userAllowlistMerged.size === 0) {
    throw new Error(
      [
        'Discord relay config error: user allowlist is required.',
        'Set DISCORD_RELAY_USER_IDS (comma-separated) or discordRelay.userAllowlist / users in opencode.json.',
      ].join(' '),
    );
  }

  if (!authorizationMerged) {
    throw new Error(
      [
        'Discord relay auth is required.',
        'Prefer OPENCODE_SERVER_PASSWORD (matches OpenChamber Basic auth)',
        'or DISCORD_RELAY_BEARER_TOKEN / DISCORD_RELAY_AUTHORIZATION overrides.',
      ].join(' '),
    );
  }

  let channelRestriction: ReadonlySet<string> | null;
  if (channelAllowlist && channelAllowlist.size > 0) {
    channelRestriction = channelAllowlist;
  } else {
    channelRestriction = null;
  }

  return {
    discordBotToken,
    openchamberBaseUrl,
    sessionId,
    authorization: authorizationMerged,
    ...(typeof workspaceResolved === 'string'
      ? { workspaceDirectory: workspaceResolved }
      : {}),
    allowlists: Object.freeze({
      userIds: userAllowlistMerged,
      channelIds: channelRestriction,
    }),
  };
}
