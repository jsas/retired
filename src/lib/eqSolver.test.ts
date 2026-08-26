import { describe, it, expect } from 'vitest';
import { solveEq, EQ_RUNS, EQ_SEED, GRID_TARGET_RATE } from './eqSolver';
import { generateSequences, simulate } from './monteCarlo';
import { AXES, withAxis } from './eqConstraints';
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

describe('solveEq grid', () => {
  it('produces a G×G grid whose cells match a brute-force per-cell score', () => {
    const inputs = plan();
    const res = solveEq({ inputs, config, pad: { x: 'retirementAge', y: 'desiredSpending' } });
    expect(res.grid).not.toBeNull();
    const G = res.gridMeta!.size;
    expect(res.grid!.length).toBe(G * G);

    // Brute-force reference: score every cell independently against the SAME
    // seeded batch and compare. The monotonic row-solve must agree.
    const sequences = generateSequences(
      EQ_RUNS, inputs.currentAge, inputs.maxAge, inputs.investmentReturn, inputs.returnVolatility, EQ_SEED,
    );
    const xSpec = AXES.retirementAge;
    const ySpec = AXES.desiredSpending;
    for (let gy = 0; gy < G; gy++) {
      const y = ySpec.min + (ySpec.max - ySpec.min) * (gy / (G - 1));
      for (let gx = 0; gx < G; gx++) {
        const x = xSpec.min + (xSpec.max - xSpec.min) * (gx / (G - 1));
        const cand = withAxis(withAxis(inputs, 'retirementAge', x), 'desiredSpending', y);
        const expected = simulate(cand, config, sequences).successRate >= GRID_TARGET_RATE;
        expect(res.grid![gy * G + gx]).toBe(expected);
      }
    }
  });

  it('streams every row exactly once, covering the whole grid', () => {
    const inputs = plan();
    const rows: number[] = [];
    const res = solveEq({ inputs, config, pad: { x: 'retirementAge', y: 'desiredSpending' } }, (p) => {
      rows.push(p.row);
      expect(p.cells.length).toBe(9);
    });
    const G = res.gridMeta!.size;
    expect(rows.length).toBe(G);
    expect(new Set(rows).size).toBe(G); // no duplicates, full coverage
  });

  it('streams center-out: the first row is nearest the current spending', () => {
    // Put spending near the TOP of the axis so the center row is near G-1.
    const inputs = withAxis(plan(), 'desiredSpending', 230000);
    const rows: number[] = [];
    const res = solveEq({ inputs, config, pad: { x: 'retirementAge', y: 'desiredSpending' } }, (p) => rows.push(p.row));
    const G = res.gridMeta!.size;
    const centerRow = Math.round(((230000 - 0) / (250000 - 0)) * (G - 1));
    expect(rows[0]).toBe(centerRow);
  });

  it('reports a success rate within [0,1] and null grid when pad is null', () => {
    const res = solveEq({ inputs: plan(), config, pad: null });
    expect(res.successRate).toBeGreaterThanOrEqual(0);
    expect(res.successRate).toBeLessThanOrEqual(1);
    expect(res.grid).toBeNull();
    expect(res.gridMeta).toBeNull();
  });
});
