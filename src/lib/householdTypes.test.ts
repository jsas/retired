import { describe, it, expect } from 'vitest';
import {
  legacyToPerson,
  legacyToShared,
  legacySpouseToPerson,
  resolveSpouseSource,
  baselineSpouse,
  eventEndpoints,
} from './householdTypes';
import type { CashEvent } from './retirementEngine';
import { baseInputs } from '../test/helpers';

describe('legacy ↔ unified converters', () => {
  it('splits a legacy plan into person + shared without losing fields', () => {
    const legacy = baseInputs({
      currentAge: 50,
      retirementAge: 60,
      maxAge: 92,
      investmentReturn: 0.07,
      provinceCode: 'BC',
      desiredSpending: 55000,
      events: [{ id: 'e1', age: 65, label: 'x', amount: 1000, direction: 'in' }],
    });
    const person = legacyToPerson(legacy);
    const shared = legacyToShared(legacy);

    expect(person.currentAge).toBe(50);
    expect(person.desiredSpending).toBe(55000);
    expect(person.events).toHaveLength(1);
    // Person must NOT carry the shared fields.
    expect('maxAge' in person).toBe(false);
    expect('provinceCode' in person).toBe(false);

    expect(shared.maxAge).toBe(92);
    expect(shared.investmentReturn).toBe(0.07);
    expect(shared.provinceCode).toBe('BC');
  });

  it('converts an enabled legacy spouse to a full person with parity defaults', () => {
    const legacy = baseInputs({
      spouse: {
        enabled: true,
        currentAge: 58,
        retirementAge: 62,
        rrspBalance: 100000,
        tfsaBalance: 50000,
        taxableBalance: 10000,
        cashCushionBalance: 5000,
        rrspContribution: 0,
        tfsaContribution: 0,
        taxableContribution: 0,
        cppStartAge: 65,
        cppMonthlyAmount: 800,
        oasStartAge: 65,
        oasYearsInCanada: 40,
        desiredSpending: 25000,
      },
    });
    const sp = legacySpouseToPerson(legacy.spouse!);
    expect(sp.currentAge).toBe(58);
    expect(sp.desiredSpending).toBe(25000);
    // Parity: the fields the stripped spouse type never carried are present.
    expect(sp.cppAdjustedAmount).toBe(false);
    expect(Array.isArray(sp.withdrawalOrder)).toBe(true);
  });
});

describe('baselineSpouse — the single source of truth for a new spouse', () => {
  it('starts at the host ages, zero balances, CPP/OAS at 65, and half the host spending', () => {
    const sp = baselineSpouse({ currentAge: 55, retirementAge: 60, desiredSpending: 50000 });
    expect(sp.enabled).toBe(true);
    expect(sp.currentAge).toBe(55);
    expect(sp.retirementAge).toBe(60);
    expect(sp.rrspBalance + sp.tfsaBalance + sp.taxableBalance + sp.cashCushionBalance).toBe(0);
    expect(sp.cppStartAge).toBe(65);
    expect(sp.oasStartAge).toBe(65);
    expect(sp.desiredSpending).toBe(25000);
  });
});

describe('cash-event transfer helpers', () => {
  it('defaults a legacy inflow to external → primary account', () => {
    const ev: CashEvent = { id: 'e', age: 65, label: 'in', amount: 100, direction: 'in' };
    const { from, to } = eventEndpoints(ev);
    expect(from.kind).toBe('external');
    expect(to).toEqual({ kind: 'account', person: 'primary', account: 'taxable' });
  });

  it('defaults a legacy outflow to primary account → external spending', () => {
    const ev: CashEvent = { id: 'e', age: 65, label: 'out', amount: 100, direction: 'out' };
    const { from, to } = eventEndpoints(ev);
    expect(from.kind).toBe('account');
    expect(to.kind).toBe('external');
  });

  it('explicit from/to win over direction/account', () => {
    const ev: CashEvent = {
      id: 'e', age: 70, label: 't', amount: 5000, direction: 'out', account: 'tfsa',
      from: { kind: 'account', person: 'primary', account: 'rrsp' },
      to: { kind: 'account', person: 'spouse', account: 'tfsa' },
    };
    const { from, to } = eventEndpoints(ev);
    expect(from).toEqual({ kind: 'account', person: 'primary', account: 'rrsp' });
    expect(to).toEqual({ kind: 'account', person: 'spouse', account: 'tfsa' });
  });
});

