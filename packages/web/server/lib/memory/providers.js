import { codememAdapter } from './adapters/codemem.js';
import { opencodeMemAdapter } from './adapters/opencode-mem.js';
import { mempalaceAdapter } from './adapters/mempalace.js';
import { hindsightAdapter } from './adapters/hindsight.js';

/**
 * Ordered registry of supported memory backends. Order is the display order in
 * the Memory settings section.
 */
export const MEMORY_ADAPTERS = [
  opencodeMemAdapter,
  mempalaceAdapter,
  codememAdapter,
  hindsightAdapter,
];

const BY_ID = new Map(MEMORY_ADAPTERS.map((a) => [a.id, a]));

export function getAdapter(id) {
  return BY_ID.get(id) || null;
}

/**
 * Public, serializable metadata for a backend (no functions). Used by the
 * status endpoint so the UI can render cards without leaking server internals.
 */
export function adapterMeta(adapter) {
  return {
    id: adapter.id,
    name: adapter.name,
    tagline: adapter.tagline,
    description: adapter.description,
    docsUrl: adapter.docsUrl,
    integration: adapter.integration,
    badges: adapter.badges || [],
    requirements: adapter.requirements || [],
    capabilities: adapter.capabilities || {},
    recordModel: adapter.recordModel || {},
  };
}
