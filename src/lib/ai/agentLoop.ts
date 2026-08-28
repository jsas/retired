// The agent turn loop: user message → model (streaming) → tool calls →
// results → model again … until the model stops without calling tools.
//
// This module is provider-neutral — it takes a `chat` function (usually
// streamChat bound to a connection) so tests drive it with scripted fakes.
// Mutating tools (set_scenario_value) pause the loop: the proposal is handed
// to `onMutation`, and the loop only continues once the UI reports the user's
// decision. That's the confirm-before-apply guarantee — no path from model
// output to plan state bypasses it.

import type { AgentToolCall, ChatMessage, StreamEvent, ToolSpec } from './providers';
import { executeToolCall, toolSpecs, type ToolContext, type ToolOutcome } from './tools';

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; call: AgentToolCall }
  | { type: 'tool_result'; call: AgentToolCall; content: string; isError: boolean }
  | { type: 'mutation'; proposal: MutationProposal }
  | { type: 'error'; message: string }
  | { type: 'done'; stopReason: string };

export interface MutationProposal {
  callId: string;
  field: string;
  value: unknown;
  rationale?: string;
  preview: Record<string, unknown>;
}

export interface MutationDecision {
  approved: boolean;
  /** Optional note from the user ("only set it to 60000") echoed back to the model. */
  note?: string;
}

export interface AgentLoopOptions {
  /** The scenario/engine surface the tools run against. */
  context: ToolContext;
  /** Prior conversation (oldest first). */
  history: ChatMessage[];
  /** The new user message. */
  userMessage: string;
  system: string;
  /** Chat function; streamChat(conn, …) in the app, a fake in tests. */
  chat: (req: {
    system: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
    signal?: AbortSignal;
  }) => AsyncGenerator<StreamEvent>;
  /** Called when the model proposes a mutation; resolves with the user's decision. */
  onMutation: (proposal: MutationProposal) => Promise<MutationDecision>;
  signal?: AbortSignal;
  /** Safety net: max tool-call round trips per user message (default 8). */
  maxRounds?: number;
}

/** Build the system prompt the agent runs under. */
export function buildSystemPrompt(scenarioName: string): string {
  return [
    'You are the assistant inside RE:tired, a Canadian retirement drawdown CALCULATOR.',
    'You help the user understand and edit their scenario using the provided tools.',
    '',
    'Rules you must follow:',
    '- RE:tired is a calculator, not a planner. You explain consequences of inputs;',
    '  you never give personalized financial advice or tell the user what they SHOULD do.',
    '- Ground every claim in tool output: use get_scenario to read the plan and',
    '  run_projection / compare_scenarios for numbers. Never invent balances or results.',
    '- You can only change the plan through set_scenario_value, which the USER must',
    '  confirm. Propose changes when asked (or when clearly wanted), never silently.',
    '- CPP/OAS rules: CPP may start 60–70 (0.6%/month reduction before 65, +0.7%/month',
    '  after, to 70). OAS may start 65–70 (+0.6%/month to 70). RRSP/RRIF draws are fully',
    '  taxable and claw back GIS; TFSA withdrawals are tax-free.',
    '- Keep answers concise. Reference specific ages and dollar figures from tool output.',
    '',
    `The active scenario is "${scenarioName}".`,
  ].join('\n');
}

/**
 * Run one user turn through the agent. Yields AgentEvents as they happen so
 * the UI can stream prose, show tool activity, and surface confirm cards.
 * The returned history (via the final 'done' event's preceding state) is NOT
 * maintained here — the caller appends events to its own transcript; this
 * generator only needs `history` + `userMessage` as the starting point.
 */
export async function* runAgentTurn(opts: AgentLoopOptions): AsyncGenerator<AgentEvent> {
  const maxRounds = opts.maxRounds ?? 8;
  const tools = toolSpecs();
  const messages: ChatMessage[] = [...opts.history, { role: 'user', content: opts.userMessage }];

  try {
    for (let round = 0; round < maxRounds; round++) {
      let text = '';
      const calls: AgentToolCall[] = [];
      let stopReason = 'unknown';

      for await (const evt of opts.chat({ system: opts.system, messages, tools, signal: opts.signal })) {
        if (evt.type === 'text') {
          text += evt.text;
          yield { type: 'text', text: evt.text };
        } else if (evt.type === 'tool_use') {
          calls.push(evt.call);
        } else if (evt.type === 'done') {
          stopReason = evt.stopReason;
        }
      }

      if (calls.length === 0) {
        yield { type: 'done', stopReason };
        return;
      }

      // Record the assistant turn (prose + tool calls) before executing, so
      // the next request serializes correctly for every provider.
      messages.push({ role: 'assistant', content: text, toolCalls: calls });
      const results: Array<{ toolCallId: string; content: string; isError: boolean }> = [];

      for (const call of calls) {
        yield { type: 'tool_start', call };
        const outcome: ToolOutcome = executeToolCall(opts.context, call);

        if (outcome.kind === 'mutation') {
          const proposal: MutationProposal = {
            callId: call.id,
            field: outcome.field,
            value: outcome.value,
            rationale: outcome.rationale,
            preview: outcome.preview,
          };
          yield { type: 'mutation', proposal };
          const decision = await opts.onMutation(proposal);
          const content = decision.approved
            ? `APPROVED: ${outcome.field} set to ${JSON.stringify(outcome.value)}.` +
              (decision.note ? ` User note: ${decision.note}` : '')
            : `REJECTED by the user — do not apply or repeat this change unprompted.` +
              (decision.note ? ` User note: ${decision.note}` : '');
          results.push({ toolCallId: call.id, content, isError: !decision.approved });
          yield { type: 'tool_result', call, content, isError: !decision.approved };
          continue;
        }

        const isError = outcome.kind === 'error';
        const content = outcome.content;
        results.push({ toolCallId: call.id, content, isError });
        yield { type: 'tool_result', call, content, isError };
      }

      // Feed results back; the loop continues for the model's next turn.
      messages.push({ role: 'user', content: '', toolResults: results });
    }

    yield {
      type: 'error',
      message: `Stopped after ${maxRounds} tool round trips (safety limit). The model kept calling tools without finishing — try rephrasing.`,
    };
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
