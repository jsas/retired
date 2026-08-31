import { describe, expect, it } from 'vitest';
import { gateReport, scoreReply } from './eval';
import { emitToolCall } from './protocol';
import type { CorpusRecord } from './buildCorpus';

const rec = (toolName: string): CorpusRecord => ({
  id: `test:${toolName}`, split: 'eval', kind: 'tool-call', scenarioId: 's',
  messages: [],
  expect: { toolName },
});

const RUN_PROJ = rec('run_projection');

describe('eval gate — scoreReply tiers', () => {
  it('fully valid: right tool, valid args, single call', () => {
    const s = scoreReply(RUN_PROJ, emitToolCall('run_projection', {}));
    expect(s.valid).toBe(true);
    expect(s.parseable && s.inCatalog && s.singleCall && s.argsValid && s.toolMatch).toBe(true);
    expect(s.reason).toBeUndefined();
  });

  it('tolerates leading prose but still valid', () => {
    const s = scoreReply(RUN_PROJ, `Let me check.\n${emitToolCall('run_projection', {})}`);
    expect(s.valid).toBe(true);
  });

  it('no-call: parseable prose but zero tool call', () => {
    const s = scoreReply(RUN_PROJ, 'You are on track, no need to check.');
    expect(s.valid).toBe(false);
    expect(s.parseable).toBe(false);
    expect(s.reason).toMatch(/no tool call/);
  });

  it('bad-json: not parseable', () => {
    const s = scoreReply(RUN_PROJ, 'TOOL_CALL: {"name":"run_projection","args":{,}}');
    expect(s.valid).toBe(false);
    expect(s.parseable).toBe(false);
    expect(s.reason).toMatch(/malformed JSON/);
  });

  it('unknown-tool: parseable shape but hallucinated name', () => {
    const s = scoreReply(RUN_PROJ, emitToolCall('make_me_rich', {}));
    expect(s.valid).toBe(false);
    expect(s.parseable).toBe(true);
    expect(s.inCatalog).toBe(false);
    expect(s.reason).toMatch(/hallucinated tool/);
  });

  it('args-invalid: right tool, args fail the Zod schema', () => {
    // run_projection.overrides must be an object; a string fails the schema.
    const s = scoreReply(RUN_PROJ, emitToolCall('run_projection', { overrides: 'bogus' }));
    expect(s.parseable && s.inCatalog && s.singleCall).toBe(true);
    expect(s.argsValid).toBe(false);
    expect(s.valid).toBe(false);
    expect(s.reason).toMatch(/args fail run_projection schema/);
  });

  it('wrong-tool: valid call, but not the expected one', () => {
    const s = scoreReply(RUN_PROJ, emitToolCall('get_scenario', { section: 'accounts' }));
    expect(s.argsValid).toBe(true);
    expect(s.toolMatch).toBe(false);
    expect(s.valid).toBe(false);
    expect(s.reason).toMatch(/wrong tool/);
  });

  it('multi-call: parseable + in-catalog but off the one-call discipline', () => {
    const reply = `${emitToolCall('run_projection', {})}\n${emitToolCall('get_scenario', {})}`;
    const s = scoreReply(RUN_PROJ, reply);
    expect(s.parseable && s.inCatalog && s.argsValid).toBe(true);
    expect(s.singleCall).toBe(false);
    expect(s.valid).toBe(false);
    expect(s.reason).toMatch(/multiple calls/);
  });

  it('set_scenario_value: schema validates shape, not field membership', () => {
    const setRec = rec('set_scenario_value');
    const good = scoreReply(setRec, emitToolCall('set_scenario_value', { field: 'cppStartAge', value: 70 }));
    expect(good.valid).toBe(true);
    // `field` is z.string().min(1) — EDITABLE_FIELDS membership is enforced by
    // the EXECUTOR, not the schema, so a bogus field is still "argsValid" at
    // this tier. The gate reports the honest schema-level result.
    const bogusField = scoreReply(setRec, emitToolCall('set_scenario_value', { field: 'bogusField', value: 1 }));
    expect(bogusField.argsValid).toBe(true);
    // …but an empty field string IS a schema failure (min(1)).
    const emptyField = scoreReply(setRec, emitToolCall('set_scenario_value', { field: '', value: 1 }));
    expect(emptyField.argsValid).toBe(false);
    expect(emptyField.valid).toBe(false);
  });
});

describe('eval gate — gateReport aggregation', () => {
  const records = [RUN_PROJ, RUN_PROJ, RUN_PROJ, RUN_PROJ];

  it('computes protocol-validity and tier fractions', () => {
    const replies = [
      emitToolCall('run_projection', {}),           // valid
      emitToolCall('get_scenario', {}),             // wrong tool (argsValid)
      'no call here',                               // no-call
      emitToolCall('run_projection', { overrides: 'x' }), // args-invalid
    ];
    const r = gateReport('test-model', records, replies, 0.95);
    expect(r.total).toBe(4);
    expect(r.protocolValidity).toBe(0.25);
    expect(r.tiers.parseable).toBe(0.75);
    expect(r.tiers.inCatalog).toBe(0.75);
    expect(r.tiers.toolMatch).toBe(0.5);
    expect(r.passed).toBe(false);
    expect(Object.keys(r.failures).length).toBeGreaterThan(0);
  });

  it('passes when validity meets the threshold', () => {
    const replies = records.map(() => emitToolCall('run_projection', {}));
    const r = gateReport('good-model', records, replies, 0.95);
    expect(r.protocolValidity).toBe(1);
    expect(r.passed).toBe(true);
  });

  it('throws when records and replies misalign', () => {
    expect(() => gateReport('m', [RUN_PROJ], [], 0.9)).toThrow(/align/);
  });
});
