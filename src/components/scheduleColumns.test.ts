import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_COLUMNS,
  BASE_COLUMN_IDS,
  DEFAULT_VISIBLE_IDS,
  ALWAYS_VISIBLE_IDS,
  resolveVisibleColumns,
} from './scheduleColumns';

describe('schedule column registry', () => {
  it('declares every base column exactly once', () => {
    expect(new Set(BASE_COLUMN_IDS).size).toBe(BASE_COLUMN_IDS.length);
    // 19 base columns (the old hard-coded set, minus the conditional four).
    expect(BASE_COLUMN_IDS.length).toBe(19);
  });

  it('keeps Age and Ending Balance always visible', () => {
    expect(ALWAYS_VISIBLE_IDS).toEqual(['age', 'endingBalance']);
  });

  it('starts with the money-flow story: age, balances-in-motion, withdrawals, benefits, ending', () => {
    expect([...DEFAULT_VISIBLE_IDS]).toEqual([
      'age',
      'startingBalance',
      'contributions',
      'marketGains',
      'withdrawals',
      'cpp',
      'oas',
      'endingBalance',
    ]);
  });

  it('resolveVisibleColumns(null) returns the default set', () => {
    expect([...resolveVisibleColumns(null)]).toEqual([...DEFAULT_VISIBLE_IDS]);
  });

  it('a stored pref narrows the set but can never hide the always-visible pair', () => {
    const visible = resolveVisibleColumns(['cpp', 'oas']);
    expect(visible.has('cpp')).toBe(true);
    expect(visible.has('withdrawals')).toBe(false);
    expect(visible.has('age')).toBe(true);
    expect(visible.has('endingBalance')).toBe(true);
  });

  it('drops unknown ids from older builds instead of crashing', () => {
    const visible = resolveVisibleColumns(['cpp', 'notAColumn']);
    expect(visible.has('cpp')).toBe(true);
    expect(visible.has('notAColumn')).toBe(false);
  });

  it('every column produces a number (or undefined) for a row-shaped object', () => {
    const row = {
      age: 70,
      startingBalance: 1000,
      contributions: 100,
      marketGains: 50,
      spendingTarget: 40000,
      withdrawals: 40000,
      incomeTax: 5000,
      totalTaxPaid: 6000,
      cumulativeTax: 60000,
      cppIncome: 10000,
      oasIncome: 8000,
      gisIncome: 0,
      pensionIncome: 0,
      endingBalance: 900,
      rrspBalance: 500,
      rrifBalance: 0,
      tfsaBalance: 400,
      taxableBalance: 0,
      cashCushionBalance: 0,
    } as Parameters<(typeof SCHEDULE_COLUMNS)[number]['value']>[0];
    for (const col of SCHEDULE_COLUMNS) {
      const v = col.value(row);
      expect(v === undefined || typeof v === 'number', col.id).toBe(true);
    }
  });
});
