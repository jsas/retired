import { describe, it, expect } from 'vitest';
import { executeToolCall, toolSpecs, EDITABLE_FIELDS, type ToolContext } from './tools';
import { calculateHousehold, householdOutcome } from '@retired/engine-core/retirementEngine';
import { baseInputs, testConfig } from '@retired/engine-core/test/helpers';
import { captureCheckpoint, UNDEFINED_SENTINEL } from './checkpoints';
import { MemoryStore } from './memoryStore';
import type { MemoryAdapter, MemoryRecord } from './memoryStore';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import { toHousehold } from '@retired/engine-core/householdTypes';

/** Deterministic in-memory memory adapter (same shape the store tests use). */
class InMemoryAdapter implements MemoryAdapter {
  private map = new Map<string, MemoryRecord>();
  all(): MemoryRecord[] { return [...this.map.values()]; }
  put(record: MemoryRecord): void { this.map.set(record.id, record); }
  delete(id: string): void { this.map.delete(id); }
}

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    inputs: baseInputs(),
    config: testConfig(),
    scenarioName: 'Test plan',
    scenarioList: [{ id: 'a', name: 'Test plan' }],
    ...over,
  };
}

describe('toolSpecs', () => {
  it('advertises the full tool surface with JSON schemas', () => {
    const specs = toolSpecs();
    expect(specs.map(s => s.name).sort()).toEqual([
      'compare_scenarios', 'get_schedule', 'get_scenario',
      'list_scenarios',
      'manage_cash_event', 'manage_debt', 'manage_income',
      'propose_cash_event', 'propose_debt', 'propose_fhsa', 'propose_income', 'propose_patch',
      'propose_rdsp', 'propose_revert', 'propose_reverse_mortgage', 'propose_spending_bands', 'propose_spouse',
      'recall', 'remember',
      'open_scenario', 'save_scenario_as',
      'run_monte_carlo', 'run_projection', 'run_strategies',
      'set_scenario_value', 'solve_spending',
    ].sort());
    for (const s of specs) {
      expect(s.jsonSchema).toHaveProperty('type', 'object');
      expect(s.description.length).toBeGreaterThan(10);
    }
  });
});

describe('get_scenario', () => {
  it('returns the full plan by default', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'get_scenario', args: {} });
    expect(out.kind).toBe('result');
    if (out.kind !== 'result') return;
    expect(out.content).toContain('Test plan');
    expect(out.content).toContain('SUMMARY');
    expect(out.content).toContain('ACCOUNTS');
    expect(out.content).toContain('FULL INPUTS JSON');
  });

  it('returns just the requested section', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'get_scenario', args: { section: 'accounts' } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('ACCOUNTS');
    expect(out.content).not.toContain('FULL INPUTS JSON');
  });

  it('rejects an unknown section', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'get_scenario', args: { section: 'everything' } });
    expect(out.kind).toBe('error');
  });
});

describe('run_projection', () => {
  it('runs the engine on the current plan and reports the verdict', () => {
    const c = ctx();
    const expected = calculateHousehold(c.inputs, c.config);
    const out = executeToolCall(c, { id: '1', name: 'run_projection', args: {} });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain(expected.status === 'ON_TRACK' ? 'ON TRACK' : 'SHORTFALL');
    expect(out.content).toContain('lifetime tax');
  });

  it('applies valid overrides to a copy, and reports invalid ones', () => {
    const c = ctx();
    const out = executeToolCall(c, {
      id: '1', name: 'run_projection',
      args: { overrides: { desiredSpending: 40000, nonsense: 1, desiredSpending2: 5 } },
    });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('WITH overrides');
    expect(out.content).toContain('nonsense');
    // The caller's inputs must not be mutated by the what-if run.
    expect(c.inputs.desiredSpending).toBe(20000);
  });

  it('refuses structural fields in overrides', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'run_projection',
      args: { overrides: { spouse: { enabled: true } } },
    });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('structural field');
  });

  it('headline verdict is the HOUSEHOLD one for a couple, per-person stays as detail (A-03)', () => {
    // The primary's silo depletes; the funded spouse covers the gap. The old
    // per-person headline would read SHORTFALL while householdOutcome (the
    // dashboard/MC verdict, #33) says the household is fine.
    const inputs = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 90,
      rrspBalance: 100000, tfsaBalance: 0, taxableBalance: 0,
      cppStartAge: 65, cppMonthlyAmount: 500, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 20000, income: [],
      spouse: {
        enabled: true, currentAge: 65, retirementAge: 65,
        rrspBalance: 900000, tfsaBalance: 200000, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 25000, income: [],
      },
    });
    const hr = calculateHousehold(inputs, testConfig());
    // Fixture sanity: the primary's own silo really does deplete, and the
    // household verdict really is ON_TRACK — otherwise this proves nothing.
    expect(hr.status).toBe('SHORTFALL');
    const ho = householdOutcome(hr, toHousehold(inputs));
    expect(ho.status).toBe('ON_TRACK');

    const out = executeToolCall(ctx({ inputs, config: testConfig() }), {
      id: '1', name: 'run_projection', args: {},
    });
    if (out.kind !== 'result') throw new Error('expected result');
    // Headline = household verdict…
    expect(out.content).toMatch(/Result: ON TRACK — household funded to age 90\+/);
    // …and the per-person verdicts are demoted to a labeled detail line.
    expect(out.content).toContain('per-person (detail): you deplete at');
    expect(out.content).toContain('spouse on track');
  });
});

