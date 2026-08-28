import { describe, it, expect } from 'vitest';
import { runAgentTurn, buildSystemPrompt, type AgentEvent, type MutationProposal } from './agentLoop';
import type { ChatMessage, StreamEvent } from './providers';
import type { ToolContext } from './tools';
import { baseInputs, testConfig } from '../../test/helpers';

function ctx(): ToolContext {
  return {
    inputs: baseInputs(),
    config: testConfig(),
    scenarioName: 'Test plan',
    scenarioList: [{ id: 'a', name: 'Test plan' }],
  };
}

/** A scripted chat function: each entry is one assistant turn's events. */
function scripted(turns: StreamEvent[][]): {
  chat: (req: { messages: ChatMessage[]; tools?: unknown[] }) => AsyncGenerator<StreamEvent>;
  requests: Array<{ messages: ChatMessage[]; tools?: unknown[] }>;
} {
  const requests: Array<{ messages: ChatMessage[]; tools?: unknown[] }> = [];
  let i = 0;
  return {
    requests,
    chat: async function* (req) {
      requests.push(JSON.parse(JSON.stringify({ messages: req.messages, tools: req.tools })));
      const turn = turns[Math.min(i, turns.length - 1)];
      i += 1;
      for (const evt of turn) yield evt;
    },
  };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('runAgentTurn', () => {
  it('streams a plain text answer and finishes', async () => {
    const { chat } = scripted([[
      { type: 'text', text: 'You are ' },
      { type: 'text', text: 'on track.' },
      { type: 'done', stopReason: 'end_turn' },
    ]]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'how am I doing?',
      system: 's', chat, onMutation: async () => ({ approved: false }),
    }));
    const text = events.filter(e => e.type === 'text').map(e => (e as { text: string }).text).join('');
    expect(text).toBe('You are on track.');
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('forwards reasoning events for display without mixing them into the answer', async () => {
    const { chat } = scripted([[
      { type: 'reasoning', text: 'Let me check the balances… ' },
      { type: 'reasoning', text: 'the TFSA outlives the RRIF.' },
      { type: 'text', text: 'Your plan is funded to 95.' },
      { type: 'done', stopReason: 'end_turn' },
    ]]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'how am I doing?',
      system: 's', chat, onMutation: async () => ({ approved: false }),
    }));
    const reasoning = events.filter(e => e.type === 'reasoning').map(e => (e as { text: string }).text).join('');
    expect(reasoning).toBe('Let me check the balances… the TFSA outlives the RRIF.');
    // Reasoning must not leak into the prose the model is quoted as saying.
    const text = events.filter(e => e.type === 'text').map(e => (e as { text: string }).text).join('');
    expect(text).toBe('Your plan is funded to 95.');
  });

  it('executes a tool, feeds the result back, and continues the loop', async () => {
    const { chat, requests } = scripted([
      [
        { type: 'tool_use', call: { id: 'c1', name: 'run_projection', args: {} } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'The projection says you are on track.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'run it',
      system: 's', chat, onMutation: async () => ({ approved: false }),
    }));
    expect(events.some(e => e.type === 'tool_start')).toBe(true);
    const result = events.find(e => e.type === 'tool_result');
    expect(result && !result.isError).toBe(true);
    // Second request must carry the assistant tool call + the tool result.
    const second = requests[1].messages;
    expect(second.at(-2)).toMatchObject({ role: 'assistant', toolCalls: [{ name: 'run_projection' }] });
    expect(second.at(-1)?.toolResults?.[0]?.toolCallId).toBe('c1');
    expect(second.at(-1)?.toolResults?.[0]?.content).toContain('lifetime tax');
  });

  it('pauses on a mutation proposal and reports the user decision to the model', async () => {
    const { chat, requests } = scripted([
      [
        { type: 'tool_use', call: { id: 'm1', name: 'set_scenario_value', args: { field: 'cppStartAge', value: 70 } } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'Done — CPP now starts at 70.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const proposals: MutationProposal[] = [];
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'defer cpp',
      system: 's', chat,
      onMutation: async (p) => { proposals.push(p); return { approved: true }; },
    }));
    expect(proposals).toEqual([{
      callId: 'm1', patch: { cppStartAge: 70 }, label: 'Set cppStartAge',
      rationale: undefined, preview: { field: 'cppStartAge', from: null, to: 70 },
    }]);
    expect(events.some(e => e.type === 'mutation')).toBe(true);
    const toolResultBack = requests[1].messages.at(-1)?.toolResults?.[0];
    expect(toolResultBack?.content).toContain('APPROVED');
  });

  it('tells the model when the user rejects a change', async () => {
    const { chat, requests } = scripted([
      [
        { type: 'tool_use', call: { id: 'm1', name: 'set_scenario_value', args: { field: 'desiredSpending', value: 90000 } } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'Understood, leaving spending as is.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'spend more',
      system: 's', chat,
      onMutation: async () => ({ approved: false, note: 'too high' }),
    }));
    const back = requests[1].messages.at(-1)?.toolResults?.[0];
    expect(back?.isError).toBe(true);
    expect(back?.content).toContain('REJECTED');
    expect(back?.content).toContain('too high');
  });

  it('surfaces provider errors as agent error events', async () => {
    const failing = async function* (): AsyncGenerator<StreamEvent> {
      if (Math.random() >= 0) throw new Error('Provider error 401 — check the API key');
      yield { type: 'done', stopReason: 'end_turn' }; // unreachable; satisfies the generator shape
    };
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'hi',
      system: 's', chat: failing, onMutation: async () => ({ approved: false }),
    }));
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Provider error 401 — check the API key' });
  });

  it('forces a no-tools final answer after the round limit instead of leaving nothing', async () => {
    // The model keeps calling the same tool every round; once maxRounds is
    // hit the loop must NOT just error out — it makes one more pass with no
    // tools on offer so the user still gets a real answer.
    const { chat, requests } = scripted([
      [
        { type: 'tool_use', call: { id: 'c', name: 'get_scenario', args: {} } },
        { type: 'done', stopReason: 'tool_use' },
      ],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'loop',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      maxRounds: 3,
    }));
    // The final pass ran AFTER the 3 tool rounds, with no tools offered.
    expect(requests.length).toBe(4);
    expect(requests.at(-1)?.tools).toEqual([]);
    // And the final pass's system prompt tells the model to stop and answer.
    // (The scripted chat replays a tool call, but the loop ignores it and
    // still closes with a done, not a dead-end safety error.)
    expect(events.at(-1)?.type).toBe('done');
    expect(events.some(e => e.type === 'error' && (e as { message: string }).message.includes('safety limit'))).toBe(false);
  });

  it('the forced final answer surfaces its prose to the user', async () => {
    // Round-limit path where the finalization pass actually answers.
    const { chat } = scripted([
      [{ type: 'tool_use', call: { id: 'c', name: 'get_scenario', args: {} } }, { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'Based on the numbers, you are on track.' }, { type: 'done', stopReason: 'end_turn' }],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'loop',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      maxRounds: 1,
    }));
    const prose = events.filter(e => e.type === 'text').map(e => (e as { text: string }).text).join('');
    expect(prose).toContain('on track');
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });
});

