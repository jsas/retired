import type { Scenario } from '../lib/scenarioStorage';

/**
 * First-run example scenarios: three realistic, mutually distinct starting
 * points that each exercise different engine features. Only used when
 * localStorage is empty (first launch or after a full reset) — the user's own
 * scenarios replace them permanently once saved.
 *
 *   Example - Early Couple ....... an embedded spouse plan + spending bands
 *   Example - Single at 60 ....... one-time cash events + CPP deferred to 70
 *   Example - Semi-retirement .... modest balances, spending bands, part-time
 *                                  style contributions into retirement
 *
 * Keep these aligned with the current RetirementInputs shape — the test suite
 * asserts each one runs through the engine and touches the features above.
 */
export const buildDefaultScenarios = (): Scenario[] => [
  {
    id: 'scenario-1',
    name: 'Example - Early Couple',
    inputs: {
      currentAge: 45,
      retirementAge: 55,
      maxAge: 95,
      rrspBalance: 320000,
      tfsaBalance: 140000,
      taxableBalance: 90000,
      cashCushionBalance: 30000,
      rrspContribution: 24000,
      tfsaContribution: 14000,
      taxableContribution: 6000,
      annualWithdrawal: 70000,
      investmentReturn: 0.06,
      returnVolatility: 0.15,
      provinceCode: 'ONT',
      cppStartAge: 65,
      cppMonthlyAmount: 1000,
      cppAdjustedAmount: false,
      oasStartAge: 65,
      oasYearsInCanada: 40,
      desiredSpending: 70000,
      withdrawalOrder: ['taxable', 'rrsp', 'tfsa'],
      spendingBands: [
        { fromAge: 75, pctOfBase: 0.85 },
        { fromAge: 85, pctOfBase: 0.7 },
      ],
      spouse: {
        enabled: true,
        currentAge: 43,
        retirementAge: 55,
        rrspBalance: 240000,
        tfsaBalance: 110000,
        taxableBalance: 40000,
        cashCushionBalance: 20000,
        rrspContribution: 18000,
        tfsaContribution: 7000,
        taxableContribution: 0,
        cppStartAge: 65,
        cppMonthlyAmount: 850,
        oasStartAge: 65,
        oasYearsInCanada: 40,
        desiredSpending: 30000,
        withdrawalOrder: ['taxable', 'rrsp', 'tfsa'],
      },
    },
  },
  {
    id: 'scenario-2',
    name: 'Example - Single at 60',
    inputs: {
      currentAge: 55,
      retirementAge: 60,
      maxAge: 95,
      rrspBalance: 600000,
      tfsaBalance: 120000,
      taxableBalance: 80000,
      cashCushionBalance: 40000,
      rrspContribution: 20000,
      tfsaContribution: 7000,
      taxableContribution: 0,
      annualWithdrawal: 52000,
      investmentReturn: 0.05,
      returnVolatility: 0.12,
      provinceCode: 'BC',
      cppStartAge: 70,
      cppMonthlyAmount: 1250,
      cppAdjustedAmount: false,
      oasStartAge: 65,
      oasYearsInCanada: 40,
      desiredSpending: 52000,
      withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
      events: [
        { id: 'evt-downsize', age: 68, label: 'Downsize home', amount: 250000, direction: 'in', account: 'taxable' },
        { id: 'evt-car', age: 63, label: 'Replace car', amount: 35000, direction: 'out' },
      ],
    },
  },
  {
    id: 'scenario-3',
    name: 'Example - Semi-retirement',
    inputs: {
      currentAge: 52,
      retirementAge: 60,
      maxAge: 90,
      rrspBalance: 260000,
      tfsaBalance: 110000,
      taxableBalance: 40000,
      cashCushionBalance: 15000,
      rrspContribution: 14000,
      tfsaContribution: 7000,
      taxableContribution: 2000,
      annualWithdrawal: 36000,
      investmentReturn: 0.045,
      returnVolatility: 0.10,
      provinceCode: 'ONT',
      cppStartAge: 65,
      cppMonthlyAmount: 900,
      cppAdjustedAmount: false,
      oasStartAge: 65,
      oasYearsInCanada: 35,
      desiredSpending: 36000,
      withdrawalOrder: ['taxable', 'tfsa', 'rrsp'],
      spendingBands: [
        { fromAge: 70, pctOfBase: 0.9 },
        { fromAge: 80, pctOfBase: 0.75 },
      ],
    },
  },
];
