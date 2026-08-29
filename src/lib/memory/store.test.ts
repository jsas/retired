// Tests for the memory store: bounded size, access weighting, recency decay,
// search ranking, and the write-refusal semantics that keep the store from
// churning. The store is deliberately standalone (no app imports) so these
// exercise it exactly as a future library consumer would.
import { describe, it, expect } from 'vitest';
import {
  MemoryStore, rank, recencyFactor, MAX_PER_SCOPE,
  type MemoryAdapter, type MemoryRecord,
} from './store';

/** Deterministic in-memory adapter + a settable clock so decay tests are
 *  exact rather than timing-dependent. */
function makeStore(now = 1_000_000) {
  let records: MemoryRecord[] = [];
  const adapter: MemoryAdapter = {
    all: () => records,
    put: (r) => { records = records.some(x => x.id === r.id) ? records.map(x => (x.id === r.id ? r : x)) : [...records, r]; },
    delete: (id) => { records = records.filter(x => x.id !== id); },
  };
  let clock = now;
  const store = new MemoryStore(adapter, () => clock);
  return {
    store,
    tick: (ms: number) => { clock += ms; },
    time: () => clock,
  };
}

const DAY = 24 * 60 * 60 * 1000;

describe('write', () => {
  it('stores a memory with defaults and refuses empty text', () => {
    const { store } = makeStore();
    const m = store.write({ scope: 'scenario', scopeKey: 's1', text: 'Spouse pension pays $1,200/mo' });
    expect(m).not.toBeNull();
    expect(m!.importance).toBe(0.5);
    expect(store.write({ scope: 'scenario', scopeKey: 's1', text: '   ' })).toBeNull();
    // A scenario memory without a scope key is invalid, not global.
    expect(store.write({ scope: 'scenario', text: 'orphan' })).toBeNull();
  });

  it('rewriting identical text refreshes instead of duplicating', () => {
    const { store, tick } = makeStore();
    const a = store.write({ scope: 'global', text: 'User is 62', importance: 0.4 });
    tick(DAY);
    const b = store.write({ scope: 'global', text: 'User is 62', importance: 0.8 });
    expect(b!.id).toBe(a!.id);
    expect(b!.importance).toBe(0.8);      // raised
    expect(b!.accessCount).toBe(1);       // counted as an access
    expect(store.list().length).toBe(1);
  });

  it('evicts the lowest-ranked memory when the scope is full', () => {
    const { store, tick } = makeStore();
    for (let i = 0; i < MAX_PER_SCOPE; i++) {
      store.write({ scope: 'scenario', scopeKey: 's1', text: `fact ${i}`, importance: 0.5 });
      tick(DAY); // time separation so ranks genuinely differ
    }
    expect(store.list('s1').length).toBe(MAX_PER_SCOPE);
    // The new memory is the freshest (highest recency), so the OLDEST —
    // decayed the furthest — is the weakest resident and gets evicted.
    const ok = store.write({ scope: 'scenario', scopeKey: 's1', text: 'the newest fact', importance: 0.5 });
    expect(ok).not.toBeNull();
    expect(store.list('s1').length).toBe(MAX_PER_SCOPE);
    expect(store.list('s1').some(m => m.text === 'fact 0')).toBe(false); // oldest evicted
    expect(store.list('s1').some(m => m.text === 'the newest fact')).toBe(true);
  });

  it('refuses a write that would not outrank the weakest resident', () => {
    const { store } = makeStore();
    for (let i = 0; i < MAX_PER_SCOPE; i++) {
      store.write({ scope: 'global', text: `strong ${i}`, importance: 0.9 });
    }
    // A trivial new memory loses to the weakest 0.9 — refused, not churned.
    const refused = store.write({ scope: 'global', text: 'trivial', importance: 0.05 });
    expect(refused).toBeNull();
    expect(store.list().length).toBe(MAX_PER_SCOPE);
    expect(store.list().some(m => m.text === 'trivial')).toBe(false);
  });

  it('scopes are budgeted independently (global full does not block a scenario)', () => {
    const { store } = makeStore();
    for (let i = 0; i < MAX_PER_SCOPE; i++) {
      store.write({ scope: 'global', text: `global ${i}`, importance: 0.9 });
    }
    const s = store.write({ scope: 'scenario', scopeKey: 's1', text: 'scenario fact', importance: 0.1 });
    expect(s).not.toBeNull();
  });
});

