// Tests for the spending-contour terrain (contour.ts). Covers the engine-facing
// semantics (predicates, boundary search, band ordering) against the REAL
// engine, and the pure geometry (axis mapping, smoothing path) without the DOM.
import { describe, it, expect } from 'vitest';
import {
  makeSample, boundarySpend, boundaryChain, buildBands,
  predGreen, predAmber, predDeep,
  xFrac, yFrac, ageAtFrac, spendAtFrac, smoothPath, terrainKey,
  type TerrainWindow,
} from './contour';
import { calculateHousehold } from './retirementEngine';
import { baseInputs, testConfig } from '../test/helpers';

const config = testConfig();

// A plan that holds comfortably at low spending and fails at high spending, so
// a real boundary exists inside the window. currentAge 55, retire 55–75 window.
const plan = baseInputs({
  currentAge: 55,
  retirementAge: 62,
  maxAge: 90,
  tfsaBalance: 800000,
  rrspBalance: 200000,
  desiredSpending: 60000,
  investmentReturn: 0.05,
  cppStartAge: null,
  oasStartAge: null,
});

const WIN: TerrainWindow = { ageMin: 55, ageMax: 75, spendTop: 160000, spendBottom: 20000 };

describe('predicates', () => {
  it('green = ON_TRACK', () => {
    expect(predGreen({ status: 'ON_TRACK', depletionAge: null })).toBe(true);
    expect(predGreen({ status: 'SHORTFALL', depletionAge: 80 })).toBe(false);
  });

  it('amber = ON_TRACK or depletion within borderYears of maxAge', () => {
    expect(predAmber({ status: 'ON_TRACK', depletionAge: null }, 90)).toBe(true);
    expect(predAmber({ status: 'SHORTFALL', depletionAge: 86 }, 90)).toBe(true);  // 4 ≤ 6
    expect(predAmber({ status: 'SHORTFALL', depletionAge: 80 }, 90)).toBe(false); // 10 > 6
  });

  it('deep = no depletion or comfortably past maxAge + cushion', () => {
    expect(predDeep({ status: 'ON_TRACK', depletionAge: null }, 90)).toBe(true);
    expect(predDeep({ status: 'SHORTFALL', depletionAge: 96 }, 90)).toBe(true);  // > 90+5
    expect(predDeep({ status: 'SHORTFALL', depletionAge: 92 }, 90)).toBe(false); // ≤ 90+5
  });
});

describe('boundarySpend (against the real engine)', () => {
  it('finds a boundary inside the window where low spend holds and high spend fails', () => {
    const sample = makeSample(plan, config);
    const b = boundarySpend(62, predGreen, sample, WIN);
    expect(b).toBeGreaterThan(WIN.spendBottom);
    expect(b).toBeLessThan(WIN.spendTop);
    // the boundary is where the verdict flips: just below holds, just above fails
    expect(sample(62, b - 500).status).toBe('ON_TRACK');
    expect(sample(62, b + 500).status).toBe('SHORTFALL');
  });

  it('clamps to spendTop when the plan holds even at the top of the map', () => {
    const rich = { ...plan, tfsaBalance: 90000000 };
    const sample = makeSample(rich, config);
    expect(boundarySpend(62, predGreen, sample, WIN)).toBe(WIN.spendTop);
  });

  it('clamps to spendBottom when the plan fails even at the bottom', () => {
    const broke = { ...plan, tfsaBalance: 0, rrspBalance: 0 };
    const sample = makeSample(broke, config);
    expect(boundarySpend(62, predGreen, sample, WIN)).toBe(WIN.spendBottom);
  });

  it('working longer (later retire age) lets you spend more — boundary rises', () => {
    const sample = makeSample(plan, config);
    const at60 = boundarySpend(60, predGreen, sample, WIN);
    const at70 = boundarySpend(70, predGreen, sample, WIN);
    expect(at70).toBeGreaterThan(at60);
  });
});

