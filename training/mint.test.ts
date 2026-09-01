import { describe, expect, it } from 'vitest';
import { mintCorpus, mintGuardrailRecords, mintMutationRecords, mintOptionFramingRecords, mintReadRecords, toJsonl } from './mint';
import { mintDomainKnowledgeRecords } from './domain';
import { scoreToolReply, TOOL_NAMES } from './protocol';
import { SCENARIOS } from './scenarios';
import { executeToolCall, type ToolContext } from '@retired/mcp-tools/tools';
import { testConfig } from '@retired/engine-core/test/helpers';

describe('corpus minter', () => {
  const records = mintReadRecords();

  it('mints at scale: every paraphrase × scenario yields a tool-call record', () => {
    // The point of the paraphrase bank is scale — many phrasings per tool. We
    // should get well past the old 77-record skeleton toward a trainable size.
    const calls = records.filter((r) => r.kind === 'tool-call');
    expect(calls.length).toBeGreaterThan(100);
    // Every scenario is represented.
    expect(new Set(calls.map((r) => r.scenarioId)).size).toBe(SCENARIOS.length);
    // Multiple phrasings map to the same canonical call for a given tool.
    const runProj = calls.filter((r) => r.expect.toolName === 'run_projection');
    expect(new Set(runProj.map((r) => r.messages[0].content)).size).toBeGreaterThan(3);
  });

  it('mints follow-ups only for tools with figure-bearing results', () => {
    const follows = records.filter((r) => r.kind === 'tool-followup');
    expect(follows.length).toBeGreaterThan(0);
    // No follow-up should exist for the raw-JSON tools (get_scenario, etc.).
    const followTools = new Set(follows.map((r) => r.expect.toolName));
    expect(followTools.has('get_scenario')).toBe(false);
  });

  it('holds out an eval split drawn from the same distribution', () => {
    const evals = records.filter((r) => r.split === 'eval');
    const trains = records.filter((r) => r.split === 'train');
    expect(evals.length).toBeGreaterThan(0);
    expect(trains.length).toBeGreaterThan(evals.length);
    // eval covers multiple tools, not just one
    expect(new Set(evals.map((r) => r.expect.toolName)).size).toBeGreaterThan(1);
  });

  it('train and eval are disjoint (no id leaks across the split)', () => {
    // Guard against any future mint path that accidentally assigns the same
    // record to BOTH splits — without this check, eval-validity scores would
    // report inflated percentages on models that memorized the eval items.
    const scan = (rs: typeof records) => {
      const ids = new Set(rs.map((r) => r.id));
      const trainIds = new Set(rs.filter((r) => r.split === 'train').map((r) => r.id));
      const evalIds = new Set(rs.filter((r) => r.split === 'eval').map((r) => r.id));
      const overlap = [...trainIds].filter((i) => evalIds.has(i));
      expect(overlap, `split overlap: ${overlap.slice(0, 5).join(',')}`).toEqual([]);
      expect(trainIds.size + evalIds.size).toBe(ids.size);
    };
    scan(records);
    scan(mintMutationRecords());
    scan(mintGuardrailRecords());
    scan(mintOptionFramingRecords());
    scan(mintDomainKnowledgeRecords());
    scan(mintCorpus());
  }, 600000);

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
  }, 600000);

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

describe('guardrail records', () => {
  const guard = mintGuardrailRecords();

  it('mints refusal, clarify, and domain-explain kinds', () => {
    expect(guard.some((r) => r.kind === 'refusal')).toBe(true);
    expect(guard.some((r) => r.kind === 'clarify')).toBe(true);
    expect(guard.some((r) => r.kind === 'domain-explain')).toBe(true);
  });

  it('refusals deflect without naming a recommendation or emitting a tool call', () => {
    for (const r of guard.filter((x) => x.kind === 'refusal')) {
      const reply = r.messages[1].content.toLowerCase();
      expect(reply).toContain('consequences');
      expect(reply).not.toContain('tool_call');
      for (const banned of r.expect.mustNotContain ?? []) {
        expect(reply).not.toContain(banned.toLowerCase());
      }
    }
  });

  it('clarify records ask a question instead of guessing a tool', () => {
    for (const r of guard.filter((x) => x.kind === 'clarify')) {
      const reply = r.messages[1].content;
      expect(reply.trim().endsWith('?')).toBe(true);
      expect(reply).not.toContain('TOOL_CALL');
    }
  });

  it('domain explainers stay non-advisory and offer to ground in real numbers', () => {
    for (const r of guard.filter((x) => x.kind === 'domain-explain')) {
      const reply = r.messages[1].content.toLowerCase();
      for (const banned of r.expect.mustNotContain ?? []) {
        expect(reply).not.toContain(banned.toLowerCase());
      }
    }
  });

  it('the full corpus combines engine-grounded, mutation, guardrail, option, and domain records', () => {
    const full = mintCorpus();
    expect(full.length).toBe(
      mintReadRecords().length + mintMutationRecords().length + guard.length
      + mintOptionFramingRecords().length + mintDomainKnowledgeRecords().length,
    );
  }, 600000);
});

