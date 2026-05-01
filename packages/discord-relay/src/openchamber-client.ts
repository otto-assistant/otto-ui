export type OpenChamberRelayClientConfig = Readonly<{
  baseUrl: string;
  sessionId: string;
  authorization: string | null;
  workspaceDirectory?: string;
}>;

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export async function postPromptAsync(
  config: OpenChamberRelayClientConfig,
  text: string,
  signal?: AbortSignal,
): Promise<{ ok: true; status: number } | { ok: false; status: number; body: string }> {
  const url = new URL(
    `/api/session/${encodeURIComponent(config.sessionId)}/prompt_async`,
    `${stripTrailingSlash(config.baseUrl)}/`,
  );

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'accept-encoding': 'identity',
  };

  if (config.authorization) {
    headers.authorization = config.authorization;
  }

  if (config.workspaceDirectory) {
    headers['x-opencode-directory'] = config.workspaceDirectory;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parts: [{ type: 'text', text }],
    }),
    signal,
  });

  const rawBody = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: rawBody.slice(0, 4000) };
  }

  return { ok: true, status: res.status };
}