describe('compare_scenarios', () => {
  it('runs both plans and reports deltas (singular overrides form)', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'compare_scenarios',
      args: { overrides: { desiredSpending: 30000 } },
    });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('CURRENT plan');
    expect(out.content).toContain('VARIANT');
    expect(out.content).toContain('DELTAS');
    expect(out.content).toContain('"desiredSpending":30000');
  });

  it('compares several variants in one call (variants form)', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'compare_scenarios',
      args: {
        variants: [
          { label: 'Retire at 60', overrides: { retirementAge: 60 } },
          { label: 'Retire at 70', overrides: { retirementAge: 70 } },
        ],
      },
    });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('CURRENT plan');
    expect(out.content).toContain('Retire at 60');
    expect(out.content).toContain('Retire at 70');
    expect(out.content).toContain('DELTAS');
    expect(out.content).toContain('Comparing 2 variants');
  });

  it('caps variants at 4 and skips an invalid variant without killing the batch', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'compare_scenarios',
      args: {
        variants: [
          { label: 'Good', overrides: { desiredSpending: 25000 } },
          { label: 'Bad', overrides: { bogus: 1 } },
        ],
      },
    });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('Good');
    expect(out.content).toContain('Skipped variant "Bad"');
  });

  it('variants take precedence when both forms are passed', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'compare_scenarios',
      args: {
        overrides: { desiredSpending: 30000 },
        variants: [{ label: 'List form', overrides: { desiredSpending: 28000 } }],
      },
    });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('"desiredSpending":28000');
    expect(out.content).not.toContain('"desiredSpending":30000');
  });

  it('errors when no override survives validation in ANY variant', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'compare_scenarios',
      args: { variants: [{ overrides: { bogus: 1 } }] },
    });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('bogus');
  });

  it('errors when neither form is provided', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'compare_scenarios', args: {} });
    expect(out.kind).toBe('error');
  });
});

describe('set_scenario_value', () => {
  it('proposes a mutation with a from→to preview for a valid change', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'set_scenario_value',
      args: { field: 'cppStartAge', value: 70, rationale: 'deferral bonus' },
    });
    expect(out.kind).toBe('mutation');
    if (out.kind !== 'mutation') return;
    expect(out.patch).toEqual({ cppStartAge: 70 });
    expect(out.preview).toEqual({ field: 'cppStartAge', from: null, to: 70 });
    expect(out.rationale).toBe('deferral bonus');
  });

  it('rejects fields outside the editable allow-list', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'set_scenario_value',
      args: { field: 'annualWithdrawal', value: 5 },
    });
    expect(out.kind).toBe('error');
    expect(EDITABLE_FIELDS.has('annualWithdrawal')).toBe(false);
  });

  it('rejects a value that fails the scenario schema', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'set_scenario_value',
      args: { field: 'desiredSpending', value: 'lots' },
    });
    expect(out.kind).toBe('error');
  });

  it('coerces a stringified number ("65") instead of rejecting it', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'set_scenario_value',
      args: { field: 'oasStartAge', value: '65' },
    });
    expect(out.kind).toBe('mutation');
    if (out.kind !== 'mutation') return;
    expect(out.patch).toEqual({ oasStartAge: 65 });
    expect(out.preview).toEqual({ field: 'oasStartAge', from: null, to: 65 });
  });

  it('coerces "null" for a nullable age field', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'set_scenario_value',
      args: { field: 'cppStartAge', value: 'null' },
    });
    expect(out.kind).toBe('mutation');
    if (out.kind !== 'mutation') return;
    expect(out.patch).toEqual({ cppStartAge: null });
  });

  it('sets and clears contribution room (issue #24)', () => {
    // Room fields are editable scalars: a number turns tracking on, null clears.
    expect(EDITABLE_FIELDS.has('tfsaRoom')).toBe(true);
    expect(EDITABLE_FIELDS.has('rrspRoom')).toBe(true);
    const on = executeToolCall(ctx(), {
      id: '1', name: 'set_scenario_value',
      args: { field: 'tfsaRoom', value: 40000 },
    });
    expect(on.kind).toBe('mutation');
    if (on.kind !== 'mutation') return;
    expect(on.patch).toEqual({ tfsaRoom: 40000 });
    const off = executeToolCall(ctx(), {
      id: '2', name: 'set_scenario_value',
      args: { field: 'tfsaRoom', value: 'null' },
    });
    expect(off.kind).toBe('mutation');
    if (off.kind !== 'mutation') return;
    expect(off.patch).toEqual({ tfsaRoom: null });
  });

  it('leaves a real string field untouched (no coercion needed)', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'set_scenario_value',
      args: { field: 'provinceCode', value: 'BC' },
    });
    expect(out.kind).toBe('mutation');
    if (out.kind !== 'mutation') return;
    expect(out.patch).toEqual({ provinceCode: 'BC' });
  });

  it('rejects unknown tool names with the available list', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'delete_everything', args: {} });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('get_scenario');
  });
});

describe('propose_patch', () => {
  it('batches several valid scalar changes into one patch', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_patch',
      args: { changes: { cppStartAge: 70, oasStartAge: 70, desiredSpending: 55000 } },
    });
    expect(out.kind).toBe('mutation');
    if (out.kind !== 'mutation') return;
    expect(out.patch).toEqual({ cppStartAge: 70, oasStartAge: 70, desiredSpending: 55000 });
    expect(out.preview).toHaveProperty('cppStartAge');
  });

  it('skips invalid entries and reports them, but still proposes the valid ones', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_patch',
      args: { changes: { cppStartAge: 70, spouse: { enabled: true }, bogus: 1 } },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    expect(out.patch).toEqual({ cppStartAge: 70 });
    expect(out.rationale).toContain('skipped invalid');
  });

  it('errors when nothing in the batch is valid', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_patch', args: { changes: { bogus: 1 } },
    });
    expect(out.kind).toBe('error');
  });

  it('coerces stringified scalars in a batch instead of dropping them', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_patch',
      args: { changes: { cppStartAge: '70', oasStartAge: '65' } },
    });
    expect(out.kind).toBe('mutation');
    if (out.kind !== 'mutation') return;
    expect(out.patch).toEqual({ cppStartAge: 70, oasStartAge: 65 });
    expect(out.rationale).not.toContain('skipped invalid');
  });
});

