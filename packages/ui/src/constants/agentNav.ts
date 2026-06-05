export type AppActiveView =
  | 'dashboard'
  | 'tasks'
  | 'chat'
  | 'settings';

const APP_ACTIVE_VIEW_SET = new Set<AppActiveView>([
  'dashboard',
  'tasks',
  'chat',
  'settings',
]);

export function isAppActiveView(value: unknown): value is AppActiveView {
  return typeof value === 'string' && APP_ACTIVE_VIEW_SET.has(value as AppActiveView);
}