describe('recall + weighting', () => {
  it('searches by substring and ranks by weight × recency', () => {
    const { store } = makeStore();
    store.write({ scope: 'global', text: 'User plans to retire to Nova Scotia', importance: 0.9 });
    store.write({ scope: 'global', text: 'User prefers plain language', importance: 0.3 });
    store.write({ scope: 'scenario', scopeKey: 's1', text: 'Spouse pension: Nova Scotia plan, $1,200/mo', importance: 0.6 });
    const hits = store.recall('nova scotia', { scopeKey: 's1' });
    // Both Nova-Scotia memories match, higher rank first; the unrelated one is out.
    expect(hits.length).toBe(2);
    expect(hits[0]!.text).toContain('retire to Nova Scotia');
  });

  it('an access strengthens the memory (weighting by use)', () => {
    const { store, tick, time } = makeStore();
    store.write({ scope: 'global', text: 'often useful', importance: 0.5 });
    store.write({ scope: 'global', text: 'rarely useful', importance: 0.5 });
    // Recall one of them repeatedly over time; its access count climbs and its
    // lastAccessedAt stays fresh.
    for (let i = 0; i < 5; i++) { tick(DAY); store.recall('often'); }
    const all = store.list();
    const often = all.find(m => m.text === 'often useful')!;
    const rarely = all.find(m => m.text === 'rarely useful')!;
    expect(often.accessCount).toBe(5);
    expect(rarely.accessCount).toBe(0);
    expect(often.lastAccessedAt).toBe(time()); // refreshed by the last recall
    expect(rank(often, time())).toBeGreaterThan(rank(rarely, time()));
  });

  it('empty query returns the top-ranked memories outright', () => {
    const { store, tick } = makeStore();
    store.write({ scope: 'global', text: 'meh', importance: 0.2 });
    tick(DAY);
    store.write({ scope: 'global', text: 'vital', importance: 0.95 });
    const top = store.recall('', { limit: 1 });
    expect(top.length).toBe(1);
    expect(top[0]!.text).toBe('vital');
  });

  it('respects the scope filter: scenario recall includes global, not other scenarios', () => {
    const { store } = makeStore();
    store.write({ scope: 'global', text: 'user fact' });
    store.write({ scope: 'scenario', scopeKey: 's1', text: 's1 fact' });
    store.write({ scope: 'scenario', scopeKey: 's2', text: 's2 fact' });
    const hits = store.recall('', { scopeKey: 's1' });
    expect(hits.map(h => h.text).sort()).toEqual(['s1 fact', 'user fact']);
  });
});

describe('decay + prune', () => {
  it('recency halves at the half-life', () => {
    expect(recencyFactor(0, 0)).toBe(1);
    expect(recencyFactor(0, 30 * DAY)).toBeCloseTo(0.5);
    expect(recencyFactor(0, 60 * DAY)).toBeCloseTo(0.25);
  });

  it('an old important memory still outranks a fresh trivial one', () => {
    const now = 10_000_000;
    const old = { importance: 1.0, lastAccessedAt: now - 90 * DAY } as MemoryRecord;
    const fresh = { importance: 0.08, lastAccessedAt: now } as MemoryRecord;
    expect(rank(old, now)).toBeGreaterThan(rank(fresh, now));
  });

  it('prune drops only decayed-to-noise memories', () => {
    const { store, tick } = makeStore();
    store.write({ scope: 'global', text: 'sticky', importance: 1.0 });
    store.write({ scope: 'global', text: 'fleeting', importance: 0.05 });
    // 120 days: the 0.05 memory sinks below the prune floor (0.05 × 0.5^4 ≈
    // 0.003 < 0.04) while the 1.0 one (0.5^4 = 0.0625) survives.
    tick(120 * DAY);
    const removed = store.prune();
    expect(removed).toBe(1);
    const left = store.list().map(m => m.text);
    expect(left).toEqual(['sticky']);
  });

  it('forget removes exactly one memory', () => {
    const { store } = makeStore();
    const a = store.write({ scope: 'global', text: 'keep me' })!;
    store.write({ scope: 'global', text: 'drop me' });
    store.forget(a.id);
    expect(store.list().map(m => m.text)).toEqual(['drop me']);
  });
});
