import { describe, expect, it } from 'vitest';
import { gateReport, scoreFollowup, scoreMutationConfirm, scoreReply } from './eval';
import { emitToolCall } from './protocol';
import { mintReadRecords } from './mint';
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

describe('eval gate — multi-turn followup grading', () => {
  // A real follow-up record from the corpus carries the genuine engine result
  // in messages[2] and the grounding expectations in expect.
  const followRec = mintReadRecords().find((r) => r.kind === 'tool-followup')!;
  const callTarget = followRec.messages[1].content;       // canonical TOOL_CALL
  const resultText = followRec.messages[2].content;        // fed-back [OK] result
  const aFigure = (resultText.match(/\$[\d,]+/) ?? [''])[0]; // a real figure from the result

  it('passes a correct call + grounded non-advisory continuation', () => {
    const cont = `Net worth at retirement is ${aFigure}. Those are the consequences from your plan.`;
    const s = scoreFollowup(followRec, callTarget, cont);
    expect(s.call.valid).toBe(true);
    expect(s.grounded).toBe(true);
    expect(s.nonAdvisory).toBe(true);
    expect(s.pass).toBe(true);
  });

  it('fails when the continuation ignores the tool result', () => {
    const s = scoreFollowup(followRec, callTarget, 'Everything looks fine, no numbers needed.');
    expect(s.grounded).toBe(false);
    expect(s.pass).toBe(false);
    expect(s.reason).toMatch(/does not reference/);
  });

  it('fails when the continuation crosses into advice', () => {
    const s = scoreFollowup(followRec, callTarget, `At ${aFigure} you should retire at 60.`);
    expect(s.nonAdvisory).toBe(false);
    expect(s.pass).toBe(false);
  });

  it('fails when the tool call itself is invalid', () => {
    const s = scoreFollowup(followRec, emitToolCall('wrong_tool', {}), `At ${aFigure}.`);
    expect(s.call.valid).toBe(false);
    expect(s.pass).toBe(false);
  });
});

describe('eval gate — mutation-confirm grading', () => {
  const proposeCall = emitToolCall('set_scenario_value', { field: 'cppStartAge', value: 70 });

  it('approved: pass when the model confirms without re-proposing', () => {
    const s = scoreMutationConfirm(proposeCall, 'set_scenario_value', true,
      'Done — CPP now starts at 70 and it is live in your plan.');
    expect(s.callValid && s.noRepropose && s.acknowledges).toBe(true);
    expect(s.pass).toBe(true);
  });

  it('approved: fail when the model re-proposes the same change', () => {
    const s = scoreMutationConfirm(proposeCall, 'set_scenario_value', true,
      `Confirmed.\n${proposeCall}`);
    expect(s.noRepropose).toBe(false);
    expect(s.pass).toBe(false);
    expect(s.reason).toMatch(/re-proposed/);
  });

  it('rejected: pass when the model accepts and does not repeat', () => {
    const s = scoreMutationConfirm(proposeCall, 'set_scenario_value', false,
      'Understood — I have left the plan unchanged.');
    expect(s.pass).toBe(true);
  });

  it('rejected: fail when the model pushes the change again', () => {
    const s = scoreMutationConfirm(proposeCall, 'set_scenario_value', false,
      `You really should do this.\n${proposeCall}`);
    expect(s.pass).toBe(false);
  });

  it('fails when the mutation call itself is malformed', () => {
    const s = scoreMutationConfirm('TOOL_CALL: {bad json', 'set_scenario_value', true, 'done');
    expect(s.callValid).toBe(false);
    expect(s.pass).toBe(false);
  });
});
