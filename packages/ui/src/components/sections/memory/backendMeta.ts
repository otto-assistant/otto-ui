import type { IconName } from '@/components/icon/icons';
import type { SettingsPageSlug } from '@/lib/settings/metadata';

/** Display icon per backend id (falls back to a generic memory icon). */
export const MEMORY_BACKEND_ICONS: Record<string, IconName> = {
  'opencode-mem': 'database-2',
  mempalace: 'node-tree',
  codemem: 'archive',
  hindsight: 'sparkling',
};

export function memoryBackendIcon(id: string): IconName {
  return MEMORY_BACKEND_ICONS[id] ?? 'brain';
}

/** Settings slug for a backend's record-management page. */
export function memoryBackendSlug(id: string): SettingsPageSlug {
  return `memory.${id}` as SettingsPageSlug;
}

/** Extract the backend id from a `memory.<id>` settings slug. */
export function backendIdFromSlug(slug: string): string | null {
  if (!slug.startsWith('memory.')) return null;
  return slug.slice('memory.'.length) || null;
}
