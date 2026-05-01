/**
 * Otto API base URL resolution.
 * Detects environment (Tauri desktop, standalone web, dev proxy) and returns the correct base.
 */

let _baseUrl: string | null = null;

/**
 * Returns the base URL for Otto API requests.
 * - In Tauri: reads from window.__OTTO_API_URL__ or defaults to localhost:4080
 * - In dev with Vite proxy: returns empty string (relative paths work)
 * - In production standalone: returns empty string (same-origin)
 */
export function getBaseUrl(): string {
  if (_baseUrl !== null) return _baseUrl;

  // Tauri desktop app injects this
  const tauriUrl = (globalThis as Record<string, unknown>).__OTTO_API_URL__;
  if (typeof tauriUrl === "string" && tauriUrl) {
    _baseUrl = tauriUrl.replace(/\/$/, "");
    return _baseUrl;
  }

  // Environment variable via Vite
  const envUrl = (import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_OTTO_API_URL;
  if (typeof envUrl === "string" && envUrl) {
    _baseUrl = envUrl.replace(/\/$/, "");
    return _baseUrl;
  }

  // Default: same-origin (relative paths)
  _baseUrl = "";
  return _baseUrl;
}

/**
 * Build a full API URL from a path.
 * @example apiUrl("/api/otto/agents") => "http://localhost:4080/api/otto/agents" or "/api/otto/agents"
 */
export function apiUrl(path: string): string {
  return `${getBaseUrl()}${path}`;
}

/**
 * Fetch wrapper that uses the correct base URL and includes credentials.
 */
export async function ottoFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    credentials: "same-origin",
    ...init,
  });
}

/**
 * JSON fetch helper with error handling.
 * Returns parsed JSON or throws on non-ok responses.
 */
export async function ottoFetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await ottoFetch(path, init);
  if (!res.ok) {
    throw new Error(`Otto API error: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  if (!text.trim()) return null as T;
  return JSON.parse(text) as T;
}
