import type { AppActiveView } from '@/constants/agentNav';

/**
 * Hash-based routing for Otto UI agent views.
 *
 * Maps:
 *   #/           → dashboard
 *   #/memory     → memory
 *   #/tasks      → tasks (Tasks hub; List tab by default)
 *   #/chat       → chat
 *   #/settings   → settings
 *
 * Deep links:
 *   #/tasks/:id        → tasks view with task detail
 *
 * Legacy redirects:
 *   #/persona  → #/settings   (persona config now lives under Settings → Agents)
 *   #/schedule → #/tasks      (schedule is a tab inside the Tasks hub; the hash
 *                              watcher in `useHashRoute` switches the hub tab
 *                              to "schedule" when this redirect fires)
 *   #/projects → #/           (projects now render on the Dashboard)
 */

export interface HashRouteState {
  view: AppActiveView;
  params: Record<string, string>;
}

const VIEW_TO_PATH: Record<AppActiveView, string> = {
  dashboard: '/',
  tasks: '/tasks',
  chat: '/chat',
  settings: '/settings',
};

const PATH_TO_VIEW: Record<string, AppActiveView> = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/projects': 'dashboard',
  '/persona': 'settings',
  '/memory': 'settings',
  '/tasks': 'tasks',
  '/schedule': 'tasks',
  '/chat': 'chat',
  '/settings': 'settings',
};

/**
 * Returns true when the raw hash path should auto-select the Schedule tab
 * inside the Tasks hub view. The mapping is kept here so we don't need a
 * separate "legacy path" registry.
 */
export function isScheduleHashPath(hash?: string): boolean {
  const raw = hash ?? (typeof window !== 'undefined' ? window.location.hash : '');
  const path = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!path) return false;
  const segments = path.split('/');
  const basePath = `/${segments[1] || ''}`;
  return basePath === '/schedule';
}

/**
 * Parse the current window.location.hash into a route state.
 */
export function parseHashRoute(hash?: string): HashRouteState {
  const raw = hash ?? (typeof window !== 'undefined' ? window.location.hash : '');
  // Remove leading '#'
  const path = raw.startsWith('#') ? raw.slice(1) : raw;

  if (!path || path === '/') {
    return { view: 'dashboard', params: {} };
  }

  // Split into segments: /tasks/abc123 → ['', 'tasks', 'abc123']
  const segments = path.split('/');
  const basePath = `/${segments[1] || ''}`;
  const view = PATH_TO_VIEW[basePath];

  if (!view) {
    return { view: 'dashboard', params: {} };
  }

  const params: Record<string, string> = {};

  // Deep link parameter (second segment)
  if (segments[2]) {
    params.id = decodeURIComponent(segments[2]);
  }

  return { view, params };
}

/**
 * Build a hash string for a given view and optional params.
 */
export function buildHashRoute(view: AppActiveView, params?: Record<string, string>): string {
  const base = VIEW_TO_PATH[view] ?? '/';
  const id = params?.id;

  if (id) {
    return `#${base}/${encodeURIComponent(id)}`;
  }

  return `#${base}`;
}

/**
 * Navigate to a hash route via pushState-style hash update.
 */
export function navigateHash(view: AppActiveView, params?: Record<string, string>): void {
  if (typeof window === 'undefined') return;

  const hash = buildHashRoute(view, params);
  // Use pushState to enable back/forward
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  window.history.pushState({ hashRoute: { view, params } }, '', url);

  // Dispatch hashchange manually since pushState doesn't trigger it
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/**
 * Replace current hash route (no history entry).
 */
export function replaceHashRoute(view: AppActiveView, params?: Record<string, string>): void {
  if (typeof window === 'undefined') return;

  const hash = buildHashRoute(view, params);
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  window.history.replaceState({ hashRoute: { view, params } }, '', url);
}
