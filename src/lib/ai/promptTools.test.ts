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
      'TOOL_CALL: {"name": "get_scenario",\n  "args": {"section": "summary"}}',
      names,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual({ section: 'summary' });
  });

  it('supports multiple calls in one reply', () => {
    const { calls } = extractPromptToolCalls(
      'TOOL_CALL: {"name": "get_scenario"}\nTOOL_CALL: {"name": "run_projection"}',
      names,
    );
    expect(calls.map(c => c.name)).toEqual(['get_scenario', 'run_projection']);
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
  it('teaches the one-line format and lists every tool compactly', () => {
    const s = buildPromptToolInstructions(toolSpecs());
    expect(s).toContain('TOOL_CALL:');
    for (const name of names) expect(s).toContain(name);
    // Compact: no full JSON-schema dump (token-heavy for small models).
    expect(s).not.toContain('"$schema"');
    expect(s).not.toContain('additionalProperties');
  });
});
