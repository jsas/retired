import { describe, it, expect } from 'vitest';
import {
  retirementInputsSchema, scenarioSchema, appConfigSchema, parseAppDbDoc,
} from './schemas';
import { baseInputs } from '../test/helpers';
import { DEFAULT_APP_CONFIG } from '../lib/appConfig';
import { buildDefaultScenarios } from './exampleScenarios';

/** The Zod schemas are the gatekeeper for everything persisted or imported —
 *  a good payload must pass, a corrupted one must fail LOUDLY (return null /
 *  throw), never pass silently into app state. */

describe('schemas — persisted shapes', () => {
  it('accepts the engine inputs every shipped example produces', () => {
    for (const s of buildDefaultScenarios()) {
      const result = scenarioSchema.safeParse({ ...s, inputs: { ...s.inputs } });
      expect(result.success, `${s.name} failed: ${result.success ? '' : result.error.message}`).toBe(true);
    }
  });

  it('accepts a full-fat inputs object (spouse, events, RM, pensions, bands)', () => {
    const inputs = baseInputs({
      spouse: {
        enabled: true, currentAge: 57, retirementAge: 62,
        rrspBalance: 1, tfsaBalance: 2, taxableBalance: 3, cashCushionBalance: 4,
        rrspContribution: 5, tfsaContribution: 6, taxableContribution: 7,
        cppStartAge: null, cppMonthlyAmount: 900, oasStartAge: null, oasYearsInCanada: 40,
        desiredSpending: 30000,
        events: [{ id: 'e', age: 70, label: 'x', amount: 100, direction: 'out', from: { kind: 'account', person: 'spouse', account: 'rrsp' }, to: { kind: 'external' } }],
      },
      reverseMortgage: { enabled: false, homeValue: 700000, appreciationRate: 0.02, interestRate: 0.065, topUp: true },
      pensions: [{ id: 'p', label: 'DB', annualAmount: 10000, startAge: 60, endAge: 65, indexedToCpi: false }],
      employment: [{ id: 'j', label: 'part-time', annualAmount: 15000, startAge: 65, endAge: 70, destAccount: 'tfsa', topUpSpending: true, indexedToCpi: false }],
      spendingBands: [{ fromAge: 80, pctOfBase: 0.8 }],
      events: [{ id: 'ev', age: 68, label: 'sale', amount: 200000, direction: 'in', account: 'taxable' }],
    });
    expect(retirementInputsSchema.safeParse(inputs).success).toBe(true);
  });

  it('rejects an employment row with a bad destAccount', () => {
    const bad = {
      ...baseInputs(),
      employment: [{ id: 'j', label: 'x', annualAmount: 1000, startAge: 65, endAge: 66, destAccount: 'crypto', topUpSpending: false, indexedToCpi: false }],
    };
    expect(retirementInputsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects inputs with a missing required field', () => {
    const bad = baseInputs() as unknown as Record<string, unknown>;
    delete bad.desiredSpending;
    expect(retirementInputsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects inputs with the wrong primitive type', () => {
    const bad = { ...baseInputs(), currentAge: 'fifty-five' };
    expect(retirementInputsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed spouseSource variant', () => {
    const bad = { ...baseInputs(), spouseSource: { kind: 'scenario' } }; // missing scenarioId
    expect(retirementInputsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a tax table whose rates/brackets lengths disagree', () => {
    const bad = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    bad.federal.rates = [0.14]; // should be brackets.length + 1 = 5
    expect(appConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts the shipped default config', () => {
    expect(appConfigSchema.safeParse(DEFAULT_APP_CONFIG).success).toBe(true);
  });

  it('parseAppDbDoc migrates legacy inputs before validating', () => {
    const legacyScenario = {
      id: 'old', name: 'Old plan',
      inputs: {
        // v1-era shape: single annualContribution, no returnVolatility, no
        // cppAdjustedAmount, no spouseSource. The migrator fills all of them.
        ...baseInputs(),
        annualContribution: 9000,
        returnVolatility: undefined,
        cppAdjustedAmount: undefined,
        spouseSource: undefined,
      },
    };
    delete (legacyScenario.inputs as Record<string, unknown>).returnVolatility;
    delete (legacyScenario.inputs as Record<string, unknown>).cppAdjustedAmount;
    delete (legacyScenario.inputs as Record<string, unknown>).spouseSource;
    const doc = parseAppDbDoc({
      version: 1,
      scenarios: [legacyScenario],
      activeScenarioId: 'missing-id',
      config: DEFAULT_APP_CONFIG,
    });
    expect(doc).not.toBeNull();
    expect(doc!.scenarios[0].inputs.returnVolatility).toBeTypeOf('number');
    expect(doc!.scenarios[0].inputs.spouseSource).toEqual({ kind: 'builtin' });
    // A dead active id falls back to the first scenario.
    expect(doc!.activeScenarioId).toBe('old');
  });

  it('parseAppDbDoc rejects an empty scenario list and garbage', () => {
    expect(parseAppDbDoc(null)).toBeNull();
    expect(parseAppDbDoc({ version: 1, scenarios: [], activeScenarioId: 'x', config: DEFAULT_APP_CONFIG })).toBeNull();
    expect(parseAppDbDoc('a string')).toBeNull();
  });
});
