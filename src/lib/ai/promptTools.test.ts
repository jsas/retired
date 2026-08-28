import { describe, it, expect } from 'vitest';
import {
  buildPromptToolInstructions, extractPromptToolCalls, formatPromptToolResults,
} from './promptTools';
import { toolSpecs } from './tools';

const names = new Set(toolSpecs().map(s => s.name));

describe('extractPromptToolCalls', () => {
  it('pulls a valid tool block out of surrounding prose', () => {
    const { prose, calls, errors } = extractPromptToolCalls(
      'Checking now. ```tool\n{"name": "run_projection", "args": {}}\n``` One moment.',
      names,
    );
    expect(prose).toBe('Checking now.  One moment.');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('run_projection');
    expect(calls[0].id).toBeTruthy();
    expect(errors).toHaveLength(0);
  });

  it('handles a missing closing fence (small-model habit)', () => {
    const { calls } = extractPromptToolCalls(
      '```tool\n{"name": "get_scenario", "args": {"section": "summary"}}',
      names,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual({ section: 'summary' });
  });

  it('supports multiple blocks in one reply', () => {
    const { calls } = extractPromptToolCalls(
      '```tool\n{"name": "get_scenario"}\n```\n```tool\n{"name": "run_projection"}\n```',
      names,
    );
    expect(calls.map(c => c.name)).toEqual(['get_scenario', 'run_projection']);
  });

  it('flags invalid JSON as a retryable error, not a crash', () => {
    const { calls, errors } = extractPromptToolCalls('```tool\n{oops}\n```', names);
    expect(calls).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('not valid JSON');
  });

  it('flags unknown tool names with guidance', () => {
    const { errors } = extractPromptToolCalls('```tool\n{"name": "delete_everything"}\n```', names);
    expect(errors[0].message).toContain('Unknown tool');
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
  it('teaches the fenced format and lists every tool compactly', () => {
    const s = buildPromptToolInstructions(toolSpecs());
    expect(s).toContain('```tool');
    for (const name of names) expect(s).toContain(name);
    // Compact: no full JSON-schema dump (token-heavy for small models).
    expect(s).not.toContain('"$schema"');
    expect(s).not.toContain('additionalProperties');
  });
});
