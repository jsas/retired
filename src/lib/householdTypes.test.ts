import { describe, it, expect } from 'vitest';
import {
  legacyToPerson,
  legacyToShared,
  legacyToHousehold,
  householdToLegacy,
  resolveHousehold,
  resolveSpouseSource,
  isTransferEvent,
  eventEndpoints,
  type HouseholdInputs,
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

  it('round-trips a single-person plan through household form unchanged', () => {
    const legacy = baseInputs({ currentAge: 60, desiredSpending: 40000 });
    const household = legacyToHousehold(legacy);
    expect(household.spouse).toBeUndefined();
    const back = householdToLegacy(resolveHousehold(household));
    expect(back.currentAge).toBe(legacy.currentAge);
    expect(back.desiredSpending).toBe(legacy.desiredSpending);
    expect(back.maxAge).toBe(legacy.maxAge);
    expect(back.provinceCode).toBe(legacy.provinceCode);
    expect(back.spouse).toBeUndefined();
  });

  it('converts an enabled legacy spouse to a builtin adapter with parity defaults', () => {
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
    const household = legacyToHousehold(legacy);
    expect(household.spouse?.kind).toBe('builtin');
    const sp = household.spouse!.kind === 'builtin' ? household.spouse!.person : null;
    expect(sp).not.toBeNull();
    expect(sp!.currentAge).toBe(58);
    expect(sp!.desiredSpending).toBe(25000);
    // Parity: the fields the stripped spouse type never carried are present.
    expect(sp!.cppAdjustedAmount).toBe(false);
    expect(Array.isArray(sp!.withdrawalOrder)).toBe(true);
  });

  it('round-trips a couple through household form preserving the spouse', () => {
    const legacy = baseInputs({
      spouse: {
        enabled: true, currentAge: 57, retirementAge: 60,
        rrspBalance: 1, tfsaBalance: 2, taxableBalance: 3, cashCushionBalance: 4,
        rrspContribution: 5, tfsaContribution: 6, taxableContribution: 7,
        cppStartAge: 65, cppMonthlyAmount: 900, oasStartAge: 65, oasYearsInCanada: 38,
        desiredSpending: 30000, withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
      },
    });
    // householdToLegacy takes a RESOLVED household (spouse is a person, not an
    // adapter), so resolve first.
    const resolved = resolveHousehold(legacyToHousehold(legacy));
    const back = householdToLegacy(resolved);
    expect(back.spouse?.enabled).toBe(true);
    expect(back.spouse?.currentAge).toBe(57);
    expect(back.spouse?.desiredSpending).toBe(30000);
    expect(back.spouse?.withdrawalOrder).toEqual(['rrsp', 'tfsa', 'taxable']);
  });
});

describe('resolveHousehold — spouse adapters', () => {
  const scenarios = [
    { id: 'a', inputs: baseInputs({ provinceCode: 'QC', investmentReturn: 0.08, maxAge: 99, desiredSpending: 45000 }) },
    { id: 'b', inputs: baseInputs({ provinceCode: 'ONT', desiredSpending: 30000 }) },
  ];

  it('resolves a builtin spouse directly with no warnings', () => {
    const household = legacyToHousehold(baseInputs());
    household.spouse = { kind: 'builtin', person: legacyToPerson(baseInputs({ desiredSpending: 20000 })) };
    const r = resolveHousehold(household, scenarios);
    expect(r.spouse?.desiredSpending).toBe(20000);
    expect(r.warnings).toEqual([]);
  });

  it('resolves a scenario spouse, host wins on shared conflicts with warnings', () => {
    const household = legacyToHousehold(baseInputs({ provinceCode: 'ONT', investmentReturn: 0.05, maxAge: 90 }));
    household.spouse = { kind: 'scenario', scenarioId: 'a' };
    const r = resolveHousehold(household, scenarios);
    // Spouse person comes from scenario 'a'...
    expect(r.spouse?.desiredSpending).toBe(45000);
    // ...but the HOST's shared fields win.
    expect(r.shared.provinceCode).toBe('ONT');
    expect(r.shared.investmentReturn).toBe(0.05);
    expect(r.shared.maxAge).toBe(90);
    // Each conflicting shared field produces a warning.
    expect(r.warnings.some(w => w.includes('Province'))).toBe(true);
    expect(r.warnings.some(w => w.includes('Investment return'))).toBe(true);
    expect(r.warnings.some(w => w.includes('max age'))).toBe(true);
  });

  it('no warning when the linked scenario shares the host shared values', () => {
    const shared = { maxAge: 90, investmentReturn: 0.05, returnVolatility: 0.1, provinceCode: 'ONT' };
    const household: HouseholdInputs = {
      shared,
      primary: legacyToPerson(baseInputs()),
      spouse: { kind: 'scenario', scenarioId: 'b' },
    };
    const r = resolveHousehold(household, [
      { id: 'b', inputs: baseInputs({ provinceCode: 'ONT', investmentReturn: 0.05, maxAge: 90 }) },
    ]);
    expect(r.spouse).toBeDefined();
    expect(r.warnings).toEqual([]);
  });

  it('drops a missing scenario spouse with a warning rather than throwing', () => {
    const household = legacyToHousehold(baseInputs());
    household.spouse = { kind: 'scenario', scenarioId: 'does-not-exist' };
    const r = resolveHousehold(household, scenarios);
    expect(r.spouse).toBeUndefined();
    expect(r.warnings.some(w => w.includes('not found'))).toBe(true);
  });

  it('guards circular spouse references', () => {
    const household = legacyToHousehold(baseInputs());
    household.spouse = { kind: 'scenario', scenarioId: 'a' };
    const seen = new Set(['a']); // 'a' already on the resolution stack
    const r = resolveHousehold(household, scenarios, seen);
    expect(r.spouse).toBeUndefined();
    expect(r.warnings.some(w => w.toLowerCase().includes('circular'))).toBe(true);
  });
});

describe('cash-event transfer helpers', () => {
  it('a plain in/out event is not a transfer', () => {
    const ev: CashEvent = { id: 'e', age: 65, label: 'sale', amount: 100, direction: 'in', account: 'taxable' };
    expect(isTransferEvent(ev)).toBe(false);
  });

  it('an event with from/to is a transfer', () => {
    const ev: CashEvent = {
      id: 'e', age: 70, label: 'meltdown', amount: 10000, direction: 'out',
      from: { kind: 'account', person: 'primary', account: 'rrsp' },
      to: { kind: 'account', person: 'primary', account: 'tfsa' },
    };
    expect(isTransferEvent(ev)).toBe(true);
  });

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
});
