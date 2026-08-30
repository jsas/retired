// Contribution-room ledger (issue #24). When tfsaRoom/rrspRoom are set the
// engine accrues room each year and caps registered deposits at what's left,
// spilling the excess to taxable (ACB-tracked) and reporting it as `overflow`.
// Blank (null) room = unlimited = enforcement off, preserving pre-#24 behavior.
import { describe, it, expect } from 'vitest';
import { calculateRetirement, type IncomeSource } from './retirementEngine';
import { testConfig, baseInputs, yearAt, closeTo } from '../test/helpers';

const config = testConfig();
// testConfig ships indexTaxTables off, so factorAt() = 1 and the annual limits
// below are flat (not CPI-indexed). rrspAnnualMax is large enough not to bind.
const TFSA_LIMIT = config.engine.tfsaAnnualLimit; // 7000

describe('TFSA room', () => {
  it('accrues the annual limit each year on top of the starting room', () => {
    // Contribute exactly the starting room at age 60; room refills by the limit
    // each year, so a same-size contribution fits again at 61 once refilled.
    const r = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 63, maxAge: 65,
      tfsaBalance: 0, tfsaContribution: 0, taxableBalance: 0,
      tfsaRoom: 10000,
      events: [
        { id: 'a', age: 60, label: 'in', amount: 10000, direction: 'in', account: 'tfsa' },
        { id: 'b', age: 61, label: 'in', amount: 7000, direction: 'in', account: 'tfsa' },
      ],
    }), config);
    // Age 60: room was 10000 + 7000 accrued = 17000; 10000 lands, none overflows.
    expect(yearAt(r.yearlyBreakdown, 60).detail?.overflow).toBeUndefined();
    expect(closeTo(yearAt(r.yearlyBreakdown, 60).detail?.deposit?.tfsa ?? 0, 10000)).toBe(true);
    // Age 61: room left = 17000-10000 = 7000, +7000 accrued = 14000; 7000 lands.
    expect(yearAt(r.yearlyBreakdown, 61).detail?.overflow).toBeUndefined();
    expect(closeTo(yearAt(r.yearlyBreakdown, 61).detail?.deposit?.tfsa ?? 0, 7000)).toBe(true);
  });

  it('caps a deposit at remaining room and overflows the excess to taxable', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 63, maxAge: 65,
      tfsaBalance: 0, tfsaContribution: 0, taxableBalance: 0,
      tfsaRoom: 5000, // 5000 start + 7000 accrued = 12000 available at 60
      events: [{ id: 'a', age: 60, label: 'in', amount: 20000, direction: 'in', account: 'tfsa' }],
    }), config);
    const row = yearAt(r.yearlyBreakdown, 60);
    // Only 12000 fits; the other 8000 spills to taxable and is reported.
    expect(closeTo(row.detail?.deposit?.tfsa ?? 0, 12000)).toBe(true);
    expect(closeTo(row.detail?.overflow?.tfsa ?? 0, 8000)).toBe(true);
    // Overflow lands in taxable. It is redirected when the deposit is processed
    // (after that year's growth step), so the year-end balance is the overflow
    // itself, ungrown; it grows from the next year onward.
    expect(closeTo(row.taxableBalance, 8000, 1)).toBe(true);
  });

  it('re-adds a TFSA withdrawal to room the FOLLOWING year (CRA rule)', () => {
    // Retired, drawing spending from the TFSA. Room starts at 0, so the year's
    // accrual is just the annual limit; the withdrawal re-adds next year.
    const r = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 68,
      tfsaBalance: 100000, taxableBalance: 0, rrspBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      tfsaRoom: 0,
      withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
      events: [
        { id: 'wd', age: 65, label: 'draw', amount: 10000, direction: 'out' }, // pulls 10k from TFSA
        // At 66, room = 7000 (accrued at 65) + 7000 (accrued at 66) + 10000 (re-added) = 24000.
        { id: 'in', age: 66, label: 'recontribute', amount: 24000, direction: 'in', account: 'tfsa' },
      ],
    }), config);
    // The 24000 fits exactly at 66 because the 10000 withdrawal re-added to room.
    expect(yearAt(r.yearlyBreakdown, 66).detail?.overflow).toBeUndefined();
    expect(closeTo(yearAt(r.yearlyBreakdown, 66).detail?.deposit?.tfsa ?? 0, 24000)).toBe(true);
  });

  it('does NOT re-add a TFSA withdrawal in the same year', () => {
    // Same-year recontribution must fit within the room available BEFORE the
    // withdrawal re-add (which lands next year).
    const r = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 67,
      tfsaBalance: 100000, taxableBalance: 0, rrspBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      tfsaRoom: 0, // 7000 accrued at 65 → only 7000 available in-year
      withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
      events: [
        { id: 'wd', age: 65, label: 'draw', amount: 10000, direction: 'out' },
        { id: 'in', age: 65, label: 'recontribute', amount: 15000, direction: 'in', account: 'tfsa' },
      ],
    }), config);
    // Order: inflow events land before outflow draws within the year, so the
    // 15000 recontribute hits the 7000 room cap; 8000 overflows.
    const row = yearAt(r.yearlyBreakdown, 65);
    expect(closeTo(row.detail?.deposit?.tfsa ?? 0, 7000)).toBe(true);
    expect(closeTo(row.detail?.overflow?.tfsa ?? 0, 8000)).toBe(true);
  });
});

