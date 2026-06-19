import { spawn } from 'child_process';

/**
 * Run a command and capture stdout/stderr.
 *
 * Used by CLI-backed memory adapters (e.g. codemem). Always runs the target
 * executable directly with `windowsHide` so desktop shells never flash a
 * console window (see AGENTS.md desktop rules).
 *
 * Resolves with { code, stdout, stderr } and never rejects on a non-zero exit;
 * callers decide how to interpret the exit code. Rejects only when the process
 * cannot be spawned or the timeout elapses.
 */
export function runCommand(command, args, options = {}) {
  const {
    cwd,
    env,
    timeoutMs = 60000,
    input,
  } = options;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: cwd || undefined,
        env: env ? { ...process.env, ...env } : process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });

    if (input !== undefined && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}

/**
 * Whether a command is resolvable on PATH (best-effort, fast).
 */
export async function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { code } = await runCommand(probe, [command], { timeoutMs: 5000 });
    return code === 0;
  } catch {
    return false;
  }
}
