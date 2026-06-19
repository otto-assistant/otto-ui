export { registerMemoryRoutes } from './routes.js';
export {
  getMemoryStatus,
  installBackend,
  activateBackend,
  deactivateBackend,
  getBackendConfig,
  setBackendConfig,
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
} from './service.js';
export { MEMORY_ADAPTERS, getAdapter, adapterMeta } from './providers.js';
