import { describe, it, expect } from 'vitest';
import { migrateInputs } from './scenarioStorage';

// These tests pin the migration behaviour so scenarios saved by older builds
// keep working as the inputs schema grows.

describe('migrateInputs', () => {
  it('back-fills an empty pension list for primary and spouse', () => {
    const m = migrateInputs({ spouse: { enabled: true } });
    expect(m.pensions).toEqual([]);
    expect((m.spouse as { pensions: unknown[] }).pensions).toEqual([]);
  });

  it('splits a legacy single annualContribution into the TFSA', () => {
    const m = migrateInputs({ annualContribution: 6000 });
    expect('annualContribution' in m).toBe(false);
    expect(m.tfsaContribution).toBe(6000);
    expect(m.rrspContribution).toBe(0);
    expect(m.taxableContribution).toBe(0);
  });

  it('flags legacy CPP amounts as already-adjusted', () => {
    expect(migrateInputs({}).cppAdjustedAmount).toBe(true);
  });

  it('defaults returnVolatility when missing', () => {
    expect(migrateInputs({}).returnVolatility).toBe(0.15);
  });

  it('leaves a fully-populated record untouched', () => {
    const full = {
      annualContribution: undefined,
      returnVolatility: 0.2,
      cppAdjustedAmount: false,
      pensions: [{ id: 'p', label: 'x', annualAmount: 1, startAge: 65, endAge: null, indexedToCpi: true }],
      spouse: { enabled: true, pensions: [] },
    };
    const m = migrateInputs(full);
    expect(m.returnVolatility).toBe(0.2);
    expect(m.cppAdjustedAmount).toBe(false);
    expect(m.pensions).toHaveLength(1);
  });

  it('tolerates a reverse-mortgage-free record (feature is opt-in)', () => {
    // No reverseMortgage key at all — the engine treats it as disabled.
    const m = migrateInputs({});
    expect(m.reverseMortgage).toBeUndefined();
  });

  it('normalizes a missing spouseSource to a builtin adapter', () => {
    // Scenarios saved before spouse adapters existed have no spouseSource key;
    // they should become explicit builtin adapters (embedded spouse, edited inline).
    const m = migrateInputs({ spouse: { enabled: true } });
    expect(m.spouseSource).toEqual({ kind: 'builtin' });
  });

  it('keeps a valid scenario spouseSource and drops a malformed one', () => {
    const linked = migrateInputs({ spouseSource: { kind: 'scenario', scenarioId: 'abc' } });
    expect(linked.spouseSource).toEqual({ kind: 'scenario', scenarioId: 'abc' });

    const noId = migrateInputs({ spouseSource: { kind: 'scenario' } });
    expect(noId.spouseSource).toEqual({ kind: 'builtin' });

    const garbage = migrateInputs({ spouseSource: 42 });
    expect(garbage.spouseSource).toEqual({ kind: 'builtin' });
  });
});
