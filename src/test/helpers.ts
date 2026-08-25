// Shared fixtures for engine tests. `baseInputs()` returns a complete, valid
// RetirementInputs the caller overrides per-test; `testConfig()` is a deep copy
// of DEFAULT_APP_CONFIG (loadAppConfig needs localStorage, absent under Node).
import type { RetirementInputs, YearlyBreakdown } from '../lib/retirementEngine';
import { DEFAULT_APP_CONFIG, type AppConfig } from '../lib/appConfig';

export function testConfig(): AppConfig {
  return JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
}

export function baseInputs(overrides: Partial<RetirementInputs> = {}): RetirementInputs {
  return {
    currentAge: 65,
    retirementAge: 65,
    maxAge: 90,
    rrspBalance: 0,
    tfsaBalance: 500000,
    taxableBalance: 0,
    cashCushionBalance: 0,
    rrspContribution: 0,
    tfsaContribution: 0,
    taxableContribution: 0,
    annualWithdrawal: 0,
    investmentReturn: 0.05,
    returnVolatility: 0.1,
    provinceCode: 'ONT',
    cppStartAge: null,
    cppMonthlyAmount: 0,
    cppAdjustedAmount: false,
    oasStartAge: null,
    oasYearsInCanada: 40,
    desiredSpending: 20000,
    successFactor: 1,
    withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
    pensions: [],
    ...overrides,
  };
}

export const yearAt = (rows: YearlyBreakdown[], age: number): YearlyBreakdown => {
  const row = rows.find(y => y.age === age);
  if (!row) throw new Error(`no breakdown row at age ${age} (depleted at ${rows[rows.length - 1]?.age})`);
  return row;
};

// Floating-point money comparisons.
export const closeTo = (actual: number, expected: number, tol = 1) =>
  Math.abs(actual - expected) <= tol;
