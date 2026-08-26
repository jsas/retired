// Tests for the Monte Carlo spending solver (issue #3).
import { describe, it, expect } from 'vitest';
import { solveSustainableSpending } from './spendingSolver';
import { mulberry32, generateSequences, simulate, runMonteCarlo } from './monteCarlo';
import { calculateHousehold } from './retirementEngine';
import { testConfig, baseInputs } from '../test/helpers';

const config = testConfig();

// A solidly-funded plan so the solver has room to find a positive spending.
const inputs = baseInputs({
  currentAge: 65, retirementAge: 65, maxAge: 90,
  rrspBalance: 600000, tfsaBalance: 200000, taxableBalance: 0, cashCushionBalance: 0,
  cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
  desiredSpending: 60000, investmentReturn: 0.05, returnVolatility: 0.15,
});

describe('mulberry32 / seeding', () => {
  it('is deterministic for a fixed seed and differs across seeds', () => {
    const a1 = mulberry32(42); const seqA1 = [a1(), a1(), a1()];
    const a2 = mulberry32(42); const seqA2 = [a2(), a2(), a2()];
    expect(seqA2).toEqual(seqA1);
    const b = mulberry32(43); const seqB = [b(), b(), b()];
    expect(seqB).not.toEqual(seqA1);
    for (const v of [...seqA1, ...seqB]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('runMonteCarlo with a fixed seed reproduces the same success rate', () => {
    const req = { inputs, config, runs: 200, volatility: 0.15, seed: 7 };
    const r1 = runMonteCarlo(req);
    const r2 = runMonteCarlo(req);
    expect(r1.successCount).toBe(r2.successCount);
    expect(r1.successRate).toBe(r2.successRate);
  });
});

describe('solveSustainableSpending', () => {
  it('achieves at least the target rate, and the next step up falls below it', () => {
    const target = 0.9;
    const res = solveSustainableSpending({ inputs, config, targetSuccessRate: target, volatility: 0.15, runs: 500, seed: 123 });
    expect(res.feasible).toBe(true);
    expect(res.unconstrained).toBe(false);
    expect(res.spending).toBeGreaterThan(0);
    expect(res.achievedSuccessRate).toBeGreaterThanOrEqual(target);
    expect(res.nextStepSuccessRate).not.toBeNull();
    expect(res.nextStepSuccessRate!).toBeLessThan(target);
  });

  it('is monotonic: a lower target allows at least as much spending', () => {
    const hi = solveSustainableSpending({ inputs, config, targetSuccessRate: 0.95, volatility: 0.15, runs: 500, seed: 55 });
    const lo = solveSustainableSpending({ inputs, config, targetSuccessRate: 0.75, volatility: 0.15, runs: 500, seed: 55 });
    expect(lo.spending).toBeGreaterThanOrEqual(hi.spending);
  });

  it('reproduces ≈ the target when the solved spending is re-simulated on the same futures', () => {
    const target = 0.9;
    const res = solveSustainableSpending({ inputs, config, targetSuccessRate: target, volatility: 0.15, runs: 500, seed: 99 });
    const seqs = generateSequences(500, inputs.currentAge, inputs.maxAge, inputs.investmentReturn, 0.15, 99);
    const check = simulate({ ...inputs, desiredSpending: res.spending }, config, seqs);
    expect(check.successRate).toBeGreaterThanOrEqual(target);
  });

  it('marks the plan infeasible when even zero spending misses the target', () => {
    // A ruinous fixed outflow event forces depletion no matter the spending.
    const broke = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 90,
      rrspBalance: 1000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      events: [{ id: 'e1', age: 66, label: 'huge', amount: 500000, direction: 'out' }],
    });
    // Confirm the premise: it depletes even at zero spending.
    expect(calculateHousehold(broke, config).depletionAge).not.toBeNull();
    const res = solveSustainableSpending({ inputs: broke, config, targetSuccessRate: 0.9, volatility: 0.15, runs: 200, seed: 5 });
    expect(res.feasible).toBe(false);
    expect(res.spending).toBe(0);
  });

  it('flags unconstrained when the target holds at the absolute ceiling', () => {
    // An enormous portfolio funds any plausible spending at high confidence.
    const rich = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 70, // short horizon
      rrspBalance: 0, tfsaBalance: 50000000, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 100000, withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
    });
    const res = solveSustainableSpending({
      inputs: rich, config, targetSuccessRate: 0.9, volatility: 0.1,
      runs: 100, seed: 11, toleranceDollars: 50000,
    });
    expect(res.feasible).toBe(true);
    expect(res.unconstrained).toBe(true);
  });

  it('respects the iteration budget', () => {
    const res = solveSustainableSpending({ inputs, config, targetSuccessRate: 0.9, volatility: 0.15, runs: 300, seed: 21, maxIterations: 10 });
    expect(res.iterations).toBeLessThanOrEqual(10);
  });
});
