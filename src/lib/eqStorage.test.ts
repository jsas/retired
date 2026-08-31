import { describe, it, expect, beforeEach } from 'vitest';
import {
  bandToFrac, bandFromFrac, defaultEqBands, loadEqBands, saveEqBands,
  type BandFrac,
} from './eqStorage';
import { AXES, fullBand, normalizeBand, type EqAxis } from '@retired/engine-core/eqConstraints';

// Tests run in Node (no DOM), so give the storage module a minimal in-memory
// localStorage to persist against.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage;
});

describe('band scalar encoding', () => {
  it('a full-axis band encodes to fractions 0..1', () => {
    expect(bandToFrac('desiredSpending', fullBand('desiredSpending'))).toEqual({ lo: 0, hi: 1 });
    expect(bandToFrac('retirementAge', fullBand('retirementAge'))).toEqual({ lo: 0, hi: 1 });
  });

  it('encodes an absolute crop to its axis fractions', () => {
    // retirementAge axis is 40..75 (span 35). Crop 47..68 → lo=7/35=0.2, hi=28/35=0.8.
    const f = bandToFrac('retirementAge', { min: 47, max: 68 });
    expect(f.lo).toBeCloseTo(0.2, 9);
    expect(f.hi).toBeCloseTo(0.8, 9);
  });

  it('round-trips an absolute band through fractions and back', () => {
    const axes: EqAxis[] = ['desiredSpending', 'retirementAge', 'investmentReturn', 'maxAge', 'annualSavings', 'returnVolatility', 'cppStartAge', 'oasStartAge'];
    for (const a of axes) {
      const s = AXES[a];
      const band = normalizeBand(a, { min: s.min + (s.max - s.min) * 0.25, max: s.min + (s.max - s.min) * 0.75 });
      expect(bandFromFrac(a, bandToFrac(a, band))).toEqual(band);
    }
  });

  it('clamps out-of-range fractions on rehydrate', () => {
    const b = bandFromFrac('desiredSpending', { lo: -0.5, hi: 1.5 });
    expect(b).toEqual(fullBand('desiredSpending'));
  });

  it('reorders an inverted fraction pair', () => {
    const frac: BandFrac = { lo: 0.8, hi: 0.2 };
    const b = bandFromFrac('retirementAge', frac);
    expect(b.min).toBeLessThanOrEqual(b.max);
  });

  it('decouples the crop from the axis range: same fractions map to new min/max', () => {
    // Simulate an axis whose range changed between save and load by checking the
    // fractions, not the absolute numbers, carry the meaning. A middle-60% crop:
    const frac: BandFrac = { lo: 0.2, hi: 0.8 };
    const onAges = bandFromFrac('retirementAge', frac);   // 40..75
    const onMoney = bandFromFrac('desiredSpending', frac); // 0..1000000
    // Both sit at 20%..80% of their own (different) ranges.
    expect(onAges.min).toBeCloseTo(40 + 0.2 * 35, 6);
    expect(onAges.max).toBeCloseTo(40 + 0.8 * 35, 6);
    expect(onMoney.min).toBeCloseTo(0.2 * 1000000, 6);
    expect(onMoney.max).toBeCloseTo(0.8 * 1000000, 6);
  });
});

describe('defaultEqBands', () => {
  it('starts every control unconstrained (full-axis crop)', () => {
    const b = defaultEqBands();
    expect(b.desiredSpending).toEqual(fullBand('desiredSpending'));
    expect(b.cppStartAge).toEqual(fullBand('cppStartAge'));
    expect(b.annualSavings).toEqual(fullBand('annualSavings'));
  });
});

describe('save/load round-trip', () => {
  it('persists bands as fractions and rehydrates them on the same axes', () => {
    const bands = defaultEqBands();
    bands.retirementAge = { min: 47, max: 68 };
    bands.desiredSpending = { min: 50000, max: 150000 };
    saveEqBands(bands);
    const loaded = loadEqBands();
    expect(loaded.retirementAge).toEqual({ min: 47, max: 68 });
    expect(loaded.desiredSpending).toEqual({ min: 50000, max: 150000 });
    // Untouched axes come back as full bands.
    expect(loaded.maxAge).toEqual(fullBand('maxAge'));
  });

  it('falls back to full bands on corrupt storage', () => {
    localStorage.setItem('wealthconsole_eq', '{not json');
    expect(loadEqBands()).toEqual(defaultEqBands());
  });
});
