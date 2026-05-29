/**
 * Bun-side client for the MemPalace sidecar.
 *
 * Spawns a Node child process running mempalace-worker.mjs and exchanges
 * line-delimited JSON-RPC messages with it. The client is a singleton — one
 * worker per server process.
 *
 * Why a sidecar? The mempalace SDK depends on `better-sqlite3`, a native
 * Node addon that the Bun runtime cannot load (V8 ABI mismatch). Hosting
 * mempalace inside a dedicated Node child keeps the rest of the API server
 * runtime-agnostic.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_PATH = path.join(__dirname, 'mempalace-worker.mjs');

/** @typedef {{ resolve: (value: unknown) => void; reject: (err: Error) => void; method: string }} PendingCall */

class MempalaceClient {
  constructor() {
    /** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
    this.child = null;
    /** @type {Map<string, PendingCall>} */
    this.pending = new Map();
    this.idCounter = 0;
    /** @type {Promise<boolean> | null} */
    this.startPromise = null;
    this.ready = false;
    this.lastError = null;
    this.buffer = '';
  }

  reset() {
    if (this.child) {
      try { this.child.kill('SIGTERM'); } catch { /* noop */ }
    }
    this.child = null;
    this.startPromise = null;
    this.ready = false;
    this.buffer = '';
    for (const [id, call] of this.pending) {
      call.reject(new Error('mempalace worker reset'));
      this.pending.delete(id);
    }
  }

  /** Spawn the worker and wait for the initial `ready` line. */
  async start() {
    if (this.ready && this.child) return true;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise((resolve) => {
      const env = { ...process.env };
      const nodeBin = process.env.MEMPALACE_NODE_BIN || 'node';
      let child;
      try {
        child = spawn(nodeBin, [WORKER_PATH], {
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        this.lastError = err.message;
        this.startPromise = null;
        resolve(false);
        return;
      }

      this.child = child;

      child.stdout.setEncoding('utf-8');
      child.stdout.on('data', (chunk) => this._onData(chunk));
      child.stderr.setEncoding('utf-8');
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        if (text.trim()) console.warn('[mempalace-worker]', text.trimEnd());
      });
      child.on('exit', (code, signal) => {
        const wasReady = this.ready;
        this.ready = false;
        this.child = null;
        this.startPromise = null;
        for (const [id, call] of this.pending) {
          call.reject(new Error(`mempalace worker exited (code=${code} signal=${signal})`));
          this.pending.delete(id);
        }
        if (wasReady) {
          console.warn(`[mempalace] worker exited unexpectedly (code=${code} signal=${signal})`);
        }
      });
      child.on('error', (err) => {
        this.lastError = err.message;
        if (!this.ready) {
          this.startPromise = null;
          resolve(false);
        }
      });

      // The worker emits `{ ready: true }` on startup.
      const readyTimer = setTimeout(() => {
        if (!this.ready) {
          this.lastError = 'worker startup timeout';
          try { child.kill('SIGKILL'); } catch { /* noop */ }
          resolve(false);
        }
      }, 15_000);

      this._onReady = () => {
        clearTimeout(readyTimer);
        this.ready = true;
        this.lastError = null;
        resolve(true);
      };
    });

    return this.startPromise;
  }

  _onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;

      let msg;
      try { msg = JSON.parse(line); }
      catch {
        console.warn('[mempalace] bad worker line:', line);
        continue;
      }

      if (msg && msg.ready === true && (msg.id === null || msg.id === undefined)) {
        if (this._onReady) {
          const fn = this._onReady;
          this._onReady = null;
          fn();
        }
        continue;
      }

      const { id } = msg;
      if (!id) continue;
      const call = this.pending.get(id);
      if (!call) continue;
      this.pending.delete(id);
      if ('error' in msg) call.reject(new Error(msg.error));
      else call.resolve(msg.result);
    }
  }

  /**
   * Send a JSON-RPC call. Returns the worker's `result` or throws if the
   * worker reports `error`.
   */
  async call(method, params = {}) {
    const ok = await this.start();
    if (!ok || !this.child) {
      throw new Error(this.lastError || 'mempalace worker not started');
    }

    const id = `c${++this.idCounter}`;
    const payload = JSON.stringify({ id, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      try {
        this.child.stdin.write(payload, (err) => {
          if (err) {
            this.pending.delete(id);
            reject(err);
          }
        });
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }
}

let singleton = null;

export function getMempalaceClient() {
  if (!singleton) singleton = new MempalaceClient();
  return singleton;
}

export function resetMempalaceClient() {
  if (singleton) singleton.reset();
  singleton = null;
}
