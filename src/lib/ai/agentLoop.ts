// The agent turn loop: user message → model (streaming) → tool calls →
// results → model again … until the model stops without calling tools.
//
// This module is provider-neutral — it takes a `chat` function (usually
// streamChat bound to a connection) so tests drive it with scripted fakes.
// Mutating tools (propose_plan / manage_* / propose_*) pause the loop: the proposal is handed
// to `onMutation`, and the loop only continues once the UI reports the user's
// decision. That's the confirm-before-apply guarantee — no path from model
// output to plan state bypasses it.

import type { AgentToolCall, ChatMessage, StreamEvent, ToolSpec } from './providers';
import { executeToolCall, toolSpecs, type ToolContext, type ToolOutcome } from '@retired/mcp-tools/tools';
import { pageTitleLine } from '@retired/mcp-tools/navigation';
import { foldTarget, type View } from '../viewRoutes';
import { buildPromptToolInstructions, extractPromptToolCalls, formatPromptToolResults } from './promptTools';
import { buildProgramRules } from './programRules';
import type { AppConfig } from '@retired/engine-core/appConfig';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import type { Locale } from '../locale';
import { i18n } from '../i18n';

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  /** Prompt-mode untagged CoT was shown live as thinking; this round is the
   *  answer — move `text` out of the thinking block into the reply bubble
   *  without wiping earlier rounds' thoughts. */
  | { type: 'promote_reasoning'; text: string }
  | { type: 'tool_start'; call: AgentToolCall }
  | { type: 'tool_result'; call: AgentToolCall; content: string; isError: boolean }
  | { type: 'mutation'; proposal: MutationProposal }
  | { type: 'error'; message: string }
  | { type: 'done'; stopReason: string; servedModel?: string };

