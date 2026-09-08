import { describe, it, expect } from 'vitest';
import { runAgentTurn, buildSystemPrompt, assembleSystemPrompt, liveReasoningDelta, type AgentEvent, type MutationProposal } from './agentLoop';
import type { ChatMessage, StreamEvent } from './providers';
import type { ToolContext } from '@retired/mcp-tools/tools';
import { baseInputs, testConfig } from '@retired/engine-core/test/helpers';

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
  chat: (req: { system?: string; messages: ChatMessage[]; tools?: unknown[] }) => AsyncGenerator<StreamEvent>;
  requests: Array<{ system?: string; messages: ChatMessage[]; tools?: unknown[] }>;
} {
  const requests: Array<{ system?: string; messages: ChatMessage[]; tools?: unknown[] }> = [];
  let i = 0;
  return {
    requests,
    chat: async function* (req) {
      requests.push(JSON.parse(JSON.stringify({ system: req.system, messages: req.messages, tools: req.tools })));
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

/** Prompt-mode untagged CoT becomes the answer via promote_reasoning. */
function answerText(events: AgentEvent[]): string {
  return events
    .filter((e): e is Extract<AgentEvent, { type: 'text' | 'promote_reasoning' }> =>
      e.type === 'text' || e.type === 'promote_reasoning')
    .map(e => e.text)
    .join('');
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
    // Unambiguous: applied-and-live, so the model doesn't re-propose it.
    expect(toolResultBack?.content).toContain('now APPLIED');
    expect(toolResultBack?.content).toContain('do NOT re-propose');
  });

  it('reads the LIVE inputs after an approved change, not the stale snapshot', async () => {
    // Regression: the UI hands the loop a context whose `inputs` is read
    // through a getter (it re-renders with the applied patch while the loop is
    // parked on the confirm card). A read tool called AFTER approval must see
    // the new value — otherwise the model thinks the change never landed and
    // re-proposes it (the duplicate Applied card / stale-answer bug).
    const live = { inputs: baseInputs() };
    const liveCtx: ToolContext = {
      get inputs() { return live.inputs; },
      config: testConfig(),
      scenarioName: 'Test plan',
      scenarioList: [{ id: 'a', name: 'Test plan' }],
    };
    const { chat } = scripted([
      // Round 1: propose lowering spending.
      [
        { type: 'tool_use', call: { id: 'm1', name: 'set_scenario_value', args: { field: 'desiredSpending', value: 42000 } } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      // Round 2 (after approval): the model re-reads the plan, then answers.
      [
        { type: 'tool_use', call: { id: 'g1', name: 'get_scenario', args: { section: 'summary' } } },
        { type: 'done', stopReason: 'tool_use' },
      ],
      [
        { type: 'text', text: 'Spending is now set to the sustainable level.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const events = await collect(runAgentTurn({
      context: liveCtx, history: [], userMessage: 'lower spending', system: 's', chat,
      onMutation: async () => {
        // The parent applies the patch, so the live inputs change before the
        // loop's next tool executes.
        live.inputs = { ...live.inputs, desiredSpending: 42000 };
        return { approved: true };
      },
    }));
    const summaryResult = events.find(
      e => e.type === 'tool_result' && (e as { call?: { id?: string } }).call?.id === 'g1',
    ) as { content: string } | undefined;
    expect(summaryResult?.content).toContain('"desiredSpending": 42000');
    expect(summaryResult?.content).not.toContain('"desiredSpending": 20000');
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
    expect(back?.content).toContain('NOT applied');
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

  it('maxRounds 0 is one chat pass with the given system, not wrap-up', async () => {
    const { chat, requests } = scripted([[
      { type: 'text', text: 'hi' },
      { type: 'done', stopReason: 'end_turn' },
    ]]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'say hi',
      system: '', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'off', maxRounds: 0,
    }));
    expect(requests).toHaveLength(1);
    expect(requests[0].system).toBe('');
    expect(requests[0].tools).toEqual([]);
    expect(events.filter(e => e.type === 'text')).toEqual([{ type: 'text', text: 'hi' }]);
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
    // Tool mechanics + scenario name still ride; persona is last by default so
    // a small model honors the override instead of the later tool blurb.
    expect(s).toContain('set_scenario_value');
    expect(s).toContain('"My Plan"');
    expect(s.indexOf('You are a terse actuary.')).toBeGreaterThan(s.indexOf('set_scenario_value'));
  });

  it('falls back to the default persona when the override is blank', () => {
    const s = buildSystemPrompt('My Plan', { basePrompt: '   ' });
    expect(s).toContain('planning assistant');
  });

  it('adds the ambient current-page line when the host supplies a view', () => {
    // The page titles come from the catalog — this is what find_page's
    // "already here" tag and the ambient line share (issue #141).
    const s = buildSystemPrompt('My Plan', { currentView: 'details' });
    expect(s).toContain('The user is currently on the Plans page.');
  });

  it('names the destination page for a folded legacy view, and drops the line when absent', () => {
    // Compare has no page of its own — the user is on Plans even at a
    // legacy #/compare route. (The Tools surfaces unfurled in issue #162.)
    const folded = buildSystemPrompt('My Plan', { currentView: 'compare' });
    expect(folded).toContain('The user is currently on the Plans page.');
    // An unfurled tool names its own page.
    expect(buildSystemPrompt('My Plan', { currentView: 'montecarlo' }))
      .toContain('The user is currently on the Monte Carlo page.');
    // No currentView (tests / MCP hosts): the line simply falls out.
    expect(buildSystemPrompt('My Plan')).not.toContain('currently on the');
  });

  it('drops tool instructions for chat-only providers', () => {
    const s = buildSystemPrompt('My Plan', { toolMode: 'off' });
    expect(s).not.toContain('set_scenario_value');
    // Grounded in the plan summary, and honest that it can't change the plan.
    expect(s).toContain('plan summary');
    expect(s).toContain('can\'t change the plan');
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

  it('honors send flags that drop individual pieces', () => {
    const s = buildSystemPrompt('My Plan', {
      config: testConfig(),
      currentView: 'details',
      basePrompt: 'say only yes yes yes',
      send: {
        includePersona: true,
        includePageLine: false,
        includeToolInstructions: false,
        includeProgramRules: false,
        includeScenarioName: false,
      },
    });
    expect(s).toBe('say only yes yes yes');
  });

  it('is empty when every send piece is off', () => {
    const s = assembleSystemPrompt({
      scenarioName: 'My Plan',
      toolMode: 'prompt',
      config: testConfig(),
      currentView: 'details',
      basePrompt: 'say only yes yes yes',
      chatNote: 'per-chat note',
      send: {
        includePersona: false,
        includePageLine: false,
        includeToolInstructions: false,
        includePromptCatalog: false,
        includeProgramRules: false,
        includeScenarioName: false,
        includePlanDigest: false,
        includeChatNote: false,
        sendTools: false,
      },
    });
    expect(s).toBe('');
  });

  it('uses a custom tool-instruction override', () => {
    const s = buildSystemPrompt('My Plan', { toolInstructions: 'Call only get_scenario.' });
    expect(s).toContain('Call only get_scenario.');
    expect(s).not.toContain('set_scenario_value');
  });

  it('can put the persona first when personaLast is off', () => {
    const s = buildSystemPrompt('My Plan', {
      basePrompt: 'say only yes yes yes',
      send: { personaLast: false },
    });
    expect(s.indexOf('say only yes yes yes')).toBeLessThan(s.indexOf('set_scenario_value'));
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
    // Pre-tool narration ("Let me check.") is the model's thinking, not the
    // answer — it belongs in the reasoning block. The actual reply is the
    // post-tool prose. The TOOL_CALL JSON never reaches the user.
    const thinking = events.filter(e => e.type === 'reasoning').map(e => (e as { text: string }).text).join('');
    expect(thinking).toContain('Let me check.');
    const prose = answerText(events);
    expect(prose).not.toContain('Let me check.');
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
    const prose = answerText(events);
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

  it('finds the tool call when a thinking model emits it inside its reasoning', async () => {
    // The local fine-tune "thinks" first: the provider splits <think>…</think>
    // into the reasoning channel, and the TOOL_CALL line rides along in it —
    // visible text stays empty. The loop must scan both channels or the call
    // silently never runs (the "tool calls are not being surfaced" bug).
    const { chat, requests } = scripted([
      [
        { type: 'reasoning', text: 'The user wants numbers. ' },
        { type: 'reasoning', text: 'TOOL_CALL: {"name": "run_projection", "args": {}}' },
        { type: 'done', stopReason: 'end_turn' },
      ],
      [
        { type: 'text', text: 'Your plan is funded to age 95.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'how am I doing?',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'prompt',
    }));
    const result = events.find(e => e.type === 'tool_result');
    expect(result && !result.isError).toBe(true);
    expect((result as { content: string }).content).toContain('lifetime tax');
    expect(requests.length).toBe(2);
  });

  it('does not double-execute a call that appears in BOTH the reasoning and the visible text', async () => {
    // A model that repeats its call outside the <think> block must not get the
    // tool run twice — the visible copy wins, the reasoning copy is ignored.
    const { chat } = scripted([
      [
        { type: 'reasoning', text: 'TOOL_CALL: {"name": "run_projection", "args": {}}' },
        { type: 'text', text: 'TOOL_CALL: {"name": "run_projection", "args": {}}' },
        { type: 'done', stopReason: 'end_turn' },
      ],
      [
        { type: 'text', text: 'Done — funded to age 95.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'check',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'prompt',
    }));
    const results = events.filter(e => e.type === 'tool_result');
    expect(results).toHaveLength(1);
  });

  it('puts pre-tool narration in the reasoning block, not the answer bubble', async () => {
    // Bonsai (and small Qwen) write chain-of-thought as plain text, then a
    // TOOL_CALL. That narration must not look like the reply.
    const { chat } = scripted([
      [
        { type: 'text', text: 'The user wants to retire earlier.\nTOOL_CALL: {"name": "run_projection", "args": {}}' },
        { type: 'done', stopReason: 'end_turn' },
      ],
      [
        { type: 'text', text: 'Your plan lasts to 95.' },
        { type: 'done', stopReason: 'end_turn' },
      ],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'help me retire earlier',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'prompt',
    }));
    const thinking = events.filter(e => e.type === 'reasoning').map(e => (e as { text: string }).text).join('');
    const prose = answerText(events);
    expect(thinking).toContain('retire earlier');
    expect(prose).toBe('Your plan lasts to 95.');
    expect(prose).not.toContain('The user wants');
    // Live stream, then tools — do not reprint the same narration.
    const reasoningEvents = events.filter(e => e.type === 'reasoning');
    expect(reasoningEvents.length).toBeGreaterThan(0);
    expect(thinking).not.toMatch(/The user wants to retire earlier[\s\S]*The user wants to retire earlier/);
  });

  it('streams untagged CoT into the thinking block as tokens arrive', async () => {
    // Bonsai has no <think> tags. Prompt mode used to buffer the whole turn,
    // so the bubble sat on "Thinking…" until generate finished. Tokens must
    // land on the reasoning channel live, like tagged Qwen thoughts.
    const { chat } = scripted([[
      { type: 'text', text: 'The user wants to ' },
      { type: 'text', text: 'retire earlier so I should look at spending.' },
      { type: 'text', text: '\nTOOL_CALL: {"name": "run_projection", "args": {}}' },
      { type: 'done', stopReason: 'end_turn' },
    ], [
      { type: 'text', text: 'Cut spending.' },
      { type: 'done', stopReason: 'end_turn' },
    ]]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'help me retire earlier',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'prompt',
    }));
    const beforeTool = [];
    for (const e of events) {
      if (e.type === 'tool_start' || e.type === 'tool_result') break;
      beforeTool.push(e);
    }
    expect(beforeTool.some(e => e.type === 'reasoning')).toBe(true);
    const live = beforeTool.filter(e => e.type === 'reasoning').map(e => (e as { text: string }).text).join('');
    expect(live).toContain('The user wants');
    expect(live).not.toContain('TOOL_CALL');
    expect(beforeTool.some(e => e.type === 'promote_reasoning')).toBe(false);
    // The post-tool answer may promote its own live tokens into the bubble;
    // the pre-tool thought must still have been a reasoning event.
    const thinking = events.filter(e => e.type === 'reasoning').map(e => (e as { text: string }).text).join('');
    expect(thinking).toContain('The user wants');
  });

  it('promotes a no-tool untagged reply into the answer bubble', async () => {
    const { chat } = scripted([[
      { type: 'text', text: 'You are on track through age ninety-five.' },
      { type: 'done', stopReason: 'end_turn' },
    ]]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'how am I doing?',
      system: 's', chat, onMutation: async () => ({ approved: false }),
      toolMode: 'prompt',
    }));
    expect(events.some(e => e.type === 'promote_reasoning')).toBe(true);
    expect(answerText(events)).toBe('You are on track through age ninety-five.');
  });

  it('liveReasoningDelta holds a split tool marker and stops before TOOL_CALL', () => {
    const a = liveReasoningDelta('Hello there this is thinking', 0, 12);
    expect(a.chunk).toContain('Hello');
    expect(a.chunk.endsWith('thinking')).toBe(false);
    const withCall = liveReasoningDelta('Let me look.\nTOOL_CALL: {"name": "run_projection"}', 0, 12);
    expect(withCall.chunk).toBe('Let me look.\n');
    expect(withCall.chunk).not.toContain('TOOL_CALL');
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
