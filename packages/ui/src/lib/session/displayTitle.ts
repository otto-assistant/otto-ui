/**
 * Session title display helpers.
 *
 * OpenCode assigns brand-new sessions a placeholder title of the form
 * `New session - 2026-06-12T07:08:41.381Z` (and `Child session - …` for
 * subagents) until its title agent generates a real summary from the first
 * exchange. That raw timestamped placeholder must never be shown in the UI —
 * it leaks an ugly ISO string into the sidebar/header for the few seconds
 * before the generated title arrives. These helpers detect the placeholder so
 * callers can fall back to a friendly label instead.
 *
 * Mirrors OpenCode's own `isDefaultTitle` regex
 * (packages/opencode/src/session/session.ts).
 */

const PLACEHOLDER_TITLE_REGEX =
  /^(New session|Child session)\s*-\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/i;

/** True when `title` is OpenCode's auto-assigned, not-yet-generated placeholder. */
export function isPlaceholderSessionTitle(title: string | null | undefined): boolean {
  if (typeof title !== 'string') return false;
  return PLACEHOLDER_TITLE_REGEX.test(title.trim());
}

/**
 * Resolve the title to display for a session. Returns the trimmed title when
 * it is a real (non-placeholder) one, otherwise the provided fallback (e.g. a
 * localized "Untitled Session" label).
 */
export function getSessionDisplayTitle(
  title: string | null | undefined,
  fallback: string,
): string {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed || isPlaceholderSessionTitle(trimmed)) {
    return fallback;
  }
  return trimmed;
}
