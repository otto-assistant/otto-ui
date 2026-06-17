import express from 'express';
import { resolveDashboardConfig, saveDashboardConfig, saveAnchorConfig, clearDashboardConfig, resolveConfigMode, resolveAnchorConfig } from './providers/opencode-go-dashboard.js';

export function registerQuotaRoutes(app, { getQuotaProviders }) {
  app.get('/api/quota/providers', async (_req, res) => {
    try {
      const { listConfiguredQuotaProviders } = await getQuotaProviders();
      const providers = listConfiguredQuotaProviders();
      res.json({ providers });
    } catch (error) {
      console.error('Failed to list quota providers:', error);
      res.status(500).json({ error: error.message || 'Failed to list quota providers' });
    }
  });

  app.get('/api/quota/:providerId', async (req, res) => {
    try {
      const { providerId } = req.params;
      if (!providerId) {
        return res.status(400).json({ error: 'Provider ID is required' });
      }
      const { fetchQuotaForProvider } = await getQuotaProviders();
      const result = await fetchQuotaForProvider(providerId);
      res.json(result);
    } catch (error) {
      console.error('Failed to fetch quota:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch quota' });
    }
  });

  // ── OpenCode Go dashboard config endpoints ──

  /** Check current config status (mode + whether configured). */
  app.get('/api/quota/opencode-go/config', (_req, res) => {
    const mode = resolveConfigMode();
    const cookieConfig = mode === 'cookie' ? resolveDashboardConfig() : null;
    const anchorConfig = mode === 'anchor' ? resolveAnchorConfig() : null;
    res.json({
      configured: !!mode,
      mode,
      hasCookie: !!cookieConfig,
      hasAnchors: !!anchorConfig,
      cookieSource: cookieConfig?.source ?? null,
      // Return anchor values (seconds until reset) so UI can pre-fill edit fields
      anchors: anchorConfig ?? null,
    });
  });

  /** Save config: either cookie mode (workspaceId + authCookie) or anchor mode (anchors). */
  app.post('/api/quota/opencode-go/config', express.json({ limit: '64kb' }), (req, res) => {
    try {
      const { mode, workspaceId, authCookie, anchors } = req.body ?? {};

      if (mode === 'cookie') {
        if (!workspaceId || !authCookie) {
          return res.status(400).json({ ok: false, error: 'workspaceId and authCookie are required' });
        }
        saveDashboardConfig({ workspaceId, authCookie });
      } else if (mode === 'anchor') {
        if (!anchors || typeof anchors !== 'object') {
          return res.status(400).json({ ok: false, error: 'anchors object is required' });
        }
        saveAnchorConfig(anchors);
      } else {
        return res.status(400).json({ ok: false, error: 'mode must be "cookie" or "anchor"' });
      }

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to save config' });
    }
  });

  /** Remove config. */
  app.delete('/api/quota/opencode-go/config', (_req, res) => {
    try {
      clearDashboardConfig();
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Failed to clear config' });
    }
  });
}
