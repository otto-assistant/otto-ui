import type { CommandExecResult, FilesAPI, RuntimeAPIs } from '@/lib/api/types';

type ExecResult = { success: boolean; results: CommandExecResult[] };

const DEFAULT_BASE_URL = import.meta.env.VITE_OPENCODE_URL || '/api';

const getBaseUrl = (): string => {
  if (typeof DEFAULT_BASE_URL === 'string' && DEFAULT_BASE_URL.startsWith('/')) {
    return DEFAULT_BASE_URL;
  }
  return DEFAULT_BASE_URL;
};

function getRuntimeFilesAPI(): FilesAPI | null {
  if (typeof window === 'undefined') return null;
  const apis = (window as typeof window & { __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs }).__OPENCHAMBER_RUNTIME_APIS__;
  if (apis?.files) {
    return apis.files;
  }
  return null;
}

export async function execCommands(commands: string[], cwd: string): Promise<ExecResult> {
  const runtimeFiles = getRuntimeFilesAPI();
  if (runtimeFiles?.execCommands) {
    return runtimeFiles.execCommands(commands, cwd);
  }

  // Guard rails: the server rejects empty cwd/commands with 400. Bail out
  // locally with a structured failure so probing callers (e.g. worktree/git
  // detection) don't have to defend against unhandled promise rejections.
  if (!Array.isArray(commands) || commands.length === 0 || typeof cwd !== 'string' || cwd.trim() === '') {
    return {
      success: false,
      results: commands.map((command) => ({
        command,
        success: false,
        error: 'execCommands requires non-empty commands and cwd',
      })),
    };
  }

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}/fs/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands, cwd, background: false }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    return {
      success: false,
      results: commands.map((command) => ({ command, success: false, error: message })),
    };
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: response.statusText }));
    const message = (errorBody as { error?: string }).error || `HTTP ${response.status}`;
    return {
      success: false,
      results: commands.map((command) => ({ command, success: false, error: message })),
    };
  }

  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; results?: CommandExecResult[] }
    | null;

  return {
    success: Boolean(payload?.success),
    results: Array.isArray(payload?.results) ? payload!.results! : [],
  };
}

export async function execCommand(command: string, cwd: string): Promise<CommandExecResult> {
  const result = await execCommands([command], cwd);
  const first = result.results[0];
  if (!first) {
    return { command, success: result.success };
  }
  return first;
}
