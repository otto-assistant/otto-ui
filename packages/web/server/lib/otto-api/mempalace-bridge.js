/**
 * MemPalace bridge — exposes a small HTTP surface backed by `@mempalace/core`.
 *
 * MemPalace ships two distinct knowledge stores:
 *   1. KnowledgeGraph: a SQLite-backed temporal entity/triple store
 *      (subject/predicate/object with validity windows). Cheap to open, no
 *      embedding model required, so we eagerly use it for /graph, /search,
 *      /traverse, and /fact.
 *   2. VectorStorage: a LanceDB-backed semantic store that holds drawers
 *      (chunks of mined text). Requires the transformers.js worker for
 *      embeddings, so we lazily initialize it and fall back to KG-only
 *      results when it's unavailable.
 *
 * `@mempalace/core` depends on `better-sqlite3`, which the Bun runtime
 * cannot load. To stay runtime-agnostic we run the SDK in a Node child
 * process and proxy calls through `mempalace-client.js`.
 */
import express, { Router } from 'express';
import path from 'node:path';
import os from 'node:os';
import { getMempalaceClient, resetMempalaceClient } from './mempalace-client.js';

function resolvePalaceHome() {
  return process.env.MEMPALACE_PATH || path.join(os.homedir(), '.mempalace');
}

/** Convert a KG `Triple` into the relation shape expected by the UI store. */
function tripleToRelation(t, idx) {
  return {
    id: t.id != null ? String(t.id) : `r-${idx}`,
    subject: t.subName || t.subject,
    predicate: t.predicate,
    object: t.objName || t.object,
    validFrom: t.validFrom,
    validTo: t.validTo,
    confidence: t.confidence,
    current: t.current,
  };
}

/** Build a deduplicated entity list from a list of triples. */
function entitiesFromTriples(triples) {
  const seen = new Map();
  for (const t of triples) {
    for (const name of [t.subName || t.subject, t.objName || t.object]) {
      if (!name || seen.has(name)) continue;
      seen.set(name, { id: name, name, type: 'entity' });
    }
  }
  return [...seen.values()];
}

