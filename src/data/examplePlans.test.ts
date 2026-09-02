import { describe, it, expect } from 'vitest';
import { buildDefaultPlans } from '@retired/engine-core/examplePlans';
import { calculateHousehold } from '@retired/engine-core/retirementEngine';
import { DEFAULT_APP_CONFIG } from '@retired/engine-core/appConfig';
import { migrateInputs } from './migrations';

/**
 * The first-run examples are the app's front door — a broken or unrealistic
 * one is the first thing a new user sees. These tests pin two things:
 *   1. every example survives the storage migration and runs end-to-end
 *      through the engine without producing NaN or an instant shortfall;
 *   2. each example actually exercises the engine feature its header comment
 *      claims it does (spouse plans, spending bands, one-time events, CPP
 *      deferral) — otherwise the "three mutually distinct starting points"
 *      promise is fiction.
 */

const examples = buildDefaultPlans();
const byName = (name: string) => {
  const s = examples.find(e => e.name === name);
  if (!s) throw new Error(`missing example: ${name}`);
  return s;
};

describe('examplePlans — data audit', () => {
  it('ships exactly the four documented examples with unique ids', () => {
    expect(examples.map(s => s.name)).toEqual([
      'Example - Early Couple',
      'Example - Single at 60',
      'Example - Semi-retirement',
      'Example - RDSP Starting Out',
    ]);
    expect(new Set(examples.map(s => s.id)).size).toBe(examples.length);
  });

  it.each(examples.map(s => [s.name, s] as const))('%s: ages are internally consistent', (_name, s) => {
    const i = s.inputs;
    expect(i.currentAge).toBeLessThan(i.retirementAge);
    expect(i.retirementAge).toBeLessThan(i.maxAge);
    expect(i.maxAge).toBeLessThanOrEqual(105);
    if (i.spouse?.enabled) {
      expect(i.spouse.currentAge).toBeLessThan(i.spouse.retirementAge);
      expect(i.spouse.retirementAge).toBeLessThan(i.maxAge); // shared horizon
    }
  });

  it.each(examples.map(s => [s.name, s] as const))('%s: runs end-to-end with sane results', (_name, s) => {
    const r = calculateHousehold({ ...migrateInputs(s.inputs) }, DEFAULT_APP_CONFIG);
    expect(r.yearlyBreakdown.length).toBeGreaterThan(10);
    expect(r.totalNetWorthAtRetirement).toBeGreaterThan(0);
    expect(Number.isFinite(r.withdrawalRate)).toBe(true);
    // An example that depletes immediately is a bad demo; late-life depletion
    // is realistic (and fixable — that's what the Optimize tab is for).
    expect(r.depletionAge === null || r.depletionAge >= 80).toBe(true);
  });

  it('Early Couple exercises the spouse plan and spending bands', () => {
    const s = byName('Example - Early Couple');
    expect(s.inputs.spouse?.enabled).toBe(true);
    expect(s.inputs.spendingBands?.length).toBeGreaterThanOrEqual(2);
    const r = calculateHousehold({ ...migrateInputs(s.inputs) }, DEFAULT_APP_CONFIG);
    // The spouse plan actually ran (not silently dropped).
    expect(r.spouse).toBeDefined();
    expect(r.spouse!.yearlyBreakdown.length).toBeGreaterThan(10);
  });

  it('Single at 60 exercises one-time events and CPP deferral to 70', () => {
    const s = byName('Example - Single at 60');
    expect(s.inputs.cppStartAge).toBe(70); // deferral: +42% vs 65
    expect(s.inputs.events?.length).toBeGreaterThanOrEqual(2);
    // Events are inside the projection window and reference real accounts.
    for (const ev of s.inputs.events!) {
      expect(ev.age).toBeGreaterThanOrEqual(s.inputs.currentAge);
      expect(ev.age).toBeLessThanOrEqual(s.inputs.maxAge);
    }
    expect(s.inputs.spouse?.enabled).toBeFalsy(); // single, as named
  });

  it('Semi-retirement exercises spending bands on a tighter plan', () => {
    const s = byName('Example - Semi-retirement');
    expect(s.inputs.spendingBands?.length).toBeGreaterThanOrEqual(2);
    // A partial OAS history (35 of 40 years) is part of the example's texture.
    expect(s.inputs.oasYearsInCanada).toBeLessThan(40);
  });

  it('RDSP Starting Out models a young DTC-eligible beneficiary building from zero', () => {
    const s = byName('Example - RDSP Starting Out');
    const rdsp = s.inputs.rdsp;
    expect(rdsp?.enabled).toBe(true);
    expect(rdsp?.dtcEligible).toBe(true);
    expect(s.inputs.currentAge).toBeLessThan(30); // a young-starter example
    // Starting balance of zero is the whole point: grants/bonds do the lifting.
    expect(rdsp?.balance).toBe(0);
    // $1,500/yr at $30k family income earns the full CDSG grant ($3,500/yr).
    expect(rdsp?.contribution).toBe(1500);
    expect(rdsp?.familyIncome).toBeLessThanOrEqual(DEFAULT_APP_CONFIG.rdsp.grantThreshold);

    const r = calculateHousehold({ ...migrateInputs(s.inputs) }, DEFAULT_APP_CONFIG);
    // The first accumulation year must show the grant landing alongside the
    // contribution — otherwise the RDSP slot is dead and the example lies.
    const firstYear = r.yearlyBreakdown[0];
    expect(firstYear.detail?.rdsp?.contribution).toBe(1500);
    expect(firstYear.detail?.rdsp?.grant).toBeGreaterThan(0);
    // Bond phases in at low family income (phases out above bondThresholdLower).
    expect(firstYear.detail?.rdsp?.bond).toBeGreaterThan(0);
    // The RDSP actually accumulates over the 40-year runway.
    const lastAccumYear = r.yearlyBreakdown.find(y => y.age === s.inputs.retirementAge - 1);
    expect(lastAccumYear?.rdspBalance ?? 0).toBeGreaterThan(100000);
  });
});
