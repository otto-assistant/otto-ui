import path from 'path';

/** @typedef {{ fsPromises: import('fs/promises') }} SafePathDeps */

const isInsideRoot = (rootRealpath, candidateRealpath) => {
  if (typeof rootRealpath !== 'string' || typeof candidateRealpath !== 'string') {
    return false;
  }

  if (candidateRealpath === rootRealpath) {
    return true;
  }

  const relative = path.relative(rootRealpath, candidateRealpath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * Resolves symlink targets (`realpath`) for `candidateAbsolute` relative to roots.
 *
 * Prefer `anchors` ordering: the first containment match wins after canonicalization,
 * mimicking sequential workspace widening used by FS routes (workspace then config root).
 *
 * Missing paths walk parents until realpath anchors exist while preserving the unresolved suffix.
 *
 * @param {{
 *   fsPromises: import('fs/promises'),
 *   candidateAbsolute: string,
 *   anchors: string[],
 * }} params
 */
export const resolveContainedPath = async ({ fsPromises, candidateAbsolute, anchors }) => {
  if (!(typeof candidateAbsolute === 'string' && candidateAbsolute.trim())) {
    return { ok: false, error: 'Path is required' };
  }

  if (!Array.isArray(anchors) || anchors.length === 0) {
    return { ok: false, error: 'Anchor root required' };
  }

  /** @returns {Promise<string>} */
  const canonicalPath = async (absolutePath) => {
    const normalized = path.resolve(absolutePath);
    try {
      return await fsPromises.realpath(normalized);
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(/** @type {{ code?: string }} */(error).code)
          : '';
      if (code !== 'ENOENT') {
        throw error;
      }

      const parent = path.dirname(normalized);
      if (parent === normalized) {
        return normalized;
      }

      const parentCanonical = await canonicalPath(parent);
      return path.join(parentCanonical, path.basename(normalized));
    }
  };

  const anchored = await canonicalPath(candidateAbsolute);

  for (const anchor of anchors) {
    if (!(typeof anchor === 'string' && anchor.trim())) {
      continue;
    }

    const resolvedAnchor = path.resolve(anchor);
    let anchoredRoot;

    try {
      anchoredRoot = await fsPromises.realpath(resolvedAnchor);
    } catch {
      anchoredRoot = resolvedAnchor;
    }

    if (isInsideRoot(anchoredRoot, anchored)) {
      return {
        ok: true,
        resolvedAbsolute: anchored,
        anchorAbsolute: anchoredRoot,
      };
    }
  }

  return { ok: false, error: 'Path is outside of active workspace' };
};
