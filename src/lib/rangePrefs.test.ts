// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRangePrefs,
  setRangePrefs,
  DEFAULT_RANGE_PREFS,
  RANGES_PREF_KEY,
} from './rangePrefs';

// Node env has no localStorage; prefKV degrades to it, so stub a tiny mirror.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

describe('lever range prefs', () => {
  beforeEach(() => store.clear());

  it('defaults match the engine constraint ranges (eqConstraints AXES)', () => {
    expect(getRangePrefs()).toEqual({
      spendingMax: 1_000_000,
      savingsMax: 500_000,
      returnMin: 0,
      returnMax: 0.2,
      volatilityMax: 0.3,
    });
  });

  it('a set persists and merges over the defaults', () => {
    setRangePrefs({ spendingMax: 2_500_000 });
    const prefs = getRangePrefs();
    expect(prefs.spendingMax).toBe(2_500_000);
    expect(prefs.returnMax).toBe(DEFAULT_RANGE_PREFS.returnMax);
    expect(JSON.parse(store.get(RANGES_PREF_KEY)!)).toMatchObject({ spendingMax: 2_500_000 });
  });

  it('ignores junk fields from a hand-edited pref', () => {
    store.set(RANGES_PREF_KEY, JSON.stringify({ spendingMax: 'lots', savingsMax: 750_000, nope: 1 }));
    const prefs = getRangePrefs();
    expect(prefs.spendingMax).toBe(DEFAULT_RANGE_PREFS.spendingMax);
    expect(prefs.savingsMax).toBe(750_000);
  });

  it('an inverted return range falls back to the default max', () => {
    store.set(RANGES_PREF_KEY, JSON.stringify({ returnMin: 0.15, returnMax: 0.05 }));
    const prefs = getRangePrefs();
    expect(prefs.returnMin).toBe(0.15);
    expect(prefs.returnMax).toBe(DEFAULT_RANGE_PREFS.returnMax);
  });

  it('a negative value is rejected in favour of the default', () => {
    store.set(RANGES_PREF_KEY, JSON.stringify({ volatilityMax: -0.4 }));
    expect(getRangePrefs().volatilityMax).toBe(DEFAULT_RANGE_PREFS.volatilityMax);
  });

  it('unparseable JSON yields the defaults instead of throwing', () => {
    store.set(RANGES_PREF_KEY, '{oops');
    expect(getRangePrefs()).toEqual(DEFAULT_RANGE_PREFS);
  });
});
