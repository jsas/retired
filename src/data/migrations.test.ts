// Migration tests — the income-register fold is the load-bearing migration for
// issue #24 Phase 1: legacy `pensions[]`+`employment[]` become one `income[]`,
// the old keys are dropped, and no legacy shape survives into the engine.
import { describe, it, expect } from 'vitest';
import { migrateInputs } from './migrations';
import type { IncomeSource } from '../lib/retirementEngine';

const base = () => ({
  currentAge: 60, retirementAge: 65, maxAge: 95,
  rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
  rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
  annualWithdrawal: 0, investmentReturn: 0.05, returnVolatility: 0.15,
  provinceCode: 'ONT', cppStartAge: 65, cppMonthlyAmount: 900,
  oasStartAge: 65, oasYearsInCanada: 40, desiredSpending: 40000,
  withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
});

describe('migrateInputs — income-register fold (issue #24)', () => {
  it('folds pensions and employment into one income[] register, pensions first', () => {
    const legacy = {
      ...base(),
      pensions: [
        { id: 'p1', label: 'DB pension', annualAmount: 15000, startAge: 65, endAge: null, indexedToCpi: false },
        { id: 'p2', label: 'Bridge', annualAmount: 6000, startAge: 60, endAge: 65, indexedToCpi: true },
      ],
      employment: [
        { id: 'j1', label: 'Part-time', annualAmount: 20000, startAge: 65, endAge: 70, destAccount: 'tfsa', topUpSpending: false, indexedToCpi: false },
      ],
    };
    const out = migrateInputs(legacy);
    expect(out.income).toEqual([
      { id: 'p1', label: 'DB pension', kind: 'pension', annualAmount: 15000, startAge: 65, endAge: null, indexedToCpi: false },
      { id: 'p2', label: 'Bridge', kind: 'pension', annualAmount: 6000, startAge: 60, endAge: 65, indexedToCpi: true },
      { id: 'j1', label: 'Part-time', kind: 'employment', annualAmount: 20000, startAge: 65, endAge: 70, indexedToCpi: false, destAccount: 'tfsa', topUpSpending: false },
    ]);
    // The legacy arrays are gone — no dual state survives.
    expect('pensions' in out).toBe(false);
    expect('employment' in out).toBe(false);
  });

  it('preserves employment-only fields (destAccount, topUpSpending) and drops them from pensions', () => {
    const out = migrateInputs({
      ...base(),
      employment: [{ id: 'j', label: 'Consult', annualAmount: 30000, startAge: 66, endAge: 68, destAccount: 'rrsp', topUpSpending: true, indexedToCpi: true }],
    });
    const job = (out.income as IncomeSource[])[0];
    expect(job.kind).toBe('employment');
    expect(job.destAccount).toBe('rrsp');
    expect(job.topUpSpending).toBe(true);
    // A pension never gains employment-only fields.
    const out2 = migrateInputs({
      ...base(),
      pensions: [{ id: 'p', label: 'DB', annualAmount: 10000, startAge: 65, endAge: null, indexedToCpi: false }],
    });
    const pen = (out2.income as IncomeSource[])[0];
    expect(pen.kind).toBe('pension');
    expect('destAccount' in pen).toBe(false);
    expect('topUpSpending' in pen).toBe(false);
  });

  it('leaves an already-migrated income[] untouched and drops stray legacy keys', () => {
    const income: IncomeSource[] = [
      { id: 'x', label: 'DB', kind: 'pension', annualAmount: 9000, startAge: 65, endAge: null, indexedToCpi: true },
    ];
    const out = migrateInputs({ ...base(), income, pensions: [{ id: 'stale', label: 'stale', annualAmount: 1, startAge: 1, endAge: null, indexedToCpi: false }] });
    expect(out.income).toEqual(income); // income wins, not re-folded
    expect('pensions' in out).toBe(false);
    expect('employment' in out).toBe(false);
  });

  it('folds the embedded spouse’s income too (first-class person)', () => {
    const out = migrateInputs({
      ...base(),
      spouse: {
        enabled: true, currentAge: 58, retirementAge: 62,
        rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 20000,
        pensions: [{ id: 'sp', label: 'Spouse DB', annualAmount: 12000, startAge: 62, endAge: null, indexedToCpi: false }],
        employment: [],
      },
    });
    const spouse = out.spouse as { income?: IncomeSource[] };
    expect(spouse.income).toEqual([
      { id: 'sp', label: 'Spouse DB', kind: 'pension', annualAmount: 12000, startAge: 62, endAge: null, indexedToCpi: false },
    ]);
    expect('pensions' in (spouse as object)).toBe(false);
  });

  it('produces no income key when there was never any income', () => {
    const out = migrateInputs({ ...base() });
    expect(out.income).toBeUndefined();
  });
});
