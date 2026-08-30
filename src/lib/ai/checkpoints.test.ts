import { describe, it, expect } from 'vitest';
import {
  captureCheckpoint, appendCheckpoint, diffInputs, buildRevertPlan,
  encodeRevertPatch, decodeRevertPatch, CHECKPOINT_LIMIT, UNDEFINED_SENTINEL,
} from './checkpoints';
import { baseInputs } from '../../test/helpers';

describe('checkpoints', () => {
  it('capture deep-copies: later edits to the plan must not leak in', () => {
    const inputs = baseInputs({ desiredSpending: 20000 });
    const cp = captureCheckpoint('test', inputs);
    inputs.desiredSpending = 99999;
    inputs.tfsaBalance = 1;
    expect(cp.inputs.desiredSpending).toBe(20000);
    expect(cp.inputs.tfsaBalance).toBe(500000);
    expect(cp.inputs).not.toBe(inputs);
  });

  it('appendCheckpoint keeps only the newest LIMIT, oldest-first order', () => {
    let list = [] as ReturnType<typeof captureCheckpoint>[];
    for (let i = 0; i < CHECKPOINT_LIMIT + 3; i++) {
      list = appendCheckpoint(list, captureCheckpoint(`cp ${i}`, baseInputs()));
    }
    expect(list).toHaveLength(CHECKPOINT_LIMIT);
    expect(list[0].label).toBe('cp 3'); // oldest three dropped
    expect(list.at(-1)?.label).toBe(`cp ${CHECKPOINT_LIMIT + 2}`);
  });

  it('diffInputs reports only genuinely differing top-level fields', () => {
    const before = baseInputs({ desiredSpending: 20000 });
    const after = { ...before, desiredSpending: 30000 };
    const entries = diffInputs(before, after);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ key: 'desiredSpending', before: 20000, after: 30000 });
  });

  it('diffInputs treats absent vs present as a difference (structural rollback)', () => {
    const before = baseInputs();
    const after = { ...before, spouse: {
      enabled: true, currentAge: 60, retirementAge: 65,
      rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: null, cppMonthlyAmount: 0,
      oasStartAge: null, oasYearsInCanada: 40, desiredSpending: 0,
    } };
    const entries = diffInputs(before, after);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('spouse');
    expect(entries[0].before).toBeUndefined();
  });

  it('diffInputs ignores key ORDER in nested objects/arrays-of-objects', () => {
    const before = baseInputs({ income: [{ id: 'p1', label: 'A', kind: 'pension', annualAmount: 1, startAge: 65, endAge: null, indexedToCpi: true }] });
    const reordered = { id: 'p1', startAge: 65, endAge: null, annualAmount: 1, label: 'A', kind: 'pension' as const, indexedToCpi: true };
    const after = { ...before, income: [reordered] };
    expect(diffInputs(before, after)).toHaveLength(0);
  });

  it('buildRevertPlan produces a patch of checkpoint values for differing fields', () => {
    const before = baseInputs({ desiredSpending: 20000, rrspBalance: 0 });
    const live = { ...before, desiredSpending: 40000, rrspBalance: 150000 };
    const plan = buildRevertPlan(live, captureCheckpoint('test', before));
    expect(plan.changed).toBe(2);
    expect(plan.patch).toEqual({ desiredSpending: 20000, rrspBalance: 0 });
    expect(plan.preview.desiredSpending).toEqual({ from: 40000, to: 20000 });
  });

  it('encode/decode round-trips undefined through the sentinel', () => {
    const patch = { desiredSpending: 30000, spouse: undefined, cppStartAge: null };
    const encoded = encodeRevertPatch(patch);
    expect(encoded.spouse).toBe(UNDEFINED_SENTINEL);
    expect(encoded.cppStartAge).toBeNull();
    const decoded = decodeRevertPatch(encoded);
    expect(decoded.spouse).toBeUndefined();
    expect(decoded.cppStartAge).toBeNull();
    // And it survives a JSON round-trip (what persistence does).
    const throughJson = decodeRevertPatch(JSON.parse(JSON.stringify(encoded)));
    expect('spouse' in throughJson).toBe(true);
    expect(throughJson.spouse).toBeUndefined();
  });
});