describe('propose_spouse', () => {
  it('proposes adding a spouse from a full block', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_spouse',
      args: { changes: {
        enabled: true, currentAge: 60, retirementAge: 65,
        rrspBalance: 100000, tfsaBalance: 50000, taxableBalance: 20000, cashCushionBalance: 5000,
        rrspContribution: 5000, tfsaContribution: 3000, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 30000,
      } },
    });
    expect(out.kind).toBe('mutation');
    if (out.kind !== 'mutation') return;
    expect(out.label).toBe('Add spouse/partner');
    expect((out.patch.spouse as { enabled: boolean }).enabled).toBe(true);
  });

  it('rejects an incomplete add with guidance', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_spouse', args: { changes: { enabled: true, currentAge: 60 } },
    });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('full block');
  });

  it('proposes removing a spouse', () => {
    const c = ctx();
    c.inputs = { ...c.inputs, spouse: {
      enabled: true, currentAge: 60, retirementAge: 65,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
      desiredSpending: 0,
    } };
    const out = executeToolCall(c, { id: '1', name: 'propose_spouse', args: { changes: { enabled: false } } });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    expect(out.label).toBe('Remove spouse');
  });
});

describe('propose_income / cash_event', () => {
  it('adds a pension with a generated id appended to the income register', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_income',
      args: { label: 'Work DB', kind: 'pension', annualAmount: 12000, startAge: 65, endAge: null, indexedToCpi: true },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    const income = out.patch.income as Array<{ id: string; label: string; kind: string; endAge: number | null }>;
    expect(income).toHaveLength(1);
    expect(income[0].label).toBe('Work DB');
    expect(income[0].kind).toBe('pension');
    expect(income[0].endAge).toBeNull();
    expect(income[0].id).toBeTruthy();
  });

  it('requires endAge as an explicit null, never omitted', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_income',
      args: { label: 'X', kind: 'pension', annualAmount: 1, startAge: 65, indexedToCpi: false },
    });
    expect(out.kind).toBe('error');
  });

  it('adds an employment income block', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_income',
      args: { label: 'Consulting', kind: 'employment', annualAmount: 40000, startAge: 60, endAge: 65, destAccount: 'taxable', topUpSpending: false, indexedToCpi: true },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    const income = out.patch.income as Array<{ kind: string }>;
    expect(income.length).toBe(1);
    expect(income[0].kind).toBe('employment');
  });

  it('adds a cash event', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_cash_event',
      args: { label: 'Downsize', age: 70, amount: 300000, direction: 'in', account: 'taxable' },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    expect((out.patch.events as Array<{ label: string }>)[0].label).toBe('Downsize');
  });
});

describe('propose_debt / manage_debt', () => {
  const mortgage = { id: 'd1', label: 'Mortgage', kind: 'mortgage' as const, balance: 320000, interestRate: 0.051, monthlyPayment: 2100 };

  it('adds a debt with a generated id appended to the debts list', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_debt',
      args: { label: 'Credit card', kind: 'creditCard', balance: 8000, interestRate: 0.1999, monthlyPayment: 400 },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    const debts = out.patch.debts as Array<{ id: string; label: string; kind: string }>;
    expect(debts).toHaveLength(1);
    expect(debts[0].label).toBe('Credit card');
    expect(debts[0].kind).toBe('creditCard');
    expect(debts[0].id).toBeTruthy();
  });

  it('rejects an unknown kind', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_debt',
      args: { label: 'X', kind: 'payday', balance: 1000, interestRate: 0.2, monthlyPayment: 100 },
    });
    expect(out.kind).toBe('error');
  });

  it('updates a debt by unique label, re-validated, keeping id and other fields', () => {
    const c = ctx({ inputs: baseInputs({ debts: [mortgage] }) });
    const out = executeToolCall(c, {
      id: '1', name: 'manage_debt',
      args: { action: 'update', target: 'mortgage', changes: { monthlyPayment: 2500 } },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    const debts = out.patch.debts as Array<{ id: string; monthlyPayment: number; balance: number }>;
    expect(debts[0].monthlyPayment).toBe(2500);
    expect(debts[0].id).toBe('d1'); // id immutable
    expect(debts[0].balance).toBe(320000); // untouched field survives
  });

  it('rejects an update that fails the debt schema', () => {
    const c = ctx({ inputs: baseInputs({ debts: [mortgage] }) });
    const out = executeToolCall(c, {
      id: '1', name: 'manage_debt',
      args: { action: 'update', target: 'd1', changes: { interestRate: 'high' } },
    });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('Invalid debt update');
  });

  it('removes a debt by id', () => {
    const c = ctx({ inputs: baseInputs({ debts: [mortgage, { id: 'd2', label: 'Card', kind: 'creditCard' as const, balance: 5000, interestRate: 0.2, monthlyPayment: 200 }] }) });
    const out = executeToolCall(c, { id: '1', name: 'manage_debt', args: { action: 'remove', target: 'd1' } });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    expect((out.patch.debts as unknown[]).map(e => (e as { id: string }).id)).toEqual(['d2']);
  });

  it('errors on an unknown target and on an empty plan', () => {
    const empty = executeToolCall(ctx(), { id: '1', name: 'manage_debt', args: { action: 'remove', target: 'd1' } });
    expect(empty.kind).toBe('error');
    if (empty.kind === 'error') expect(empty.content).toContain('no debts');

    const one = ctx({ inputs: baseInputs({ debts: [mortgage] }) });
    const missing = executeToolCall(one, { id: '1', name: 'manage_debt', args: { action: 'remove', target: 'zzz' } });
    expect(missing.kind).toBe('error');
    if (missing.kind === 'error') expect(missing.content).toContain('Mortgage');
  });

  it('refuses a flat override that targets the structural debts field', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'run_projection',
      args: { overrides: { debts: [mortgage] } },
    });
    // Structural fields are rejected in overrides (use propose_debt instead).
    expect(out.kind === 'error' || (out.kind === 'result' && /rejected|debts/i.test(out.content))).toBe(true);
  });

  it('surfaces debts in the get_scenario spending section', () => {
    const c = ctx({ inputs: baseInputs({ debts: [mortgage] }) });
    const out = executeToolCall(c, { id: '1', name: 'get_scenario', args: { section: 'spending' } });
    expect(out.kind).toBe('result');
    if (out.kind === 'result') {
      expect(out.content).toContain('Mortgage');
      expect(out.content).toContain('funded from spending');
    }
  });
});

