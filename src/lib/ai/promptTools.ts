// Prompt-based tool calling for chat-only providers (web-llm / local models).
//
// Native function-calling APIs don't exist on the web-llm chat surface we use,
// so instead the tools are DESCRIBED IN THE SYSTEM PROMPT as a text protocol:
// the model emits a `TOOL_CALL: {…}` line and we parse + dispatch it exactly
// like a native tool call. Small models drift, though — a Qwen-family fine-tune
// arrives with strong priors toward other shapes — so the extractor accepts
// every reasonable variant and dispatches them identically:
//
//   TOOL_CALL: {"name": …, "args": {…}}      the taught one-liner (any casing,
//                                            spacing, **bold**, bare tool name)
//   <tool_call>{"name": …}</tool_call>       Qwen's native function-call tags
//   ```tool / ```json fenced blocks          the protocol's ORIGINAL shape
//   "arguments" instead of "args"            Qwen's native args key
//
// Malformed calls still come back as tool errors (same shape as a Zod
// rejection) so the model gets a retry with feedback, and a per-reply call cap
// breaks degenerate loops of repeated broken calls.
//
// The confirm-before-apply guarantee is unchanged: set_scenario_value still
// produces a mutation proposal that pauses the loop for user approval.

import { z } from 'zod';
import type { AgentToolCall, ToolSpec } from './providers';

/** Result of scanning an assistant reply for tool blocks. */
export interface ParsedToolText {
  /** Prose with all tool blocks stripped. */
  prose: string;
  /** Successfully decoded tool calls (JSON parsed, name known, id assigned). */
  calls: AgentToolCall[];
  /** Blocks that looked like tool calls but failed to parse — fed back to the
   *  model as tool errors so it can fix and retry. */
  errors: Array<{ raw: string; message: string }>;
}

let promptCallSeq = 0;
const nextCallId = () => `prompt-call-${++promptCallSeq}`;

/** Every way a model wraps the same call JSON. Pass 1 matches the tag and
 *  fence shapes FIRST and removes them from the text, so their inner JSON is
 *  never also seen by the line-scan (which would double-count the call). */
const CALLOUT_BLOCK = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const CALLOUT_FENCE = /```(?:tool|tool_call)\s*\n([\s\S]*?)```/gi;

/** A candidate call's JSON, after normalizing the model's drift:
 *  "arguments" → "args" (Qwen's native key), the app's real arg names are
 *  untouched. Returns null when there's no name to salvage. */
function normalizeCallObject(obj: Record<string, unknown>): { name: string; args: Record<string, unknown> } | null {
  const name = typeof obj.name === 'string' ? obj.name : '';
  if (!name) return null;
  let args: Record<string, unknown> = {};
  const rawArgs = obj.args ?? obj.arguments;
  if (rawArgs !== undefined && rawArgs !== null) {
    if (typeof rawArgs === 'object') args = rawArgs as Record<string, unknown>;
  }
  return { name, args };
}

/** Decode one candidate JSON blob into a call or a parse error. Shared by the
 *  block/fence/line scans so all shapes get identical name/args/cap rules. */
function decodeCandidate(
  raw: string,
  toolNames: ReadonlySet<string>,
  calls: AgentToolCall[],
  errors: ParsedToolText['errors'],
): void {
  try {
    const parsed: unknown = JSON.parse(raw);
    const call = normalizeCallObject(parsed as Record<string, unknown>);
    if (!call) {
      errors.push({
        raw,
        message: 'Tool call is missing "name". Format: TOOL_CALL: {"name": "<tool>", "args": {…}}',
      });
      return;
    }
    if (!toolNames.has(call.name)) {
      errors.push({
        raw,
        message: `Unknown tool "${call.name}". Use one of the listed tool names exactly.`,
      });
      return;
    }
    // A confused model can emit dozens of calls in one reply — running them
    // all spams the transcript. Keep the first few and report the overflow as
    // an error so the model learns to stop.
    if (calls.length >= PROMPT_TOOL_MAX_CALLS_PER_REPLY) {
      errors.push({
        raw,
        message: `Too many tool calls in one reply (max ${PROMPT_TOOL_MAX_CALLS_PER_REPLY}). ` +
          'Call one tool, read its result, then decide the next step.',
      });
      return;
    }
    calls.push({ id: nextCallId(), name: call.name, args: call.args });
  } catch {
    errors.push({
      raw,
      message: 'That tool call was not valid JSON. Emit one line: ' +
        'TOOL_CALL: {"name": "<tool>", "args": {…}} — no comments, no trailing commas.',
    });
  }
}

