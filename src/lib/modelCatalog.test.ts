// The catalog that feeds both pickers (issue #165): locals + every ready
// connection's models, one list. The pure builders are tested directly; the
// hook's async probing is deliberately not (jsdom fetch/network — the page
// tests cover the rendered behavior).
import { describe, expect, it } from 'vitest';
import {
  buildLocalModels, cloudEntriesFor, buildModelCatalog, pickModel, activeCatalogKey,
  catalogBucket, toggleFavorite, chatPickerEntries, DEFAULT_CHAT_LOCAL_ID,
} from './modelCatalog';
import { WEBLLM_MODELS, visibleWebLlmModels } from '../lib/ai/webLlmModels';
import { BONSAI_MODELS } from '../lib/ai/bonsaiModels';
import type { AiConnection } from '../lib/aiSettings';

const conn = (over: Partial<AiConnection>): AiConnection => ({
  id: 'c1', provider: 'gemini', label: 'My key', apiKey: 'k', model: 'm-default',
  ...over,
});

describe('buildLocalModels', () => {
  it('lists every curated model with a local: key and no connection', () => {
    const entries = buildLocalModels();
    const expected = [...visibleWebLlmModels().map(m => m.id), ...BONSAI_MODELS.map(m => m.id)];
    expect(entries.map(e => e.modelId)).toEqual(expected);
    for (const e of entries) {
      expect(e.key).toBe(`local:${e.modelId}`);
      expect(e.local).toBe(true);
      expect(e.connectionId).toBeNull();
      expect(e.cached).toBeUndefined(); // not probed yet
    }
  });

  it('carries download state from the probe, and appends unknown cached ids as extras', () => {
    const first = WEBLLM_MODELS[0]!;
    const entries = buildLocalModels({ [first.id]: true, 'old-model-q4f16_1-MLC': true });
    expect(entries.find(e => e.modelId === first.id)?.cached).toBe(true);
    expect(entries.find(e => e.modelId === first.id)?.sizeGB).toBe(first.sizeGB);
    const extra = entries.find(e => e.modelId === 'old-model-q4f16_1-MLC');
    expect(extra?.local).toBe(true);
    expect(extra?.cached).toBe(true);
  });

  it('false probe results leave the model listed but not cached (downloadable)', () => {
    const first = WEBLLM_MODELS[0]!;
    const entries = buildLocalModels({ [first.id]: false });
    expect(entries.find(e => e.modelId === first.id)?.cached).toBe(false);
  });
});

describe('cloudEntriesFor', () => {
  it('contributes nothing when the connection is not ready', () => {
    expect(cloudEntriesFor(conn({ apiKey: '' }), [{ id: 'm' }])).toEqual([]);
    expect(cloudEntriesFor(conn({ apiKey: '' }), null)).toEqual([]);
  });

  it('falls back to the configured model while the list is pending/empty', () => {
    const c = conn({ id: 'g1', label: 'Gem' });
    const fallback = cloudEntriesFor(c, null);
    expect(fallback).toHaveLength(1);
    expect(fallback[0]).toMatchObject({
      key: 'g1:m-default', modelId: 'm-default', connectionId: 'g1',
      connectionLabel: 'Gem', local: false,
    });
  });

  it('maps the fetched list to one entry per model with provider detail', () => {
    const c = conn({ id: 'g1', label: 'Gem' });
    const entries = cloudEntriesFor(c, [{ id: 'gemini-2.5-flash', detail: 'Gemini 2.5 Flash' }, { id: 'gemini-2.5-pro' }]);
    expect(entries.map(e => e.key)).toEqual(['g1:gemini-2.5-flash', 'g1:gemini-2.5-pro']);
    expect(entries[0]!.label).toBe('Gemini 2.5 Flash');
    expect(entries[1]!.label).toBe('gemini-2.5-pro');
  });

  it('injects the OpenRouter free router when a ready OpenRouter key lists models', () => {
    const c = conn({
      id: 'or1', provider: 'openrouter', label: 'OR',
      model: 'openrouter/free', baseUrl: 'https://openrouter.ai/api/v1',
    });
    const entries = cloudEntriesFor(c, [
      { id: 'meta-llama/llama-3.3-70b-instruct:free' },
      { id: 'openai/gpt-4o' },
    ]);
    expect(entries[0]!.modelId).toBe('openrouter/free');
    expect(entries.map(e => e.modelId)).toEqual([
      'openrouter/free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'openai/gpt-4o',
    ]);
  });
});

describe('buildModelCatalog', () => {
  it('merges locals first, then each connection’s models; skips the webllm connection and not-ready clouds', () => {
    const webllm = conn({ id: 'w1', provider: 'webllm', apiKey: '', model: 'Qwen3.5-4B-q4f16_1-MLC' });
    const ready = conn({ id: 'g1', label: 'Gem' });
    const noKey = conn({ id: 'g2', apiKey: '', label: 'Nope' });
    const entries = buildModelCatalog([webllm, ready, noKey], {
      cached: {},
      cloudLists: { g1: [{ id: 'gemini-2.5-flash' }] },
    });
    // locals first (the full curated catalog), then g1's models; w1 is the
    // local tier itself (not a duplicate row) and g2 contributes nothing.
    expect(entries[0]!.local).toBe(true);
    expect(entries.filter(e => e.connectionId === 'g1').map(e => e.modelId)).toEqual(['gemini-2.5-flash']);
    expect(entries.filter(e => e.connectionId === 'g2')).toEqual([]);
    expect(entries.filter(e => e.connectionId === 'w1')).toEqual([]);
  });

  it('a ready connection with no list yet still offers its configured model', () => {
    const ready = conn({ id: 'g1' });
    const entries = buildModelCatalog([ready], {});
    expect(entries.filter(e => e.connectionId === 'g1').map(e => e.modelId)).toEqual(['m-default']);
  });
});