describe('propose_spending_bands', () => {
  it('sorts bands and proposes the replacement set', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_spending_bands',
      args: { bands: [{ fromAge: 80, pctOfBase: 0.7 }, { fromAge: 65, pctOfBase: 1 }] },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    expect(out.patch.spendingBands).toEqual([{ fromAge: 65, pctOfBase: 1 }, { fromAge: 80, pctOfBase: 0.7 }]);
  });

  it('rejects an out-of-range pctOfBase', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_spending_bands', args: { bands: [{ fromAge: 65, pctOfBase: 9 }] },
    });
    expect(out.kind).toBe('error');
  });
});

describe('propose_reverse_mortgage', () => {
  it('proposes enabling a reverse mortgage from a full block', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_reverse_mortgage',
      args: { changes: { enabled: true, homeValue: 800000, appreciationRate: 0.02, interestRate: 0.065, topUp: true } },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    expect(out.label).toBe('Enable reverse mortgage');
    expect((out.patch.reverseMortgage as { enabled: boolean }).enabled).toBe(true);
  });

  it('rejects an incomplete enable with guidance', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_reverse_mortgage', args: { changes: { enabled: true, homeValue: 800000 } },
    });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('homeValue, appreciationRate, and interestRate');
  });
});

describe('propose_rdsp', () => {
  it('proposes enabling an RDSP from a full block', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_rdsp',
      args: { changes: { enabled: true, balance: 15000, contribution: 500, familyIncome: 35000, dtcEligible: true } },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    expect(out.label).toBe('Enable RDSP');
    const rdsp = out.patch.rdsp as { enabled: boolean; balance: number; contribution: number; familyIncome: number; dtcEligible: boolean };
    expect(rdsp.enabled).toBe(true);
    expect(rdsp.balance).toBe(15000);
    expect(rdsp.contribution).toBe(500);
    expect(rdsp.familyIncome).toBe(35000);
    expect(rdsp.dtcEligible).toBe(true);
  });

  it('rejects an incomplete enable with guidance', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'propose_rdsp', args: { changes: { enabled: true, balance: 10000 } },
    });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('balance, contribution, familyIncome, and dtcEligible');
  });

  it('proposes disabling an RDSP', () => {
    const c = ctx({
      inputs: baseInputs({
        rdsp: { enabled: true, balance: 20000, contribution: 1000, familyIncome: 40000, dtcEligible: true },
      }),
    });
    const out = executeToolCall(c, {
      id: '1', name: 'propose_rdsp', args: { changes: { enabled: false } },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    expect(out.label).toBe('Disable RDSP');
    expect((out.patch.rdsp as { enabled: boolean }).enabled).toBe(false);
  });

  it('proposes updating an existing RDSP', () => {
    const c = ctx({
      inputs: baseInputs({
        rdsp: { enabled: true, balance: 20000, contribution: 1000, familyIncome: 40000, dtcEligible: true },
      }),
    });
    const out = executeToolCall(c, {
      id: '1', name: 'propose_rdsp', args: { changes: { contribution: 1500 } },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    expect(out.label).toBe('Update RDSP');
    const rdsp = out.patch.rdsp as { contribution: number; balance: number };
    expect(rdsp.contribution).toBe(1500);
    expect(rdsp.balance).toBe(20000); // untouched fields survive
  });

  it('rejects rdsp as a flat override — points to the structural tool', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'run_projection',
      args: { overrides: { rdsp: { enabled: true } } },
    });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('structural field');
  });

  it('shows rdsp in the accounts section when enabled', () => {
    const c = ctx({
      inputs: baseInputs({
        rdsp: { enabled: true, balance: 25000, contribution: 500, familyIncome: 30000, dtcEligible: true },
      }),
    });
    const out = executeToolCall(c, { id: '1', name: 'get_scenario', args: { section: 'accounts' } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('rdsp');
    expect(out.content).toContain('25000');
  });

  it('omits rdsp from the accounts section when not configured', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'get_scenario', args: { section: 'accounts' } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).not.toContain('"rdsp"');
  });
});