/** Attempt to salvage a candidate blob as a tool call — but only when it
 *  actually LOOKS like one. This is the confidence gate that keeps ordinary
 *  JSON in prose (a config example, a plan figure) from being hijacked: the
 *  blob must carry a "name" field that is a string. Anything else is left
 *  exactly where it was. Returns true when the blob was consumed. */
function looksLikeCallJSON(blob: string): boolean {
  if (!blob.includes('"name"')) return false;
  try {
    const parsed: unknown = JSON.parse(blob);
    const obj = parsed as Record<string, unknown>;
    return typeof obj?.name === 'string';
  } catch {
    return false;
  }
}

/** Extract tool calls from assistant text, in every shape models actually
 *  emit: the taught one-liner, Qwen's <tool_call> tags, and ```tool fences —
 *  plus the drift variants (any casing, **bold** marker, "arguments" for
 *  "args", a bare tool name). Tolerates prose before/after and multiple
 *  calls; anything not matching a known tool name is an error the model can
 *  learn from, not a silent drop.
 *
 *  Confidence rule: the more ambiguous the shape, the stronger the signal
 *  required. <tool_call> tags and ```tool fences are unambiguous — whatever
 *  is inside is treated as a call attempt. A bare ```json/``` fence or an
 *  unmarked JSON line in prose is NOT: it's only taken when it parses to an
 *  object with a string "name" (i.e. it genuinely looks like a call). */
