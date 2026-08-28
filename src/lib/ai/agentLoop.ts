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
import { extractPromptToolCalls, formatPromptToolResults } from './promptTools';

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
  /** How the model invokes tools. 'native' = provider function-calling APIs
   *  (Anthropic/OpenAI/Gemini). 'prompt' = chat-only providers (web-llm): the
   *  system prompt teaches a ```tool fenced-JSON protocol and calls are
   *  parsed out of the model's text. 'off' = no tools at all. Default
   *  'native'. */
  toolMode?: 'native' | 'prompt' | 'off';
  /** Called when the model proposes a mutation; resolves with the user's decision. */
  onMutation: (proposal: MutationProposal) => Promise<MutationDecision>;
  signal?: AbortSignal;
  /** Safety net: max tool-call round trips per user message (default 8). */
  maxRounds?: number;
}

/** Build the system prompt the agent runs under. */
export function buildSystemPrompt(
  scenarioName: string,
  opts?: { toolsEnabled?: boolean; toolMode?: 'native' | 'prompt' | 'off' },
): string {
  const mode = opts?.toolMode ?? (opts?.toolsEnabled === false ? 'off' : 'native');
  return [
    'You are the assistant inside RE:tired, a Canadian retirement drawdown CALCULATOR.',
    mode === 'off'
      ? 'You help the user understand their scenario. You cannot run tools; answer from the plan summary below.'
      : 'You help the user understand and edit their scenario using the provided tools.',
    '',
    'Rules you must follow:',
    '- RE:tired is a calculator, not a planner. You explain consequences of inputs;',
    '  you never give personalized financial advice or tell the user what they SHOULD do.',
    ...(mode !== 'off' ? [
      '- Ground every claim in tool output: use get_scenario to read the plan and',
      '  run_projection / compare_scenarios for numbers. Never invent balances or results.',
      '- You can only change the plan through set_scenario_value, which the USER must',
      '  confirm. Propose changes when asked (or when clearly wanted), never silently.',
    ] : [
      '- Ground every claim in the plan summary below; do not invent balances or results.',
      '- You cannot change the plan or run new projections. When the user asks for a',
      '  what-if, explain the trade-off qualitatively and suggest they try it in the app.',
    ]),
    '- CPP/OAS rules: CPP may start 60–70 (0.6%/month reduction before 65, +0.7%/month',
    '  after, to 70). OAS may start 65–70 (+0.6%/month to 70). RRSP/RRIF draws are fully',
    '  taxable and claw back GIS; TFSA withdrawals are tax-free.',
    '- Keep answers concise. Reference specific ages and dollar figures where helpful.',
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
  const mode = opts.toolMode ?? 'native';
  const tools = mode === 'native' ? toolSpecs() : [];
  const messages: ChatMessage[] = [...opts.history, { role: 'user', content: opts.userMessage }];
  const knownTools = new Set(toolSpecs().map(s => s.name));

  try {
    for (let round = 0; round < maxRounds; round++) {
      let text = '';
      const calls: AgentToolCall[] = [];
      let stopReason = 'unknown';
      let parseErrors: Array<{ raw: string; message: string }> = [];
      // Prompt mode: prose is yielded AFTER the reply is complete and tool
      // blocks have been stripped (streaming raw text would flash ```tool
      // JSON at the user). A spinner shows in the meantime.
      const bufferText = mode === 'prompt';

      for await (const evt of opts.chat({ system: opts.system, messages, tools, signal: opts.signal })) {
        if (evt.type === 'text') {
          text += evt.text;
          if (!bufferText) yield { type: 'text', text: evt.text };
        } else if (evt.type === 'tool_use') {
          calls.push(evt.call);
        } else if (evt.type === 'done') {
          stopReason = evt.stopReason;
        }
      }

      if (mode === 'prompt') {
        const parsed = extractPromptToolCalls(text, knownTools);
        calls.push(...parsed.calls);
        parseErrors = parsed.errors;
        if (parsed.prose) yield { type: 'text', text: parsed.prose };
      }

      if (calls.length === 0 && parseErrors.length === 0) {
        yield { type: 'done', stopReason };
        return;
      }

      // Record the assistant turn (prose + tool calls) before executing, so
      // the next request serializes correctly for every provider.
      messages.push({ role: 'assistant', content: text, toolCalls: calls.length ? calls : undefined });
      const results: Array<{ toolCallId: string; content: string; isError: boolean }> = [];

      for (const call of calls) {
        yield { type: 'tool_start', call };
        // Chat-only providers: never execute — tell the model tools are off.
        if (mode === 'off') {
          const content = 'Tool use is not available with this provider. Answer from the conversation and the plan summary in the system prompt instead.';
          results.push({ toolCallId: call.id, content, isError: true });
          yield { type: 'tool_result', call, content, isError: true };
          continue;
        }
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
      if (mode === 'prompt') {
        // Text-protocol providers: results go back as a plain user message in
        // the fenced-block convention the system prompt taught.
        messages.push({ role: 'user', content: formatPromptToolResults(results, parseErrors) });
      } else {
        messages.push({ role: 'user', content: '', toolResults: results });
      }
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
