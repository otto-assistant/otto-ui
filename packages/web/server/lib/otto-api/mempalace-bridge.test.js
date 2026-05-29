/**
 * Backend smoke tests for the MemPalace bridge router. Exercises every route
 * against a real `@mempalace/core` instance (KG only — vector storage is left
 * uninitialized so tests don't try to download embedding models).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

import {
  createMempalaceBridgeRouter,
  _resetMempalaceBridge,
} from './mempalace-bridge.js';

const TEST_HOME = path.join(
  os.tmpdir(),
  `mempalace-bridge-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
);

let app;

beforeAll(() => {
  fs.mkdirSync(TEST_HOME, { recursive: true });
  process.env.MEMPALACE_PATH = TEST_HOME;
  _resetMempalaceBridge();

  app = express();
  app.use(express.json());
  app.use('/api/otto/mempalace', createMempalaceBridgeRouter());
});

afterAll(() => {
  _resetMempalaceBridge();
  try {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe('MemPalace bridge', () => {
  it('reports availability and KG stats from /status', async () => {
    const res = await request(app).get('/api/otto/mempalace/status');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.path).toContain(TEST_HOME);
    expect(res.body.stats).toHaveProperty('knowledgeGraph');
    expect(typeof res.body.stats.knowledgeGraph).toBe('object');
    // VectorStorage isn't ready unless we explicitly init it (which would
    // require downloading embedding models). The route should still 200.
    expect(typeof res.body.vectorStorageReady).toBe('boolean');
  });

  it('returns an empty graph initially', async () => {
    const res = await request(app).get('/api/otto/mempalace/graph');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('mempalace-kg');
    expect(Array.isArray(res.body.entities)).toBe(true);
    expect(Array.isArray(res.body.relations)).toBe(true);
    expect(res.body.entities.length).toBe(0);
    expect(res.body.relations.length).toBe(0);
  });

  it('round-trips a triple through POST /fact and GET /graph', async () => {
    const post = await request(app)
      .post('/api/otto/mempalace/fact')
      .send({ subject: 'Otto', predicate: 'works_on', object: 'otto-ui' });
    expect(post.status).toBe(200);
    expect(post.body.ok).toBe(true);

    const graph = await request(app).get('/api/otto/mempalace/graph');
    expect(graph.status).toBe(200);
    expect(graph.body.entities.map((e) => e.name).sort()).toEqual(
      ['Otto', 'otto-ui'].sort(),
    );
    expect(graph.body.relations).toHaveLength(1);
    const rel = graph.body.relations[0];
    expect(rel.subject).toBe('Otto');
    expect(rel.predicate).toBe('works_on');
    expect(rel.object).toBe('otto-ui');
  });

  it('rejects malformed POST /fact payloads', async () => {
    const res = await request(app)
      .post('/api/otto/mempalace/fact')
      .send({ subject: 'Otto' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('finds triples via GET /search and reports vector readiness', async () => {
    await request(app)
      .post('/api/otto/mempalace/fact')
      .send({ subject: 'Alice', predicate: 'owns', object: 'otto-ui' });

    const res = await request(app).get('/api/otto/mempalace/search?q=Otto');
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('Otto');
    expect(Array.isArray(res.body.results)).toBe(true);
    // KG-side hits should appear without needing vector storage.
    const kgHits = res.body.results.filter((r) => r.source === 'mempalace-kg');
    expect(kgHits.length).toBeGreaterThan(0);
    expect(kgHits[0].text).toMatch(/Otto/);
    expect('vectorStorageReady' in res.body).toBe(true);
  });

  it('returns empty results for empty queries', async () => {
    const res = await request(app).get('/api/otto/mempalace/search?q=');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it('GET /traverse/:entity returns connections from the KG', async () => {
    const res = await request(app).get('/api/otto/mempalace/traverse/Otto');
    expect(res.status).toBe(200);
    expect(res.body.entity).toBe('Otto');
    expect(Array.isArray(res.body.connections)).toBe(true);
    expect(res.body.connections.length).toBeGreaterThan(0);
    expect(res.body.connections[0]).toHaveProperty('predicate');
  });

  it('DELETE /fact invalidates a triple', async () => {
    const del = await request(app)
      .delete('/api/otto/mempalace/fact')
      .query({ subject: 'Otto', predicate: 'works_on', object: 'otto-ui' });
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    // After invalidation, the triple should no longer appear as `current`.
    const graph = await request(app).get('/api/otto/mempalace/graph');
    const stillCurrent = (graph.body.relations || []).filter(
      (r) => r.subject === 'Otto' && r.predicate === 'works_on' && r.object === 'otto-ui' && r.current,
    );
    expect(stillCurrent).toHaveLength(0);
  });

  it('GET /diary degrades gracefully when vector storage is unavailable', async () => {
    const res = await request(app).get('/api/otto/mempalace/diary?agent=otto');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    // Without storage init, we expect the unavailable branch to fire (or an
    // empty result if init worked silently). Either way, the route must 200.
    expect(['mempalace', 'mempalace-storage-unavailable']).toContain(
      res.body.source,
    );
  });

  it('POST /diary requires content', async () => {
    const res = await request(app).post('/api/otto/mempalace/diary').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/content/i);
  });

  it('POST /mine requires a directory', async () => {
    const res = await request(app).post('/api/otto/mempalace/mine').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/directory/i);
  });
});