export function extractPromptToolCalls(text: string, toolNames: ReadonlySet<string>): ParsedToolText {
  const calls: AgentToolCall[] = [];
  const errors: ParsedToolText['errors'] = [];

  // Pass 1a: Qwen-style tag-wrapped calls. Always a call attempt.
  let rest = text.replace(CALLOUT_BLOCK, (_m, body: string) => {
    decodeCandidate(body.trim(), toolNames, calls, errors);
    return ''; // the call leaves no prose behind
  });

  // Pass 1b: fenced calls. ```tool/```tool_call are unambiguous; a bare
  // ```/```json fence is only consumed when its body parses to a call-shaped
  // object — otherwise it's the model showing the user code, and it stays.
  rest = rest.replace(CALLOUT_FENCE, (_m, body: string) => {
    decodeCandidate(body.trim(), toolNames, calls, errors);
    return '';
  });
  rest = rest.replace(/```(?:json)?\s*\n([\s\S]*?)```/gi, (m, body: string) => {
    const trimmed = body.trim();
    if (!looksLikeCallJSON(trimmed)) return m; // ordinary code block — leave it
    decodeCandidate(trimmed, toolNames, calls, errors);
    return '';
  });

  // Pass 2: the taught one-line protocol (any casing, **bold**, prose prefix),
  // plus unmarked call-shaped JSON lines and the bare-tool-name shortcut.
  const proseLines: string[] = [];
  const lines = rest.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Small models emit the marker in any casing (tool_call:, Tool_Call:, …),
    // possibly markdown-bolded (**TOOL_CALL:**) — match loosely so a bolded
    // marker doesn't leak into the chat either.
    const m = /tool_call\s*:?\s*/i.exec(line);
    const bareJson = !m && /^\s*\{.*\}\s*,?\s*$/.test(line);
    if (!m && !bareJson) { proseLines.push(line); continue; }
    if (m) {
      // The prose before the marker — minus the markdown decorations a bolded
      // marker leaves on its left ("**" from "**TOOL_CALL:**").
      proseLines.push(line.slice(0, m.index).replace(/[`*]+\s*$/, ''));
      let raw = line.slice(m.index + m[0].length).trim();
      // Strip wrapping **…** / backticks a markdown-happy model adds.
      raw = raw.replace(/^[`*]+/, '').replace(/[`*]+$/, '');
      // "TOOL_CALL: run_projection" — a bare tool name with no JSON body.
      if (raw !== '' && !raw.startsWith('{') && /^[\w.]+$/.test(raw)) {
        decodeCandidate(JSON.stringify({ name: raw, args: {} }), toolNames, calls, errors);
        continue;
      }
      // Swallow continuation lines while the JSON is incomplete (more opens
      // than closes) so multi-line args still parse.
      while (i + 1 < lines.length && !jsonLooksComplete(raw)) {
        raw += '\n' + lines[++i];
      }
      decodeCandidate(raw, toolNames, calls, errors);
    } else {
      // An unmarked line that is just a JSON object: only a call when it has
      // a string "name" (see looksLikeCallJSON) — anything else is prose.
      let raw = line.trim().replace(/,\s*$/, '');
      while (i + 1 < lines.length && !jsonLooksComplete(raw)) {
        raw += '\n' + lines[++i];
      }
      if (looksLikeCallJSON(raw)) {
        decodeCandidate(raw, toolNames, calls, errors);
      } else {
        proseLines.push(line);
      }
    }
  }
  return { prose: proseLines.join('\n').trim(), calls, errors };
}

/** Cheap brace balance check: true when the string plausibly contains a whole
 *  JSON object (as many closes as opens). Good enough for swallowing wrapped
 *  args; real validation happens in JSON.parse. */
function jsonLooksComplete(raw: string): boolean {
  const opens = (raw.match(/[{[]/g) ?? []).length;
  const closes = (raw.match(/[}\]]/g) ?? []).length;
  return opens > 0 && closes >= opens;
}

/** Serialize tool results as the next user message in the text protocol. */
export function formatPromptToolResults(
  results: Array<{ toolCallId: string; content: string; isError: boolean }>,
  parseErrors: ParsedToolText['errors'],
): string {
  const parts: string[] = ['Tool results:'];
  for (const r of results) {
    parts.push(`\n[${r.isError ? 'ERROR' : 'OK'}] ${r.content}`);
  }
  for (const e of parseErrors) {
    parts.push(`\n[ERROR] Your tool block could not be used: ${e.message}`);
  }
  parts.push(
    '\nIf you have everything you need, answer the user in plain prose now. ' +
    'Otherwise emit another TOOL_CALL: line.',
  );
  return parts.join('\n');
}

/** Cap on tool-call round trips for prompt-protocol providers. Native
 *  providers get maxRounds=8; small local models need a tighter leash because
 *  they can loop the same broken call forever. */
export const PROMPT_TOOL_MAX_CALLS = 5;

/** Cap on tool calls parsed from a SINGLE assistant reply. A small model that
 *  has lost the plot can emit dozens of TOOL_CALL: lines in one message; each
 *  becomes a transcript chip, so we keep only the first few and tell the model
 *  to slow down. */
export const PROMPT_TOOL_MAX_CALLS_PER_REPLY = 3;

/** Minimal JSON-Schema → compact text for the prompt. Full schemas are too
 *  token-heavy for small context windows, so we render "name (type, req?):
 *  description" lines instead. */
function compactSchema(jsonSchema: Record<string, unknown>): string {
  const props = (jsonSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((jsonSchema.required as string[] | undefined) ?? []);
  const lines: string[] = [];
  for (const [key, spec] of Object.entries(props)) {
    const type = Array.isArray(spec.type) ? spec.type.join('|') : String(spec.type ?? 'any');
    const desc = typeof spec.description === 'string' ? spec.description.split('\n')[0] : '';
    const req = required.has(key) ? ', required' : '';
    lines.push(`    ${key} (${type}${req})${desc ? `: ${desc}` : ''}`);
  }
  return lines.length ? lines.join('\n') : '    (no arguments)';
}

/** Build the system-prompt section that teaches a chat-only model the tool
 *  protocol: the format, the tool catalog, and the discipline rules. Small
 *  models follow a one-line format far more reliably than fenced blocks. */
export function buildPromptToolInstructions(specs: ToolSpec[]): string {
  const catalog = specs.map(s => `- ${s.name}: ${s.description}\n  args:\n${compactSchema(s.jsonSchema)}`).join('\n');
  return [
    'TOOLS: to run local code, output ONE line starting with TOOL_CALL: followed by one JSON object:',
    'TOOL_CALL: {"name": "run_projection", "args": {}}',
    'The result comes back as the next message. Rules:',
    '- The TOOL_CALL: line contains ONLY the JSON — all prose goes on other lines.',
    '- Call AT MOST ONE tool, then STOP and wait for its result. Do NOT emit',
    '  several TOOL_CALL: lines in one reply.',
    '- Never call the same tool twice in a row with the same arguments.',
    '- Available tools:',
    catalog,
    '- Prefer run_projection/compare_scenarios numbers over guessing.',
    '- NEVER ask the user for balances, ages, or account values — they are in the plan',
    '  summary in the system prompt, and get_scenario/run_projection return them.',
    '- Every propose_* and set_scenario_value tool only PROPOSES a change; the user confirms it.',
    '- When the user asks WHERE something lives, use find_page (it tags the page they are',
    '  already on); use propose_navigate to offer opening a page — the app moves only on the',
    '  card the user approves. Never claim a page opened unless the result says it did.',
  ].join('\n');
}

/** Zod guard for the on-the-wire tool-call JSON shape — the parser hand-checks
 *  name/args above, this is for tests and future stricter handling. */
export const promptToolCallSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
});
