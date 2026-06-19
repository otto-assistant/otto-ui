import {
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

/**
 * HTTP routes for the Memory feature, mounted under `/api/config/memory`.
 *
 * Registered before the generic OpenCode proxy (see feature-routes-runtime.js).
 * Lifecycle mutations trigger an OpenCode reload so the agent picks up the
 * plugin/MCP changes.
 */
export const registerMemoryRoutes = (app, dependencies) => {
  const {
    resolveOptionalProjectDirectory,
    refreshOpenCodeAfterConfigChange,
    clientReloadDelayMs,
  } = dependencies;

  const resolveDir = async (req) => {
    const { directory } = await resolveOptionalProjectDirectory(req);
    return directory || undefined;
  };

  const handleError = (res, error, context) => {
    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error(`[API:memory ${context}]`, error);
    }
    return res.status(status).json({
      error: error.message || 'Memory operation failed',
      ...(error.availability ? { availability: error.availability } : {}),
    });
  };

  const finishLifecycle = async (res, action, id, result) => {
    try {
      await refreshOpenCodeAfterConfigChange(`memory ${action} (${id})`);
      return res.json({
        success: true,
        requiresReload: true,
        reloadDelayMs: clientReloadDelayMs,
        ...result,
      });
    } catch (error) {
      console.error(`[API:memory ${action}] Reload failed after config change:`, error);
      return res.json({
        success: true,
        requiresReload: false,
        reloadFailed: true,
        warning: error.message || 'OpenCode reload failed after the memory configuration changed',
        ...result,
      });
    }
  };

  app.get('/api/config/memory', async (req, res) => {
    try {
      const directory = await resolveDir(req);
      const status = await getMemoryStatus(directory);
      return res.json(status);
    } catch (error) {
      return handleError(res, error, 'status');
    }
  });

  app.post('/api/config/memory/:id/install', async (req, res) => {
    try {
      const directory = await resolveDir(req);
      const deactivateOthers = req.body?.deactivateOthers === true;
      const result = await installBackend(req.params.id, { workingDirectory: directory, deactivateOthers });
      return finishLifecycle(res, 'install', req.params.id, result);
    } catch (error) {
      return handleError(res, error, 'install');
    }
  });

  app.post('/api/config/memory/:id/activate', async (req, res) => {
    try {
      const directory = await resolveDir(req);
      const deactivateOthers = req.body?.deactivateOthers === true;
      const result = await activateBackend(req.params.id, { workingDirectory: directory, deactivateOthers });
      return finishLifecycle(res, 'activate', req.params.id, result);
    } catch (error) {
      return handleError(res, error, 'activate');
    }
  });

  app.post('/api/config/memory/:id/deactivate', async (req, res) => {
    try {
      const directory = await resolveDir(req);
      const result = await deactivateBackend(req.params.id, { workingDirectory: directory });
      return finishLifecycle(res, 'deactivate', req.params.id, result);
    } catch (error) {
      return handleError(res, error, 'deactivate');
    }
  });

  app.get('/api/config/memory/:id/config', async (req, res) => {
    try {
      const directory = await resolveDir(req);
      const config = getBackendConfig(req.params.id, { workingDirectory: directory });
      return res.json(config);
    } catch (error) {
      return handleError(res, error, 'get-config');
    }
  });

  app.put('/api/config/memory/:id/config', async (req, res) => {
    try {
      const directory = await resolveDir(req);
      const result = setBackendConfig(req.params.id, { workingDirectory: directory, raw: req.body?.raw });
      return res.json({ success: true, ...result });
    } catch (error) {
      return handleError(res, error, 'set-config');
    }
  });

  app.get('/api/config/memory/:id/records', async (req, res) => {
    try {
      const directory = await resolveDir(req);
      const query = typeof req.query.q === 'string' ? req.query.q : undefined;
      const result = await listRecords(req.params.id, { workingDirectory: directory, query });
      return res.json(result);
    } catch (error) {
      return handleError(res, error, 'list-records');
    }
  });

  app.post('/api/config/memory/:id/records', async (req, res) => {
    try {
      const directory = await resolveDir(req);
      const input = req.body?.input || req.body || {};
      const record = await createRecord(req.params.id, { workingDirectory: directory, input });
      return res.json({ success: true, record });
    } catch (error) {
      return handleError(res, error, 'create-record');
    }
  });

  app.put('/api/config/memory/:id/records/:recordId', async (req, res) => {
    try {
      const directory = await resolveDir(req);
      const input = req.body?.input || req.body || {};
      const record = await updateRecord(req.params.id, {
        workingDirectory: directory,
        recordId: req.params.recordId,
        input,
      });
      return res.json({ success: true, record });
    } catch (error) {
      return handleError(res, error, 'update-record');
    }
  });

  app.delete('/api/config/memory/:id/records/:recordId', async (req, res) => {
    try {
      const directory = await resolveDir(req);
      const result = await deleteRecord(req.params.id, {
        workingDirectory: directory,
        recordId: req.params.recordId,
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      return handleError(res, error, 'delete-record');
    }
  });
};
