// Prompt-based tool calling for chat-only providers (web-llm / local models).
//
// Native function-calling APIs don't exist on the web-llm chat surface we use,
// so instead the tools are DESCRIBED IN THE SYSTEM PROMPT as a text protocol:
// the model emits <tool_call>{…}</tool_call> blocks (Qwen3's native dialect)
// and we parse + dispatch them exactly like native tool calls. Small models
// sometimes emit malformed calls — those come back as tool errors (same shape
// as a Zod rejection), so the model gets a retry with feedback, and a per-turn
// call cap breaks degenerate loops of repeated broken calls.
//
// The confirm-before-apply guarantee is unchanged: set_plan_value still
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

/** Canonical example we show the model in errors + instructions. */
const CALL_EXAMPLE = '<tool_call>\n{"name": "<tool>", "arguments": {…}}\n</tool_call>';

/** Decode one tool-call JSON body into a validated call, or push an error.
 *  Accepts both wire shapes and normalizes to the internal {name, args}:
 *    Qwen native:  {"name": "…", "arguments": {…}}   (trained dialect)
 *    Legacy line:  {"name": "…", "args": {…}}        (TOOL_CALL: fallback)
 *  Returns true when the call was accepted (pushed onto `calls`). */
function acceptCallBody(
  raw: string,
  toolNames: ReadonlySet<string>,
  calls: AgentToolCall[],
  errors: ParsedToolText['errors'],
): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    errors.push({
      raw,
      message: 'That tool call was not valid JSON. Emit one block:\n' +
        `${CALL_EXAMPLE} — no comments, no trailing commas.`,
    });
    return false;
  }
  const obj = parsed as Record<string, unknown>;
  const name = typeof obj?.name === 'string' ? obj.name : '';
  if (!toolNames.has(name)) {
    errors.push({
      raw,
      message: name
        ? `Unknown tool "${name}". Use one of the listed tool names exactly.`
        : `Tool call is missing "name". Format:\n${CALL_EXAMPLE}`,
    });
    return false;
  }
  // arguments (native) wins; fall back to args (legacy) so older fine-tunes
  // and hand-written calls keep working.
  const rawArgs = obj.arguments !== undefined ? obj.arguments : obj.args;
  const args = rawArgs !== undefined && typeof rawArgs === 'object' && rawArgs !== null
    ? (rawArgs as Record<string, unknown>)
    : {};
  // A confused model can emit dozens of tool calls in one reply — running them
  // all spams the transcript. Keep the first few and report the overflow as an
  // error so the model learns to stop.
  if (calls.length >= PROMPT_TOOL_MAX_CALLS_PER_REPLY) {
    errors.push({
      raw,
      message: `Too many tool calls in one reply (max ${PROMPT_TOOL_MAX_CALLS_PER_REPLY}). ` +
        'Call one tool, read its result, then decide the next step.',
    });
    return false;
  }
  calls.push({ id: nextCallId(), name, args });
  return true;
}

/** Extract tool calls from assistant text. Two accepted shapes:
 *
 *    <tool_call>                       <- Qwen3 native (what we now teach)
 *    {"name": "<tool>", "arguments": {…}}
 *    </tool_call>
 *
 *    TOOL_CALL: {"name": "<tool>", "args": {…}}   <- legacy fallback
 *
 *  Tolerates prose before/after and multiple calls; anything not matching a
 *  known tool name is an error the model can learn from, not a silent drop.
 *  The <tool_call> block format is what Qwen3's chat template emits natively,
 *  so it rides the pre-trained prior instead of fighting it; the TOOL_CALL:
 *  line stays accepted so older models and hand-written calls don't break. */
export function extractPromptToolCalls(text: string, toolNames: ReadonlySet<string>): ParsedToolText {
  const calls: AgentToolCall[] = [];
  const errors: ParsedToolText['errors'] = [];
  const proseChunks: string[] = [];

  // Pass 1: pull every <tool_call>…</tool_call> block out of the text. The
  // close tag is mandatory in the taught format, but a truncated generation
  // can drop it — so we also accept a block that runs to end-of-text.
  let rest = text;
  const BLOCK_RE = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/gi;
  let m: RegExpExecArray | null;
  let lastIdx = 0;
  BLOCK_RE.lastIndex = 0;
  const stripped: string[] = [];
  while ((m = BLOCK_RE.exec(text)) !== null) {
    stripped.push(text.slice(lastIdx, m.index));
    lastIdx = m.index + m[0].length;
    const body = m[1].trim();
    if (body) acceptCallBody(body, toolNames, calls, errors);
  }
  stripped.push(text.slice(lastIdx));
  rest = stripped.join('\n');

  // Pass 2: legacy TOOL_CALL: lines in whatever prose remains.
  const lines = rest.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Small models emit the marker in any casing (tool_call:, Tool_Call:, …) —
    // match case-insensitively so a lowercase marker doesn't leak into the chat.
    const start = line.toLowerCase().indexOf('tool_call:');
    if (start === -1) { proseChunks.push(line); continue; }
    proseChunks.push(line.slice(0, start));
    let raw = line.slice(start + 'tool_call:'.length).trim();
    // Swallow continuation lines while the JSON is incomplete (more opens
    // than closes) so multi-line args still parse.
    while (i + 1 < lines.length && !jsonLooksComplete(raw)) {
      raw += '\n' + lines[++i];
    }
    acceptCallBody(raw, toolNames, calls, errors);
  }
  return { prose: proseChunks.join('\n').trim(), calls, errors };
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
    'Otherwise call the next tool.',
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
    'TOOLS: to run local code, output ONE tool call as a <tool_call> block with one JSON object:',
    '<tool_call>',
    '{"name": "run_projection", "arguments": {}}',
    '</tool_call>',
    'The result comes back as the next message. Rules:',
    '- The <tool_call> block contains ONLY the JSON — all prose goes OUTSIDE the block.',
    '- Call AT MOST ONE tool, then STOP and wait for its result. Do NOT emit',
    '  several <tool_call> blocks in one reply.',
    '- Never call the same tool twice in a row with the same arguments.',
    '- Available tools:',
    catalog,
    '- Prefer run_projection/compare_plans numbers over guessing.',
    '- NEVER ask the user for balances, ages, or account values — they are in the plan',
    '  summary in the system prompt, and get_plan/run_projection return them.',
    '- Every propose_* and set_plan_value tool only PROPOSES a change; the user confirms it.',
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
