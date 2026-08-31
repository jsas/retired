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
];

/** Scenario used for exemplars that need a guaranteed shortfall to explain. */
export const SHORTFALL_SCENARIO = SCENARIOS.find((x) => x.id === 'shortfall')!;
