import { toast } from "@/components/ui/toast";

export type ApiResult<T> = {
  data: T | null;
  error: string | null;
};

const BASE_URL = import.meta.env.VITE_OTTO_API_URL ?? "";

export async function ottoFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const url = `${BASE_URL}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (res.status === 401) {
      toast.error("Session expired. Please reconnect.");
      return { data: null, error: "Unauthorized — please reconnect." };
    }

    if (res.status >= 500) {
      const msg = `Server error (${res.status})`;
      toast.error(msg);
      return { data: null, error: msg };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = body || `Request failed (${res.status})`;
      return { data: null, error: msg };
    }

    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Network error — check your connection.";
    toast.error(msg);
    return { data: null, error: msg };
  }
}