describe('buildSystemPrompt', () => {
  it('names the scenario, takes a planner stance, and never refuses to plan', () => {
    const s = buildSystemPrompt('My Plan');
    expect(s).toContain('"My Plan"');
    // The persona must engage as a planner — the old "calculator, not a
    // planner" guardrail made small models parrot "I'm not a planner" back.
    expect(s).toContain('planning assistant');
    expect(s).not.toContain('not a planner');
    expect(s).toContain('set_scenario_value');
  });

  it('uses a user-supplied base prompt in place of the default persona', () => {
    const s = buildSystemPrompt('My Plan', { basePrompt: 'You are a terse actuary.' });
    expect(s).toContain('You are a terse actuary.');
    expect(s).not.toContain('planning assistant');
    // Tool mechanics + scenario name are still appended after the persona.
    expect(s).toContain('set_scenario_value');
    expect(s).toContain('"My Plan"');
  });

  it('falls back to the default persona when the override is blank', () => {
    const s = buildSystemPrompt('My Plan', { basePrompt: '   ' });
    expect(s).toContain('planning assistant');
  });

  it('drops tool instructions for chat-only providers', () => {
    const s = buildSystemPrompt('My Plan', { toolMode: 'off' });
    expect(s).not.toContain('set_scenario_value');
    expect(s).toContain('cannot run tools');
  });

  it('renders the program rules from the live config when supplied', () => {
    const s = buildSystemPrompt('My Plan', { config: testConfig() });
    // The rules come from the app's real settings, not hard-coded prose.
    expect(s).toContain('CPP');
    expect(s).toContain('OAS');
    expect(s).toContain('GIS');
    expect(s).toContain('RRIF');
    // And it reflects the config's actual numbers (2026 TFSA limit).
    expect(s).toContain('7,000');
  });

  it('reflects user-edited config values in the rules', () => {
    // Bump the TFSA limit; the prompt must quote the NEW value, proving the
    // rules are read live from config rather than frozen in the persona.
    const config = testConfig();
    config.engine.tfsaAnnualLimit = 9999;
    const s = buildSystemPrompt('My Plan', { config });
    expect(s).toContain('9,999');
    expect(s).not.toContain('7,000');
  });

  it('omits the rules section when no config is given', () => {
    const s = buildSystemPrompt('My Plan');
    expect(s).not.toContain('Rules this program applies');
  });
});

