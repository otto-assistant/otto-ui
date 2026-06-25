import express from 'express';
import { resolveDashboardConfig, saveDashboardConfig, saveAnchorConfig, clearDashboardConfig, resolveConfigMode, resolveAnchorConfig } from './providers/opencode-go-dashboard.js';

/**
 * Mask a sensitive string for display — shows first and last few chars
 * with asterisks in between so the user can see credentials are present
 * without exposing the full value.
 *
 * @param {string | null} value
 * @param {{ prefix?: number, suffix?: number }} [opts]
 * @returns {string | null}
 */
const maskSensitiveValue = (value, opts = {}) => {
  if (!value || typeof value !== 'string') return null;
  const { prefix = 4, suffix = 4 } = opts;
  const trimmed = value.trim();
  if (trimmed.length <= prefix + suffix + 2) {
    // Too short to mask meaningfully — show as fully masked.
    return '••••••••';
  }
  return trimmed.slice(0, prefix) + '••••' + trimmed.slice(-suffix);
};

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
    const anchorResetAt = mode === 'anchor' ? resolveAnchorConfig() : null;
    const anchorSeconds = anchorResetAt
      ? Object.fromEntries(
          Object.entries(anchorResetAt).map(([key, resetAt]) => [
            key,
            Math.max(0, Math.round((resetAt - Date.now()) / 1000)),
          ]),
        )
      : null;
    res.json({
      configured: !!mode,
      mode,
      hasCookie: !!cookieConfig,
      hasAnchors: !!anchorResetAt,
      cookieSource: cookieConfig?.source ?? null,
      // Masked values so UI can show that credentials are saved
      maskedWorkspaceId: cookieConfig ? maskSensitiveValue(cookieConfig.workspaceId, { prefix: 4, suffix: 4 }) : null,
      hasAuthCookie: !!cookieConfig?.authCookie,
      // Remaining seconds until reset (derived from persisted resetAt) for UI pre-fill
      anchors: anchorSeconds,
    });
  });

  /** Save config: either cookie mode (workspaceId + authCookie) or anchor mode (anchors). */
  app.post('/api/quota/opencode-go/config', express.json({ limit: '64kb' }), (req, res) => {
    try {
      const { mode, workspaceId, authCookie, anchors } = req.body ?? {};

      if (mode === 'cookie') {
        // Support partial updates: if workspaceId/authCookie are not provided
        // (or are empty/just the masked placeholder), preserve existing values.
        const existing = resolveDashboardConfig();
        const finalWorkspaceId = (workspaceId && typeof workspaceId === 'string' && !workspaceId.includes('••••'))
          ? workspaceId.trim()
          : existing?.workspaceId ?? null;
        const finalAuthCookie = (authCookie && typeof authCookie === 'string' && !authCookie.includes('••••'))
          ? authCookie.trim()
          : existing?.authCookie ?? null;
        if (!finalWorkspaceId || !finalAuthCookie) {
          return res.status(400).json({ ok: false, error: 'workspaceId and authCookie are required' });
        }
        saveDashboardConfig({ workspaceId: finalWorkspaceId, authCookie: finalAuthCookie });
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
