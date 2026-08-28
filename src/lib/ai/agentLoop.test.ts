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

  it('stops at the round limit instead of looping forever', async () => {
    const { chat } = scripted([[
      { type: 'tool_use', call: { id: 'c', name: 'get_scenario', args: {} } },
      { type: 'done', stopReason: 'tool_use' },
    ]]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'loop',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      maxRounds: 3,
    }));
    expect(events.at(-1)?.type).toBe('error');
    expect((events.at(-1) as { message: string }).message).toContain('safety limit');
  });
});

describe('buildSystemPrompt', () => {
  it('names the scenario and states the calculator-not-advisor rule', () => {
    const s = buildSystemPrompt('My Plan');
    expect(s).toContain('"My Plan"');
    expect(s).toContain('calculator, not a planner');
    expect(s).toContain('set_scenario_value');
  });

  it('drops tool instructions for chat-only providers', () => {
    const s = buildSystemPrompt('My Plan', { toolMode: 'off' });
    expect(s).not.toContain('set_scenario_value');
    expect(s).toContain('cannot run tools');
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

  it('caps prompt-mode loops so a model repeating broken calls stops', async () => {
    const { chat } = scripted([[
      { type: 'text', text: 'TOOL_CALL: {"name": "nope"}' },
      { type: 'done', stopReason: 'end_turn' },
    ]]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'check',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'prompt', maxRounds: 3,
    }));
    const safety = events.find(e => e.type === 'error');
    expect(safety && (safety as { message: string }).message).toContain('safety limit');
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