describe('chat-only (tools disabled) providers', () => {
  it('does not advertise tools and refuses stray tool_use from the model', async () => {
    const { chat, requests } = scripted([
      // A small local model hallucinating a tool call despite not being offered any:
      [
        { type: 'tool_use', call: { id: 'x', name: 'run_projection', args: {} } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'From the summary: you are on track.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'how am I doing?',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'off',
    }));
    // No tools were advertised on the first request.
    expect(requests[0].tools).toEqual([]);
    // The stray tool call was answered with an unavailable message, not executed.
    const refusal = events.find(e => e.type === 'tool_result');
    expect(refusal && refusal.isError).toBe(true);
    expect((refusal as { content: string }).content).toContain('not available');
    // The engine never ran: the content contains no projection output.
    expect((refusal as { content: string }).content).not.toContain('lifetime tax');
  });
});

describe('prompt-protocol tools (local models)', () => {
  it('parses a TOOL_CALL line out of text, executes it, and feeds results back', async () => {
    const { chat, requests } = scripted([
      // Local model reply: prose + a one-line tool call, streamed as one chunk.
      [
        { type: 'text', text: 'Let me check.\nTOOL_CALL: {"name": "run_projection", "args": {}}' },
        { type: 'done', stopReason: 'end_turn' },
      ],
      [
        { type: 'text', text: 'Your plan is funded to age 95.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'is my plan ok?',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'prompt',
    }));
    // The engine actually ran.
    const result = events.find(e => e.type === 'tool_result');
    expect(result && !result.isError).toBe(true);
    expect((result as { content: string }).content).toContain('lifetime tax');
    // The user saw prose with the tool line stripped, never the raw JSON.
    const prose = events.filter(e => e.type === 'text').map(e => (e as { text: string }).text).join('');
    expect(prose).toContain('Let me check.');
    expect(prose).toContain('funded to age 95.');
    expect(prose).not.toContain('TOOL_CALL:');
    expect(prose).not.toContain('"name"');
    // Round 2's request carries the tool result as a plain user message
    // (chat providers have no tool-result role).
    const round2 = requests[1];
    const lastMsg = round2.messages.at(-1) as ChatMessage;
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('lifetime tax');
    expect(lastMsg.toolResults).toBeUndefined();
  });

  it('returns malformed tool JSON as an error the model can retry from', async () => {
    const { chat } = scripted([
      [{ type: 'text', text: 'TOOL_CALL: {not json}' }, { type: 'done', stopReason: 'end_turn' }],
      [{ type: 'text', text: 'Sorry, let me just answer.' }, { type: 'done', stopReason: 'end_turn' }],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'check',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'prompt',
    }));
    // The loop survived the malformed block and the model got a second turn.
    const prose = events.filter(e => e.type === 'text').map(e => (e as { text: string }).text).join('');
    expect(prose).toContain('let me just answer');
  });

  it('caps prompt-mode loops, then forces a no-tools final answer', async () => {
    // A stuck model emits an unknown tool every round; after the cap the loop
    // makes one finalization pass (no tools) instead of erroring out empty.
    const { chat, requests } = scripted([[
      { type: 'text', text: 'TOOL_CALL: {"name": "nope"}' },
      { type: 'done', stopReason: 'end_turn' },
    ]]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'check',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'prompt', maxRounds: 3,
    }));
    // Finalization pass ran after the 3 rounds with no tools offered.
    expect(requests.length).toBe(4);
    expect(requests.at(-1)?.tools).toEqual([]);
    // The unknown-TOOL_CALL prose from the final pass is stripped; the loop
    // closes cleanly rather than surfacing a dead-end "safety limit" error.
    expect(events.at(-1)?.type).toBe('done');
    expect(events.some(e => e.type === 'error' && (e as { message: string }).message.includes('safety limit'))).toBe(false);
  });

  it('a mid-stream engine crash surfaces as an error event, not a stuck spinner', async () => {
    // Simulates the GPU dying partway through (the mapAsync failure) — the
    // chat generator throws, the loop must emit an 'error' the UI can render.
    const chat = async function* (): AsyncGenerator<StreamEvent> {
      yield { type: 'text', text: 'partial…' };
      throw new Error('GPU device lost');
    };
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'check',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'prompt',
    }));
    const err = events.find(e => e.type === 'error');
    expect(err).toBeTruthy();
    expect((err as { message: string }).message).toContain('GPU device lost');
    // The loop terminated (no infinite hang waiting for a done that never came).
    expect(events.some(e => e.type === 'done')).toBe(false);
  });

  it('refuses to re-run the identical tool+args back-to-back (loop guard)', async () => {
    // A stuck model calls run_projection with the same args twice in a row.
    // The second must bounce as an error instead of re-executing and feeding
    // the loop — and only ONE real tool_result should reference the engine.
    const { chat } = scripted([
      [{ type: 'tool_use', call: { id: 'c1', name: 'run_projection', args: {} } },
       { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'tool_use', call: { id: 'c2', name: 'run_projection', args: {} } },
       { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'Ok, here is the answer.' },
       { type: 'done', stopReason: 'end_turn' }],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'check',
      system: 's', chat, onMutation: async () => ({ approved: false }),
    }));
    const results = events.filter(e => e.type === 'tool_result') as Array<{ isError: boolean; content: string }>;
    // First ran fine, second bounced with the loop-guard message.
    expect(results[0].isError).toBe(false);
    expect(results[1].isError).toBe(true);
    expect(results[1].content).toContain('already have its result');
    // Only one execution hit the engine.
    expect(results.filter(r => r.content.includes('lifetime tax'))).toHaveLength(1);
  });
});
