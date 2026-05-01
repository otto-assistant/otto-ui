import crypto from 'crypto';

/**
 * Normalize env-provided bearer material for constant-time comparisons.
 *
 * Reads OPENCHAMBER_IPC_BEARER_TOKEN (preferred) with compatibility alias
 * OPENCHAMBER_WEB_IPC_BEARER_TOKEN. Returns null when unset/empty → caller should skip enforcement.
 */
export const resolveIpcBearerSecret = (processLike = process) => {
  const raw =
    (typeof processLike.env?.OPENCHAMBER_IPC_BEARER_TOKEN === 'string' &&
      processLike.env.OPENCHAMBER_IPC_BEARER_TOKEN.trim()) ||
    (typeof processLike.env?.OPENCHAMBER_WEB_IPC_BEARER_TOKEN === 'string' &&
      processLike.env.OPENCHAMBER_WEB_IPC_BEARER_TOKEN.trim()) ||
    '';
  if (!raw) {
    return null;
  }
  return {
    digest: crypto.createHash('sha256').update(raw, 'utf8').digest(),
    displayLength: raw.length,
  };
};

/** @returns {boolean} */
export const timingSafeEqualDigests = (a, b) => {
  if (!(a instanceof Buffer) || !(b instanceof Buffer)) {
    return false;
  }
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
};

/**
 * Verifies Authorization: Bearer <token> against a sha256(secret) fingerprint.
 *
 * Comparisons digest both sides so plaintext secrets are not compared directly.
 *
 * @param {unknown} authorizationHeader
 * @param {NonNullable<ReturnType<typeof resolveIpcBearerSecret>>} expected
 */
export const verifyBearerAuthorizationHeader = (authorizationHeader, expected) => {
  if (typeof authorizationHeader !== 'string' || authorizationHeader.trim().length === 0) {
    return false;
  }

  const match = /^Bearer\s+(\S+)/i.exec(authorizationHeader.trim());
  if (!match?.[1]) {
    return false;
  }

  const providedUtf8 = match[1].trim();
  if (!providedUtf8) {
    return false;
  }

  try {
    const providedDigest = crypto.createHash('sha256').update(providedUtf8, 'utf8').digest();
    return timingSafeEqualDigests(providedDigest, expected.digest);
  } catch {
    return false;
  }
};