describe('RRSP room', () => {
  it('accrues 18% of earned income, capped, and caps deposits at remaining room', () => {
    const job: IncomeSource = {
      id: 'j', label: 'salary', kind: 'employment', annualAmount: 100000,
      startAge: 55, endAge: 59, destAccount: 'taxable', topUpSpending: false, indexedToCpi: false,
    };
    const r = calculateRetirement(baseInputs({
      currentAge: 55, retirementAge: 60, maxAge: 62,
      rrspBalance: 0, rrspContribution: 0, tfsaBalance: 0, taxableBalance: 0,
      rrspRoom: 0, // start empty; accrues 0.18*100000 = 18000/yr while employed
      income: [job],
      events: [{ id: 'a', age: 55, label: 'in', amount: 25000, direction: 'in', account: 'rrsp' }],
    }), config);
    // At 55 room = 18000 accrued; 25000 deposit → 18000 lands, 7000 overflows.
    const row = yearAt(r.yearlyBreakdown, 55);
    expect(closeTo(row.detail?.deposit?.rrsp ?? 0, 18000)).toBe(true);
    expect(closeTo(row.detail?.overflow?.rrsp ?? 0, 7000)).toBe(true);
  });

  it('reduces accrual dollar-for-dollar by the pension adjustment (PA)', () => {
    const job: IncomeSource = {
      id: 'j', label: 'salary', kind: 'employment', annualAmount: 100000,
      startAge: 55, endAge: 59, destAccount: 'taxable', topUpSpending: false, indexedToCpi: false,
    };
    const dbPension: IncomeSource = {
      id: 'p', label: 'DB pension', kind: 'pension', annualAmount: 0,
      startAge: 55, endAge: null, indexedToCpi: false, pensionAdjustment: 5000,
    };
    const r = calculateRetirement(baseInputs({
      currentAge: 55, retirementAge: 60, maxAge: 62,
      rrspBalance: 0, rrspContribution: 0, tfsaBalance: 0, taxableBalance: 0,
      rrspRoom: 0,
      income: [job, dbPension],
      events: [{ id: 'a', age: 55, label: 'in', amount: 20000, direction: 'in', account: 'rrsp' }],
    }), config);
    // Accrual = 0.18*100000 - 5000 PA = 13000; 20000 deposit → 13000 lands, 7000 over.
    const row = yearAt(r.yearlyBreakdown, 55);
    expect(closeTo(row.detail?.deposit?.rrsp ?? 0, 13000)).toBe(true);
    expect(closeTo(row.detail?.overflow?.rrsp ?? 0, 7000)).toBe(true);
  });

  it('never re-adds an RRSP withdrawal to room', () => {
    // Meltdown a chunk out of RRSP; room must NOT grow by the withdrawn amount.
    const r = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 500000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      rrspRoom: 0, // no earned income in decumulation → room stays 0 forever
      events: [{
        id: 'meltdown', age: 65, label: 'RRSP meltdown', amount: 50000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'primary', account: 'taxable' },
      }, {
        // Try to put money back into RRSP at 66 — there is still no room.
        id: 'back', age: 66, label: 'back', amount: 5000, direction: 'in', account: 'rrsp',
      }],
    }), config);
    const row = yearAt(r.yearlyBreakdown, 66);
    // Nothing landed in RRSP (no room accrued, withdrawal not re-added); all over.
    expect(closeTo(row.detail?.deposit?.rrsp ?? 0, 0)).toBe(true);
    expect(closeTo(row.detail?.overflow?.rrsp ?? 0, 5000)).toBe(true);
  });

  it('caps an RRSP→TFSA meltdown at TFSA room, overflowing the net to taxable', () => {
    // A registered→registered conversion is not a deposit, but the LANDING in
    // TFSA is. With no TFSA room the whole after-tax net spills to taxable.
    const r = calculateRetirement(baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 66,
      rrspBalance: 500000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      desiredSpending: 0,
      tfsaRoom: 0, // 7000 accrued at 65 → only 7000 of the net can stay in TFSA
      events: [{
        id: 'meltdown', age: 65, label: 'RRSP meltdown', amount: 50000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'primary', account: 'tfsa' },
      }],
    }), config);
    const row = yearAt(r.yearlyBreakdown, 65);
    const tr = row.detail?.calc?.transfers?.[0];
    expect(tr).toBeDefined();
    // Only 7000 of the net landed in TFSA; the rest overflowed to taxable.
    expect(closeTo(row.detail?.deposit?.tfsa ?? 0, 7000)).toBe(true);
    expect(closeTo(row.detail?.overflow?.tfsa ?? 0, tr!.net - 7000)).toBe(true);
  });
});

describe('blank room = unlimited (enforcement off)', () => {
  it('imposes no cap and reports no overflow when room is null', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 63, maxAge: 65,
      tfsaBalance: 0, tfsaContribution: 0, taxableBalance: 0,
      tfsaRoom: null, rrspRoom: null,
      events: [{ id: 'a', age: 60, label: 'in', amount: 999999, direction: 'in', account: 'tfsa' }],
    }), config);
    const row = yearAt(r.yearlyBreakdown, 60);
    expect(row.detail?.overflow).toBeUndefined();
    expect(closeTo(row.detail?.deposit?.tfsa ?? 0, 999999)).toBe(true);
  });

  it('omitting room fields entirely also leaves enforcement off', () => {
    const r = calculateRetirement(baseInputs({
      currentAge: 60, retirementAge: 63, maxAge: 65,
      tfsaBalance: 0, tfsaContribution: 50000, taxableBalance: 0,
      // no tfsaRoom/rrspRoom keys at all
    }), config);
    // A contribution far above any real limit lands in full — pre-#24 behavior.
    expect(yearAt(r.yearlyBreakdown, 60).detail?.overflow).toBeUndefined();
    expect(yearAt(r.yearlyBreakdown, 60).contributions).toBe(50000);
  });
});
