import { describe, it, expect } from 'vitest';
import {
  donationCredit,
  calculateTax,
  findGrossIncomeForTakeHome,
  gisAnnual,
  gisAnnualCouple,
  calculateRrifMinimum,
  isRrifMandatory,
  oasAnnualGross,
  oasDeferralMultiplier,
  indexConfig,
} from './canadianTax';
import { cppAdjustmentMultiplier } from './retirementEngine';
import { testConfig, closeTo } from '../test/helpers';

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

describe('basic personal amount credit (T-02)', () => {
  // taxOnTable credits the exemption at the table's FIRST rate. CRA computes
  // non-refundable credits at the LOWEST rate of each jurisdiction — federally
  // the credit rate is legislated to track the bottom marginal rate (ITA
  // 117(2)(a); 14% for 2026 under the Tax Cut for All Canadians Act), and
  // provinces use the same model (Form 428). So every shipped table must list
  // its lowest rate first; if a future table edit breaks that ordering, the
  // exemption credit silently misprices every income level.
  it('every shipped table lists its lowest rate first (the credit rate)', () => {
    expect(config.federal.rates[0]).toBe(Math.min(...config.federal.rates));
    for (const table of Object.values(config.provinces)) {
      expect(table.rates[0]).toBe(Math.min(...table.rates));
    }
  });

  it('federal exemption credit equals exemption × lowest rate (hand-computed, 2026)', () => {
    // 100_000 gross, federal only (unknown province → no provincial tax):
    // raw = 58_523×0.14 + (100_000−58_523)×0.205 = 16_696.005
    // credit = 16_452×0.14 = 2_303.28 → tax 14_392.725
    const t = calculateTax(100000, 'ZZ', config);
    expect(closeTo(t.federalTax, 14392.725, 0.01)).toBe(true);
    // Crediting at any other bracket rate would land far from this value.
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

  it('minimum grows with age (older retirees draw a larger share)', () => {
    const balance = 100000;
    const younger = calculateRrifMinimum(72, balance, config);
    const older = calculateRrifMinimum(85, balance, config);
    expect(older).toBeGreaterThan(younger);
  });
});

describe('findGrossIncomeForTakeHome (reverse-tax solver)', () => {
  it('round-trips calculateTax across the bracket range', () => {
    for (const take of [15000, 42000, 80000, 150000]) {
      const gross = findGrossIncomeForTakeHome(take, 'ONT', config);
      expect(closeTo(calculateTax(gross, 'ONT', config).takeHome, take, 1)).toBe(true);
    }
  });

  it('returns 0 for a 0 target and stays monotonic in the target', () => {
    expect(findGrossIncomeForTakeHome(0, 'ONT', config)).toBe(0);
    let prev = -1;
    for (const take of [10000, 30000, 60000, 120000]) {
      const g = findGrossIncomeForTakeHome(take, 'ONT', config);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
  });

  it('works in every supported province', () => {
    for (const code of Object.keys(config.provinces)) {
      const gross = findGrossIncomeForTakeHome(50000, code, config);
      expect(Number.isFinite(gross)).toBe(true);
      expect(closeTo(calculateTax(gross, code, config).takeHome, 50000, 1)).toBe(true);
    }
  });

  it('never hangs on a pathological config with a ≥100% marginal rate (E-05 / #28)', () => {
    // The upper-bound expansion loop used to be unbounded: with a user-edited
    // table whose marginal rate is ≥ 100%, takeHome never rises, so the bound
    // was never bracketed and the loop spun forever. The cap must make it
    // terminate and return a finite (if meaningless) number instead of hanging.
    const flat100 = { brackets: [], rates: [1], exemption: 0 };
    const broken = {
      ...config,
      federal: flat100,
      provinces: { ...config.provinces, ONT: flat100 },
    };
    const gross = findGrossIncomeForTakeHome(50000, 'ONT', broken);
    expect(Number.isFinite(gross)).toBe(true);
  });
});

describe('oasDeferralMultiplier', () => {
  it('is 1.0 at 65 and climbs 0.6%/month to +36% at 70', () => {
    expect(closeTo(oasDeferralMultiplier(65, config), 1, 9)).toBe(true);
    expect(closeTo(oasDeferralMultiplier(70, config), 1.36, 6)).toBe(true);
    // One year of deferral = +7.2%.
    expect(closeTo(oasDeferralMultiplier(66, config), 1.072, 6)).toBe(true);
  });

  it('does not reward deferring past 70', () => {
    expect(closeTo(oasDeferralMultiplier(72, config), 1.36, 6)).toBe(true);
  });
});

describe('oasAnnualGross', () => {
  it('prorates by residency years/40', () => {
    const full = oasAnnualGross(65, 65, 40, config);
    expect(closeTo(oasAnnualGross(65, 65, 20, config), full / 2, 1)).toBe(true);
  });

  it('applies the deferral multiplier to the annual amount', () => {
    const at65 = oasAnnualGross(70, 65, 40, config);   // started at 65
    const deferred = oasAnnualGross(70, 70, 40, config); // deferred to 70
    expect(deferred).toBeGreaterThan(at65);
  });

  it('is zero before the start age and below the residency floor', () => {
    expect(oasAnnualGross(64, 65, 40, config)).toBe(0);
    expect(oasAnnualGross(65, 65, 5, config)).toBe(0);
  });

  it('pro-rating and deferral compose: partial residency still defers (T-03)', () => {
    // 20 years' residency (half pension) deferred to 70 (+36%): the residency
    // fraction applies to the whole deferred amount — (20/40) × 742.31 ×
    // 1.36 × 12 — never the full pension, and the deferral is not lost.
    const partial = oasAnnualGross(70, 70, 20, config);
    expect(closeTo(partial, 6057.25, 1)).toBe(true);
    expect(closeTo(partial, oasAnnualGross(70, 70, 40, config) / 2, 1)).toBe(true);
  });
});

describe('indexConfig (full-table scaling)', () => {
  const F = 1.05;
  const idx = indexConfig(config, F);

  it('scales federal brackets, rates stay fixed, exemption scales', () => {
    expect(closeTo(idx.federal.brackets[0], config.federal.brackets[0] * F, 0.01)).toBe(true);
    expect(idx.federal.rates).toEqual(config.federal.rates); // rates are not indexed
    expect(closeTo(idx.federal.exemption, config.federal.exemption * F, 0.01)).toBe(true);
  });

  it('scales every province table', () => {
    for (const code of Object.keys(config.provinces)) {
      expect(closeTo(idx.provinces[code].exemption, config.provinces[code].exemption * F, 0.01)).toBe(true);
      expect(closeTo(idx.provinces[code].brackets[0], config.provinces[code].brackets[0] * F, 0.01)).toBe(true);
    }
  });

  it('scales OAS base amounts, clawback threshold and both GIS maxima', () => {
    expect(closeTo(idx.oas.baseMonthly65to74, config.oas.baseMonthly65to74 * F, 0.01)).toBe(true);
    expect(closeTo(idx.oas.clawbackThreshold, config.oas.clawbackThreshold * F, 0.01)).toBe(true);
    expect(closeTo(idx.oas.gisMaxAnnualSingle, config.oas.gisMaxAnnualSingle * F, 0.01)).toBe(true);
    expect(closeTo(idx.oas.gisMaxAnnualCouple, config.oas.gisMaxAnnualCouple * F, 0.01)).toBe(true);
  });

  it('scales the Ontario surtax thresholds', () => {
    expect(closeTo(idx.ontarioSurtax.threshold1, config.ontarioSurtax.threshold1 * F, 0.01)).toBe(true);
    expect(closeTo(idx.ontarioSurtax.threshold2, config.ontarioSurtax.threshold2 * F, 0.01)).toBe(true);
  });

  it('factor of 1 returns the config unchanged (no-op)', () => {
    expect(indexConfig(config, 1)).toBe(config);
  });
});

// ---- Charitable donation tax credit (issue #164) ---------------------------
// Rates: federal 14% on the first $200, then 29%/33% over the $258,482 top
// bracket (https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html);
// provincial donation rates from https://www.taxtips.ca/filing/donations/tax-credit-rates-2026.htm.
describe('donationCredit (line 34900/34990, issue #164)', () => {
  it('$1,000 gift at $100k income: federal = 200×14% + 800×29%', () => {
    const r = donationCredit(1000, 100000, 'ONT', config);
    expect(closeTo(r.federal, 260, 0.01)).toBe(true);
  });

  it('provincial credit matches each province\'s published 2026 donation rates', () => {
    // total = first-band×first-rate + 800×over-rate (income < every top bracket).
    const prov = {
      ONT: 99.38, BC: 145.60, AB: 288.00, MB: 160.80, SK: 137.00, NS: 185.58,
      NB: 162.40, NL: 191.80, PE: 171.00, YT: 115.20, NT: 124.20, NU: 100.00, QC: 232.00,
    };
    for (const [code, want] of Object.entries(prov)) {
      expect(closeTo(donationCredit(1000, 100000, code, config).provincial, want, 0.01)).toBe(true);
    }
  });

  it('Quebec federal credit is abated (×(1−16.5%)), provincial is not', () => {
    const r = donationCredit(1000, 100000, 'QC', config);
    expect(closeTo(r.federal, 260 * (1 - config.qcFederalAbatement), 0.01)).toBe(true); // 217.10
    expect(closeTo(r.provincial, 232, 0.01)).toBe(true);
    expect(closeTo(r.total, 449.10, 0.01)).toBe(true);
  });

  it('top tier (33%/QC 25.75%) applies to the excess above the top bracket', () => {
    // Income $400k > federal top bracket $258,482: the whole $800 above the
    // $200 band is in the top tier → 28 + 800×0.33 = 292.
    expect(closeTo(donationCredit(1000, 400000, 'ONT', config).federal, 292, 0.01)).toBe(true);
    // BC top bracket $265,545 → donation top rate 20.5% for the excess.
    expect(closeTo(donationCredit(1000, 400000, 'BC', config).provincial, 11.20 + 800 * 0.205, 0.01)).toBe(true); // 175.20
    // QC top donation rate 25.75%; federal still abated.
    const qc = donationCredit(1000, 400000, 'QC', config);
    expect(closeTo(qc.provincial, 40 + 800 * 0.2575, 0.01)).toBe(true); // 246
    expect(closeTo(qc.federal, (28 + 800 * 0.33) * (1 - 0.165), 0.01)).toBe(true); // 243.82
  });

  it('the $200 first band rides the LOW rate even at high income', () => {
    // $50k gift on $150k income (under the $258,482 top bracket, under both
    // the 75% claim cap and the non-refundable clamp): the first $200 rides
    // 14%, everything above rides 29%.
    const r = donationCredit(50000, 150000, 'ONT', config);
    expect(closeTo(r.federal, 28 + 49800 * 0.29, 0.01)).toBe(true);
  });

  it('claims are capped at 75% of income', () => {
    // $180k gift on $200k income → only $150k claimable.
    const r = donationCredit(180000, 200000, 'ONT', config);
    const capped = donationCredit(150000, 200000, 'ONT', config);
    expect(closeTo(r.total, capped.total, 0.01)).toBe(true);
  });

  it('Quebec is exempt from the 75% claim cap', () => {
    // Revenu Québec: no 75% limit. A gift ≥ full tax still only clamps at the
    // tax payable, not at 75% of income.
    const r = donationCredit(180000, 200000, 'QC', config);
    const tax = calculateTax(200000, 'QC', config);
    expect(closeTo(r.total, tax.totalTax, 0.01)).toBe(true); // clamped at tax, above the 75% line
    expect(r.total).toBeGreaterThan(donationCredit(150000, 200000, 'QC', config).total);
  });

  it('non-refundable: credit never exceeds tax payable, each level separately', () => {
    const r = donationCredit(100000, 50000, 'ONT', config);
    const tax = calculateTax(50000, 'ONT', config);
    expect(r.federal).toBe(tax.federalTax);
    expect(r.provincial).toBe(tax.provincialTax);
    expect(r.total).toBe(tax.totalTax);
  });

  it('unknown province code: federal credit only', () => {
    const r = donationCredit(1000, 100000, 'ZZ', config);
    expect(r.federal).toBe(260);
    expect(r.provincial).toBe(0);
  });

  it('zero or negative donation/income produce zero credit', () => {
    expect(donationCredit(0, 100000, 'ONT', config).total).toBe(0);
    expect(donationCredit(-500, 100000, 'ONT', config).total).toBe(0);
    expect(donationCredit(1000, 0, 'ONT', config).total).toBe(0);
  });
});
