/**
 * Shared verbosity model for the Discord/Telegram ↔ OpenCode bridge.
 *
 * Three levels control how much of an OpenCode turn is mirrored back into the
 * messenger surface:
 *
 *   - `quiet`   — only the assistant's final text. Reasoning markers and tool
 *                 activity are suppressed entirely.
 *   - `normal`  — assistant text + reasoning markers + a compact one-liner per
 *                 tool run (the historical default).
 *   - `verbose` — everything `normal` shows, PLUS the full tool input and the
 *                 tool output/error for each call, wrapped in a Discord spoiler
 *                 (`||…||`) so the details stay collapsed "under a cut" until a
 *                 reader expands them.
 *
 * Both the OpenChamber settings UI and the in-chat `/verbosity` command write to
 * the same store, so the level can be changed from either side.
 */

export const VERBOSITY_LEVELS = ['quiet', 'normal', 'verbose'];

export const DEFAULT_VERBOSITY = 'normal';

const VERBOSITY_ALIASES = new Map([
  ['quiet', 'quiet'],
  ['silent', 'quiet'],
  ['low', 'quiet'],
  ['min', 'quiet'],
  ['minimal', 'quiet'],
  ['off', 'quiet'],
  ['normal', 'normal'],
  ['default', 'normal'],
  ['medium', 'normal'],
  ['standard', 'normal'],
  ['std', 'normal'],
  ['verbose', 'verbose'],
  ['high', 'verbose'],
  ['max', 'verbose'],
  ['maximum', 'verbose'],
  ['full', 'verbose'],
  ['all', 'verbose'],
  ['debug', 'verbose'],
]);

/**
 * Map a free-text level (from the UI or a `/verbosity` command) to one of the
 * canonical levels. Returns `null` for unrecognised input so callers can show a
 * helpful error instead of silently picking a default.
 */
export function parseVerbosityLevel(input) {
  if (typeof input !== 'string') return null;
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;
  return VERBOSITY_ALIASES.get(normalized) ?? null;
}

/** Coerce any value to a valid level, falling back to `normal`. */
export function normalizeVerbosity(value) {
  return VERBOSITY_LEVELS.includes(value) ? value : DEFAULT_VERBOSITY;
}
