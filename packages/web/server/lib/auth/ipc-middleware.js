import { resolveIpcBearerSecret, verifyBearerAuthorizationHeader } from './ipc-token.js';

const stripQuery = (candidate) => {
  if (typeof candidate !== 'string') {
    return '';
  }

  const withoutQuery = candidate.split('?', 1)[0] ?? '';
  if (!withoutQuery) {
    return '';
  }

  if (withoutQuery === '/' || withoutQuery === '') {
    return '/';
  }

  try {
    return decodeURIComponent(withoutQuery.split('#', 1)[0]);
  } catch {
    return withoutQuery.split('#', 1)[0];
  }
};

/** @typedef {{ classifyRequestScope: (req: import('express').Request) => string } | null | undefined} TunnelAuthLike */

/**
 * Bearer gate for hardened IPC callers. Disabled until OPENCHAMBER_* env is populated.
 *
 * Tunnel-scoped browsers cannot obtain the embedded IPC secret reliably; reuse existing tunnel session checks instead.
 *
 * @param {{ process?: typeof process; tunnelAuthController?: TunnelAuthLike }} [options]
 */
export const createIpcBearerProtection = ({
  process: processLike = process,
  tunnelAuthController = null,
} = {}) => {
  const expectedSecret = resolveIpcBearerSecret(processLike);

  const protection = /** @type {import('express').RequestHandler} */((req, res, next) => {
    const pathnameRaw = typeof req.originalUrl === 'string' ? req.originalUrl : req.url;
    const pathname = stripQuery(pathnameRaw);

    if (!pathname.startsWith('/api')) {
      next();
      return;
    }

    if (!expectedSecret) {
      next();
      return;
    }

    try {
      const scope = tunnelAuthController?.classifyRequestScope(req);
      if (scope === 'tunnel') {
        next();
        return;
      }

      if (!verifyBearerAuthorizationHeader(req.headers?.authorization, expectedSecret)) {
        res.status(401).json({ error: 'Unauthorized', ipcBearerRequired: true });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  });

  return {
    enabled: Boolean(expectedSecret),
    protection,
    expectedSecretConfigured: Boolean(expectedSecret?.digest),
    expectedSecretPreviewLength:
      typeof expectedSecret?.displayLength === 'number'
        ? expectedSecret.displayLength
        : undefined,
  };
};
