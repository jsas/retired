import { describe, it, expect } from 'vitest';
import { runAgentTurn, buildSystemPrompt, type AgentEvent } from './agentLoop';
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
  chat: (req: { messages: ChatMessage[] }) => AsyncGenerator<StreamEvent>;
  requests: Array<{ messages: ChatMessage[] }>;
} {
  const requests: Array<{ messages: ChatMessage[] }> = [];
  let i = 0;
  return {
    requests,
    chat: async function* (req) {
      requests.push({ messages: JSON.parse(JSON.stringify(req.messages)) });
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
    const proposals: Array<{ field: string; value: unknown }> = [];
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'defer cpp',
      system: 's', chat,
      onMutation: async (p) => { proposals.push(p); return { approved: true }; },
    }));
    expect(proposals).toEqual([{ callId: 'm1', field: 'cppStartAge', value: 70, rationale: undefined, preview: { field: 'cppStartAge', from: null, to: 70 } }]);
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
});
