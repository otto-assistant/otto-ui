import { describe, it, expect } from 'vitest';
import {
  buildPagedOptions,
  modelsOf,
  PAGE_SIZE,
  createDiscordModelWizard,
} from './discord-model-wizard.js';

describe('buildPagedOptions', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({
    label: `item-${i}`,
    value: `v${i}`,
  }));

  it('shows only a next-nav entry on the first page', () => {
    const { options, page, totalPages } = buildPagedOptions(items, 0);
    expect(page).toBe(0);
    expect(totalPages).toBe(Math.ceil(60 / PAGE_SIZE));
    expect(options.length).toBe(PAGE_SIZE + 1); // 23 items + "More ▶"
    expect(options[0].value).toBe('v0');
    expect(options.at(-1).label).toBe('More ▶');
    expect(options.some((o) => o.label === '◀ Previous')).toBe(false);
  });

  it('shows both nav entries on a middle page', () => {
    const { options } = buildPagedOptions(items, 1);
    expect(options[0].label).toBe('◀ Previous');
    expect(options.at(-1).label).toBe('More ▶');
    // First real item on page 1 is index PAGE_SIZE
    expect(options[1].value).toBe(`v${PAGE_SIZE}`);
  });

  it('shows only a previous-nav entry on the last page', () => {
    const last = Math.ceil(60 / PAGE_SIZE) - 1;
    const { options } = buildPagedOptions(items, last);
    expect(options[0].label).toBe('◀ Previous');
    expect(options.some((o) => o.label === 'More ▶')).toBe(false);
  });

  it('clamps out-of-range pages and never exceeds Discord 25-option cap', () => {
    const { page } = buildPagedOptions(items, 999);
    expect(page).toBe(Math.ceil(60 / PAGE_SIZE) - 1);
    for (let p = 0; p < 5; p++) {
      const { options } = buildPagedOptions(items, p);
      expect(options.length).toBeLessThanOrEqual(25);
    }
  });

  it('handles a single page with no nav entries', () => {
    const { options, totalPages } = buildPagedOptions(items.slice(0, 5), 0);
    expect(totalPages).toBe(1);
    expect(options.length).toBe(5);
    expect(options.some((o) => o.label.includes('▶') || o.label.includes('◀'))).toBe(false);
  });
});

describe('modelsOf', () => {
  it('reads an array of models', () => {
    expect(modelsOf({ models: [{ id: 'a' }, { id: 'b' }] })).toHaveLength(2);
  });
  it('reads a map of models', () => {
    expect(modelsOf({ models: { a: { id: 'a' }, b: { id: 'b' } } })).toHaveLength(2);
  });
  it('returns [] for missing models', () => {
    expect(modelsOf({})).toEqual([]);
    expect(modelsOf(null)).toEqual([]);
  });
});

/** A restCall recorder + a bridge stub backed by a fake store. */
function makeHarness(providers) {
  const calls = [];
  const restCall = async (token, method, path, body) => {
    calls.push({ token, method, path, body });
    return { ok: true, status: 200, body: {} };
  };
  const overrides = [];
  const projectDefaults = [];
  const bridge = {
    fetchProviders: async () => ({ all: providers, connected: providers.map((p) => p.id) }),
    store: {
      setOverrides: (o) => overrides.push(o),
      setProjectDefaults: (o) => projectDefaults.push(o),
      lookup: () => null,
    },
  };
  const wizard = createDiscordModelWizard({ restCall, bridge });
  return { wizard, calls, overrides, projectDefaults };
}

function lastSelectValues(call) {
  const select = call.body?.data?.components?.[0]?.components?.[0];
  return select?.options?.map((o) => o.value) ?? [];
}

describe('createDiscordModelWizard flow', () => {
  const state = { token: 'bot-token' };
  const manyModels = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, name: `m${i}` }));
  const providers = [{ id: 'anthropic', name: 'Anthropic', models: manyModels }];

  it('paginates the model list and records a channel override on selection', async () => {
    const { wizard, calls, overrides } = makeHarness(providers);

    // /model → provider select shown
    await wizard.start(state, { id: 'i1', token: 't1', channel_id: 'chan', application_id: 'app' });
    const providerSelect = calls.at(-1);
    const provCustomId = providerSelect.body.data.components[0].components[0].custom_id;
    expect(wizard.ownsComponent(provCustomId)).toBe(true);

    // pick the provider → first page of models (23 + "More ▶")
    await wizard.handleComponent(state, { id: 'i2', token: 't2', data: { values: ['anthropic'] } }, provCustomId);
    const modelPage0 = calls.at(-1);
    const modelCustomId = modelPage0.body.data.components[0].components[0].custom_id;
    expect(lastSelectValues(modelPage0)).toContain('m0');
    expect(lastSelectValues(modelPage0)).toContain('__otto_next');
    expect(lastSelectValues(modelPage0)).not.toContain(`m${PAGE_SIZE}`);

    // page forward → second page reveals models past the first 23
    await wizard.handleComponent(state, { id: 'i3', token: 't3', data: { values: ['__otto_next'] } }, modelCustomId);
    const modelPage1 = calls.at(-1);
    expect(lastSelectValues(modelPage1)).toContain(`m${PAGE_SIZE}`);
    expect(lastSelectValues(modelPage1)).toContain('__otto_prev');

    // pick a model from page 2 → scope select
    await wizard.handleComponent(state, { id: 'i4', token: 't4', data: { values: ['m30'] } }, modelCustomId);
    const scopeSelect = calls.at(-1);
    const scopeCustomId = scopeSelect.body.data.components[0].components[0].custom_id;

    // choose channel scope → override stored as provider/model
    await wizard.handleComponent(state, { id: 'i5', token: 't5', data: { values: ['channel'] } }, scopeCustomId);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ type: 'discord', targetKey: 'chan', modelOverride: 'anthropic/m30' });
    const final = calls.at(-1);
    expect(final.body.data.content).toContain('anthropic/m30');
  });
});
