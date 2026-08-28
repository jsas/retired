import { describe, it, expect } from 'vitest';
import { executeToolCall, toolSpecs, EDITABLE_FIELDS, type ToolContext } from './tools';
import { calculateHousehold } from '../retirementEngine';
import { baseInputs, testConfig } from '../../test/helpers';

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
  it('advertises all four tools with JSON schemas', () => {
    const specs = toolSpecs();
    expect(specs.map(s => s.name).sort()).toEqual(
      ['compare_scenarios', 'get_scenario', 'run_projection', 'set_scenario_value']);
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
});

describe('compare_scenarios', () => {
  it('runs both plans and reports deltas', () => {
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

  it('errors when no override survives validation', () => {
    const out = executeToolCall(ctx(), {
      id: '1', name: 'compare_scenarios',
      args: { overrides: { bogus: 1 } },
    });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('bogus');
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
    expect(out.field).toBe('cppStartAge');
    expect(out.value).toBe(70);
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

  it('rejects unknown tool names with the available list', () => {
    const out = executeToolCall(ctx(), { id: '1', name: 'delete_everything', args: {} });
    expect(out.kind).toBe('error');
    if (out.kind === 'error') expect(out.content).toContain('get_scenario');
  });
});
