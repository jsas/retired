import { describe, it, expect } from 'vitest';
import {
  buildPromptToolInstructions, extractPromptToolCalls, formatPromptToolResults,
} from './promptTools';
import { toolSpecs } from '@retired/mcp-tools/tools';

const names = new Set(toolSpecs().map(s => s.name));

describe('extractPromptToolCalls', () => {
  it('pulls a valid TOOL_CALL line out of surrounding prose', () => {
    const { prose, calls, errors } = extractPromptToolCalls(
      'Checking now.\nTOOL_CALL: {"name": "run_projection", "args": {}}\nOne moment.',
      names,
    );
    expect(prose).toBe('Checking now.\n\nOne moment.');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('run_projection');
    expect(calls[0].id).toBeTruthy();
    expect(errors).toHaveLength(0);
  });

  it('matches the marker case-insensitively (small models emit tool_call:)', () => {
    const { prose, calls, errors } = extractPromptToolCalls(
      'tool_call: {"name": "run_projection", "args": {"overrides": {}}}\nThe plan is in a shortfall state.',
      names,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('run_projection');
    expect(prose).toBe('The plan is in a shortfall state.');
    expect(errors).toHaveLength(0);
  });

  it('swallows continuation lines when args wrap', () => {
    const { calls } = extractPromptToolCalls(
      'TOOL_CALL: {"name": "get_plan",\n  "args": {"section": "summary"}}',
      names,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual({ section: 'summary' });
  });

  it('supports multiple calls in one reply', () => {
    const { calls } = extractPromptToolCalls(
      'TOOL_CALL: {"name": "get_plan"}\nTOOL_CALL: {"name": "run_projection"}',
      names,
    );
    expect(calls.map(c => c.name)).toEqual(['get_plan', 'run_projection']);
  });

  it('flags invalid JSON as a retryable error, not a crash', () => {
    const { calls, errors } = extractPromptToolCalls('TOOL_CALL: {oops}', names);
    expect(calls).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('not valid JSON');
  });

  it('flags unknown tool names with guidance', () => {
    const { errors } = extractPromptToolCalls('TOOL_CALL: {"name": "delete_everything"}', names);
    expect(errors[0].message).toContain('Unknown tool');
  });

  it('never mistakes ordinary prose or code fences for a call', () => {
    const { calls, errors, prose } = extractPromptToolCalls(
      'Sure! Here is math: 2+2=4.\n```json\n{"kkk": 1}\n```',
      names,
    );
    expect(calls).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(prose).toContain('2+2=4');
  });

  it('caps the number of calls kept from one reply and flags the overflow', () => {
    const spam = Array.from(
      { length: 8 },
      () => 'TOOL_CALL: {"name": "run_projection", "args": {}}',
    ).join('\n');
    const { calls, errors } = extractPromptToolCalls(spam, names);
    expect(calls.length).toBe(3); // PROMPT_TOOL_MAX_CALLS_PER_REPLY
    expect(errors.some(e => e.message.includes('Too many tool calls'))).toBe(true);
  });
});

describe('formatPromptToolResults', () => {
  it('renders results and parse errors as a user message', () => {
    const msg = formatPromptToolResults(
      [{ toolCallId: 'a', content: 'ON TRACK', isError: false }],
      [{ raw: '{oops}', message: 'bad json' }],
    );
    expect(msg).toContain('[OK] ON TRACK');
    expect(msg).toContain('[ERROR]');
    expect(msg).toContain('bad json');
  });
});

describe('buildPromptToolInstructions', () => {
  it('teaches the <tool_call> block format and lists every tool compactly', () => {
    const s = buildPromptToolInstructions(toolSpecs());
    expect(s).toContain('<tool_call>');
    expect(s).toContain('</tool_call>');
    expect(s).toContain('"arguments"');
    for (const name of names) expect(s).toContain(name);
    // Compact: no full JSON-schema dump (token-heavy for small models).
    expect(s).not.toContain('"$schema"');
    expect(s).not.toContain('additionalProperties');
  });
});

describe('extractPromptToolCalls — <tool_call> blocks (Qwen native)', () => {
  it('pulls a <tool_call> block with arguments out of prose', () => {
    const { prose, calls, errors } = extractPromptToolCalls(
      'Checking now.\n<tool_call>\n{"name": "run_projection", "arguments": {}}\n</tool_call>\nOne moment.',
      names,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('run_projection');
    expect(errors).toHaveLength(0);
    expect(prose).toContain('Checking now.');
    expect(prose).toContain('One moment.');
  });

  it('normalizes native "arguments" to internal args', () => {
    const { calls } = extractPromptToolCalls(
      '<tool_call>{"name": "set_plan_value", "arguments": {"field": "retirementAge", "value": 67}}</tool_call>',
      names,
    );
    expect(calls[0].args).toEqual({ field: 'retirementAge', value: 67 });
  });

  it('accepts a block that runs to end-of-text (truncated generation)', () => {
    const { calls } = extractPromptToolCalls(
      '<tool_call>\n{"name": "get_plan", "arguments": {}}',
      names,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('get_plan');
  });

  it('accepts both formats in one reply', () => {
    const { calls } = extractPromptToolCalls(
      '<tool_call>{"name": "get_plan"}</tool_call>\nTOOL_CALL: {"name": "run_projection"}',
      names,
    );
    expect(calls.map(c => c.name)).toEqual(['get_plan', 'run_projection']);
  });

  it('flags unknown tool inside a block', () => {
    const { errors } = extractPromptToolCalls(
      '<tool_call>{"name": "delete_everything", "arguments": {}}</tool_call>',
      names,
    );
    expect(errors[0].message).toContain('Unknown tool');
  });
});