describe('mutation records', () => {
  const mutations = mintMutationRecords();

  it('mints a proposal call plus APPROVED and REJECTED confirms per paraphrase', () => {
    expect(mutations.length).toBeGreaterThan(0);
    // Every mutation record teaches a catalog tool.
    for (const r of mutations) expect(TOOL_NAMES.has(r.expect.toolName ?? '')).toBe(true);
    // Three records per (spec × paraphrase × scenario): call, approved, rejected.
    expect(mutations.length % 3).toBe(0);
  });

  it('post-confirm turns never re-propose (no TOOL_CALL in the acknowledgement)', () => {
    const confirms = mutations.filter((r) => r.messages.length === 4);
    expect(confirms.length).toBeGreaterThan(0);
    for (const r of confirms) {
      const reply = r.messages[3].content;
      expect(reply).not.toContain('TOOL_CALL');
    }
  });

  it('proposal calls are protocol-valid against the live parser', () => {
    const calls = mutations.filter((r) => r.messages.length === 2);
    for (const r of calls) {
      const scored = scoreToolReply(r.messages[1].content);
      expect(scored.kind).toBe('valid');
      if (scored.kind === 'valid') expect(scored.name).toBe(r.expect.toolName);
    }
  });
});

describe('option-framing records', () => {
  const options = mintOptionFramingRecords();

  it('surveys options via run_strategies, never a bare directive', () => {
    expect(options.length).toBeGreaterThan(0);
    for (const r of options) expect(r.expect.toolName).toBe('run_strategies');
  });

  it('the framing reply names levers + numbers but never prescribes one', () => {
    const follows = options.filter((r) => r.messages.length === 4);
    expect(follows.length).toBeGreaterThan(0);
    for (const r of follows) {
      const reply = r.messages[3].content.toLowerCase();
      expect(reply).toContain('lever');
      // Grounded in the real result: references a $ figure from run_strategies.
      expect(reply).toMatch(/\$/);
      // Calculator-not-planner: no directive language.
      for (const banned of ['you should', 'i recommend', 'the best option', 'you ought to']) {
        expect(reply).not.toContain(banned);
      }
      // And it hands the choice back to the user (any of the rotated closers).
      expect(reply).toMatch(/choice is yours|your call|depends on what you value|up to you|no single right answer/);
    }
  }, 120000);
});

describe('domain-knowledge records', () => {
  const facts = mintDomainKnowledgeRecords();

  it('covers the program areas the engine models', () => {
    expect(facts.length).toBeGreaterThan(0);
    const ids = new Set(facts.map((r) => r.id));
    // The core benefit programs + account types + market history must all be present.
    for (const area of ['cpp', 'oas', 'gis', 'rrif', 'market-history', 'accounts']) {
      expect([...ids].some((id) => id.includes(area)), `missing domain area: ${area}`).toBe(true);
    }
  });

  it('answers cite real figures and never advise', () => {
    for (const r of facts) {
      const reply = r.messages[1].content;
      // Grounded: mentions a number (a $ amount or a %).
      expect(reply).toMatch(/[$%0-9]/);
      // Every fact satisfies its own mustContain phrases.
      for (const phrase of r.expect.mustContain ?? []) {
        expect(reply.toLowerCase()).toContain(phrase.toLowerCase());
      }
      // Calculator-not-planner: no directive verbs, and no tool call (pure knowledge).
      for (const banned of ['you should', 'i recommend', 'the best choice is', 'you ought to']) {
        expect(reply.toLowerCase()).not.toContain(banned);
      }
      expect(reply).not.toContain('TOOL_CALL');
    }
  });

  it('routes fluency back to the tools (offers to ground in the user\'s numbers)', () => {
    // Most facts close by offering to run it on the user's plan — that's what keeps
    // domain knowledge from becoming free-standing advice.
    const withOffer = facts.filter((r) => /your (own )?(plan|numbers)/i.test(r.messages[1].content));
    expect(withOffer.length / facts.length).toBeGreaterThan(0.5);
  });
});
