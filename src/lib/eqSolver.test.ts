import { describe, it, expect } from 'vitest';
import { solveEq, solveEqRows, solveEqReadout, shardRows, EQ_RUNS, EQ_SEED } from './eqSolver';
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
  it('produces a G×G rate grid whose nodes match a brute-force per-node success rate', () => {
    const inputs = plan();
    const res = solveEq({ inputs, config, pad: { x: 'retirementAge', y: 'desiredSpending' } });
    expect(res.grid).not.toBeNull();
    const G = res.gridMeta!.size;
    expect(res.grid!.length).toBe(G * G);

    // Brute-force reference: score every node independently against the SAME
    // seeded batch (generated from the youngest pad age, exactly as the solver
    // does) and compare rates exactly.
    const sequences = generateSequences(
      EQ_RUNS, Math.min(inputs.currentAge, 40), inputs.maxAge, inputs.investmentReturn, inputs.returnVolatility, EQ_SEED,
    );
    const xSpec = AXES.retirementAge;
    const ySpec = AXES.desiredSpending;
    for (let gy = 0; gy < G; gy++) {
      const y = ySpec.min + (ySpec.max - ySpec.min) * (gy / (G - 1));
      for (let gx = 0; gx < G; gx++) {
        const x = xSpec.min + (xSpec.max - xSpec.min) * (gx / (G - 1));
        const cand = withAxis(withAxis(inputs, 'retirementAge', x), 'desiredSpending', y);
        const expected = simulate(cand, config, sequences).successRate;
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
    // Put spending high on the axis so the center row is near G-1.
    const inputs = withAxis(plan(), 'desiredSpending', 900000);
    const rows: number[] = [];
    const res = solveEq({ inputs, config, pad: { x: 'retirementAge', y: 'desiredSpending' } }, (p) => rows.push(p.row));
    const G = res.gridMeta!.size;
    const centerRow = Math.round(((900000 - AXES.desiredSpending.min) / (AXES.desiredSpending.max - AXES.desiredSpending.min)) * (G - 1));
    expect(rows[0]).toBe(centerRow);
  });

  it('reports a success rate within [0,1] and null grid when pad is null', () => {
    const res = solveEq({ inputs: plan(), config, pad: null });
    expect(res.successRate).toBeGreaterThanOrEqual(0);
    expect(res.successRate).toBeLessThanOrEqual(1);
    expect(res.grid).toBeNull();
    expect(res.gridMeta).toBeNull();
  });

  it('every grid rate is within [0,1]', () => {
    const res = solveEq({ inputs: plan(), config, pad: { x: 'retirementAge', y: 'desiredSpending' } });
    for (const r of res.grid!) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

describe('parallel sharding', () => {
  const req = () => ({ inputs: plan(), config, pad: { x: 'retirementAge' as const, y: 'desiredSpending' as const } });

  it('shardRows partitions every row exactly once across the shards', () => {
    const shards = shardRows(req(), 4);
    expect(shards.length).toBe(4);
    const all = shards.flat().sort((a, b) => a - b);
    expect(all).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]); // 9 rows, no dupes/gaps
  });

  it('shardRows spreads the center-out order across shards (near rows on all workers)', () => {
    const inputs = withAxis(plan(), 'desiredSpending', 60000);
    const shards = shardRows({ inputs, config, pad: { x: 'retirementAge', y: 'desiredSpending' } }, 3);
    // Round-robin of the center-out order means shard 0 gets the nearest row,
    // shard 1 the next, etc. — every shard holds some near rows.
    const G = 9;
    const yS = AXES.desiredSpending;
    const centerRow = Math.round(((60000 - yS.min) / (yS.max - yS.min)) * (G - 1));
    expect(shards[0][0]).toBe(centerRow);
    for (const s of shards) expect(s.length).toBeGreaterThan(0);
  });

  it('shardRows caps the shard count at the row count', () => {
    expect(shardRows(req(), 99).length).toBe(9);
    expect(shardRows({ ...req(), pad: null }, 4)).toEqual([]);
  });

  it('solveEqRows shards stitch back into the same grid as the full solveEq', () => {
    const inputs = plan();
    const request = { inputs, config, pad: { x: 'retirementAge' as const, y: 'desiredSpending' as const } };
    const full = solveEq(request);
    const shards = shardRows(request, 3);
    const stitched = new Array<number>(81).fill(0);
    for (const rows of shards) {
      const part = solveEqRows(request, rows);
      for (const gy of rows) {
        for (let gx = 0; gx < 9; gx++) stitched[gy * 9 + gx] = part.grid![gy * 9 + gx];
      }
    }
    expect(stitched).toEqual(full.grid);
  });

  it('solveEqReadout matches the full solveEq readout', () => {
    const inputs = plan();
    expect(solveEqReadout({ inputs, config, pad: null })).toBe(
      solveEq({ inputs, config, pad: null }).successRate,
    );
  });
});
