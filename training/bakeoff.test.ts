import { describe, expect, it } from 'vitest';
import { BAKEOFF_BASES, CANDIDATES_SMALLEST_FIRST, THRESHOLDS } from './bakeoff';

describe('bake-off manifest', () => {
  it('includes a genuinely tiny (sub-1B) tier for the mobile goal', () => {
    const subOneB = BAKEOFF_BASES.filter((b) => b.paramsB < 1);
    expect(subOneB.length).toBeGreaterThanOrEqual(2);
  });

  it('every candidate points at an MLC q4f16 prebuilt', () => {
    for (const b of BAKEOFF_BASES) {
      expect(b.modelId).toMatch(/-q4f16_1-MLC$/);
    }
  });

  it('only redistributable bases are recommended for a first-party mirror', () => {
    for (const b of CANDIDATES_SMALLEST_FIRST) {
      expect(b.redistributable).toBe(true);
      expect(b.license).toBe('Apache-2.0');
    }
    // Llama (AUP) is benchmarked as a reference but excluded from the ship set
    expect(CANDIDATES_SMALLEST_FIRST.some((b) => b.license === 'Llama-Community')).toBe(false);
    expect(BAKEOFF_BASES.some((b) => b.license === 'Llama-Community')).toBe(true);
  });

  it('orders candidates smallest-first so the bake-off stops at the first winner', () => {
    for (let i = 1; i < CANDIDATES_SMALLEST_FIRST.length; i++) {
      expect(CANDIDATES_SMALLEST_FIRST[i].paramsB)
        .toBeGreaterThanOrEqual(CANDIDATES_SMALLEST_FIRST[i - 1].paramsB);
    }
  });

  it('keeps Gemma and Phi-mini out of the running', () => {
    expect(BAKEOFF_BASES.some((b) => b.license === 'Gemma-Terms')).toBe(false);
    expect(BAKEOFF_BASES.some((b) => /phi/i.test(b.label))).toBe(false);
  });

  it('has sensible, ordered thresholds', () => {
    expect(THRESHOLDS.stockFloorToAttemptSft).toBeLessThan(THRESHOLDS.postSftShipBar);
    expect(THRESHOLDS.postSftShipBar).toBeGreaterThanOrEqual(0.9);
  });
});
