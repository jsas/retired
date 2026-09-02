// @vitest-environment node
// The dashboard's map-window composer: the spending axis widens to the
// Settings lever-range pref, never below the default 160k top nor below the
// plan's own spending (a dot above the axis would drag). Lever-range prefs
// live in prefKV — stub localStorage like the DetailsPage tests.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setRangePrefs, RANGES_PREF_KEY } from '../lib/rangePrefs';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

// Importing mapWindow via BetaApp keeps the helper colocated with the page
// that renders the map, while this test exercises exactly the window math.
import { mapWindow } from './BetaApp';

beforeEach(() => { store.clear(); });

describe('BetaApp map window (lever-range pref)', () => {
  it('defaults the axis to the default pref ($300,000 cap)', () => {
    // The pref defaults to $300,000; the axis ends at the pref, so the
    // fader's range and the map match — parity with the Details faders.
    const w = mapWindow({ desiredSpending: 60000 });
    expect(w.spendTop).toBe(300_000);
    expect(w.spendBottom).toBe(20000);
    expect(w.ageMin).toBe(55);
    expect(w.ageMax).toBe(75);
  });

  it('narrows the axis to a tightened lever-range pref', () => {
    setRangePrefs({ spendingMax: 120000 });
    const w = mapWindow({ desiredSpending: 60000 });
    expect(w.spendTop).toBe(120000);
  });

  it('covers the plan\'s own spending even above a narrow pref', () => {
    setRangePrefs({ spendingMax: 50000 });
    const w = mapWindow({ desiredSpending: 200000 });
    expect(w.spendTop).toBe(200000);
  });

  it('defaults to the $300,000 axis when no pref is set', () => {
    store.delete(RANGES_PREF_KEY);
    const w = mapWindow({ desiredSpending: 60000 });
    // absent pref → DEFAULT_RANGE_PREFS.spendingMax ($300,000) — the axis
    // extends as far as the fader's default range allows
    expect(w.spendTop).toBe(300_000);
  });
});