/** Hold-back so a split `TOOL_CALL:` across chunks doesn't flash in Thinking. */
const LIVE_REASONING_HOLD = 12;
const TOOL_MARKER = /tool_call\s*:?|<tool_call>|```tool/i;

/** Next live-reasoning slice of accumulated prompt-mode text. Stops before a
 *  tool marker so JSON never paints in the thinking block. */
export function liveReasoningDelta(accumulated: string, already: number, hold = LIVE_REASONING_HOLD): { chunk: string; next: number } {
  const cut = accumulated.search(TOOL_MARKER);
  const limit = cut === -1 ? Math.max(0, accumulated.length - hold) : cut;
  if (limit <= already) return { chunk: '', next: already };
  return { chunk: accumulated.slice(already, limit), next: limit };
}

export interface MutationProposal {
  callId: string;
  /** The proposed change as a partial inputs patch, applied on approval.
   *  Revert proposals (revert: true) encode absent-at-checkpoint fields with
   *  UNDEFINED_SENTINEL — the UI decodes them before applying. */
  patch: Record<string, unknown>;
  /** Short card label ("Add spouse", "Set CPP start age"). */
  label: string;
  rationale?: string;
  preview: Record<string, unknown>;
  /** True when this proposal rolls the plan back to a checkpoint. */
  revert?: boolean;
  /** Set on page-navigation proposals (propose_navigate): the view to open on
   *  approval. The UI routes instead of merging a plan patch, and records no
   *  checkpoint — the plan never changed. */
  navigate?: View;
  /** Mint a partner plan on approval, then link this plan to it. Empty host
   *  patch — create-and-link is the side effect. */
  createPartner?: { name: string; inputs: RetirementInputs };
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
  /** How tool calls are executed. Default: `executeToolCall(context, call)`
   *  in-process. The app passes an MCP-backed executor (see mcpClient.ts) so
   *  every call goes through the in-page MCP server — same catalog, same
   *  outcomes, but over the protocol boundary the server owns. */
  executeCall?: (call: AgentToolCall) => Promise<ToolOutcome>;
  signal?: AbortSignal;
  /** Safety net: max tool-call round trips per user message (default 8).
   *  0 = chat only: one generation with the given system, no tools, and no
   *  wrap-up pass (that pass rebuilds a default persona). */
  maxRounds?: number;
  /** The live app config; when supplied, the finalization pass after the round
   *  limit re-reads the rules from it. Not required for the loop itself. */
  config?: AppConfig;
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
  '- When the user gives plan numbers (age, retirement age, spending, balances,',
  '  province, CPP/OAS), call propose_plan immediately with those fields. Do not',
  '  recap the numbers in prose first — the confirm card IS the recap.',
  '- If this plan still looks like a blank starter (zero balances, no income,',
  '  no spouse — New Scenario defaults), interview one question at a time and',
  '  call propose_plan as numbers arrive. Ages, $40k spending, and Ontario on a',
  '  blank plan are PLACEHOLDERS — ask; do not treat them as given. If the user',
  '  says fill the rest, use defaults, or skip remaining questions, call',
  '  propose_plan THIS TURN with remaining starter defaults. Never claim you',
  '  filled the plan without that tool call — the confirm card IS the fill.',
  '- Be concrete: cite specific ages and dollar figures, and quantify the effect',
  '  of each option (depletion age, lifetime tax, ending balance, success rate).',
  '',
  'The exact benefit/tax rules this program applies (CPP/OAS/GIS amounts, RRIF',
  'minimums, registered-plan limits) are listed below, read live from the',
  'engine settings — quote those figures, not generic ones.',
  '',
  'Keep answers concise and plain-language. You explain consequences and make',
  'evidence-based recommendations; the user always makes the final call.',
].join('\n');

/** Native-mode tool blurb (cloud providers with function-calling). */
export const DEFAULT_TOOL_INSTRUCTIONS_NATIVE = [
  'Tools: use get_scenario to read the plan and run_projection / compare_scenarios /',
  'run_monte_carlo for numbers (all accept overrides for what-ifs). Use',
  'run_strategies to compare levers and solve_spending for "how much can I safely',
  'spend?". Change the plan only through propose_plan (scalars: ages, spending,',
  'balances, contributions, province, CPP/OAS) and the manage_* / propose_* tools —',
  'the user confirms every one. When the user gives several plan numbers at once',
  '(age, retirement, spending, balances), call propose_plan immediately — never',
  'narrate them first. If they say fill the rest / use defaults, call propose_plan',
  'this turn with remaining starter defaults — do not only say you will. For a spouse use propose_spouse; for income, cash events, or',
  'debts use manage_income / manage_cash_event / manage_debt (action add|update|remove).',
  'For a reverse mortgage, RDSP, or FHSA use propose_account. To undo a change the',
  'user approved earlier, propose_revert restores the automatic snapshot taken just',
  'before it landed.',
  'Memory: at the START of a conversation, recall your memories so you know what',
  'the user told you before. When the user shares something durable and important',
  '(a decision, a constraint, a preference, a life plan), remember it — scope',
  '"scenario" for plan facts, "global" for facts about the user. When you remember',
  'something, also pass keywords: the category words a later question might use',
  '(a note about oranges needs "fruit", "food") — recall matches by keyword. If a',
  'recall query returns only "closest memories", those did NOT match; use them as',
  'a hint, and say honestly when nothing recorded covers the question. Never',
  'memorize numbers that are already in the plan.',
  'Scenarios: list_scenarios with action "open" switches to another saved plan;',
  'action "save_as" keeps the current plan under a new name and opens the copy —',
  'use it when the user wants to keep a variant ("save this as its own plan")',
  'before editing.',
].join('\n');

/** Prompt-mode tool blurb (local models; the TOOL_CALL catalog is appended separately). */
export const DEFAULT_TOOL_INSTRUCTIONS_PROMPT = [
  'Tools: the plan inputs and computed projection are BELOW in this message. The',
  'user\'s age, balances, benefits, and account values are in the summary. Read',
  'them from there, and call get_scenario or run_projection (with overrides) for',
  'any number you don\'t have. Answer with the real figures; only use',
  'run_projection/compare_scenarios for what-ifs. When the user gives new plan',
  'numbers, call propose_plan immediately — do not recap them. If they ask you to',
  'fill remaining fields yourself, call propose_plan this turn with remaining',
  'starter defaults; do not only say you will. If the summary marks this as a',
  'blank starter (zero balances / New Scenario defaults), those ages and spending',
  'are PLACEHOLDERS — interview one question at a time instead of treating them',
  'as the user\'s real situation.',
].join('\n');

/** Chat-only blurb when tools are off. */
export const DEFAULT_TOOL_INSTRUCTIONS_OFF =
  'Answer questions from the plan summary below — it has the ages, balances, benefits, ' +
  'and computed projection. Ground every number in it; never invent figures or ask the ' +
  'user for values that are already there. This model can\'t change the plan, so don\'t ' +
  'promise edits; just explain the numbers plainly.';

/** Per-request switches for what rides in the system prompt. Unset = send
 *  (defaults match historical behavior, except personaLast which defaults on
 *  so a user override is not drowned by later tool/rules text). */
export interface PromptSendFlags {
  includePersona?: boolean;
  includePageLine?: boolean;
  includeLocale?: boolean;
  includeToolInstructions?: boolean;
  includePromptCatalog?: boolean;
  includeProgramRules?: boolean;
  includeScenarioName?: boolean;
  includePlanDigest?: boolean;
  includeChatNote?: boolean;
  sendTools?: boolean;
  personaLast?: boolean;
}

export const DEFAULT_PROMPT_SEND: Required<PromptSendFlags> = {
  includePersona: true,
  includePageLine: true,
  includeLocale: true,
  includeToolInstructions: true,
  includePromptCatalog: true,
  includeProgramRules: true,
  includeScenarioName: true,
  includePlanDigest: true,
  includeChatNote: true,
  sendTools: true,
  personaLast: true,
};

export function resolvePromptSend(flags?: PromptSendFlags): Required<PromptSendFlags> {
  return { ...DEFAULT_PROMPT_SEND, ...flags };
}

function tPrompt(
  key: string,
  locale: Locale | undefined,
  fallback: string,
  vars?: Record<string, unknown>,
): string {
  if (!locale) return fallback;
  const result = i18n.t(key, { ns: 'prompts', lng: locale, ...vars });
  if (typeof result !== 'string' || result === key || result.startsWith('prompts:')) return fallback;
  return result;
}

/** Locale-aware persona. Falls back to the English constant when no locale is given. */
export function defaultSystemPromptFor(locale?: Locale): string {
  return tPrompt('persona', locale, DEFAULT_SYSTEM_PROMPT);
}

export function defaultToolInstructionsFor(
  mode: 'native' | 'prompt' | 'off',
  locale?: Locale,
): string {
  if (mode === 'off') return tPrompt('toolOff', locale, DEFAULT_TOOL_INSTRUCTIONS_OFF);
  if (mode === 'prompt') return tPrompt('toolPrompt', locale, DEFAULT_TOOL_INSTRUCTIONS_PROMPT);
  return tPrompt('toolNative', locale, DEFAULT_TOOL_INSTRUCTIONS_NATIVE);
}

function localizedPageTitle(view: View, locale?: Locale): string {
  return tPrompt(`pageTitle.${foldTarget(view)}`, locale, pageTitleLine(view));
}

const LOCALE_LINE_FALLBACK =
  'The page language is {{locale}} ({{locale}}). Think and answer in that language. Only switch if the user writes a full sentence in another language — a greeting like "hi" is not a switch.';

function localeLineFor(locale: Locale | undefined): string | null {
  if (!locale) return null;
  return tPrompt('localeLine', locale, LOCALE_LINE_FALLBACK.replaceAll('{{locale}}', locale), {
    language: tPrompt(
      'languageName',
      locale,
      locale === 'fr-CA' ? 'français (Canada)' : 'English (Canada)',
    ),
    locale,
  });
}

/** Build the system prompt the agent runs under. The persona comes from
 *  `basePrompt` (DEFAULT_SYSTEM_PROMPT unless the user has overridden it in
 *  Settings). Tool-usage mechanics, live program rules, the current page, and
 *  the scenario name are each optional via `send`. Small local models follow
 *  the LAST system text, so the persona is last by default. */
const SETUP_LINE_FALLBACK =
  'SETUP: the active plan is an unfilled starter (all account balances $0). Interview one question at a time and call propose_plan as numbers arrive (changes: { currentAge, retirementAge, desiredSpending, rrspBalance, ... } — or the same fields at the top level). Do not treat its ages, spending, or province as the user\'s. If they say fill the rest, use defaults, or skip remaining questions: call propose_plan THIS TURN with remaining starter defaults. Never say you filled the plan without that tool call — the confirm card IS the fill.';

export function buildSystemPrompt(
  scenarioName: string,
  opts?: {
    toolsEnabled?: boolean;
    toolMode?: 'native' | 'prompt' | 'off';
    basePrompt?: string;
    /** Live engine config; when supplied, the CPP/OAS/GIS/RRIF/limit rules are
     *  rendered from it so the model quotes the program's real numbers. */
    config?: AppConfig;
    /** The view the host page is on. Ambient (one line); when the prop is
     *  absent (tests / MCP server), the line falls out. */
    currentView?: View;
    /** Page language. Always named in the prompt when supplied (en-CA and fr-CA). */
    locale?: Locale;
    send?: PromptSendFlags;
    /** Replacement for the mode-specific tool-instruction blurb. */
    toolInstructions?: string;
    /** When true, append the blank-starter interview line (New Scenario /
     *  Example plan / zero balances). */
    unsetPlan?: boolean;
  },
): string {
  const mode = opts?.toolMode ?? (opts?.toolsEnabled === false ? 'off' : 'native');
  const send = resolvePromptSend(opts?.send);
  const locale = opts?.locale;
  const persona = send.includePersona
    ? ((opts?.basePrompt?.trim()) || defaultSystemPromptFor(locale))
    : '';
  const rules = send.includeProgramRules && opts?.config
    ? buildProgramRules(opts.config, locale)
    : '';
  const pageLine = send.includePageLine && opts?.currentView
    ? tPrompt(
      'pageLine',
      locale,
      `The user is currently on the ${pageTitleLine(opts.currentView)} page.`,
      { page: localizedPageTitle(opts.currentView, locale) },
    )
    : null;
  const toolBlurb = send.includeToolInstructions
    ? ((opts?.toolInstructions?.trim()) || defaultToolInstructionsFor(mode, locale))
    : '';
  const scenarioLine = send.includeScenarioName
    ? tPrompt('scenarioLine', locale, `The active scenario is "${scenarioName}".`, { name: scenarioName })
    : '';
  // Locale rides as its own send flag (Settings → What is sent). Appended last
  // so a small model still sees it after the English TOOL_CALL catalog.
  const localeLine = send.includeLocale ? localeLineFor(locale) : null;

  const mechanics = [
    ...(pageLine ? [pageLine] : []),
    ...(toolBlurb ? ['', toolBlurb] : []),
    ...(rules ? ['', rules] : []),
    ...(scenarioLine ? ['', scenarioLine] : []),
  ];

  const parts = send.personaLast
    ? [...mechanics, ...(persona ? ['', persona] : [])]
    : [...(persona ? [persona] : []), ...mechanics];
  if (localeLine) parts.push('', localeLine);
  // Blank-starter interview last so a small model still sees it after persona.
  if (opts?.unsetPlan) parts.push('', tPrompt('setupLine', locale, SETUP_LINE_FALLBACK));

  return parts.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

/**
 * The full system body a turn actually sends: persona/mechanics plus, for
 * prompt-mode local models, the TOOL_CALL catalog. Settings and the chat page
 * share this so the Assistant preview matches the wire.
 */
export function assembleSystemPrompt(opts: {
  scenarioName: string;
  toolMode: 'native' | 'prompt' | 'off';
  send?: PromptSendFlags;
  basePrompt?: string;
  config?: AppConfig;
  currentView?: View;
  locale?: Locale;
  toolInstructions?: string;
  /** Per-chat composer note; omitted unless includeChatNote is on. */
  chatNote?: string;
  /** When true, append the blank-starter interview line. */
  unsetPlan?: boolean;
}): string {
  const send = resolvePromptSend(opts.send);
  const body = buildSystemPrompt(opts.scenarioName, {
    toolMode: opts.toolMode,
    basePrompt: opts.basePrompt,
    config: opts.config,
    currentView: opts.currentView,
    locale: opts.locale,
    send,
    toolInstructions: opts.toolInstructions,
  });
  const catalog = opts.toolMode === 'prompt' && send.includePromptCatalog
    ? buildPromptToolInstructions(toolSpecs())
    : '';
  const note = send.includeChatNote ? (opts.chatNote?.trim() ?? '') : '';
  const noteBlock = note
    ? tPrompt('chatNote', opts.locale, `Additional instructions for this chat:\n${note}`, { note })
    : '';
  // Catalog stays English (protocol). Locale already sits at the end of `body`
  // for native/off; when the catalog is present, re-append it after so a small
  // model doesn't treat the English TOOL_CALL list as the language to think in.
  const localeAgain = catalog && send.includeLocale ? (localeLineFor(opts.locale) ?? '') : '';
  // Interview line last of all — after the English catalog — so a small local
  // model still treats a blank plan as a setup, not as filled-in numbers.
  const setupLine = opts.unsetPlan
    ? tPrompt('setupLine', opts.locale, SETUP_LINE_FALLBACK)
    : '';
  return [body, catalog, noteBlock, localeAgain, setupLine].filter(Boolean).join('\n\n');
}

/**
 * Run one user turn through the agent. Yields AgentEvents as they happen so
 * the UI can stream prose, show tool activity, and surface confirm cards.
 * The returned history (via the final 'done' event's preceding state) is NOT
 * maintained here — the caller appends events to its own transcript; this
 * generator only needs `history` + `userMessage` as the starting point.
 */
export async function* runAgentTurn(opts: AgentLoopOptions): AsyncGenerator<AgentEvent> {
  const maxRoundsOpt = opts.maxRounds ?? 8;
  // 0 means chat-only: one generation with the CALLER'S system. Falling
  // through to finalizeWithoutTools would rebuild a default persona and
  // "answer from the tool results" instruction — the leftover the user
  // still saw after unchecking every Settings send flag.
  const chatOnly = maxRoundsOpt <= 0;
  const maxRounds = chatOnly ? 1 : maxRoundsOpt;
  const mode = opts.toolMode ?? 'native';
  const tools = !chatOnly && mode === 'native' ? toolSpecs() : [];
  const messages: ChatMessage[] = [...opts.history, { role: 'user', content: opts.userMessage }];
  const knownTools = new Set<string>(toolSpecs().map(s => s.name));
  // Track the last executed call so we can refuse an immediate identical
  // repeat — the classic small-model failure is ping-ponging the same two
  // tools (run_projection / compare_scenarios) with unchanged args forever.
  let lastCallKey: string | null = null;

  try {
    for (let round = 0; round < maxRounds; round++) {
      let text = '';
      let reasoningText = '';
      const calls: AgentToolCall[] = [];
      let stopReason = 'unknown';
      let servedModel: string | undefined;
      let parseErrors: Array<{ raw: string; message: string }> = [];
      // Prompt mode: don't flash tool JSON as the answer. Untagged CoT (Bonsai)
      // has no <think> tags, so stream it live as reasoning. Tagged CoT (Qwen)
      // already arrives on the reasoning channel — leave its answer text
      // buffered until tool blocks are stripped.
      const bufferText = mode === 'prompt';
      let sawProviderReasoning = false;
      let liveReasoningAt = 0;

      for await (const evt of opts.chat({ system: opts.system, messages, tools, signal: opts.signal })) {
        if (evt.type === 'text') {
          text += evt.text;
          if (!bufferText) {
            yield { type: 'text', text: evt.text };
          } else if (!sawProviderReasoning) {
            const { chunk, next } = liveReasoningDelta(text, liveReasoningAt);
            liveReasoningAt = next;
            if (chunk) yield { type: 'reasoning', text: chunk };
          }
        } else if (evt.type === 'reasoning') {
          sawProviderReasoning = true;
          reasoningText += evt.text;
          // Chain-of-thought is never part of the answer text; forward it for
          // display only (and even in prompt mode, where prose is buffered).
          yield { type: 'reasoning', text: evt.text };
        } else if (evt.type === 'tool_use') {
          calls.push(evt.call);
        } else if (evt.type === 'done') {
          stopReason = evt.stopReason;
          if (evt.servedModel) servedModel = evt.servedModel;
        }
      }

      // Flush the hold-back now that the turn is complete (no more split marker).
      if (bufferText && !sawProviderReasoning) {
        const flushed = liveReasoningDelta(text, liveReasoningAt, 0);
        liveReasoningAt = flushed.next;
        if (flushed.chunk) yield { type: 'reasoning', text: flushed.chunk };
      }

      if (mode === 'prompt') {
        // Scan BOTH channels: a Qwen-family model that "thinks" before acting
        // can emit the tool call inside its <think> block, which the provider
        // routes to the reasoning channel — scanning only the visible text
        // would miss the call entirely (the "tool calls are not being
        // surfaced" bug). Visible text wins: if the same call appears in both,
        // the reasoning copy is a duplicate and must not double-execute.
        const visible = extractPromptToolCalls(text, knownTools);
        const hidden = text.trim() === '' && reasoningText !== ''
          ? extractPromptToolCalls(reasoningText, knownTools)
          : { calls: [], errors: [] as typeof visible.errors };
        calls.push(...visible.calls, ...hidden.calls);
        parseErrors = [...visible.errors, ...hidden.errors];
        // Small local models (Bonsai, tiny Qwen) narrate chain-of-thought as
        // plain prose — no <think> tags — then emit a TOOL_CALL. That narration
        // is not the answer; putting it in the bubble makes the thought look
        // like the reply. Live-streamed untagged CoT already sits in the
        // reasoning block; only yield the hold-back tail (or promote it to
        // the answer when this turn had no tools).
        if (visible.prose) {
          const stillWorking = calls.length > 0 || parseErrors.length > 0;
          const live = !sawProviderReasoning && liveReasoningAt > 0;
          if (stillWorking) {
            // Live path already painted the narration; don't duplicate it.
            if (!live) yield { type: 'reasoning', text: visible.prose };
          } else if (live) {
            yield { type: 'promote_reasoning', text: visible.prose };
          } else {
            yield { type: 'text', text: visible.prose };
          }
        }
      }

      if (calls.length === 0 && parseErrors.length === 0) {
        yield { type: 'done', stopReason, ...(servedModel ? { servedModel } : {}) };
        return;
      }

      if (chatOnly) {
        yield { type: 'done', stopReason, ...(servedModel ? { servedModel } : {}) };
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
        const outcome: ToolOutcome = opts.executeCall
          ? await opts.executeCall(call)
          : executeToolCall(opts.context, call);
        lastCallKey = callKey;

        if (outcome.kind === 'mutation') {
          const proposal: MutationProposal = {
            callId: call.id,
            patch: outcome.patch as Record<string, unknown>,
            label: outcome.label,
            rationale: outcome.rationale,
            preview: outcome.preview,
            revert: outcome.revert,
            navigate: outcome.navigate,
            createPartner: outcome.createPartner,
          };
          yield { type: 'mutation', proposal };
          const decision = await opts.onMutation(proposal);
          const content = decision.approved
            // Say plainly that the change is ALREADY APPLIED so the model doesn't
            // wonder whether "APPROVED" means proposed-vs-live (it was re-running
            // the proposal or questioning the state). Just confirm and report.
            // Page-navigation proposals moved the UI, not the plan — the
            // feedback reflects that so the model doesn't re-project numbers.
            ? outcome.navigate != null
              ? `The user approved it and the app OPENED the page: ${outcome.label}. ` +
                `It is live — do NOT re-propose it. Confirm it to the user.` +
                (decision.note ? ` User note: ${decision.note}` : '')
              : outcome.createPartner
              ? `The user approved this change and it is now APPLIED: ${outcome.label}. ` +
                `A new partner plan named "${outcome.createPartner.name}" was created and this plan is linked to it. ` +
                `It is live — do NOT re-propose it. Confirm it to the user.` +
                (decision.note ? ` User note: ${decision.note}` : '')
              : `The user approved this change and it is now APPLIED to the plan: ${outcome.label} ` +
              `(${JSON.stringify(outcome.patch)}). It is live — do NOT re-propose it. Confirm it to ` +
              `the user and report the resulting numbers (run a fresh projection if useful).` +
              (decision.note ? ` User note: ${decision.note}` : '')
            : `The user REJECTED this change — it was NOT applied. Do not apply or repeat it ` +
              `unprompted; answer with that in mind.` +
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

    // Round limit hit. A small local model can loop tool calls until here and
    // leave the user with NOTHING — so don't just error out. Make one forced
    // finalization pass with NO tools available and an explicit "answer from
    // what you have" instruction, so the model produces a real reply from the
    // tool results already in the transcript. Only if that pass also fails do
    // we surface an error.
    yield* finalizeWithoutTools(opts, messages, mode);
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The forced final answer after the tool round-trip limit. Runs ONE more model
 * pass with no tools on offer and a direct instruction to answer from the tool
 * results already gathered, so a tool-happy small model still leaves the user
 * with a usable reply. Tool blocks a stubborn model emits anyway are parsed
 * out (not executed) and stripped from the prose.
 */
async function* finalizeWithoutTools(
  opts: AgentLoopOptions,
  messages: ChatMessage[],
  mode: 'native' | 'prompt' | 'off',
): AsyncGenerator<AgentEvent> {
  const knownTools = new Set<string>(toolSpecs().map(s => s.name));
  // A fresh system prompt for the final pass: same persona/rules, but the
  // tool catalog is replaced by the instruction to stop and answer. Keeping
  // the full tool instructions would invite yet another tool call.
  const base = buildSystemPrompt(opts.context.scenarioName, {
    toolMode: 'off',
    basePrompt: undefined, // default persona — the override lives on the full prompt
    config: opts.config ?? opts.context.config,
    currentView: opts.context.currentView,
    locale: opts.context.locale,
  });
  const wrapLocale = opts.context.locale;
  const wrapSystem = tPrompt(
    'wrapUpSystem',
    wrapLocale,
    [
      'You have already gathered tool results in this conversation. Do NOT call',
      'any more tools. Answer the user\'s question NOW in plain prose, using the',
      'numbers from the tool results above. If a needed number is missing, say so',
      'briefly and give the best answer you can with what you have.',
    ].join('\n'),
  );
  const finalSystem = [base, '', wrapSystem].join('\n');

  const finalMessages: ChatMessage[] = [
    ...messages,
    {
      role: 'user',
      content: tPrompt(
        'wrapUpUser',
        wrapLocale,
        'You have reached the tool-use limit. Do not call any more tools. Answer my question now in plain prose using the tool results above.',
      ),
    },
  ];

  try {
    let text = '';
    let liveAt = 0;
    let servedModel: string | undefined;
    for await (const evt of opts.chat({ system: finalSystem, messages: finalMessages, tools: [], signal: opts.signal })) {
      if (evt.type === 'done' && evt.servedModel) servedModel = evt.servedModel;
      if (evt.type === 'text') {
        text += evt.text;
        // Prompt mode: stream untagged CoT live as thinking; native streams
        // the answer straight through (there are no tool blocks to strip).
        if (mode !== 'prompt') {
          yield { type: 'text', text: evt.text };
        } else {
          const { chunk, next } = liveReasoningDelta(text, liveAt);
          liveAt = next;
          if (chunk) yield { type: 'reasoning', text: chunk };
        }
      } else if (evt.type === 'reasoning') {
        yield { type: 'reasoning', text: evt.text };
      }
      // A 'done' here ends the pass; tool_use is impossible (no tools offered)
      // but if a provider emitted one anyway it's ignored, not executed.
    }
    if (mode === 'prompt') {
      // Strip any tool-call attempt out of the prose. No hidden-channel scan
      // here: the finalize pass cannot execute tools, so a call found in the
      // reasoning text would have nowhere to go.
      const parsed = extractPromptToolCalls(text, knownTools);
      if (parsed.prose) {
        if (liveAt > 0) yield { type: 'promote_reasoning', text: parsed.prose };
        else yield { type: 'text', text: parsed.prose };
      }
    }
    yield { type: 'done', stopReason: 'end_turn', ...(servedModel ? { servedModel } : {}) };
  } catch (err) {
    // Even the finalization pass failed — now there's genuinely nothing to say.
    yield {
      type: 'error',
      message:
        `The model kept calling tools without finishing, and the wrap-up answer failed too ` +
        `(${err instanceof Error ? err.message : String(err)}). Try rephrasing the question.`,
    };
  }
}
