/**
 * Generate a UUID string that works in non-secure browser contexts.
 *
 * `crypto.randomUUID()` is only available in secure contexts (HTTPS or
 * localhost). When the UI is served from a LAN IP over plain HTTP (e.g.
 * `http://192.168.1.200:5173`), `crypto.randomUUID` is `undefined` and calling
 * it throws `TypeError: crypto.randomUUID is not a function`.
 *
 * This helper prefers the native implementation when available and falls back
 * to a deterministic-shape RFC4122 v4-like string built from `crypto.getRandomValues`
 * (or `Math.random` as a last resort).
 */
export function safeRandomUUID(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof (crypto as Crypto).randomUUID === 'function') {
      try {
        return (crypto as Crypto).randomUUID();
      } catch {
        // fall through to manual generation
      }
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      // Per RFC 4122 §4.4
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex: string[] = [];
      for (let i = 0; i < bytes.length; i += 1) {
        hex.push(bytes[i].toString(16).padStart(2, '0'));
      }
      return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
        .slice(6, 8)
        .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
    }
  }
  // Last-resort fallback. Not cryptographically secure, but stable in shape.
  const rand = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${rand()}${rand()}-${rand()}-4${rand().slice(1)}-${((Math.floor(Math.random() * 0x4) | 0x8).toString(16))}${rand().slice(1)}-${rand()}${rand()}${rand()}`;
}