describe('pickModel / activeCatalogKey', () => {
  const local = (): ReturnType<typeof buildLocalModels>[number] => buildLocalModels()[0]!;

  it('creates the on-computer connection when picking a local model with none yet', () => {
    const settings: import('../lib/aiSettings').AiSettings = { connections: [], activeConnectionId: null, prompts: [] };
    const next = pickModel(settings, local(), () => 'new-w');
    expect(next.connections).toHaveLength(1);
    expect(next.connections[0]).toMatchObject({ id: 'new-w', provider: 'webllm', model: local().modelId });
    expect(next.activeConnectionId).toBe('new-w');
    expect(activeCatalogKey(next)).toBe(local().key);
  });

  it('retargets an existing webllm connection rather than adding a second', () => {
    const settings: import('../lib/aiSettings').AiSettings = {
      connections: [{ id: 'w1', provider: 'webllm', label: 'On this computer', apiKey: '', model: 'old' }],
      activeConnectionId: 'w1',
      prompts: [],
    };
    const next = pickModel(settings, local());
    expect(next.connections).toHaveLength(1);
    expect(next.connections[0]!.model).toBe(local().modelId);
  });

  it('creates a separate bonsai connection instead of retargeting webllm', () => {
    const settings: import('../lib/aiSettings').AiSettings = {
      connections: [{ id: 'w1', provider: 'webllm', label: 'On this computer', apiKey: '', model: 'Qwen3.5-2B-q4f16_1-MLC' }],
      activeConnectionId: 'w1',
      prompts: [],
    };
    const bonsai = buildLocalModels().find(e => e.engine === 'bonsai')!;
    const next = pickModel(settings, bonsai, () => 'new-b');
    expect(next.connections).toHaveLength(2);
    expect(next.connections.find(c => c.provider === 'webllm')?.model).toBe('Qwen3.5-2B-q4f16_1-MLC');
    expect(next.connections.find(c => c.provider === 'bonsai')).toMatchObject({
      id: 'new-b', provider: 'bonsai', model: bonsai.modelId,
    });
    expect(next.activeConnectionId).toBe('new-b');
    expect(activeCatalogKey(next)).toBe(bonsai.key);
  });

  it('sets the cloud connection’s model and makes it active', () => {
    const c = conn({ id: 'g1', model: 'old' });
    const settings: import('../lib/aiSettings').AiSettings = {
      connections: [c], activeConnectionId: null, prompts: [],
    };
    const entry = cloudEntriesFor(c, [{ id: 'gemini-2.5-flash', detail: 'Flash' }])[0]!;
    const next = pickModel(settings, entry);
    expect(next.activeConnectionId).toBe('g1');
    expect(next.connections[0]!.model).toBe('gemini-2.5-flash');
    expect(activeCatalogKey(next)).toBe('g1:gemini-2.5-flash');
  });

  it('adds the picked model to the chat shortlist', () => {
    const settings: import('../lib/aiSettings').AiSettings = { connections: [], activeConnectionId: null, prompts: [] };
    const next = pickModel(settings, local());
    expect(next.favoriteModels).toContain(local().key);
  });
});

describe('catalogBucket / favorites / chatPickerEntries', () => {
  it('buckets local vs OpenRouter free vs paid remote', () => {
    const local = buildLocalModels()[0]!;
    const or: AiConnection = {
      id: 'or1', provider: 'openrouter', label: 'OR', apiKey: 'k', model: 'openrouter/free',
    };
    const gem: AiConnection = conn({ id: 'g1' });
    const entries = [
      local,
      ...cloudEntriesFor(or, [{ id: 'openrouter/free' }, { id: 'anthropic/claude-sonnet-4' }]),
      ...cloudEntriesFor(gem, [{ id: 'gemini-2.5-flash' }]),
    ];
    expect(catalogBucket(local)).toBe('local');
    expect(catalogBucket(entries.find(e => e.modelId === 'openrouter/free')!)).toBe('free');
    expect(catalogBucket(entries.find(e => e.modelId === 'anthropic/claude-sonnet-4')!)).toBe('remote');
    expect(catalogBucket(entries.find(e => e.modelId === 'gemini-2.5-flash')!)).toBe('remote');
  });

  it('toggles a key on and off the shortlist', () => {
    const s: import('../lib/aiSettings').AiSettings = { connections: [], activeConnectionId: null, prompts: [] };
    const on = toggleFavorite(s, 'local:x');
    expect(on.favoriteModels).toEqual(['local:x']);
    expect(toggleFavorite(on, 'local:x').favoriteModels).toEqual([]);
  });

  it('chat picker lists only favorites (plus active), not the whole catalog', () => {
    const entries = buildModelCatalog([]);
    const rec = entries.find(e => e.modelId === DEFAULT_CHAT_LOCAL_ID)!;
    const other = entries.find(e => e.local && e.modelId !== DEFAULT_CHAT_LOCAL_ID)!;
    const empty: import('../lib/aiSettings').AiSettings = { connections: [], activeConnectionId: null, prompts: [] };
    expect(chatPickerEntries(entries, empty).map(e => e.key)).toEqual([rec.key]);
    const shortlisted = { ...empty, favoriteModels: [other.key] };
    expect(chatPickerEntries(entries, shortlisted).map(e => e.key)).toEqual([other.key]);
  });
});
