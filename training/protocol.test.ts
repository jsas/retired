import { describe, expect, it } from 'vitest';
import {
  SPECS,
  TOOL_NAMES,
  TOOL_INSTRUCTIONS,
  emitToolCall,
  mutationFeedback,
  scoreToolReply,
  wrapToolResult,
} from './protocol';

describe('protocol corpus contract', () => {
  it('mirrors the live 26-tool catalog', () => {
    // Locks the corpus to the shipped catalog; if a tool is added/renamed this
    // forces a conscious regen rather than a silent drift.
    expect(SPECS.length).toBe(26);
    expect(TOOL_NAMES.has('run_projection')).toBe(true);
    expect(TOOL_NAMES.has('propose_reverse_mortgage')).toBe(true);
    expect(TOOL_NAMES.has('set_scenario_value')).toBe(true);
    expect(TOOL_NAMES.has('propose_fhsa')).toBe(true);
    expect(TOOL_NAMES.has('propose_debt')).toBe(true);
    expect(TOOL_NAMES.has('manage_debt')).toBe(true);
  });

  it('renders the taught TOOL_CALL format into the instructions', () => {
    expect(TOOL_INSTRUCTIONS).toContain('TOOL_CALL: {"name": "run_projection", "args": {}}');
    expect(TOOL_INSTRUCTIONS).toContain('Call AT MOST ONE tool');
  });

  it('a canonical emitted call parses back as valid via the app parser', () => {
    const reply = emitToolCall('compare_scenarios', {
      variants: [
        { label: 'Retire 60', overrides: { retirementAge: 60 } },
        { label: 'Retire 65', overrides: { retirementAge: 65 } },
      ],
    });
    const v = scoreToolReply(reply);
    expect(v.kind).toBe('valid');
    if (v.kind === 'valid') expect(v.name).toBe('compare_scenarios');
  });

  it('tolerates prose before the call but still scores it valid', () => {
    const reply = `Let me check that for you.\n${emitToolCall('run_projection')}`;
    expect(scoreToolReply(reply).kind).toBe('valid');
  });

  it('flags a call to a tool that is not in the catalog', () => {
    const v = scoreToolReply(emitToolCall('make_me_rich', {}));
    expect(v.kind).toBe('unknown-tool');
  });

  it('flags malformed JSON', () => {
    const v = scoreToolReply('TOOL_CALL: {"name": "run_projection", "args": {,}}');
    expect(v.kind).toBe('bad-json');
  });

  it('flags more than one call as off-discipline', () => {
    const reply = `${emitToolCall('run_projection')}\n${emitToolCall('get_scenario')}`;
    expect(scoreToolReply(reply).kind).toBe('multi-call');
  });

  it('flags a reply with no tool call when one was expected', () => {
    expect(scoreToolReply('You are on track, no need to check.').kind).toBe('no-call');
  });

  it('wraps a tool result in the app envelope', () => {
    const msg = wrapToolResult('Result: ON TRACK — household funded to age 95+');
    expect(msg).toContain('Tool results:');
    expect(msg).toContain('[OK] Result: ON TRACK');
  });

  it('encodes the approve/reject mutation feedback the model must learn', () => {
    expect(mutationFeedback(true, 'Defer CPP', '{"cppStartAge":70}')).toContain('do NOT re-propose');
    expect(mutationFeedback(false, 'Defer CPP', '{"cppStartAge":70}')).toContain('REJECTED');
  });
});
