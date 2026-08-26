import { describe, it, expect } from 'vitest';
import {
  AXES, axisValue, withAxis, deterministicOutcome,
  fullBand, normalizeBand, effectiveRange, clampToBand, isLimited, renderRange, bandWithValue,
  type Band,
} from './eqConstraints';
import { testConfig, baseInputs } from '../test/helpers';

const config = testConfig();

// A lean plan that depletes early at high spending, funded at low spending.
const lean = () => baseInputs({
  currentAge: 60, retirementAge: 65, maxAge: 90,
  tfsaBalance: 150000, rrspBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
  desiredSpending: 40000, cppStartAge: null, oasStartAge: null,
});

describe('axis read/write', () => {
  it('reads and writes each axis; retirementAge is rounded to an integer', () => {
    const i = lean();
    expect(axisValue(i, 'desiredSpending')).toBe(40000);
    expect(axisValue(withAxis(i, 'desiredSpending', 50000), 'desiredSpending')).toBe(50000);
    expect(axisValue(withAxis(i, 'retirementAge', 66.7), 'retirementAge')).toBe(67);
    expect(axisValue(withAxis(i, 'investmentReturn', 0.07), 'investmentReturn')).toBeCloseTo(0.07, 9);
  });

  it('every axis is monotonic in the documented direction', () => {
    expect(AXES.desiredSpending.increasingRate).toBe(false);
    expect(AXES.retirementAge.increasingRate).toBe(true);
    expect(AXES.investmentReturn.increasingRate).toBe(true);
    expect(AXES.maxAge.increasingRate).toBe(false);
    expect(AXES.annualSavings.increasingRate).toBe(true);
    expect(AXES.returnVolatility.increasingRate).toBe(false);
    expect(AXES.cppStartAge.increasingRate).toBe(true);
  });
});

describe('derived axes', () => {
  it('annualSavings reads the total of the three contribution buckets', () => {
    const i = baseInputs({ rrspContribution: 10000, tfsaContribution: 6000, taxableContribution: 4000 });
    expect(axisValue(i, 'annualSavings')).toBe(20000);
  });

  it('annualSavings locks RRSP+TFSA and puts the rest in taxable', () => {
    // rrsp 10k + tfsa 5k = 15k locked; setting the axis to 40k adds 25k taxable.
    const i = baseInputs({ rrspContribution: 10000, tfsaContribution: 5000, taxableContribution: 5000 });
    const next = withAxis(i, 'annualSavings', 40000);
    expect(next.rrspContribution).toBe(10000); // unchanged
    expect(next.tfsaContribution).toBe(5000);  // unchanged
    expect(next.taxableContribution).toBe(25000);
    expect(axisValue(next, 'annualSavings')).toBe(40000);
  });

  it('annualSavings at the locked floor zeroes taxable; below it clamps to zero', () => {
    const i = baseInputs({ rrspContribution: 10000, tfsaContribution: 5000, taxableContribution: 9000 });
    expect(withAxis(i, 'annualSavings', 15000).taxableContribution).toBe(0);
    // Can't drag below the locked registered amount — taxable never goes negative.
    expect(withAxis(i, 'annualSavings', 5000).taxableContribution).toBe(0);
  });

  it('annualSavings round-trips exactly through the taxable account', () => {
    const i = baseInputs({ rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0 });
    const next = withAxis(i, 'annualSavings', 53333);
    expect(next.taxableContribution).toBe(53333);
    expect(axisValue(next, 'annualSavings')).toBe(53333);
    // Setting it again from a non-zero base is still exact (no scaling drift).
    expect(axisValue(withAxis(next, 'annualSavings', 21000), 'annualSavings')).toBe(21000);
  });

  it('oasStartAge reads a null start as the default 65 and writes an integer', () => {
    const i = baseInputs({ oasStartAge: null });
    expect(axisValue(i, 'oasStartAge')).toBe(65);
    expect(axisValue(withAxis(i, 'oasStartAge', 67.6), 'oasStartAge')).toBe(68);
    expect(withAxis(i, 'oasStartAge', 70).oasStartAge).toBe(70);
  });

  it('cppStartAge reads a null start as the default 65 and writes an integer', () => {
    const i = baseInputs({ cppStartAge: null });
    expect(axisValue(i, 'cppStartAge')).toBe(65);
    expect(axisValue(withAxis(i, 'cppStartAge', 62.6), 'cppStartAge')).toBe(63);
    expect(withAxis(i, 'cppStartAge', 70).cppStartAge).toBe(70);
  });

  it('maxAge and other integer axes snap to whole numbers', () => {
    const i = baseInputs({ maxAge: 95 });
    expect(axisValue(withAxis(i, 'maxAge', 97.4), 'maxAge')).toBe(97);
    expect(normalizeBand('maxAge', { min: 80.6, max: 99.2 })).toEqual({ min: 81, max: 99 });
  });
});

describe('deterministicOutcome', () => {
  it('reports depletion age and a zero ending balance when the plan runs out', () => {
    const o = deterministicOutcome(lean(), config);
    expect(o.depletionAge).not.toBeNull();
    expect(o.endingBalance).toBe(0);
    expect(o.status).toBe('SHORTFALL');
  });

  it('reports no depletion and a positive ending balance when funded', () => {
    const o = deterministicOutcome(withAxis(lean(), 'desiredSpending', 5000), config);
    expect(o.depletionAge).toBeNull();
    expect(o.endingBalance).toBeGreaterThan(0);
    expect(o.status).toBe('ON_TRACK');
  });
});

