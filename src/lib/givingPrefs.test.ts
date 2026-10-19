// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getGivingPrefs,
  setGivingPrefs,
  DEFAULT_GIVING_PREFS,
  GIVING_PREF_KEY,
} from './givingPrefs';

// Node env has no localStorage; prefKV degrades to it, so stub a tiny mirror.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

describe('giving defaults pref', () => {
  beforeEach(() => store.clear());

  it('defaults to a 5%-of-gross pledge', () => {
    expect(getGivingPrefs()).toEqual({ defaultPct: 5, defaultBasis: 'gross' });
  });

  it('a set persists and merges over the defaults', () => {
    setGivingPrefs({ defaultBasis: 'net' });
    expect(getGivingPrefs()).toEqual({ defaultPct: 5, defaultBasis: 'net' });
    expect(JSON.parse(store.get(GIVING_PREF_KEY)!)).toMatchObject({ defaultBasis: 'net' });
  });

  it('ignores junk values from a hand-edited pref', () => {
    store.set(GIVING_PREF_KEY, JSON.stringify({ defaultPct: 'ten', defaultBasis: 'crypto' }));
    expect(getGivingPrefs()).toEqual(DEFAULT_GIVING_PREFS);
  });

  it('a percent outside 0–100 falls back to the default', () => {
    store.set(GIVING_PREF_KEY, JSON.stringify({ defaultPct: 150 }));
    expect(getGivingPrefs().defaultPct).toBe(DEFAULT_GIVING_PREFS.defaultPct);
  });

  it('unparseable JSON yields the defaults instead of throwing', () => {
    store.set(GIVING_PREF_KEY, '{oops');
    expect(getGivingPrefs()).toEqual(DEFAULT_GIVING_PREFS);
  });
});
