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
  | { type: 'reasoning'; text: string }
  | { type: 'tool_start'; call: AgentToolCall }
  | { type: 'tool_result'; call: AgentToolCall; content: string; isError: boolean }
  | { type: 'mutation'; proposal: MutationProposal }
  | { type: 'error'; message: string }
  | { type: 'done'; stopReason: string };

export interface MutationProposal {
  callId: string;
  /** The proposed change as a partial inputs patch, applied on approval. */
  patch: Record<string, unknown>;
  /** Short card label ("Add spouse", "Set CPP start age"). */
  label: string;
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

/**
 * The planner persona at the heart of the assistant's system prompt. Exported
 * as a constant so the user can read it, and so Settings can offer it as the
 * default they adjust (a per-chat note is appended separately). Tool usage and
 * the scenario name are appended by buildSystemPrompt — this is the voice and
 * the rules, not the mechanics.
 *
 * The assistant IS a planning assistant: it explains consequences, runs the
 * numbers, and proposes changes — always confirmed by the user before anything
 * is applied. It frames trade-offs and evidence rather than issuing directives.
 * The prompt deliberately avoids naming the refusal it replaces (small models
 * parrot negated phrases), so the old "I'm not a planner" guardrail is simply
 * gone rather than forbidden.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  'You are the retirement planning assistant inside RE:tired, a Canadian',
  'retirement drawdown planner. You help the user understand their plan, explore',
  'trade-offs, and improve their outcome. You ARE a planner: engage fully with',
  '"what should I do?" by laying out the options, running the numbers on each,',
  'and recommending the one the evidence supports — then let the user decide.',
  '',
  'How you work:',
  '- Ground every claim in the real numbers. Use the tools (or the plan summary',
  '  provided) to read the scenario and run projections; never invent balances,',
  '  returns, or results.',
  '- When the user asks for a change — or one is clearly wanted — propose it with',
  '  a tool. Every change is confirmed by the user before it is applied; never',
  '  apply anything silently.',
  '- Be concrete: cite specific ages and dollar figures, and quantify the effect',
  '  of each option (depletion age, lifetime tax, ending balance, success rate).',
  '',
  'Canadian retirement rules you must apply correctly:',
  '- CPP may start 60–70 (0.6%/month reduction before 65, +0.7%/month after, to',
  '  70). OAS may start 65–70 (+0.6%/month to 70) and is clawed back at high',
  '  income. GIS is income-tested and clawed back by taxable income.',
  '- RRSP/RRIF draws are fully taxable and count against GIS/OAS; TFSA',
  '  withdrawals are tax-free and do not. RRIF minimums are mandatory from 71.',
  '- Only Canadian residents; no US cross-border or non-resident tax.',
  '',
  'Keep answers concise and plain-language. You explain consequences and make',
  'evidence-based recommendations; the user always makes the final call.',
].join('\n');

/** Build the system prompt the agent runs under. The persona comes from
 *  `basePrompt` (DEFAULT_SYSTEM_PROMPT unless the user has overridden it in
 *  Settings); this appends the tool-usage mechanics and the scenario name. */
export function buildSystemPrompt(
  scenarioName: string,
  opts?: { toolsEnabled?: boolean; toolMode?: 'native' | 'prompt' | 'off'; basePrompt?: string },
): string {
  const mode = opts?.toolMode ?? (opts?.toolsEnabled === false ? 'off' : 'native');
  const persona = (opts?.basePrompt?.trim()) || DEFAULT_SYSTEM_PROMPT;
  return [
    persona,
    '',
    mode === 'off'
      ? 'You cannot run tools in this mode; answer from the plan summary below.'
      : mode === 'prompt'
        ? [
            'Tools: the plan inputs and computed projection are BELOW in this message. The',
            'user\'s age, balances, and benefits are already there — never ask for them;',
            'quote the numbers directly and use tools only for what-ifs or fresh projections.',
          ].join('\n')
        : [
            'Tools: use get_scenario to read the plan and run_projection / compare_scenarios /',
            'run_monte_carlo for numbers. Use run_strategies to compare levers and',
            'solve_spending for "how much can I safely spend?". Change the plan only through',
            'the propose_* / set_scenario_value tools — the user confirms every one. For a',
            'batch of related scalar edits prefer propose_patch; for a spouse, pension, work',
            'income, spending phases, a cash event, or a reverse mortgage use its dedicated',
            'propose_* tool.',
          ].join('\n'),
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
  // Track the last executed call so we can refuse an immediate identical
  // repeat — the classic small-model failure is ping-ponging the same two
  // tools (run_projection / compare_scenarios) with unchanged args forever.
  let lastCallKey: string | null = null;

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
        } else if (evt.type === 'reasoning') {
          // Chain-of-thought is never part of the answer text; forward it for
          // display only (and even in prompt mode, where prose is buffered).
          yield { type: 'reasoning', text: evt.text };
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
        // Refuse an immediate identical re-call (same tool, same args as the
        // one just executed). The result would be byte-identical, so re-running
        // it only feeds a loop; bounce it back as an error the model can read.
        const callKey = `${call.name}:${JSON.stringify(call.args ?? {})}`;
        if (callKey === lastCallKey) {
          const content = 'You just ran this exact tool with the same arguments and already have its result above. Do not call it again — answer the user from the numbers you have.';
          results.push({ toolCallId: call.id, content, isError: true });
          yield { type: 'tool_result', call, content, isError: true };
          continue;
        }
        const outcome: ToolOutcome = executeToolCall(opts.context, call);
        lastCallKey = callKey;

        if (outcome.kind === 'mutation') {
          const proposal: MutationProposal = {
            callId: call.id,
            patch: outcome.patch as Record<string, unknown>,
            label: outcome.label,
            rationale: outcome.rationale,
            preview: outcome.preview,
          };
          yield { type: 'mutation', proposal };
          const decision = await opts.onMutation(proposal);
          const content = decision.approved
            ? `APPROVED: ${outcome.label} (${JSON.stringify(outcome.patch)}).` +
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
