// Plan sweep for the corpus generator. Each NamedScenario is a valid
// RetirementInputs (built on the shared baseInputs fixture) plus a name, so the
// minter can run the REAL engine across a spread of Canadian retirement
// situations — provinces, account mixes, ages, pensions — instead of one plan.
//
// Field pitfalls respected (CLAUDE.md): province codes are 'ONT'-style (never
// 'ON'); cppStartAge/oasStartAge are explicit null when unset; structural
// blocks (income/events/spouse) are added whole, never as flat overrides.

import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import { baseInputs } from '@retired/engine-core/test/helpers';

export interface NamedScenario {
  id: string;
  name: string;
  inputs: RetirementInputs;
}

const s = (id: string, name: string, overrides: Parameters<typeof baseInputs>[0]): NamedScenario =>
  ({ id, name, inputs: baseInputs(overrides) });

/** The sweep. Deliberately varied so the model sees the space, not one plan. */
export const SCENARIOS: NamedScenario[] = [
  s('on-track-single', 'On-track single (TFSA-heavy)', {
    currentAge: 60, retirementAge: 65, maxAge: 95,
    rrspBalance: 250000, tfsaBalance: 180000, taxableBalance: 40000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 52000, provinceCode: 'ONT',
  }),
  s('rrsp-heavy', 'RRSP-heavy meltdown risk', {
    currentAge: 62, retirementAge: 65, maxAge: 95,
    rrspBalance: 900000, tfsaBalance: 60000, taxableBalance: 0,
    cppStartAge: 65, cppMonthlyAmount: 1100, oasStartAge: 67, oasYearsInCanada: 40,
    desiredSpending: 68000, provinceCode: 'ONT',
  }),
  s('early-retire-qc', 'Early retiree Quebec', {
    currentAge: 55, retirementAge: 55, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 120000, taxableBalance: 80000,
    cppStartAge: 60, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 46000, provinceCode: 'QC',
  }),
  s('db-pension', 'Defined-benefit pension', {
    currentAge: 60, retirementAge: 60, maxAge: 95,
    rrspBalance: 300000, tfsaBalance: 90000, taxableBalance: 20000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 58000, provinceCode: 'BC',
    income: [{
      id: 'db1', label: 'Work DB', kind: 'pension',
      annualAmount: 24000, startAge: 60, endAge: null, indexedToCpi: true,
    }],
  }),
  s('shortfall', 'Lean plan (shortfall)', {
    currentAge: 65, retirementAge: 65, maxAge: 95,
    rrspBalance: 120000, tfsaBalance: 30000, taxableBalance: 0,
    cppStartAge: 65, cppMonthlyAmount: 700, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 44000, provinceCode: 'MB',
  }),
  s('gis-sensitive', 'Low-income GIS-sensitive', {
    currentAge: 65, retirementAge: 66, maxAge: 95,
    rrspBalance: 60000, tfsaBalance: 40000, taxableBalance: 0,
    cppStartAge: 65, cppMonthlyAmount: 600, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 28000, provinceCode: 'ONT',
  }),
  s('ab-high-earner', 'Alberta high earner', {
    currentAge: 50, retirementAge: 60, maxAge: 95,
    rrspBalance: 350000, tfsaBalance: 95000, taxableBalance: 120000,
    rrspContribution: 20000, tfsaContribution: 7000,
    cppStartAge: 65, cppMonthlyAmount: 1300, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 90000, provinceCode: 'AB',
  }),
  // --- extended sweep: more provinces, ages, account mixes, benefit timings ---
  s('ns-modest', 'Nova Scotia modest', {
    currentAge: 63, retirementAge: 65, maxAge: 92,
    rrspBalance: 180000, tfsaBalance: 70000, taxableBalance: 10000,
    cppStartAge: 65, cppMonthlyAmount: 900, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 42000, provinceCode: 'NS',
  }),
  s('sk-late-cpp', 'Saskatchewan late CPP', {
    currentAge: 66, retirementAge: 66, maxAge: 95,
    rrspBalance: 420000, tfsaBalance: 110000, taxableBalance: 0,
    cppStartAge: 70, cppMonthlyAmount: 1200, oasStartAge: 70, oasYearsInCanada: 40,
    desiredSpending: 60000, provinceCode: 'SK',
  }),
  s('nb-early-cpp', 'New Brunswick early CPP', {
    currentAge: 60, retirementAge: 62, maxAge: 90,
    rrspBalance: 220000, tfsaBalance: 40000, taxableBalance: 30000,
    cppStartAge: 60, cppMonthlyAmount: 750, oasStartAge: 65, oasYearsInCanada: 35,
    desiredSpending: 44000, provinceCode: 'NB',
  }),
  s('pei-lean', 'PEI lean plan', {
    currentAge: 65, retirementAge: 65, maxAge: 92,
    rrspBalance: 90000, tfsaBalance: 55000, taxableBalance: 0,
    cppStartAge: 65, cppMonthlyAmount: 650, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 32000, provinceCode: 'PEI',
  }),
  s('nl-taxable-heavy', 'Newfoundland taxable-heavy', {
    currentAge: 58, retirementAge: 63, maxAge: 95,
    rrspBalance: 150000, tfsaBalance: 60000, taxableBalance: 300000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 66000, provinceCode: 'NL',
  }),
  s('yt-north', 'Yukon northern', {
    currentAge: 60, retirementAge: 65, maxAge: 95,
    rrspBalance: 280000, tfsaBalance: 85000, taxableBalance: 20000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 54000, provinceCode: 'YT',
  }),
  s('nt-north', 'NWT northern', {
    currentAge: 61, retirementAge: 65, maxAge: 95,
    rrspBalance: 260000, tfsaBalance: 75000, taxableBalance: 15000,
    cppStartAge: 65, cppMonthlyAmount: 980, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 52000, provinceCode: 'NT',
  }),
  s('nu-north', 'Nunavut northern', {
    currentAge: 62, retirementAge: 65, maxAge: 95,
    rrspBalance: 240000, tfsaBalance: 70000, taxableBalance: 10000,
    cppStartAge: 65, cppMonthlyAmount: 950, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 50000, provinceCode: 'NU',
  }),
  s('mb-cash-cushion', 'Manitoba cash cushion', {
    currentAge: 64, retirementAge: 65, maxAge: 95,
    rrspBalance: 320000, tfsaBalance: 90000, taxableBalance: 40000, cashCushionBalance: 60000,
    cppStartAge: 65, cppMonthlyAmount: 1050, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 56000, provinceCode: 'MB',
  }),
  s('bc-delay-oas', 'BC delayed OAS', {
    currentAge: 65, retirementAge: 66, maxAge: 95,
    rrspBalance: 380000, tfsaBalance: 120000, taxableBalance: 50000,
    cppStartAge: 66, cppMonthlyAmount: 1100, oasStartAge: 68, oasYearsInCanada: 40,
    desiredSpending: 62000, provinceCode: 'BC',
  }),
  s('on-employment', 'Ontario part-time work', {
    currentAge: 60, retirementAge: 65, maxAge: 95,
    rrspBalance: 300000, tfsaBalance: 100000, taxableBalance: 30000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 55000, provinceCode: 'ONT',
    income: [{
      id: 'pt1', label: 'Part-time consulting', kind: 'employment',
      annualAmount: 15000, startAge: 65, endAge: 70, indexedToCpi: false,
    }],
  }),
  s('qc-high-spend', 'Quebec high spender', {
    currentAge: 55, retirementAge: 60, maxAge: 95,
    rrspBalance: 600000, tfsaBalance: 150000, taxableBalance: 200000,
    rrspContribution: 25000, tfsaContribution: 7000,
    cppStartAge: 65, cppMonthlyAmount: 1250, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 100000, provinceCode: 'QC',
  }),
  // --- coupled + structural households: teach the model to read a PERSON, not ---
  // --- just a set of balances (spouse, reverse mortgage, RDSP, spending bands) ---
  s('couple-ont', 'Couple, both retiring (Ontario)', {
    currentAge: 62, retirementAge: 65, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 120000, taxableBalance: 60000,
    cppStartAge: 65, cppMonthlyAmount: 1100, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 62000, provinceCode: 'ONT',
    spouse: {
      enabled: true, currentAge: 60, retirementAge: 63,
      rrspBalance: 250000, tfsaBalance: 90000, taxableBalance: 30000,
      cashCushionBalance: 0, rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 900, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 30000,
    },
  }),
  s('couple-age-gap', 'Couple with an age gap (BC)', {
    currentAge: 65, retirementAge: 66, maxAge: 95,
    rrspBalance: 500000, tfsaBalance: 100000, taxableBalance: 80000,
    cppStartAge: 66, cppMonthlyAmount: 1200, oasStartAge: 67, oasYearsInCanada: 40,
    desiredSpending: 70000, provinceCode: 'BC',
    spouse: {
      enabled: true, currentAge: 55, retirementAge: 60,
      rrspBalance: 150000, tfsaBalance: 60000, taxableBalance: 20000,
      cashCushionBalance: 0, rrspContribution: 8000, tfsaContribution: 5000, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 38,
      desiredSpending: 35000,
    },
  }),
  s('reverse-mortgage', 'House-rich, cash-poor (reverse mortgage)', {
    currentAge: 70, retirementAge: 70, maxAge: 95,
    rrspBalance: 80000, tfsaBalance: 50000, taxableBalance: 10000,
    cppStartAge: 65, cppMonthlyAmount: 950, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 46000, provinceCode: 'ONT',
    reverseMortgage: {
      enabled: true, homeValue: 850000, appreciationRate: 0.02, interestRate: 0.065,
      drawAmount: 12000, startAge: 72, durationYears: 15,
    },
  }),
  s('rdsp-family', 'Family with an RDSP beneficiary', {
    currentAge: 58, retirementAge: 63, maxAge: 95,
    rrspBalance: 350000, tfsaBalance: 100000, taxableBalance: 40000,
    cppStartAge: 65, cppMonthlyAmount: 1050, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 58000, provinceCode: 'MB',
    rdsp: { enabled: true, balance: 60000, contribution: 1500, familyIncome: 38000 },
  }),
  // Debt-carrying household: a mortgage plus a consumer card, both serviced out
  // of spending. Teaches the model to read debts as a drag on the plan, not just
  // balances. The mortgage runs to payoff; the card is high-rate consumer debt.
  s('debt-carrying', 'Mortgage + credit-card debt', {
    currentAge: 60, retirementAge: 65, maxAge: 95,
    rrspBalance: 320000, tfsaBalance: 85000, taxableBalance: 25000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 58000, provinceCode: 'ONT',
    debts: [
      { id: 'mort1', label: 'Mortgage', kind: 'mortgage', balance: 400000, interestRate: 0.051, monthlyPayment: 2400 },
      { id: 'cc1', label: 'Credit card', kind: 'creditCard', balance: 18000, interestRate: 0.199, monthlyPayment: 600 },
    ],
  }),
  s('spending-bands', 'Go-go / slow-go / no-go spending phases', {
    currentAge: 60, retirementAge: 62, maxAge: 95,
    rrspBalance: 550000, tfsaBalance: 130000, taxableBalance: 70000,
    cppStartAge: 65, cppMonthlyAmount: 1150, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 72000, provinceCode: 'AB',
    spendingBands: [
      { fromAge: 62, pctOfBase: 1.0 },
      { fromAge: 75, pctOfBase: 0.85 },
      { fromAge: 85, pctOfBase: 0.7 },
    ],
  }),
  // --- bake-off/corpus scale-out: every edge-of-envelope cell from the sweep ---
  // (ages 50/55/60/65/70/75 × provinces × account-mix halves + new structural
  // shapes the sweep was missing: FHSA-enabled, OAS-claw-band, 2-debt, 3-debt,
  // shallow-spouse, single-wide-spouse).
  s('qc-50-late', 'Quebec 50, retiring late', {
    currentAge: 50, retirementAge: 65, maxAge: 95,
    rrspBalance: 250000, tfsaBalance: 70000, taxableBalance: 30000,
    cppStartAge: 65, cppMonthlyAmount: 900, oasStartAge: 65, oasYearsInCanada: 38,
    desiredSpending: 52000, provinceCode: 'QC',
  }),
  s('ab-55-lean', 'Alberta 55, lean plan', {
    currentAge: 55, retirementAge: 65, maxAge: 95,
    rrspBalance: 180000, tfsaBalance: 60000, taxableBalance: 0,
    cppStartAge: 65, cppMonthlyAmount: 850, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 42000, provinceCode: 'AB',
  }),
  s('on-70-late-cpp', 'Ontario 70, deferred CPP', {
    currentAge: 70, retirementAge: 70, maxAge: 95,
    rrspBalance: 300000, tfsaBalance: 100000, taxableBalance: 40000,
    cppStartAge: 71, cppMonthlyAmount: 1000, oasStartAge: 70, oasYearsInCanada: 42,
    desiredSpending: 52000, provinceCode: 'ONT',
  }),
  s('bc-75-still-working', 'BC 75, still drawing', {
    currentAge: 75, retirementAge: 75, maxAge: 95,
    rrspBalance: 200000, tfsaBalance: 120000, taxableBalance: 60000,
    cppStartAge: 75, cppMonthlyAmount: 1100, oasStartAge: 70, oasYearsInCanada: 45,
    desiredSpending: 48000, provinceCode: 'BC',
  }),
  s('ns-50-early', 'Nova Scotia 50, early-retire', {
    currentAge: 50, retirementAge: 58, maxAge: 95,
    rrspBalance: 220000, tfsaBalance: 80000, taxableBalance: 20000,
    cppStartAge: 60, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 40000, provinceCode: 'NS',
  }),
  s('sk-55-taxable-half', 'Saskatchewan 55, taxable-heavy half', {
    currentAge: 55, retirementAge: 62, maxAge: 95,
    rrspBalance: 150000, tfsaBalance: 50000, taxableBalance: 220000,
    cppStartAge: 65, cppMonthlyAmount: 900, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 50000, provinceCode: 'SK',
  }),
  s('on-60-taxable-heavy', 'Ontario 60, taxable-heavy', {
    currentAge: 60, retirementAge: 65, maxAge: 95,
    rrspBalance: 100000, tfsaBalance: 60000, taxableBalance: 400000,
    cppStartAge: 65, cppMonthlyAmount: 1050, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 70000, provinceCode: 'ONT',
  }),
  s('pei-70-cash', 'PEI 70, cash-cushioned', {
    currentAge: 70, retirementAge: 70, maxAge: 95,
    rrspBalance: 180000, tfsaBalance: 80000, taxableBalance: 20000, cashCushionBalance: 50000,
    cppStartAge: 65, cppMonthlyAmount: 950, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 46000, provinceCode: 'PEI',
  }),
  s('ab-75-rrif-heavy', 'Alberta 75, RRIF-heavy', {
    currentAge: 75, retirementAge: 72, maxAge: 95,
    rrspBalance: 600000, tfsaBalance: 90000, taxableBalance: 30000,
    cppStartAge: 65, cppMonthlyAmount: 1100, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 68000, provinceCode: 'AB',
  }),
  s('qc-50-high', 'Quebec 50, high balances', {
    currentAge: 50, retirementAge: 60, maxAge: 95,
    rrspBalance: 600000, tfsaBalance: 150000, taxableBalance: 200000,
    rrspContribution: 25000, tfsaContribution: 8000,
    cppStartAge: 65, cppMonthlyAmount: 1200, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 90000, provinceCode: 'QC',
  }),
  s('on-55-debt-two', 'Ontario 55, 2-debt family', {
    currentAge: 55, retirementAge: 62, maxAge: 95,
    rrspBalance: 320000, tfsaBalance: 90000, taxableBalance: 30000,
    cppStartAge: 65, cppMonthlyAmount: 950, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 56000, provinceCode: 'ONT',
    debts: [
      { id: 'mort1', label: 'Mortgage', kind: 'mortgage', balance: 320000, interestRate: 0.055, monthlyPayment: 1800 },
      { id: 'car1', label: 'Car loan', kind: 'other', balance: 28000, interestRate: 0.07, monthlyPayment: 500 },
    ],
  }),
  s('on-55-debt-three', 'Ontario 55, 3-debt (mort+car+card)', {
    currentAge: 55, retirementAge: 65, maxAge: 95,
    rrspBalance: 280000, tfsaBalance: 70000, taxableBalance: 25000,
    cppStartAge: 65, cppMonthlyAmount: 980, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 54000, provinceCode: 'ONT',
    debts: [
      { id: 'mort1', label: 'Mortgage', kind: 'mortgage', balance: 380000, interestRate: 0.051, monthlyPayment: 2200 },
      { id: 'car1', label: 'Car loan', kind: 'other', balance: 32000, interestRate: 0.069, monthlyPayment: 550 },
      { id: 'cc1', label: 'Credit card', kind: 'creditCard', balance: 15000, interestRate: 0.199, monthlyPayment: 400 },
    ],
  }),
  s('fhsa-on-30', 'Ontario 30, FHSA building', {
    currentAge: 30, retirementAge: 60, maxAge: 95,
    rrspBalance: 80000, tfsaBalance: 25000, taxableBalance: 0,
    cppStartAge: 65, cppMonthlyAmount: 700, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 42000, provinceCode: 'ONT',
    fhsa: { enabled: true, balance: 16000, contribution: 8000, openAge: 29 },
  }),
  s('fhsa-qc-28', 'Quebec 28, FHSA accumulating', {
    currentAge: 28, retirementAge: 55, maxAge: 95,
    rrspBalance: 40000, tfsaBalance: 12000, taxableBalance: 0,
    cppStartAge: 60, cppMonthlyAmount: 650, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 38000, provinceCode: 'QC',
    fhsa: { enabled: true, balance: 8000, contribution: 8000, openAge: 27 },
  }),
  s('ab-claw-band', 'Alberta rich, OAS claw-band edge', {
    currentAge: 65, retirementAge: 65, maxAge: 95,
    rrspBalance: 900000, tfsaBalance: 300000, taxableBalance: 400000,
    cppStartAge: 65, cppMonthlyAmount: 1300, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 110000, provinceCode: 'AB',
  }),
  s('bc-claw-partial', 'BC rich-ish, OAS partial claw', {
    currentAge: 65, retirementAge: 66, maxAge: 95,
    rrspBalance: 600000, tfsaBalance: 200000, taxableBalance: 150000,
    cppStartAge: 65, cppMonthlyAmount: 1200, oasStartAge: 66, oasYearsInCanada: 42,
    desiredSpending: 85000, provinceCode: 'BC',
  }),
  s('on-shallow-spouse', 'Ontario main, shallow-spouse plan', {
    currentAge: 62, retirementAge: 65, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 120000, taxableBalance: 60000,
    cppStartAge: 65, cppMonthlyAmount: 1100, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 62000, provinceCode: 'ONT',
    spouse: {
      enabled: true, currentAge: 60, retirementAge: 65,
      rrspBalance: 30000, tfsaBalance: 10000, taxableBalance: 0,
      cashCushionBalance: 0, rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 30,
      desiredSpending: 14000,
    },
  }),
  s('qc-wide-spouse', 'Quebec main, wide balance spouse', {
    currentAge: 60, retirementAge: 63, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 100000, taxableBalance: 50000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 60000, provinceCode: 'QC',
    spouse: {
      enabled: true, currentAge: 58, retirementAge: 63,
      rrspBalance: 450000, tfsaBalance: 150000, taxableBalance: 50000,
      cashCushionBalance: 0, rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 950, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 28000,
    },
  }),
  s('on-single-nosp', 'Ontario older single (no spouse)', {
    currentAge: 68, retirementAge: 68, maxAge: 95,
    rrspBalance: 350000, tfsaBalance: 80000, taxableBalance: 20000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 54000, provinceCode: 'ONT',
    spouse: { enabled: false },
  }),
  s('mb-single-leannest', 'Manitoba leanest single', {
    currentAge: 70, retirementAge: 70, maxAge: 95,
    rrspBalance: 60000, tfsaBalance: 20000, taxableBalance: 0,
    cppStartAge: 65, cppMonthlyAmount: 700, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 24000, provinceCode: 'MB',
  }),
  s('ns-two-pension', 'Nova Scotia 2-pension household', {
    currentAge: 60, retirementAge: 63, maxAge: 95,
    rrspBalance: 350000, tfsaBalance: 100000, taxableBalance: 40000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 58000, provinceCode: 'NS',
    income: [
      { id: 'db1', label: 'Work DB', kind: 'pension', annualAmount: 22000, startAge: 63, endAge: null, indexedToCpi: true },
      { id: 'db2', label: 'Old job DB', kind: 'pension', annualAmount: 8000, startAge: 65, endAge: null, indexedToCpi: false },
    ],
  }),
  s('nb-parttime-75', 'New Brunswick 75, still part-time', {
    currentAge: 75, retirementAge: 75, maxAge: 95,
    rrspBalance: 250000, tfsaBalance: 90000, taxableBalance: 40000,
    cppStartAge: 65, cppMonthlyAmount: 1050, oasStartAge: 70, oasYearsInCanada: 42,
    desiredSpending: 52000, provinceCode: 'NB',
    income: [{
      id: 'pt1', label: 'Part-time consulting', kind: 'employment',
      annualAmount: 10000, startAge: 75, endAge: 80, indexedToCpi: false,
    }],
  }),
  s('yt-northbands', 'Yukon 60 with spending bands', {
    currentAge: 60, retirementAge: 65, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 100000, taxableBalance: 50000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 58000, provinceCode: 'YT',
    spendingBands: [
      { fromAge: 65, pctOfBase: 1.0 },
      { fromAge: 75, pctOfBase: 0.8 },
      { fromAge: 85, pctOfBase: 0.6 },
    ],
  }),
  s('nu-northsav-50', 'Nunavut 50, saving', {
    currentAge: 50, retirementAge: 60, maxAge: 95,
    rrspBalance: 180000, tfsaBalance: 60000, taxableBalance: 15000,
    cppStartAge: 65, cppMonthlyAmount: 850, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 42000, provinceCode: 'NU',
  }),
  s('mb-cashbands', 'Manitoba cash cushion + bands', {
    currentAge: 62, retirementAge: 65, maxAge: 95,
    rrspBalance: 320000, tfsaBalance: 90000, taxableBalance: 40000, cashCushionBalance: 60000,
    cppStartAge: 65, cppMonthlyAmount: 1050, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 56000, provinceCode: 'MB',
    spendingBands: [
      { fromAge: 65, pctOfBase: 1.0 },
      { fromAge: 80, pctOfBase: 0.75 },
    ],
  }),
  s('on-noOas', 'Ontario 60 (no OAS years)', {
    currentAge: 60, retirementAge: 63, maxAge: 95,
    rrspBalance: 300000, tfsaBalance: 90000, taxableBalance: 40000,
    cppStartAge: 65, cppMonthlyAmount: 900, oasStartAge: null, oasYearsInCanada: 0,
    desiredSpending: 52000, provinceCode: 'ONT',
  }),
  s('qc-rm-60', 'Quebec 60, reverse-mortgage already', {
    currentAge: 60, retirementAge: 65, maxAge: 95,
    rrspBalance: 150000, tfsaBalance: 50000, taxableBalance: 15000,
    cppStartAge: 65, cppMonthlyAmount: 950, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 44000, provinceCode: 'QC',
    reverseMortgage: {
      enabled: true, homeValue: 900000, appreciationRate: 0.02, interestRate: 0.065,
      drawAmount: 15000, startAge: 70, durationYears: 12,
    },
  }),
  s('sk-rdsp-55', 'Saskatchewan 55 RDSP family', {
    currentAge: 55, retirementAge: 60, maxAge: 95,
    rrspBalance: 300000, tfsaBalance: 100000, taxableBalance: 40000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 52000, provinceCode: 'SK',
    rdsp: { enabled: true, balance: 80000, contribution: 1500, familyIncome: 42000 },
  }),
  s('nt-rdsp-60', 'NWT 60 RDSP beneficiary', {
    currentAge: 60, retirementAge: 65, maxAge: 95,
    rrspBalance: 250000, tfsaBalance: 80000, taxableBalance: 30000,
    cppStartAge: 65, cppMonthlyAmount: 950, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 50000, provinceCode: 'NT',
    rdsp: { enabled: true, balance: 60000, contribution: 1000, familyIncome: 38000 },
  }),
  s('mb-50-early', 'Manitoba 50, early-retire', {
    currentAge: 50, retirementAge: 58, maxAge: 95,
    rrspBalance: 220000, tfsaBalance: 70000, taxableBalance: 25000,
    cppStartAge: 60, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 40000, provinceCode: 'MB',
  }),
  s('on-50-late', 'Ontario 50, late', {
    currentAge: 50, retirementAge: 65, maxAge: 95,
    rrspBalance: 300000, tfsaBalance: 90000, taxableBalance: 40000,
    cppStartAge: 65, cppMonthlyAmount: 950, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 52000, provinceCode: 'ONT',
  }),
  s('qc-55', 'Quebec 55, retiring at 60', {
    currentAge: 55, retirementAge: 60, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 100000, taxableBalance: 50000,
    cppStartAge: 62, cppMonthlyAmount: 900, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 56000, provinceCode: 'QC',
  }),
  s('on-55-parttime', 'Ontario 55 with part-time work', {
    currentAge: 55, retirementAge: 62, maxAge: 95,
    rrspBalance: 350000, tfsaBalance: 100000, taxableBalance: 50000,
    cppStartAge: 65, cppMonthlyAmount: 950, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 54000, provinceCode: 'ONT',
    income: [{
      id: 'pt1', label: 'Consulting', kind: 'employment',
      annualAmount: 12000, startAge: 62, endAge: 67, indexedToCpi: false,
    }],
  }),
  s('nb-50-early', 'NB 50, early retire', {
    currentAge: 50, retirementAge: 55, maxAge: 95,
    rrspBalance: 200000, tfsaBalance: 70000, taxableBalance: 25000,
    cppStartAge: 60, cppMonthlyAmount: 750, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 40000, provinceCode: 'NB',
  }),
  s('nl-50', 'Newfoundland 50', {
    currentAge: 50, retirementAge: 58, maxAge: 95,
    rrspBalance: 250000, tfsaBalance: 80000, taxableBalance: 30000,
    cppStartAge: 62, cppMonthlyAmount: 850, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 46000, provinceCode: 'NL',
  }),
  s('on-taxable-half', 'Ontario taxable 50/50', {
    currentAge: 60, retirementAge: 63, maxAge: 95,
    rrspBalance: 300000, tfsaBalance: 100000, taxableBalance: 300000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 70000, provinceCode: 'ONT',
  }),
  s('sk-tfsa-heavy', 'Saskatchewan TFSA-heavy', {
    currentAge: 60, retirementAge: 65, maxAge: 95,
    rrspBalance: 200000, tfsaBalance: 250000, taxableBalance: 40000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 54000, provinceCode: 'SK',
  }),
  s('nt-rrsp-half', 'NWT RRSP+taxable half', {
    currentAge: 60, retirementAge: 62, maxAge: 95,
    rrspBalance: 300000, tfsaBalance: 50000, taxableBalance: 300000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 66000, provinceCode: 'NT',
  }),
  s('nb-two-debts', 'New Brunswick 2-debt', {
    currentAge: 60, retirementAge: 65, maxAge: 95,
    rrspBalance: 300000, tfsaBalance: 90000, taxableBalance: 40000,
    cppStartAge: 65, cppMonthlyAmount: 950, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 52000, provinceCode: 'NB',
    debts: [
      { id: 'cc1', label: 'Credit card', kind: 'creditCard', balance: 12000, interestRate: 0.199, monthlyPayment: 400 },
      { id: 'car1', label: 'Car loan', kind: 'other', balance: 24000, interestRate: 0.07, monthlyPayment: 500 },
    ],
  }),
  s('on-65-clawband', 'Ontario 65 just above OAS clawband', {
    currentAge: 65, retirementAge: 65, maxAge: 95,
    rrspBalance: 800000, tfsaBalance: 200000, taxableBalance: 100000,
    cppStartAge: 65, cppMonthlyAmount: 1150, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 95000, provinceCode: 'ONT',
  }),
  s('ns-65-noclaw', 'Nova Scotia 65 (no OAS claw)', {
    currentAge: 65, retirementAge: 65, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 150000, taxableBalance: 50000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 62000, provinceCode: 'NS',
  }),
  s('nu-75-rich', 'Nunavut 75 rich', {
    currentAge: 75, retirementAge: 75, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 150000, taxableBalance: 60000,
    cppStartAge: 65, cppMonthlyAmount: 1100, oasStartAge: 70, oasYearsInCanada: 42,
    desiredSpending: 60000, provinceCode: 'NU',
  }),
  s('ab-60-fhsa-open', 'Alberta 60, FHSA closed later', {
    currentAge: 60, retirementAge: 65, maxAge: 95,
    rrspBalance: 300000, tfsaBalance: 90000, taxableBalance: 40000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 52000, provinceCode: 'AB',
    fhsa: { enabled: true, balance: 28000, contribution: 8000, openAge: 55 },
  }),
  s('on-30-fhsa', 'Ontario 30, FHSA active', {
    currentAge: 30, retirementAge: 60, maxAge: 95,
    rrspBalance: 50000, tfsaBalance: 15000, taxableBalance: 0,
    cppStartAge: 60, cppMonthlyAmount: 700, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 40000, provinceCode: 'ONT',
    fhsa: { enabled: true, balance: 15000, contribution: 8000, openAge: 28 },
  }),
  s('qc-35-fhsa', 'Quebec 35, FHSA active', {
    currentAge: 35, retirementAge: 60, maxAge: 95,
    rrspBalance: 60000, tfsaBalance: 20000, taxableBalance: 5000,
    cppStartAge: 62, cppMonthlyAmount: 750, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 42000, provinceCode: 'QC',
    fhsa: { enabled: true, balance: 24000, contribution: 8000, openAge: 31 },
  }),
  s('pe-55-leannest60', 'PEI 55 leaning to 60', {
    currentAge: 55, retirementAge: 60, maxAge: 95,
    rrspBalance: 150000, tfsaBalance: 45000, taxableBalance: 0,
    cppStartAge: 60, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 36000, provinceCode: 'PEI',
  }),
  s('nb-sp-balance', 'New Brunswick spouse with balance', {
    currentAge: 65, retirementAge: 65, maxAge: 95,
    rrspBalance: 350000, tfsaBalance: 100000, taxableBalance: 50000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 58000, provinceCode: 'NB',
    spouse: {
      enabled: true, currentAge: 62, retirementAge: 65,
      rrspBalance: 180000, tfsaBalance: 60000, taxableBalance: 20000,
      cashCushionBalance: 0, rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 26000,
    },
  }),
  s('yt-sp-balanced', 'Yukon balanced spouse', {
    currentAge: 65, retirementAge: 65, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 120000, taxableBalance: 50000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 60000, provinceCode: 'YT',
    spouse: {
      enabled: true, currentAge: 63, retirementAge: 65,
      rrspBalance: 400000, tfsaBalance: 150000, taxableBalance: 60000,
      cashCushionBalance: 0, rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 980, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 30000,
    },
  }),
  s('on-sp-notaxable', 'Ontario spouse with no taxable', {
    currentAge: 60, retirementAge: 63, maxAge: 95,
    rrspBalance: 300000, tfsaBalance: 100000, taxableBalance: 50000,
    cppStartAge: 65, cppMonthlyAmount: 950, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 56000, provinceCode: 'ONT',
    spouse: {
      enabled: true, currentAge: 60, retirementAge: 63,
      rrspBalance: 220000, tfsaBalance: 80000, taxableBalance: 0,
      cashCushionBalance: 0, rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 900, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 24000,
    },
  }),
  s('qc-70-rich', 'Quebec 70 rich', {
    currentAge: 70, retirementAge: 70, maxAge: 95,
    rrspBalance: 600000, tfsaBalance: 200000, taxableBalance: 100000,
    cppStartAge: 65, cppMonthlyAmount: 1200, oasStartAge: 70, oasYearsInCanada: 40,
    desiredSpending: 90000, provinceCode: 'QC',
  }),
  s('on-70-bands', 'Ontario 70 with bands', {
    currentAge: 70, retirementAge: 70, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 120000, taxableBalance: 60000,
    cppStartAge: 65, cppMonthlyAmount: 1100, oasStartAge: 70, oasYearsInCanada: 40,
    desiredSpending: 62000, provinceCode: 'ONT',
    spendingBands: [
      { fromAge: 70, pctOfBase: 1.0 },
      { fromAge: 80, pctOfBase: 0.8 },
      { fromAge: 88, pctOfBase: 0.7 },
    ],
  }),
  s('ab-75-parttime', 'Alberta 75 still part-time', {
    currentAge: 75, retirementAge: 75, maxAge: 95,
    rrspBalance: 350000, tfsaBalance: 100000, taxableBalance: 50000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 70, oasYearsInCanada: 42,
    desiredSpending: 54000, provinceCode: 'AB',
    income: [{
      id: 'pt1', label: 'Board fees', kind: 'employment',
      annualAmount: 8000, startAge: 75, endAge: 80, indexedToCpi: false,
    }],
  }),
  s('on-double-pension', 'Ontario two pensions', {
    currentAge: 60, retirementAge: 62, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 100000, taxableBalance: 50000,
    cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 60000, provinceCode: 'ONT',
    income: [
      { id: 'db1', label: 'Work DB', kind: 'pension', annualAmount: 20000, startAge: 62, endAge: null, indexedToCpi: true },
      { id: 'db2', label: 'Spouse DB', kind: 'pension', annualAmount: 9000, startAge: 65, endAge: null, indexedToCpi: false },
    ],
  }),
  s('on-sp-late-cpp', 'Ontario spouse late CPP', {
    currentAge: 65, retirementAge: 66, maxAge: 95,
    rrspBalance: 400000, tfsaBalance: 120000, taxableBalance: 50000,
    cppStartAge: 67, cppMonthlyAmount: 1100, oasStartAge: 68, oasYearsInCanada: 40,
    desiredSpending: 58000, provinceCode: 'ONT',
    spouse: {
      enabled: true, currentAge: 63, retirementAge: 65,
      rrspBalance: 300000, tfsaBalance: 100000, taxableBalance: 40000,
      cashCushionBalance: 0, rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 70, cppMonthlyAmount: 900, oasStartAge: 70, oasYearsInCanada: 40,
      desiredSpending: 26000,
    },
  }),
];

/** Plan used for exemplars that need a guaranteed shortfall to explain. */
export const SHORTFALL_SCENARIO = SCENARIOS.find((x) => x.id === 'shortfall')!;