describe('propose_revert', () => {
  it('errors clearly when no checkpoints exist', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'propose_revert', args: {} });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('nothing to revert');
  });

  it('reverts to the most recent checkpoint by default, as a diff patch', () => {
    const before = baseInputs({ desiredSpending: 20000 });
    const live = { ...before, desiredSpending: 40000, cppStartAge: 70 };
    const c = ctx({
      inputs: live,
      checkpoints: [captureCheckpoint('Set desiredSpending', before)],
    });
    const out = executeToolCall(c, { id: '1', name: 'propose_revert', args: {} });
    expect(out.kind).toBe('mutation');
    if (out.kind !== 'mutation') return;
    expect(out.label).toContain('Set desiredSpending');
    // The diff is live→checkpoint: spending and CPP both differed, so both
    // roll back (CPP's checkpoint value is null — it was set AFTER the snapshot).
    expect(out.patch).toEqual({ desiredSpending: 20000, cppStartAge: null });
    expect(out.revert).toBe(true);
    expect(out.preview).toHaveProperty('desiredSpending');
  });

  it('removes structural fields added after the checkpoint via the sentinel', () => {
    const before = baseInputs();
    const withSpouse = { ...before, spouse: spouseBlock() };
    const c = ctx({
      inputs: withSpouse,
      checkpoints: [captureCheckpoint('Add spouse', before)],
    });
    const out = executeToolCall(c, { id: '1', name: 'propose_revert', args: {} });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    // JSON can't carry undefined — the patch encodes the removal instead.
    expect(out.patch.spouse).toBe(UNDEFINED_SENTINEL);
    expect(out.revert).toBe(true);
  });

  it('reverts to a named checkpoint by label', () => {
    const first = baseInputs({ desiredSpending: 20000 });
    const second = { ...first, desiredSpending: 30000 };
    const live = { ...second, cppStartAge: 70 };
    const c = ctx({
      inputs: live,
      checkpoints: [
        captureCheckpoint('Lower spending', first),
        captureCheckpoint('Defer CPP', second),
      ],
    });
    const out = executeToolCall(c, { id: '1', name: 'propose_revert', args: { checkpoint: 'lower spending' } });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    expect(out.label).toContain('Lower spending');
    expect(out.patch).toEqual({ desiredSpending: 20000, cppStartAge: null });
  });

  it('errors on an unknown checkpoint name with the recent list', () => {
    const c = ctx({ checkpoints: [captureCheckpoint('Add pension', baseInputs())] });
    const out = executeToolCall(c, { id: '1', name: 'propose_revert', args: { checkpoint: 'nope' } });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('Add pension');
  });

  it('errors when the plan already matches the checkpoint', () => {
    const before = baseInputs();
    const c = ctx({ inputs: before, checkpoints: [captureCheckpoint('Add pension', before)] });
    const out = executeToolCall(c, { id: '1', name: 'propose_revert', args: {} });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('nothing to revert');
  });
});