describe('bands — per-control crop range (no enable flag)', () => {
  it('fullBand spans the whole axis and is NOT limited', () => {
    expect(fullBand('desiredSpending')).toEqual({ min: 0, max: 1000000 });
    expect(fullBand('retirementAge')).toEqual({ min: 40, max: 75 });
    expect(isLimited('desiredSpending', fullBand('desiredSpending'))).toBe(false);
  });

  it('isLimited is true exactly when the crop is narrower than the axis', () => {
    expect(isLimited('desiredSpending', { min: 50000, max: 1000000 })).toBe(true); // at-least
    expect(isLimited('desiredSpending', { min: 0, max: 120000 })).toBe(true);       // at-most
    expect(isLimited('desiredSpending', { min: 50000, max: 120000 })).toBe(true);   // range
    expect(isLimited('desiredSpending', { min: 0, max: 1000000 })).toBe(false);     // full = free
  });

  it('normalizeBand clamps edges to the axis, orders them, and rounds ages', () => {
    // out-of-order + out-of-range
    expect(normalizeBand('desiredSpending', { min: 200000, max: -5000 }))
      .toEqual({ min: 0, max: 200000 });
    // ages snap to integers
    expect(normalizeBand('retirementAge', { min: 60.6, max: 70.2 }))
      .toEqual({ min: 61, max: 70 });
  });

  it('effectiveRange is the axis range when undefined, else the normalized crop', () => {
    expect(effectiveRange('desiredSpending', undefined)).toEqual({ min: 0, max: 1000000 });
    expect(effectiveRange('desiredSpending', fullBand('desiredSpending'))).toEqual({ min: 0, max: 1000000 });
    const band: Band = { min: 50000, max: 120000 };
    expect(effectiveRange('desiredSpending', band)).toEqual({ min: 50000, max: 120000 });
  });

  it('clampToBand holds the value inside the crop (at-least and at-most)', () => {
    const band: Band = { min: 60000, max: 120000 };
    // at-most: drag above the ceiling clamps down
    expect(clampToBand('desiredSpending', band, 200000)).toBe(120000);
    // at-least: drag below the floor clamps up
    expect(clampToBand('desiredSpending', band, 10000)).toBe(60000);
    // inside the crop passes through
    expect(clampToBand('desiredSpending', band, 90000)).toBe(90000);
    // a full-axis crop constrains nothing
    expect(clampToBand('desiredSpending', fullBand('desiredSpending'), 200000)).toBe(200000);
    expect(clampToBand('desiredSpending', fullBand('desiredSpending'), 2000000)).toBe(1000000);
  });

  it('clampToBand rounds retirement-age values to integers', () => {
    const band: Band = { min: 60, max: 70 };
    expect(clampToBand('retirementAge', band, 65.6)).toBe(66);
    expect(clampToBand('retirementAge', band, 55)).toBe(60);
  });
});

describe('renderRange — adapting the axis to the plan', () => {
  it('is the axis range when the value fits', () => {
    expect(renderRange('desiredSpending', 100000)).toEqual({ min: 0, max: 1000000 });
    expect(renderRange('desiredSpending', 1000000)).toEqual({ min: 0, max: 1000000 });
    expect(renderRange('retirementAge', 65)).toEqual({ min: 40, max: 75 });
  });

  it('grows by whole-axis steps until the value fits', () => {
    // spending axis is 0..1000000 (base 1M). $1.2M needs one extra step → 2M.
    expect(renderRange('desiredSpending', 1200000)).toEqual({ min: 0, max: 2000000 });
    // Just past the max needs one step.
    expect(renderRange('desiredSpending', 1000001)).toEqual({ min: 0, max: 2000000 });
    // Exactly at a grown boundary doesn't grow further.
    expect(renderRange('desiredSpending', 1000000)).toEqual({ min: 0, max: 1000000 });
  });

  it('floors retirement age at the plan current age', () => {
    expect(renderRange('retirementAge', 63, baseInputs({ currentAge: 55 }))).toEqual({ min: 55, max: 75 });
    // Current age below the generic axis min leaves the axis min in place.
    expect(renderRange('retirementAge', 63, baseInputs({ currentAge: 30 }))).toEqual({ min: 40, max: 75 });
  });

  it('floors annual savings at the locked RRSP+TFSA contributions', () => {
    const inputs = baseInputs({ rrspContribution: 12000, tfsaContribution: 6000 });
    expect(renderRange('annualSavings', 30000, inputs)).toEqual({ min: 18000, max: 500000 });
  });

  it('never grows the minimum below the axis min', () => {
    expect(renderRange('desiredSpending', -5000).min).toBe(0);
    expect(renderRange('cppStartAge', 30).min).toBe(60);
  });
});

describe('bandWithValue — the crop frames the value', () => {
  it('extends the max edge when the value lands above the crop', () => {
    // The Image #53 case: retirement age dragged to 63 with a crop of 49..60.
    expect(bandWithValue('retirementAge', { min: 49, max: 60 }, 63))
      .toEqual({ min: 49, max: 63 });
  });

  it('extends the min edge when the value lands below the crop', () => {
    expect(bandWithValue('retirementAge', { min: 49, max: 60 }, 45))
      .toEqual({ min: 45, max: 60 });
  });

  it('is a no-op when the value is already inside the crop', () => {
    const band: Band = { min: 49, max: 60 };
    expect(bandWithValue('retirementAge', band, 55)).toEqual(band);
    expect(bandWithValue('retirementAge', band, 49)).toEqual(band);
    expect(bandWithValue('retirementAge', band, 60)).toEqual(band);
  });

  it('rounds extended edges on integer axes and never leaves the axis', () => {
    expect(bandWithValue('retirementAge', { min: 49, max: 60 }, 63.4))
      .toEqual({ min: 49, max: 63 });
    // Value beyond the axis clamps to the axis max.
    expect(bandWithValue('retirementAge', { min: 49, max: 60 }, 99))
      .toEqual({ min: 49, max: 75 });
  });
});
