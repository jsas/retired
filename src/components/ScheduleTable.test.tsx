// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { YearlyBreakdown } from '@retired/engine-core/retirementEngine';
import { ScheduleTable } from './ScheduleTable';
import { SCHEDULE_COLS_PREF_KEY } from './scheduleColumns';

// Node env has no localStorage; prefKV degrades to it, so stub a tiny mirror.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

function row(age: number): YearlyBreakdown {
  return {
    age,
    year: 2030 + age - 65,
    startingBalance: 1_000_000 - (age - 65) * 10_000,
    contributions: 0,
    marketGains: 20_000,
    spendingTarget: 60_000,
    withdrawals: 60_000,
    incomeTax: 8_000,
    totalTaxPaid: 9_000,
    cumulativeTax: (age - 65) * 9_000,
    cppIncome: 12_000,
    oasIncome: 8_000,
    gisIncome: 0,
    pensionIncome: 0,
    endingBalance: 990_000 - (age - 65) * 10_000,
    rrspBalance: 500_000,
    rrifBalance: 0,
    tfsaBalance: 400_000,
    taxableBalance: 90_000,
    cashCushionBalance: 0,
  } as YearlyBreakdown;
}

const breakdown = [row(64), row(65), row(66)];

describe('ScheduleTable column picker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the starter column set and the Columns button by default', () => {
    const html = renderToStaticMarkup(
      createElement(ScheduleTable, { breakdown, retirementAge: 65 }),
    );
    expect(html).toContain('Columns');
    for (const label of ['Age', 'Starting Balance', 'Contributions', 'Market Gains', 'Withdrawals', 'CPP', 'OAS', 'Ending Balance']) {
      expect(html, label).toContain(label);
    }
    // Off by default, one "show all" away.
    for (const label of ['>GIS<', '>RRIF<', '>Cash Cushion<', '>Tax Burden<']) {
      expect(html, label).not.toContain(label);
    }
  });

  it('honours a stored column pref', () => {
    localStorage.setItem(SCHEDULE_COLS_PREF_KEY, JSON.stringify(['age', 'endingBalance', 'gis', 'rrsp']));
    const html = renderToStaticMarkup(
      createElement(ScheduleTable, { breakdown, retirementAge: 65 }),
    );
    expect(html).toContain('>GIS<');
    expect(html).toContain('>RRSP<');
    expect(html).not.toContain('>Withdrawals<');
  });

  it('keeps the feature-gated columns automatic regardless of the picker', () => {
    const withRdsp = breakdown.map((r) => ({ ...r, rdspBalance: 12_345 }));
    const html = renderToStaticMarkup(
      createElement(ScheduleTable, { breakdown: withRdsp, retirementAge: 65 }),
    );
    expect(html).toContain('>RDSP<');
  });
});
