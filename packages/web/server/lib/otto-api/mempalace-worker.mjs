#!/usr/bin/env node
/* eslint-env node */
/**
 * MemPalace sidecar worker.
 *
 * `@mempalace/core` depends on `better-sqlite3`, which is incompatible with
 * the Bun runtime that hosts the otto-ui dev server. To keep mempalace
 * working under both Node and Bun we run the SDK inside a long-lived Node.js
 * child process and speak line-delimited JSON-RPC over stdio.
 *
 * Protocol
 *   request  →  { id: string, method: string, params?: object }
 *   response →  { id: string, result?: any } | { id: string, error: string }
 *
 * Methods
 *   init                  → ensure config + KG + storage handles exist
 *   status                → KG stats + vector taxonomy when available
 *   kg.timeline           → list triples (params: { entity?, limit? })
 *   kg.queryEntity        → triples for an entity (params: { name, asOf?, direction? })
 *   kg.addTriple          → insert triple (params: Triple)
 *   kg.invalidate         → close validity window (params: { subject, predicate, object, ended? })
 *   kg.stats              → entity / triple counts
 *   storage.search        → semantic search (params: { query, limit?, filter? })
 *   storage.listDrawers   → list drawers (params: { limit?, filter? })
 *   storage.upsertDrawer  → insert drawer (params: Drawer)
 *   storage.getTaxonomy   → wing/room counts
 *   mine.directory        → ingest a folder (params: { directory, wing, agent? })
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import readline from 'node:readline';
import { createRequire } from 'node:module';

// MemPalace's ESM build relies on the CJS-injected `__dirname` global to
// locate its embedding worker, so we deliberately load the CommonJS entry
// via createRequire to keep that path-resolution working.
const require = createRequire(import.meta.url);

const palaceHome = process.env.MEMPALACE_PATH || path.join(os.homedir(), '.mempalace');

let mp = null;
let config = null;
let kg = null;
let storage = null;
let storageReady = false;
let storageError = null;
let storageInitPromise = null;
let palacePath = null;

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function loadCore() {
  if (mp) return mp;
  mp = require('@mempalace/core');
  return mp;
}

async function ensureInit() {
  if (kg) return;
  await loadCore();

  config = new mp.MempalaceConfig(palaceHome);
  try { config.init(); } catch { /* already initialized */ }

  palacePath = process.env.MEMPALACE_PALACE_PATH
    || process.env.MEMPAL_PALACE_PATH
    || path.join(palaceHome, 'palace');
  fs.mkdirSync(palacePath, { recursive: true });

  const kgDbPath = path.join(palacePath, 'knowledge_graph.sqlite3');
  const lancePath = path.join(palacePath, 'lancedb');

  kg = new mp.KnowledgeGraph(kgDbPath);
  storage = new mp.VectorStorage(lancePath, config.collectionName);
}

async function ensureStorage() {
  await ensureInit();
  if (storageReady) return true;
  if (storageInitPromise) return storageInitPromise;

  storageInitPromise = (async () => {
    try {
      await storage.init();
      storageReady = true;
      storageError = null;
      return true;
    } catch (err) {
      storageError = err?.message || String(err);
      storageReady = false;
      return false;
    } finally {
      storageInitPromise = null;
    }
  })();

  return storageInitPromise;
}

async function dispatch(method, params = {}) {
  switch (method) {
    case 'init': {
      await ensureInit();
      return {
        ok: true,
        palacePath,
        configHome: palaceHome,
        kgDbPath: path.join(palacePath, 'knowledge_graph.sqlite3'),
        lancePath: path.join(palacePath, 'lancedb'),
      };
    }

    case 'status': {
      await ensureInit();
      let kgStats = {};
      try { kgStats = kg.stats(); }
      catch (err) { kgStats = { error: err.message }; }

      let vectorStats = null;
      if (storageReady) {
        try { vectorStats = await storage.getTaxonomy(); }
        catch (err) { vectorStats = { error: err.message }; }
      }

      return {
        available: true,
        path: palacePath,
        configHome: palaceHome,
        stats: { knowledgeGraph: kgStats, vectorStorage: vectorStats },
        vectorStorageReady: storageReady,
        vectorStorageError: storageError,
      };
    }

    case 'kg.timeline': {
      await ensureInit();
      return kg.timeline(params.entity, params.limit ?? 1000) || [];
    }

    case 'kg.queryEntity': {
      await ensureInit();
      return kg.queryEntity(params.name, params.asOf, params.direction || 'both') || [];
    }

    case 'kg.addTriple': {
      await ensureInit();
      return { id: kg.addTriple(params) };
    }

    case 'kg.invalidate': {
      await ensureInit();
      kg.invalidate(params.subject, params.predicate, params.object, params.ended);
      return { ok: true };
    }

    case 'kg.stats': {
      await ensureInit();
      return kg.stats();
    }

    case 'storage.ensure': {
      const ready = await ensureStorage();
      return { ready, error: storageError };
    }

    case 'storage.search': {
      const ready = await ensureStorage();
      if (!ready) return { ready: false, error: storageError, results: [] };
      const results = await storage.search(params.query, params.limit ?? 20, params.filter);
      return { ready: true, results };
    }

    case 'storage.listDrawers': {
      const ready = await ensureStorage();
      if (!ready) return { ready: false, error: storageError, drawers: [] };
      const drawers = await storage.listDrawers(params.limit ?? 50, params.filter);
      return { ready: true, drawers };
    }

    case 'storage.upsertDrawer': {
      const ready = await ensureStorage();
      if (!ready) return { ready: false, error: storageError };
      await storage.upsertDrawer(params);
      return { ready: true, ok: true };
    }

    case 'storage.getTaxonomy': {
      const ready = await ensureStorage();
      if (!ready) return { ready: false, error: storageError };
      return { ready: true, taxonomy: await storage.getTaxonomy() };
    }

    case 'mine.directory': {
      const ready = await ensureStorage();
      if (!ready) return { ready: false, error: storageError };
      await mp.mineDirectory(params.directory, storage, { wing: params.wing }, params.agent);
      return { ready: true, ok: true };
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try { req = JSON.parse(trimmed); }
  catch (err) {
    send({ id: null, error: `invalid-json: ${err.message}` });
    return;
  }

  const { id, method, params } = req;
  Promise.resolve()
    .then(() => dispatch(method, params))
    .then((result) => send({ id, result }))
    .catch((err) => send({ id, error: err?.message || String(err) }));
});

process.on('uncaughtException', (err) => {
  send({ id: null, error: `uncaught: ${err?.message || String(err)}` });
});

send({ id: null, ready: true });
