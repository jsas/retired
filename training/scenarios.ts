// Scenario sweep for the corpus generator. Each NamedScenario is a valid
// RetirementInputs (built on the shared baseInputs fixture) plus a name, so the
// minter can run the REAL engine across a spread of Canadian retirement
// situations — provinces, account mixes, ages, pensions — instead of one plan.
//
// Field pitfalls respected (CLAUDE.md): province codes are 'ONT'-style (never
// 'ON'); cppStartAge/oasStartAge are explicit null when unset; structural
// blocks (income/events/spouse) are added whole, never as flat overrides.

import type { RetirementInputs } from '../src/lib/retirementEngine';
import { baseInputs } from '../src/test/helpers';

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
];

/** Scenario used for exemplars that need a guaranteed shortfall to explain. */
export const SHORTFALL_SCENARIO = SCENARIOS.find((x) => x.id === 'shortfall')!;
