// Seam test: the agent loop driving tools through the REAL MCP server.
//
// AgentPage wires runAgentTurn an executor built by createMcpToolExecutor; this
// proves the whole path — model tool_use event → MCP tools/call round trip →
// ToolOutcome back into the loop — including the two outcomes that carry the
// product's guarantees: read results (text) and mutation proposals (which must
// arrive via structuredContent and pause for user confirmation).

import { describe, expect, it } from 'vitest';
import { runAgentTurn, type AgentEvent, type MutationProposal } from './agentLoop';
import type { ChatMessage, StreamEvent } from './providers';
import type { ToolContext } from '@retired/mcp-tools/tools';
import { createMcpToolExecutor, closeSharedMcpSession } from './mcpClient';
import { baseInputs, testConfig } from '@retired/engine-core/test/helpers';

function ctx(): ToolContext {
  return {
    inputs: baseInputs(),
    config: testConfig(),
    scenarioName: 'Test plan',
    scenarioList: [{ id: 'a', name: 'Test plan' }],
  };
}

function scripted(turns: StreamEvent[][]) {
  let i = 0;
  return async function* (): AsyncGenerator<StreamEvent> {
    const turn = turns[Math.min(i, turns.length - 1)];
    i += 1;
    for (const evt of turn) yield evt;
  };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function executor() {
  const live = ctx();
  return createMcpToolExecutor(() => live);
}

describe('agent loop over the in-page MCP server', () => {
  it('runs a read tool through tools/call and feeds the text back to the model', async () => {
    const chat = scripted([
      [{ type: 'tool_use', call: { id: 'c1', name: 'get_scenario', args: { section: 'summary' } } },
       { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'All read.' }, { type: 'done', stopReason: 'end_turn' }],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [] as ChatMessage[], userMessage: 'summarize my plan',
      system: 's', chat, executeCall: executor(),
      onMutation: async () => ({ approved: false }),
    }));

    const result = events.find(e => e.type === 'tool_result') as Extract<AgentEvent, { type: 'tool_result' }>;
    expect(result).toBeDefined();
    expect(result.isError).toBe(false);
    expect(result.content).toContain('Test plan');
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
    await closeSharedMcpSession();
  });

  it('surfaces a mutation proposal from structuredContent and pauses for the decision', async () => {
    const proposals: MutationProposal[] = [];
    const chat = scripted([
      [{ type: 'tool_use', call: { id: 'c2', name: 'set_scenario_value', args: { field: 'cppStartAge', value: 65 } } },
       { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'Done.' }, { type: 'done', stopReason: 'end_turn' }],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'start CPP at 65',
      system: 's', chat, executeCall: executor(),
      onMutation: async (p) => { proposals.push(p); return { approved: true }; },
    }));

    // The confirm card got the proposal that rode back over MCP.
    expect(proposals).toHaveLength(1);
    expect(proposals[0].patch.cppStartAge).toBe(65);
    expect(proposals[0].label).toBeTruthy();
    // …and the loop reported the approval back to the model as a tool result.
    const result = events.find(e => e.type === 'tool_result') as Extract<AgentEvent, { type: 'tool_result' }>;
    expect(result.isError).toBe(false);
    expect(result.content).toContain('APPLIED');
    await closeSharedMcpSession();
  });

  it('maps a tool-level error (isError) into an error tool_result', async () => {
    const chat = scripted([
      [{ type: 'tool_use', call: { id: 'c3', name: 'set_scenario_value', args: { field: 'events', value: [] } } },
       { type: 'done', stopReason: 'tool_use' }],
      [{ type: 'text', text: 'Understood.' }, { type: 'done', stopReason: 'end_turn' }],
    ]);
    const events = await collect(runAgentTurn({
      context: ctx(), history: [], userMessage: 'clear my events',
      system: 's', chat, executeCall: executor(),
      onMutation: async () => ({ approved: false }),
    }));

    const result = events.find(e => e.type === 'tool_result') as Extract<AgentEvent, { type: 'tool_result' }>;
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not changeable');
    await closeSharedMcpSession();
  });
});