describe('resolveSpouseSource — the spouse adapter the app stores', () => {
  const scenarios = [
    { id: 'me', inputs: baseInputs({ provinceCode: 'ONT', investmentReturn: 0.05, maxAge: 90 }) },
    { id: 'partner', inputs: baseInputs({ provinceCode: 'QC', investmentReturn: 0.08, maxAge: 99, currentAge: 58, desiredSpending: 28000 }) },
  ];

  it('a builtin source returns the embedded spouse unchanged, no warnings', () => {
    const host = baseInputs({ spouse: { enabled: true, currentAge: 57, retirementAge: 60, rrspBalance: 1, tfsaBalance: 2, taxableBalance: 3, cashCushionBalance: 4, rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0, cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40, desiredSpending: 25000 } });
    host.spouseSource = { kind: 'builtin' };
    const r = resolveSpouseSource(host, scenarios, 'me');
    expect(r.spouse?.currentAge).toBe(57);
    expect(r.warnings).toEqual([]);
  });

  it('a scenario source materializes the referenced plan as the spouse', () => {
    const host = baseInputs({ provinceCode: 'ONT', investmentReturn: 0.05, maxAge: 90 });
    host.spouseSource = { kind: 'scenario', scenarioId: 'partner' };
    const r = resolveSpouseSource(host, scenarios, 'me');
    expect(r.spouse?.currentAge).toBe(58);
    expect(r.spouse?.desiredSpending).toBe(28000);
    expect(r.spouse?.enabled).toBe(true);
    // Host wins on the differing shared fields, each reported.
    expect(r.warnings.some(w => w.includes('Province'))).toBe(true);
    expect(r.warnings.some(w => w.includes('Investment return'))).toBe(true);
    expect(r.warnings.some(w => w.includes('max age'))).toBe(true);
  });

  it('guards a self-reference', () => {
    const host = baseInputs();
    host.spouseSource = { kind: 'scenario', scenarioId: 'me' };
    const r = resolveSpouseSource(host, scenarios, 'me');
    expect(r.spouse).toBeUndefined();
    expect(r.warnings.some(w => w.includes('own spouse'))).toBe(true);
  });

  it('guards a two-way circular reference', () => {
    const host = baseInputs();
    host.spouseSource = { kind: 'scenario', scenarioId: 'partner' };
    // The partner names this host ('me') as ITS spouse → a cycle.
    const partnerBack = baseInputs();
    partnerBack.spouseSource = { kind: 'scenario', scenarioId: 'me' };
    const r = resolveSpouseSource(host, [{ id: 'partner', inputs: partnerBack }], 'me');
    expect(r.spouse).toBeUndefined();
    expect(r.warnings.some(w => w.toLowerCase().includes('circular'))).toBe(true);
  });

  it('a missing referenced scenario yields no spouse and a warning', () => {
    const host = baseInputs();
    host.spouseSource = { kind: 'scenario', scenarioId: 'ghost' };
    const r = resolveSpouseSource(host, scenarios, 'me');
    expect(r.spouse).toBeUndefined();
    expect(r.warnings.some(w => w.includes('not found'))).toBe(true);
  });

  it('carries the linked plan’s full-person parity fields (events, bands, RM)', () => {
    // A linked spouse must run the referenced plan's OWN events, spending bands
    // and reverse mortgage — previously these were stripped during
    // materialization, so the spouse silently lost them.
    const partner = baseInputs({ currentAge: 58, desiredSpending: 28000 });
    partner.events = [{ id: 'e', age: 60, label: 'sale', amount: 50000, direction: 'in', account: 'tfsa' }];
    partner.spendingBands = [{ fromAge: 70, pctOfBase: 0.8 }];
    partner.reverseMortgage = { enabled: true, homeValue: 500000, appreciationRate: 0.02, interestRate: 0.06, topUp: true };
    const host = baseInputs({ provinceCode: 'ONT', investmentReturn: 0.05, maxAge: 90 });
    host.spouseSource = { kind: 'scenario', scenarioId: 'partner' };
    const r = resolveSpouseSource(host, [{ id: 'partner', inputs: partner }], 'me');
    expect(r.spouse?.events).toHaveLength(1);
    expect(r.spouse?.events?.[0].label).toBe('sale');
    expect(r.spouse?.spendingBands).toEqual([{ fromAge: 70, pctOfBase: 0.8 }]);
    expect(r.spouse?.reverseMortgage?.homeValue).toBe(500000);
  });
});