export function createMempalaceBridgeRouter() {
  const router = Router();
  router.use(express.json({ limit: '512kb' }));
  const client = getMempalaceClient();

  /**
   * Initialize the worker on first request; cache the result so subsequent
   * unavailable cases (e.g. node binary missing) skip the spawn cost.
   */
  let initFailed = null;
  async function ensureClient() {
    if (initFailed) return false;
    try {
      await client.call('init');
      return true;
    } catch (err) {
      initFailed = err.message;
      console.warn('[mempalace] worker init failed:', err.message);
      return false;
    }
  }

  router.get('/status', async (_req, res) => {
    if (!(await ensureClient())) {
      return res.json({
        available: false,
        path: resolvePalaceHome(),
        error: initFailed || 'mempalace-not-installed',
      });
    }

    try {
      const status = await client.call('status');
      return res.json(status);
    } catch (err) {
      return res.status(500).json({
        available: false,
        path: resolvePalaceHome(),
        error: err.message,
      });
    }
  });

  router.get('/graph', async (_req, res) => {
    if (!(await ensureClient())) {
      return res.json({ entities: [], relations: [], source: 'mempalace-unavailable' });
    }

    try {
      const triples = await client.call('kg.timeline', { limit: 1000 });
      const relations = (triples || []).map(tripleToRelation);
      const entities = entitiesFromTriples(triples || []);
      res.json({ entities, relations, source: 'mempalace-kg' });
    } catch (err) {
      res.status(500).json({
        entities: [],
        relations: [],
        source: 'mempalace-error',
        error: err.message,
      });
    }
  });

  router.get('/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      return res.json({ results: [], query: '' });
    }

    if (!(await ensureClient())) {
      return res.json({ results: [], query, source: 'mempalace-unavailable' });
    }

    /** @type {Array<Record<string, unknown>>} */
    const results = [];

    try {
      const triples = await client.call('kg.queryEntity', { name: query, direction: 'both' });
      (triples || []).forEach((t, i) => {
        const text = `${t.subName || t.subject} ${t.predicate} ${t.objName || t.object}`;
        results.push({
          id: `kg-${t.id ?? i}`,
          text,
          content: text,
          subject: t.subName || t.subject,
          predicate: t.predicate,
          object: t.objName || t.object,
          score: typeof t.confidence === 'number' ? t.confidence : 1,
          relevance: typeof t.confidence === 'number' ? t.confidence : 1,
          source: 'mempalace-kg',
          wing: 'knowledge_graph',
          room: t.predicate,
        });
      });
    } catch {
      /* KG returns nothing if the entity isn't indexed */
    }

    let vectorError = null;
    let vectorReady = false;
    try {
      const vec = await client.call('storage.search', { query, limit: 20 });
      vectorReady = !!vec.ready;
      vectorError = vec.error || null;
      if (vec.ready && Array.isArray(vec.results)) {
        vec.results.forEach((d, i) => {
          results.push({
            id: `vec-${d.id || i}`,
            text: d.content,
            content: d.content,
            score: d.similarity,
            relevance: d.similarity,
            wing: d.wing,
            room: d.room,
            source: 'mempalace-vector',
          });
        });
      }
    } catch (err) {
      vectorError = err.message;
    }

    res.json({
      results,
      query,
      source: 'mempalace',
      vectorStorageReady: vectorReady,
      vectorError,
    });
  });

  router.get('/traverse/:entity', async (req, res) => {
    const { entity } = req.params;
    if (!(await ensureClient())) {
      return res.json({ entity, connections: [], source: 'mempalace-unavailable' });
    }

    try {
      const triples = await client.call('kg.queryEntity', { name: entity, direction: 'both' });
      const connections = (triples || []).map((t, i) => ({
        id: t.id != null ? String(t.id) : `c-${i}`,
        from: t.subName || t.subject,
        to: t.objName || t.object,
        predicate: t.predicate,
        validFrom: t.validFrom,
        validTo: t.validTo,
      }));
      res.json({ entity, connections, source: 'mempalace-kg' });
    } catch (err) {
      res.status(500).json({
        entity,
        connections: [],
        source: 'mempalace-error',
        error: err.message,
      });
    }
  });

  router.post('/fact', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { subject, predicate, object } = body;
    if (!subject || !predicate || !object) {
      return res.status(400).json({ error: 'subject, predicate, and object are required' });
    }

    if (!(await ensureClient())) {
      return res.status(503).json({ error: 'MemPalace not available', details: initFailed });
    }

    try {
      const result = await client.call('kg.addTriple', {
        subject: String(subject),
        predicate: String(predicate),
        object: String(object),
        validFrom: body.validFrom,
        validTo: body.validTo,
        confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
        sourceFile: body.sourceFile,
        sourceCloset: body.sourceCloset,
      });
      res.json({ ok: true, id: result.id, triple: { subject, predicate, object } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/fact', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const subject = req.query.subject || body.subject;
    const predicate = req.query.predicate || body.predicate;
    const object = req.query.object || body.object;
    if (!subject || !predicate || !object) {
      return res.status(400).json({ error: 'subject, predicate, and object are required' });
    }

    if (!(await ensureClient())) {
      return res.status(503).json({ error: 'MemPalace not available', details: initFailed });
    }

    try {
      await client.call('kg.invalidate', {
        subject: String(subject),
        predicate: String(predicate),
        object: String(object),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/diary', async (req, res) => {
    if (!(await ensureClient())) {
      return res.json({ entries: [], source: 'mempalace-unavailable' });
    }

    const agent = typeof req.query.agent === 'string' && req.query.agent.trim()
      ? req.query.agent.trim().toLowerCase()
      : 'otto';
    const limit = Math.min(
      Math.max(Number.parseInt(String(req.query.limit ?? '50'), 10) || 50, 1),
      500,
    );

    try {
      const result = await client.call('storage.listDrawers', {
        limit,
        filter: { wing: `agent_${agent}`, room: 'diary' },
      });
      if (!result.ready) {
        return res.json({
          entries: [],
          source: 'mempalace-storage-unavailable',
          error: result.error,
        });
      }
      const entries = (result.drawers || []).map((d, i) => ({
        id: d.id || `diary-${i}`,
        date: (d.filedAt || d.date || new Date().toISOString()).slice(0, 10),
        timestamp: d.filedAt || d.date,
        topic: d.topic || 'general',
        content: d.content,
        agent: d.addedBy || agent,
      }));
      res.json({ entries, source: 'mempalace' });
    } catch (err) {
      res.status(500).json({
        entries: [],
        source: 'mempalace-error',
        error: err.message,
      });
    }
  });

  router.post('/diary', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const content = typeof body.content === 'string' ? body.content : null;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    if (!(await ensureClient())) {
      return res.status(503).json({ error: 'MemPalace not available', details: initFailed });
    }

    const agent = (body.agent || 'otto').toString().toLowerCase();
    const id = `diary_${Date.now()}`;
    try {
      const result = await client.call('storage.upsertDrawer', {
        id,
        content,
        wing: `agent_${agent}`,
        room: 'diary',
        topic: body.topic || 'general',
        sourceFile: 'diary',
        chunkIndex: 0,
        addedBy: agent,
        filedAt: new Date().toISOString(),
      });
      if (!result.ready) {
        return res.status(503).json({
          error: 'Vector storage is not initialized',
          details: result.error,
        });
      }
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/mine', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const directory = typeof body.directory === 'string' ? body.directory : null;
    if (!directory) {
      return res.status(400).json({ error: 'directory is required' });
    }

    if (!(await ensureClient())) {
      return res.status(503).json({ error: 'MemPalace not available', details: initFailed });
    }

    const wing = (body.wing || 'wing_code').toString();
    const agent = (body.agent || 'otto').toString();
    try {
      const result = await client.call('mine.directory', { directory, wing, agent });
      if (!result.ready) {
        return res.status(503).json({
          error: 'Vector storage is not initialized; run `mempalace setup` first',
          details: result.error,
        });
      }
      res.json({ ok: true, directory, wing });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

// Test helpers — let suites reset module state between runs.
export function _resetMempalaceBridge() {
  resetMempalaceClient();
}
