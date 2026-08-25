import { describe, it, expect } from 'vitest';
import {
  calculateTax,
  gisAnnual,
  gisAnnualCouple,
  calculateRrifMinimum,
  isRrifMandatory,
} from './canadianTax';
import { cppAdjustmentMultiplier } from './retirementEngine';
import { testConfig } from '../test/helpers';

const config = testConfig();
const S = config.oas.gisMaxAnnualSingle;   // 13478
const C = config.oas.gisMaxAnnualCouple;   // 8113
const RATE = config.oas.gisReductionRate;  // 0.5

describe('calculateTax', () => {
  it('returns zero tax on zero income', () => {
    const t = calculateTax(0, 'ONT', config);
    expect(t.totalTax).toBe(0);
    expect(t.takeHome).toBe(0);
  });

  it('income under both basic exemptions is untaxed', () => {
    // Federal and provincial basic personal amounts differ — income at or
    // below the smaller of the two is untaxed in that province.
    const floor = Math.min(config.federal.exemption, config.provinces.ONT.exemption);
    const t = calculateTax(floor, 'ONT', config);
    expect(t.totalTax).toBe(0);
    expect(t.takeHome).toBe(floor);
  });

  it('take-home is income minus tax', () => {
    const income = 80000;
    const t = calculateTax(income, 'ONT', config);
    expect(t.takeHome).toBeCloseTo(income - t.totalTax, 6);
    expect(t.totalTax).toBeGreaterThan(0);
  });

  it('higher income pays strictly more tax (monotonic brackets)', () => {
    let prev = -1;
    for (const income of [20000, 40000, 60000, 100000, 200000]) {
      const t = calculateTax(income, 'ONT', config).totalTax;
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it('every supported province computes a finite, non-negative tax', () => {
    for (const code of Object.keys(config.provinces)) {
      const t = calculateTax(75000, code, config);
      expect(Number.isFinite(t.totalTax)).toBe(true);
      expect(t.totalTax).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('gisAnnual (single)', () => {
  it('pays the full amount at zero income', () => {
    expect(gisAnnual(0, config)).toBe(S);
  });

  it('reduces 50 cents per dollar of non-OAS income', () => {
    expect(gisAnnual(10000, config)).toBeCloseTo(S - 10000 * RATE, 6);
  });

  it('phases out to zero at max / rate', () => {
    expect(gisAnnual(S / RATE, config)).toBe(0);
    expect(gisAnnual(S / RATE + 1, config)).toBe(0);
  });

  it('never goes negative and ignores negative income', () => {
    expect(gisAnnual(-5000, config)).toBe(S);
    expect(gisAnnual(999999, config)).toBe(0);
  });
});

describe('gisAnnualCouple', () => {
  it('both on OAS, zero income → couple max each', () => {
    expect(gisAnnualCouple(0, 0, true, config)).toBe(C);
  });

  it('only one on OAS, zero income → single max', () => {
    expect(gisAnnualCouple(0, 0, false, config)).toBe(S);
  });

  it('couple max is below the single max (CRA ratio)', () => {
    expect(C).toBeLessThan(S);
  });

  it('reduces on COMBINED income at the couple rate', () => {
    expect(gisAnnualCouple(0, 10000, true, config)).toBeCloseTo(C - 10000 * RATE, 6);
  });

  it('own registered draws stack on top of combined fixed income', () => {
    expect(gisAnnualCouple(4000, 10000, true, config)).toBeCloseTo(C - 14000 * RATE, 6);
  });

  it('couple phases out at the combined threshold', () => {
    expect(gisAnnualCouple(0, C / RATE, true, config)).toBe(0);
  });

  it('single-rate (partner without OAS) phases out at the higher threshold', () => {
    expect(gisAnnualCouple(0, S / RATE, false, config)).toBe(0);
  });
});

describe('cppAdjustmentMultiplier', () => {
  it('is 1.0 at 65', () => {
    expect(cppAdjustmentMultiplier(65, config)).toBeCloseTo(1, 9);
  });

  it('floors at −36% at 60', () => {
    expect(cppAdjustmentMultiplier(60, config)).toBeCloseTo(0.64, 6);
  });

  it('caps at +42% at 70', () => {
    expect(cppAdjustmentMultiplier(70, config)).toBeCloseTo(1.42, 6);
  });

  it('clamps ages outside 60–70', () => {
    expect(cppAdjustmentMultiplier(55, config)).toBeCloseTo(0.64, 6);
    expect(cppAdjustmentMultiplier(75, config)).toBeCloseTo(1.42, 6);
  });
});

describe('RRIF minimums', () => {
  it('is not mandatory before the conversion age', () => {
    expect(isRrifMandatory(64, config)).toBe(false);
  });

  it('is mandatory at and after the conversion age', () => {
    const age = config.engine.rrifConversionAge;
    expect(isRrifMandatory(age, config)).toBe(true);
    expect(isRrifMandatory(age + 10, config)).toBe(true);
  });

  it('minimum is balance × the rate for that age', () => {
    const age = config.engine.rrifConversionAge;
    const balance = 100000;
    const min = calculateRrifMinimum(age, balance, config);
    expect(min).toBeGreaterThan(0);
    expect(min).toBeLessThan(balance);
  });
});
