import { MEMORY_ADAPTERS, getAdapter, adapterMeta } from './providers.js';

/**
 * Orchestration layer for the Memory feature.
 *
 * Responsibilities:
 *  - Aggregate per-backend status (installed/active + metadata).
 *  - Drive install / activate / deactivate, including the "deactivate others"
 *    flow used when a second backend is enabled.
 *  - Dispatch per-project record CRUD to the active backend's adapter.
 *
 * Config-file mutations happen inside the adapters; OpenCode reload is triggered
 * by the route layer after a mutation succeeds.
 */

async function detectOne(adapter, workingDirectory) {
  try {
    const detection = await adapter.detect({ workingDirectory });
    return {
      ...adapterMeta(adapter),
      installed: Boolean(detection.installed),
      active: Boolean(detection.active),
      detail: detection.detail || '',
      issues: Array.isArray(detection.issues) ? detection.issues : [],
    };
  } catch (error) {
    return {
      ...adapterMeta(adapter),
      installed: false,
      active: false,
      detail: '',
      issues: [`Detection failed: ${error.message || String(error)}`],
    };
  }
}

export async function getMemoryStatus(workingDirectory) {
  const backends = await Promise.all(
    MEMORY_ADAPTERS.map((adapter) => detectOne(adapter, workingDirectory)),
  );
  const activeBackends = backends.filter((b) => b.active).map((b) => b.id);
  return { backends, activeBackends };
}

function requireAdapter(id) {
  const adapter = getAdapter(id);
  if (!adapter) {
    const error = new Error(`Unknown memory backend "${id}"`);
    error.statusCode = 404;
    throw error;
  }
  return adapter;
}

/**
 * Deactivate every active backend except `keepId`. Returns the list of ids that
 * were deactivated.
 */
async function deactivateOtherBackends(keepId, workingDirectory) {
  const deactivated = [];
  for (const adapter of MEMORY_ADAPTERS) {
    if (adapter.id === keepId) continue;
    let detection;
    try {
      detection = await adapter.detect({ workingDirectory });
    } catch {
      continue;
    }
    if (detection.active) {
      await adapter.deactivate({ workingDirectory });
      deactivated.push(adapter.id);
    }
  }
  return deactivated;
}

export async function installBackend(id, { workingDirectory, deactivateOthers = false }) {
  const adapter = requireAdapter(id);
  const deactivated = deactivateOthers ? await deactivateOtherBackends(id, workingDirectory) : [];
  const installResult = adapter.install
    ? await adapter.install({ workingDirectory })
    : { steps: [] };
  if (adapter.activate) {
    await adapter.activate({ workingDirectory });
  }
  return {
    id,
    steps: installResult.steps || [],
    deactivated,
    status: await getMemoryStatus(workingDirectory),
  };
}

export async function activateBackend(id, { workingDirectory, deactivateOthers = false }) {
  const adapter = requireAdapter(id);
  const deactivated = deactivateOthers ? await deactivateOtherBackends(id, workingDirectory) : [];
  await adapter.activate({ workingDirectory });
  return {
    id,
    deactivated,
    status: await getMemoryStatus(workingDirectory),
  };
}

export async function deactivateBackend(id, { workingDirectory }) {
  const adapter = requireAdapter(id);
  await adapter.deactivate({ workingDirectory });
  return {
    id,
    status: await getMemoryStatus(workingDirectory),
  };
}

export function getBackendConfig(id, { workingDirectory }) {
  const adapter = requireAdapter(id);
  if (!adapter.getConfig) {
    const error = new Error(`Backend "${id}" is not configurable`);
    error.statusCode = 400;
    throw error;
  }
  return adapter.getConfig({ workingDirectory });
}

export function setBackendConfig(id, { workingDirectory, raw }) {
  const adapter = requireAdapter(id);
  if (!adapter.setConfig) {
    const error = new Error(`Backend "${id}" is not configurable`);
    error.statusCode = 400;
    throw error;
  }
  return adapter.setConfig({ workingDirectory }, raw);
}

function requireRecords(adapter) {
  if (!adapter.records || !adapter.capabilities?.records) {
    const error = new Error(`Backend "${adapter.id}" does not support record management`);
    error.statusCode = 400;
    throw error;
  }
  return adapter.records;
}

export async function getRecordsAvailability(id, { workingDirectory }) {
  const adapter = requireAdapter(id);
  const records = requireRecords(adapter);
  if (!records.available) return { ok: true };
  return records.available({ workingDirectory });
}

export async function listRecords(id, { workingDirectory, project, query }) {
  const adapter = requireAdapter(id);
  const records = requireRecords(adapter);
  const availability = records.available ? await records.available({ workingDirectory }) : { ok: true };
  if (!availability.ok) {
    const error = new Error(availability.reason || 'Record management is unavailable for this backend right now.');
    error.statusCode = 503;
    error.availability = availability;
    throw error;
  }
  const items = await records.list({ workingDirectory, project, query });
  return { items, availability };
}

export async function createRecord(id, { workingDirectory, project, input }) {
  const adapter = requireAdapter(id);
  const records = requireRecords(adapter);
  if (!adapter.capabilities?.create) {
    const error = new Error(`Backend "${id}" does not support creating records`);
    error.statusCode = 400;
    throw error;
  }
  return records.create({ workingDirectory, project, input });
}

export async function updateRecord(id, { workingDirectory, project, recordId, input }) {
  const adapter = requireAdapter(id);
  const records = requireRecords(adapter);
  if (!adapter.capabilities?.update) {
    const error = new Error(`Backend "${id}" does not support updating records`);
    error.statusCode = 400;
    throw error;
  }
  return records.update({ workingDirectory, project, id: recordId, input });
}

export async function deleteRecord(id, { workingDirectory, project, recordId }) {
  const adapter = requireAdapter(id);
  const records = requireRecords(adapter);
  if (!adapter.capabilities?.delete) {
    const error = new Error(`Backend "${id}" does not support deleting records`);
    error.statusCode = 400;
    throw error;
  }
  await records.remove({ workingDirectory, project, id: recordId });
  return { id: recordId };
}
