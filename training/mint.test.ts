import { describe, expect, it } from 'vitest';
import { mintReadRecords, toJsonl } from './mint';
import { scoreToolReply, TOOL_NAMES } from './protocol';
import { SCENARIOS } from './scenarios';
import { executeToolCall, type ToolContext } from '../src/lib/ai/tools';
import { testConfig } from '../src/test/helpers';

describe('corpus minter', () => {
  const records = mintReadRecords();

  it('mints a call + follow-up for every read spec × scenario', () => {
    // 6 read specs × 7 scenarios; get_scenario is call-only (raw JSON result),
    // the other 5 mint a follow-up too → 6 calls + 5 follow-ups per scenario.
    expect(records.length).toBe((6 + 5) * SCENARIOS.length);
    const calls = records.filter((r) => r.kind === 'tool-call');
    const follows = records.filter((r) => r.kind === 'tool-followup');
    expect(calls.length).toBe(6 * SCENARIOS.length);
    expect(follows.length).toBe(5 * SCENARIOS.length);
  });

  it('holds out an eval split drawn from the same distribution', () => {
    const evals = records.filter((r) => r.split === 'eval');
    const trains = records.filter((r) => r.split === 'train');
    expect(evals.length).toBeGreaterThan(0);
    expect(trains.length).toBeGreaterThan(evals.length);
    // eval covers multiple tools, not just one
    expect(new Set(evals.map((r) => r.expect.toolName)).size).toBeGreaterThan(1);
  });

  it('every tool-call record emits a protocol-valid in-catalog call', () => {
    for (const r of records.filter((x) => x.kind === 'tool-call')) {
      const assistantLine = r.messages[1].content;
      const v = scoreToolReply(assistantLine);
      expect(v.kind, `${r.id} should be valid`).toBe('valid');
      if (v.kind === 'valid') expect(TOOL_NAMES.has(v.name)).toBe(true);
    }
  });

  it('every emitted call passes the executor’s Zod validation', () => {
    // Stronger than protocol-valid: the args must satisfy the tool's schema.
    for (const r of records.filter((x) => x.kind === 'tool-call')) {
      const v = scoreToolReply(r.messages[1].content);
      if (v.kind !== 'valid') throw new Error(`${r.id} not valid`);
      const sc = SCENARIOS.find((x) => x.id === r.scenarioId)!;
      const ctx: ToolContext = {
        inputs: sc.inputs, config: testConfig(), scenarioName: sc.name,
        scenarioList: [], activeScenarioId: sc.id,
      };
      const outcome = executeToolCall(ctx, { id: 't', name: v.name, args: v.args });
      expect(outcome.kind, `${r.id} args must satisfy schema`).not.toBe('error');
    }
  });

  it('follow-up turns are grounded in real engine output and stay non-advisory', () => {
    for (const r of records.filter((x) => x.kind === 'tool-followup')) {
      const toolResultMsg = r.messages[2].content;
      const explanation = r.messages[3].content;
      expect(toolResultMsg).toContain('[OK]');
      // explanation quotes an engine FIGURE ($ amount or %) rather than a bare label
      expect(explanation).toMatch(/[$%]/);
      for (const banned of r.expect.mustNotContain ?? []) {
        expect(explanation.toLowerCase()).not.toContain(banned.toLowerCase());
      }
    }
  });

  it('serializes to JSONL with one valid record per line', () => {
    const jsonl = toJsonl(records);
    const lines = jsonl.trim().split('\n');
    expect(lines.length).toBe(records.length);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty('id');
      expect(parsed).toHaveProperty('messages');
      expect(parsed).toHaveProperty('expect');
    }
  });

  it('explanations never cross the calculator-not-planner line', () => {
    const advicePhrases = ['you should retire', 'i recommend retiring', 'you ought to', 'the best choice is'];
    for (const r of records.filter((x) => x.kind === 'tool-followup')) {
      const explanation = r.messages[3].content.toLowerCase();
      for (const p of advicePhrases) expect(explanation).not.toContain(p);
    }
  });
});