describe('buildBands ordering', () => {
  it('keeps amber ≥ green ≥ deep per column (in spending terms)', () => {
    const bands = buildBands(plan, config, WIN, { cols: 12, bisect: 10 });
    expect(bands.green).toHaveLength(13);
    for (let i = 0; i < bands.green.length; i++) {
      expect(bands.amber[i]).toBeGreaterThanOrEqual(bands.green[i]);
      expect(bands.deep[i]).toBeLessThanOrEqual(bands.green[i]);
    }
  });

  it('a higher market return lifts the green boundary (more ground holds)', () => {
    const bearish = buildBands({ ...plan, investmentReturn: 0.03 }, config, WIN, { cols: 8, bisect: 10 });
    const bullish = buildBands({ ...plan, investmentReturn: 0.07 }, config, WIN, { cols: 8, bisect: 10 });
    const mid = 4;
    expect(bullish.green[mid]).toBeGreaterThan(bearish.green[mid]);
  });
});

describe('axis mapping', () => {
  it('round-trips age and spend through fraction space', () => {
    expect(xFrac(55, WIN)).toBe(0);
    expect(xFrac(75, WIN)).toBe(1);
    expect(ageAtFrac(xFrac(66, WIN), WIN)).toBeCloseTo(66, 6);
    // y is inverted: top of the plot = highest spending
    expect(yFrac(WIN.spendTop, WIN)).toBe(0);
    expect(yFrac(WIN.spendBottom, WIN)).toBe(1);
    expect(spendAtFrac(yFrac(90000, WIN), WIN)).toBeCloseTo(90000, 6);
  });
});

describe('smoothPath', () => {
  const box = { left: 56, right: 700, top: 20, bottom: 432 };

  it('produces a cubic path that starts at the first point and stays in the box', () => {
    const spends = boundaryChain(predGreen, makeSample(plan, config), WIN, 12, 10);
    const d = smoothPath(spends, WIN, box);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(' C ');
    // every y coordinate is clamped inside the plot box
    const ys = [...d.matchAll(/ (-?\d+\.?\d*)(?= |$|,)/g)].map(m => parseFloat(m[1]));
    // (x,y pairs; check the y half by index — crude but effective)
    for (const m of d.matchAll(/, ?(-?\d+\.?\d*) (-?\d+\.?\d*)/g)) {
      const y = parseFloat(m[2]);
      expect(y).toBeGreaterThanOrEqual(box.top);
      expect(y).toBeLessThanOrEqual(box.bottom);
    }
    expect(ys.length).toBeGreaterThan(0);
  });

  it('degenerate flat line (all same spending) still yields a valid path', () => {
    const flat = new Array(9).fill(60000);
    const d = smoothPath(flat, WIN, box);
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain('C');
  });
});

describe('terrainKey', () => {
  it('changes when a ground input changes, not when only an axis value moves', () => {
    const base = terrainKey(plan);
    expect(terrainKey({ ...plan, investmentReturn: 0.07 })).not.toBe(base);
    expect(terrainKey({ ...plan, tfsaBalance: 900000 })).not.toBe(base);
    // retire age and spending are the axes — they move the dot, not the ground
    expect(terrainKey({ ...plan, retirementAge: 70 })).toBe(base);
    expect(terrainKey({ ...plan, desiredSpending: 99999 })).toBe(base);
  });
});

describe('engine agreement (the map tells the same truth as the verdict)', () => {
  it('the green boundary matches a direct calculateHousehold verdict flip', () => {
    // Independently: at retire 62, scan spending for the ON_TRACK→SHORTFALL flip.
    const age = 62;
    let flip: number | null = null;
    for (let s = WIN.spendBottom; s <= WIN.spendTop; s += 1000) {
      const r = calculateHousehold({ ...plan, retirementAge: age, desiredSpending: s }, config);
      if (r.status === 'SHORTFALL') { flip = s; break; }
    }
    expect(flip).not.toBeNull();
    const b = boundarySpend(age, predGreen, makeSample(plan, config), WIN);
    // boundary (bisected) should sit within one scan-step below the flip point
    expect(b).toBeGreaterThan((flip as number) - 2000);
    expect(b).toBeLessThanOrEqual((flip as number));
  });
});
