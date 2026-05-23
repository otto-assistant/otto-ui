import { Router } from 'express';
import path from 'node:path';
import os from 'node:os';

let mempalace = null;
let initPromise = null;

const PALACE_PATH = process.env.MEMPALACE_PATH || path.join(os.homedir(), '.mempalace');

async function getMempalace() {
  if (mempalace) return mempalace;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const mp = await import('@mempalace/core');
      const config = new mp.MempalaceConfig(PALACE_PATH);
      const kg = new mp.KnowledgeGraph(config);
      const entityRegistry = new mp.EntityRegistry(config);

      mempalace = { config, kg, entityRegistry, core: mp };
      console.log(`[mempalace] Initialized at ${PALACE_PATH}`);
      return mempalace;
    } catch (err) {
      console.warn('[mempalace] Not available:', err.message);
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

export function createMempalaceBridgeRouter() {
  const router = Router();

  // Status
  router.get('/status', async (_req, res) => {
    const mp = await getMempalace();
    if (!mp) {
      return res.json({ available: false, path: PALACE_PATH });
    }

    try {
      const stats = mp.core.graphStats(mp.kg);
      res.json({
        available: true,
        path: PALACE_PATH,
        stats,
      });
    } catch {
      res.json({ available: true, path: PALACE_PATH, stats: null });
    }
  });

  // Knowledge Graph — entities and relations
  router.get('/graph', async (_req, res) => {
    const mp = await getMempalace();
    if (!mp) {
      return res.json({ entities: [], relations: [], source: 'mempalace-unavailable' });
    }

    try {
      const graph = mp.core.buildGraph(mp.kg);
      const entities = (graph.nodes || []).map(n => ({
        id: n.id || n.name,
        name: n.name || n.id,
        type: n.type || 'entity',
        ...n,
      }));
      const relations = (graph.edges || []).map((e, i) => ({
        id: `e-${i}`,
        subject: e.source || e.from,
        predicate: e.label || e.type || 'related_to',
        object: e.target || e.to,
        weight: e.weight,
        ...e,
      }));
      res.json({ entities, relations, source: 'mempalace' });
    } catch (err) {
      res.json({ entities: [], relations: [], source: 'mempalace-error', error: err.message });
    }
  });

  // Search
  router.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query || typeof query !== 'string') {
      return res.json({ results: [], query: '' });
    }

    const mp = await getMempalace();
    if (!mp) {
      return res.json({ results: [], query, source: 'mempalace-unavailable' });
    }

    try {
      const triples = mp.kg.query ? mp.kg.query(query) : [];
      const results = triples.map((t, i) => ({
        id: `sr-${i}`,
        text: `${t.subject} ${t.predicate} ${t.object}`,
        subject: t.subject,
        predicate: t.predicate,
        object: t.object,
        score: t.score || t.confidence || 1,
        source: 'mempalace',
      }));
      res.json({ results, query, source: 'mempalace' });
    } catch (err) {
      res.json({ results: [], query, source: 'mempalace-error', error: err.message });
    }
  });

  // Traverse graph from an entity
  router.get('/traverse/:entity', async (req, res) => {
    const { entity } = req.params;
    const mp = await getMempalace();
    if (!mp) {
      return res.json({ entity, connections: [], source: 'mempalace-unavailable' });
    }

    try {
      const connections = mp.core.traverseGraph(mp.kg, entity);
      res.json({ entity, connections: connections || [], source: 'mempalace' });
    } catch (err) {
      res.json({ entity, connections: [], source: 'mempalace-error', error: err.message });
    }
  });

  // Add fact/triple
  router.post('/fact', async (req, res) => {
    const { subject, predicate, object } = req.body ?? {};
    if (!subject || !predicate || !object) {
      return res.status(400).json({ error: 'subject, predicate, and object required' });
    }

    const mp = await getMempalace();
    if (!mp) {
      return res.status(503).json({ error: 'MemPalace not available' });
    }

    try {
      if (typeof mp.kg.addTriple === 'function') {
        mp.kg.addTriple({ subject, predicate, object });
      }
      res.json({ ok: true, triple: { subject, predicate, object } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete fact
  router.delete('/fact/:id', async (req, res) => {
    const mp = await getMempalace();
    if (!mp) {
      return res.status(503).json({ error: 'MemPalace not available' });
    }

    try {
      if (typeof mp.kg.deleteTriple === 'function') {
        mp.kg.deleteTriple(req.params.id);
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Diary entries
  router.get('/diary', async (_req, res) => {
    const mp = await getMempalace();
    if (!mp) {
      return res.json({ entries: [], source: 'mempalace-unavailable' });
    }

    try {
      const layer0 = new mp.core.Layer0(mp.config);
      const identity = layer0.load ? layer0.load() : null;
      const entries = identity?.diary || [];
      res.json({ entries: entries.map((e, i) => ({
        id: `diary-${i}`,
        text: typeof e === 'string' ? e : e.text || e.content || JSON.stringify(e),
        date: e.date || e.timestamp || new Date().toISOString(),
        topic: e.topic || e.wing || 'general',
      })), source: 'mempalace' });
    } catch (err) {
      res.json({ entries: [], source: 'mempalace-error', error: err.message });
    }
  });

  // Mine a directory into mempalace
  router.post('/mine', async (req, res) => {
    const { directory } = req.body ?? {};
    if (!directory) {
      return res.status(400).json({ error: 'directory required' });
    }

    const mp = await getMempalace();
    if (!mp) {
      return res.status(503).json({ error: 'MemPalace not available' });
    }

    try {
      await mp.core.mineDirectory(directory, mp.config);
      res.json({ ok: true, directory });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