describe('manage_cash_event / manage_income', () => {
  it('updates a cash event by unique label, re-validated', () => {
    const c = ctx({ inputs: baseInputs({ events: [{ id: 'e1', label: 'Downsize', age: 70, amount: 300000, direction: 'in', account: 'taxable' }] }) });
    const out = executeToolCall(c, {
      id: '1', name: 'manage_cash_event',
      args: { action: 'update', target: 'downsize', changes: { amount: 250000 } },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    const events = out.patch.events as Array<{ id: string; amount: number; label: string }>;
    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe(250000);
    expect(events[0].id).toBe('e1'); // id immutable
    expect(events[0].label).toBe('Downsize'); // untouched fields survive
  });

  it('updates a pension by exact id, including an explicit null endAge', () => {
    const c = ctx({ inputs: baseInputs({ income: [{ id: 'p1', label: 'Work DB', kind: 'pension', annualAmount: 12000, startAge: 65, endAge: 75, indexedToCpi: true }] }) });
    const out = executeToolCall(c, {
      id: '1', name: 'manage_income',
      args: { action: 'update', target: 'p1', changes: { endAge: null } },
    });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    const income = out.patch.income as Array<{ id: string; endAge: number | null }>;
    expect(income[0].endAge).toBeNull();
  });

  it('rejects an update that fails the element schema', () => {
    const c = ctx({ inputs: baseInputs({ income: [{ id: 'p1', label: 'Work DB', kind: 'pension', annualAmount: 12000, startAge: 65, endAge: null, indexedToCpi: true }] }) });
    const out = executeToolCall(c, {
      id: '1', name: 'manage_income',
      args: { action: 'update', target: 'p1', changes: { annualAmount: 'lots' } },
    });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('Invalid income source update');
  });

  it('removes a cash event by id', () => {
    const c = ctx({ inputs: baseInputs({
      events: [
        { id: 'e1', label: 'Downsize', age: 70, amount: 300000, direction: 'in', account: 'taxable' },
        { id: 'e2', label: 'Gift', age: 60, amount: 10000, direction: 'out' },
      ],
    }) });
    const out = executeToolCall(c, { id: '1', name: 'manage_cash_event', args: { action: 'remove', target: 'e1' } });
    if (out.kind !== 'mutation') throw new Error('expected mutation');
    expect((out.patch.events as unknown[]).map(e => (e as { id: string }).id)).toEqual(['e2']);
  });

  it('errors on ambiguous labels, unknown targets, and empty plans', () => {
    const two = ctx({ inputs: baseInputs({ events: [
      { id: 'e1', label: 'Gift', age: 60, amount: 10000, direction: 'out' },
      { id: 'e2', label: 'Gift', age: 61, amount: 12000, direction: 'out' },
    ] }) });
    const ambiguous = executeToolCall(two, { id: '1', name: 'manage_cash_event', args: { action: 'remove', target: 'gift' } });
    expect(ambiguous.kind).toBe('error');
    if (ambiguous.kind === 'error') expect(ambiguous.content).toContain('ids');

    const none = ctx();
    const missing = executeToolCall(none, { id: '1', name: 'manage_cash_event', args: { action: 'remove', target: 'e1' } });
    expect(missing.kind).toBe('error');
    if (missing.kind === 'error') expect(missing.content).toContain('no cash events');

    const one = ctx({ inputs: baseInputs({ events: [{ id: 'e1', label: 'Downsize', age: 70, amount: 1, direction: 'in' }] }) });
    const unknown = executeToolCall(one, { id: '1', name: 'manage_cash_event', args: { action: 'remove', target: 'zzz' } });
    expect(unknown.kind).toBe('error');
    if (unknown.kind === 'error') expect(unknown.content).toContain('Downsize');
  });

  it('rejects an update with no changes given', () => {
    const c = ctx({ inputs: baseInputs({ income: [{ id: 'p1', label: 'Work DB', kind: 'pension', annualAmount: 12000, startAge: 65, endAge: null, indexedToCpi: true }] }) });
    const out = executeToolCall(c, { id: '1', name: 'manage_income', args: { action: 'update', target: 'p1' } });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('no fields were given');
  });
});

// A minimal valid spouse block for checkpoint/removal tests.
function spouseBlock(): RetirementInputs['spouse'] {
  return {
    enabled: true, currentAge: 60, retirementAge: 65,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
    cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
    desiredSpending: 0,
  };
}

describe('read backends', () => {
  it('run_strategies ranks variants and suggests levers', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'run_strategies', args: {} });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('CURRENT plan');
    expect(out.content).toContain('sustainable spending');
    expect(out.content).toContain('Suggested levers');
  });

  it('run_strategies scopes to requested categories', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'run_strategies', args: { categories: ['cpp', 'oas'] } });
    if (out.kind !== 'result') throw new Error('expected result');
    // CPP/OAS rows present…
    expect(out.content).toContain('CPP');
    // …and withdrawal-order rows excluded.
    expect(out.content).not.toContain('Withdraw TFSA');
  });

  it('run_strategies errors on an unknown category instead of silently narrowing', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'run_strategies', args: { categories: ['cppp'] } });
    expect(out.kind).toBe('error');
  });

  it('run_strategies caps the variant list with maxVariants', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'run_strategies', args: { maxVariants: 3 } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('hidden by filters');
  });

  it('solve_spending returns a sustainable spending figure', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'solve_spending', args: { targetSuccessRate: 0.9, runs: 100 } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('Max sustainable after-tax spending');
    expect(out.content).toContain('90%');
  });

  it('solve_spending accepts what-if overrides without touching the plan', () => {
    const c = ctx({ inputs: baseInputs({ cppStartAge: 65, cppMonthlyAmount: 1000 }) });
    const withCpp = executeToolCall(c, {
      id: '1', name: 'solve_spending',
      args: { targetSuccessRate: 0.9, runs: 100 },
    });
    const withoutCpp = executeToolCall(c, {
      id: '2', name: 'solve_spending',
      args: { targetSuccessRate: 0.9, runs: 100, overrides: { cppMonthlyAmount: 0 } },
    });
    if (withCpp.kind !== 'result' || withoutCpp.kind !== 'result') throw new Error('expected results');
    // Zeroing CPP via the override changes the solved spending — it landed.
    expect(withoutCpp.content).not.toBe(withCpp.content);
    // Caller's plan is untouched.
    expect(c.inputs.cppMonthlyAmount).toBe(1000);
  });

  it('solve_spending reports invalid overrides instead of applying them', () => {
    const c = ctx({ inputs: baseInputs({ cppMonthlyAmount: 1000 }) });
    const out = executeToolCall(c, {
      id: '1', name: 'solve_spending',
      args: { targetSuccessRate: 0.9, runs: 100, overrides: { spouse: { enabled: true } } },
    });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('structural field');
    expect(c.inputs.cppMonthlyAmount).toBe(1000);
  });

  it('run_monte_carlo returns a success rate', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'run_monte_carlo', args: { runs: 100 } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('success rate');
  });

  it('run_monte_carlo applies what-if overrides and leaves the plan untouched', () => {
    const c = ctx({ inputs: baseInputs({ desiredSpending: 20000, tfsaBalance: 500000 }) });
    const out = executeToolCall(c, {
      id: '1', name: 'run_monte_carlo',
      args: { runs: 100, overrides: { desiredSpending: 60000 } },
    });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('WITH overrides');
    // A 3x spending jump on the same portfolio must change the answer vs base.
    const base = executeToolCall(c, { id: '2', name: 'run_monte_carlo', args: { runs: 100 } });
    if (base.kind !== 'result') throw new Error('expected result');
    expect(out.content).not.toBe(base.content);
    expect(c.inputs.desiredSpending).toBe(20000);
  });

  it('get_schedule returns year rows for the requested range', () => {
    const c = ctx();
    const out = executeToolCall(c, { id: '1', name: 'get_schedule', args: { fromAge: c.inputs.currentAge, toAge: c.inputs.currentAge + 2 } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain(`age ${c.inputs.currentAge}:`);
    expect(out.content).toContain('withdrew');
  });

  it('get_schedule stride skips years but always keeps the last', () => {
    const c = ctx();
    const from = c.inputs.currentAge;      // 65
    const to = c.inputs.currentAge + 20;   // 85
    const out = executeToolCall(c, { id: '1', name: 'get_schedule', args: { fromAge: from, toAge: to, stride: 5 } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain(`age ${from}:`);
    expect(out.content).toContain(`age ${from + 5}:`);
    expect(out.content).toContain(`age ${to}:`);
    expect(out.content).not.toContain(`age ${from + 1}:`);
  });
});

describe('remember / recall', () => {
  it('remember stores a fact and recall returns it', () => {
    const memory = new MemoryStore(new InMemoryAdapter());
    const c = ctx({ memory, memoryScenarioId: 'sc-1' });
    const put = executeToolCall(c, {
      id: '1', name: 'remember',
      args: { text: 'Spouse retires at 63, not 65.', scope: 'scenario', importance: 0.8 },
    });
    if (put.kind !== 'result') throw new Error('expected result');
    expect(put.content).toContain('Remembered');

    const got = executeToolCall(c, { id: '2', name: 'recall', args: { query: 'spouse' } });
    if (got.kind !== 'result') throw new Error('expected result');
    expect(got.content).toContain('[scenario]');
    expect(got.content).toContain('Spouse retires at 63');
    expect(got.content).toContain('importance 0.80');
  });

  it('recall without a query lists the top memories', () => {
    const memory = new MemoryStore(new InMemoryAdapter());
    const c = ctx({ memory, memoryScenarioId: 'sc-1' });
    executeToolCall(c, { id: '1', name: 'remember', args: { text: 'First fact.' } });
    executeToolCall(c, { id: '2', name: 'remember', args: { text: 'Second fact.' } });
    const out = executeToolCall(c, { id: '3', name: 'recall', args: {} });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('First fact.');
    expect(out.content).toContain('Second fact.');
  });

  it('global memories are visible from any scenario, scenario ones are not', () => {
    const memory = new MemoryStore(new InMemoryAdapter());
    const here = ctx({ memory, memoryScenarioId: 'sc-1' });
    const elsewhere = ctx({ memory, memoryScenarioId: 'sc-2' });
    executeToolCall(here, { id: '1', name: 'remember', args: { text: 'Plan fact for sc-1.' } });
    executeToolCall(here, { id: '2', name: 'remember', args: { text: 'User wants to retire to Nova Scotia.', scope: 'global' } });

    const fromOther = executeToolCall(elsewhere, { id: '3', name: 'recall', args: { query: 'plan fact' } });
    if (fromOther.kind !== 'result') throw new Error('expected result');
    // The sc-1 plan fact is out of scope here; the global Nova Scotia memory
    // (matching "plan"→"plans", "fact"→"facts") comes back as a fallback hit,
    // clearly labelled as not a true match.
    expect(fromOther.content).toContain('Nothing in memory matches');
    expect(fromOther.content).toContain('Closest memories');
    expect(fromOther.content).toContain('Nova Scotia');

    const nova = executeToolCall(elsewhere, { id: '4', name: 'recall', args: { query: 'Nova Scotia' } });
    if (nova.kind !== 'result') throw new Error('expected result');
    expect(nova.content).toContain('[global] User wants to retire to Nova Scotia');
  });

  it('keyword matching: a category query finds a fact stored with hypernyms', () => {
    const memory = new MemoryStore(new InMemoryAdapter());
    const c = ctx({ memory, memoryScenarioId: 'sc-1' });
    executeToolCall(c, {
      id: '1', name: 'remember',
      args: { text: 'User likes oranges.', scope: 'global', keywords: ['fruit', 'food', 'preference'] },
    });
    const out = executeToolCall(c, { id: '2', name: 'recall', args: { query: 'favorite fruit', limit: 5 } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('[global] User likes oranges.');
    expect(out.content).not.toContain('Closest memories'); // a true hit, not the fallback
  });

  it('a miss falls back to the closest memories instead of a dead end', () => {
    const memory = new MemoryStore(new InMemoryAdapter());
    const c = ctx({ memory, memoryScenarioId: 'sc-1' });
    executeToolCall(c, { id: '1', name: 'remember', args: { text: 'User likes oranges.', scope: 'global', keywords: ['fruit'] } });
    const out = executeToolCall(c, { id: '2', name: 'recall', args: { query: 'xyzzyqqh' } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('Nothing in memory matches');
    expect(out.content).toContain('Closest memories');
    expect(out.content).toContain('[global] User likes oranges.');
    // Fallback is capped at 3 regardless of the requested limit.
    executeToolCall(c, { id: '3', name: 'remember', args: { text: 'Second fact.', scope: 'global' } });
    executeToolCall(c, { id: '4', name: 'remember', args: { text: 'Third fact.', scope: 'global' } });
    executeToolCall(c, { id: '5', name: 'remember', args: { text: 'Fourth fact.', scope: 'global' } });
    executeToolCall(c, { id: '6', name: 'remember', args: { text: 'Fifth fact.', scope: 'global' } });
    const capped = executeToolCall(c, { id: '7', name: 'recall', args: { query: 'xyzzyqqh', limit: 20 } });
    if (capped.kind !== 'result') throw new Error('expected result');
    expect(capped.content.match(/^- \[/gm)?.length).toBe(3);
  });

  it('reports when memory is unavailable instead of failing silently', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'remember', args: { text: 'Nobody will save this.' } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('Memory is unavailable');
  });
});

describe('open_scenario / save_scenario_as', () => {
  it('opens by id and announces the switch', () => {
    const opened: string[] = [];
    const c = ctx({
      scenarioList: [{ id: 'sc-1', name: 'Base' }, { id: 'sc-2', name: 'Downsized' }],
      onOpenScenario: (id) => opened.push(id),
    });
    const out = executeToolCall(c, { id: '1', name: 'open_scenario', args: { scenarioId: 'sc-2' } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(opened).toEqual(['sc-2']);
    expect(out.content).toContain('Downsized');
  });

  it('opens by unique case-insensitive name', () => {
    const opened: string[] = [];
    const c = ctx({
      scenarioList: [{ id: 'sc-1', name: 'Base' }, { id: 'sc-2', name: 'Downsized' }],
      onOpenScenario: (id) => opened.push(id),
    });
    const out = executeToolCall(c, { id: '1', name: 'open_scenario', args: { name: '  downsized ' } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(opened).toEqual(['sc-2']);
  });

  it('refuses an ambiguous name, listing the matches', () => {
    const opened: string[] = [];
    const c = ctx({
      scenarioList: [{ id: 'a', name: 'Plan' }, { id: 'b', name: 'plan' }, { id: 'c', name: 'Other' }],
      onOpenScenario: (id) => opened.push(id),
    });
    const out = executeToolCall(c, { id: '1', name: 'open_scenario', args: { name: 'plan' } });
    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.content).toContain('matches 2 scenarios');
    expect(opened).toEqual([]);
  });

  it('errors on an unknown id and lists what exists', () => {
    const c = ctx({
      scenarioList: [{ id: 'sc-1', name: 'Base' }],
      onOpenScenario: () => {},
    });
    const out = executeToolCall(c, { id: '1', name: 'open_scenario', args: { scenarioId: 'nope' } });
    expect(out.kind).toBe('error');
    if (out.kind !== 'error') return;
    expect(out.content).toContain('No saved scenario matches');
    expect(out.content).toContain('"Base" (sc-1)');
  });

  it('errors when scenario switching is unavailable', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'open_scenario', args: { scenarioId: 'sc-1' } });
    expect(out.kind).toBe('error');
  });

  it('save_scenario_as hands the name to the callback and reports success', () => {
    const names: string[] = [];
    const c = ctx({ onSaveScenarioAs: (name) => { names.push(name); return 'sc-new'; } });
    const out = executeToolCall(c, { id: '1', name: 'save_scenario_as', args: { name: ' Downsize at 65 ' } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(names).toEqual(['Downsize at 65']);
    expect(out.content).toContain('Downsize at 65');
  });

  it('save_scenario_as errors when unavailable', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'save_scenario_as', args: { name: 'x' } });
    expect(out.kind).toBe('error');
  });
});

describe('list_scenarios', () => {
  it('lists every scenario and marks the active one', () => {
    const c = ctx({
      scenarioList: [{ id: 'sc-1', name: 'Base' }, { id: 'sc-2', name: 'Downsized' }],
      activeScenarioId: 'sc-2',
    });
    const out = executeToolCall(c, { id: '1', name: 'list_scenarios', args: {} });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('2 saved scenarios');
    expect(out.content).toContain('Base');
    expect(out.content).toContain('Downsized (ACTIVE — currently open)');
    expect(out.content).toContain('[id: sc-1]');
    // Compact form: no plan numbers.
    expect(out.content).not.toContain('spending');
  });

  it('withDetails adds the active plan\'s numbers without opening anything', () => {
    const c = ctx({
      scenarioList: [{ id: 'a', name: 'Test plan' }],
      activeScenarioId: 'a',
    });
    const out = executeToolCall(c, { id: '1', name: 'list_scenarios', args: { withDetails: true } });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('spending');
    expect(out.content).toContain('RRSP');
    expect(out.content).toContain('single');
  });

  it('withDetails uses scenarioInputsById for non-active plans', () => {
    const c = ctx({
      inputs: baseInputs({ desiredSpending: 99999 }),
      scenarioList: [{ id: 'a', name: 'Test plan' }, { id: 'b', name: 'Other' }],
      activeScenarioId: 'a',
      scenarioInputsById: (id) => (id === 'b' ? baseInputs({ desiredSpending: 12345, currentAge: 71 }) : undefined),
    });
    const out = executeToolCall(c, { id: '1', name: 'list_scenarios', args: { withDetails: true } });
    if (out.kind !== 'result') throw new Error('expected result');
    // Currency-formatted: the OTHER plan's number appears, and both plans show.
    expect(out.content).toContain('$12,345/yr');
    expect(out.content).toContain('$99,999/yr');
    expect(out.content).toContain('ages 71→');
  });

  it('falls back to a compact line when details are unavailable for a plan', () => {
    const c = ctx({
      inputs: baseInputs({ desiredSpending: 50000 }),
      scenarioList: [{ id: 'a', name: 'Test plan' }, { id: 'b', name: 'Other' }],
      activeScenarioId: 'a',
      // no scenarioInputsById
    });
    const out = executeToolCall(c, { id: '1', name: 'list_scenarios', args: { withDetails: true } });
    if (out.kind !== 'result') throw new Error('expected result');
    // 'a' detailed, 'b' compact (id line only, no numbers).
    expect(out.content).toContain('spending');
    expect(out.content).toContain('- Other [id: b]');
  });

  it('handles an empty scenario list', () => {
    const out = executeToolCall(ctx({ scenarioList: [] }), { id: '1', name: 'list_scenarios', args: {} });
    if (out.kind !== 'result') throw new Error('expected result');
    expect(out.content).toContain('no saved scenarios');
  });
});
