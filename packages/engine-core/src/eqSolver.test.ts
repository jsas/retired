import { describe, it, expect } from 'vitest';
import { solveEqReadout, EQ_RUNS, EQ_SEED } from './eqSolver';
import { generateSequences, simulate } from './monteCarlo';
import { testConfig, baseInputs } from '../test/helpers';

const config = testConfig();

// A mid-range plan: funded at low spend / late retirement, short at high spend / early.
const plan = () => baseInputs({
  currentAge: 50, retirementAge: 60, maxAge: 92,
  rrspBalance: 400000, tfsaBalance: 120000, taxableBalance: 60000, cashCushionBalance: 20000,
  rrspContribution: 12000, tfsaContribution: 6000, taxableContribution: 3000,
  desiredSpending: 60000, investmentReturn: 0.05, returnVolatility: 0.14,
  cppStartAge: 65, oasStartAge: 65,
});

describe('solveEqReadout', () => {
  it('matches a brute-force score against the same seeded batch', () => {
    const inputs = plan();
    const sequences = generateSequences(
      EQ_RUNS, Math.min(inputs.currentAge, 40), inputs.maxAge,
      inputs.investmentReturn, inputs.returnVolatility, EQ_SEED,
    );
    expect(solveEqReadout(inputs, config)).toBe(simulate(inputs, config, sequences).successRate);
  });

  it('is deterministic: the same plan always reports the same rate', () => {
    expect(solveEqReadout(plan(), config)).toBe(solveEqReadout(plan(), config));
  });

  it('stays within [0,1], and a broke plan scores lower than a funded one', () => {
    const broke = baseInputs({
      currentAge: 50, retirementAge: 60, maxAge: 92,
      rrspBalance: 20000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      desiredSpending: 90000, investmentReturn: 0.02, returnVolatility: 0.14,
      cppStartAge: 65, oasStartAge: 65,
    });
    const funded = plan();
    expect(solveEqReadout(broke, config)).toBeGreaterThanOrEqual(0);
    expect(solveEqReadout(funded, config)).toBeLessThanOrEqual(1);
    expect(solveEqReadout(broke, config)).toBeLessThan(solveEqReadout(funded, config));
  });
});
