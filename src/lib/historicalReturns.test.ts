import { describe, it, expect } from 'vitest';
import { runBacktest, HISTORICAL_REAL_RETURNS } from './historicalReturns';

// A stub engine runner: we don't need the real projection to test window
// construction, only that the runner receives a per-age return sequence and
// that empty/clamped horizons behave. It returns a flat breakdown whose length
// matches the horizon and never depletes.
const stubEngine = ((runInputs: { currentAge: number; maxAge: number }, _cfg: unknown, opts: { returnSequence: Record<number, number> }) => {
  const years = Math.max(1, Math.round(runInputs.maxAge - runInputs.currentAge));
  return {
    yearlyBreakdown: Array.from({ length: years }, (_, i) => ({ endingBalance: 1000 + i, age: runInputs.currentAge + i })),
    depletionAge: null,
    // Echo the sequence so a test can assert the ages align.
    __seq: opts.returnSequence,
  };
}) as never;

const base = { currentAge: 65, maxAge: 95, investmentReturn: 0.05, returnVolatility: 0 } as never;

describe('runBacktest horizon clamping', () => {
  it('builds rolling windows across the data for a normal horizon', () => {
    const r = runBacktest(base, {}, stubEngine);
    const dataLen = HISTORICAL_REAL_RETURNS.returns.length; // 55
    expect(r.windowYears).toBe(30);
    expect(r.windowCount).toBe(dataLen - 30 + 1);
    expect(r.truncated).toBe(false);
    expect(r.worstWindow).not.toBeNull();
    expect(r.bestWindow).not.toBeNull();
  });

  it('clamps the horizon to the data when the plan outlasts the record', () => {
    // currentAge 30 → maxAge 95 = 65-year horizon, longer than the 55-yr series.
    const young = { currentAge: 30, maxAge: 95, investmentReturn: 0.05, returnVolatility: 0 } as never;
    const r = runBacktest(young, {}, stubEngine);
    const dataLen = HISTORICAL_REAL_RETURNS.returns.length;
    expect(r.windowYears).toBe(dataLen);      // clamped to the full series
    expect(r.windowCount).toBe(1);            // exactly one window fits
    expect(r.truncated).toBe(true);
    expect(r.worstWindow).not.toBeNull();     // no crash on the single window
  });

  it('aligns each window to calendar years of the data', () => {
    const r = runBacktest(base, {}, stubEngine);
    const start = HISTORICAL_REAL_RETURNS.startYear;
    expect(r.windows[0].startYear).toBe(start);
    expect(r.windows[r.windows.length - 1].startYear).toBe(start + r.windowCount - 1);
  });
});
