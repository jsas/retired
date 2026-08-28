// Provider adapters: one streaming chat interface over Anthropic, any
// OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama, generic), and Gemini.
//
// The browser calls the provider's HTTPS API DIRECTLY with the user's own key —
// there is no proxy, no server, and nothing is logged or stored beyond the
// local settings store. Every adapter normalizes to the same event stream so
// the agent loop and UI never see provider wire formats:
//
//   { type: 'text', text }        — a chunk of assistant prose
//   { type: 'tool_use', call }    — the model wants a tool run (accumulated)
//   { type: 'done', stopReason }  — terminal event, exactly once
//
// Anything unrecognized on the wire is skipped, never fatal; a malformed
// stream yields whatever text arrived before the break.

import type { AiConnection } from '../aiSettings';

export interface AgentToolCall {
  id: string;
  name: string;
  /** Parsed JSON arguments ({} when the model sent none / unparseable). */
  args: Record<string, unknown>;
}

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; call: AgentToolCall }
  | { type: 'done'; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'unknown' };

export interface ChatMessage {
  role: 'user' | 'assistant';
  /** Provider-neutral content: text plus any tool calls the assistant made. */
  content: string;
  toolCalls?: AgentToolCall[];
  /** Results the caller is appending right after this assistant turn. */
  toolResults?: Array<{ toolCallId: string; content: string; isError?: boolean }>;
}

/** A tool the model may call, described with a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
}

export interface StreamChatRequest {
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export class ProviderError extends Error {
  readonly status?: number;
  /** True for 429/5xx/network failures where retrying may help. */
  readonly retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
  }
}

type FetchFn = typeof fetch;

/**
 * Stream a chat turn from the connection's provider. Yields text as it
 * arrives; tool calls are accumulated internally and yielded once complete.
 */
export async function* streamChat(
  conn: AiConnection,
  req: StreamChatRequest,
  fetchFn: FetchFn = fetch,
): AsyncGenerator<StreamEvent> {
  switch (conn.provider) {
    case 'anthropic':
      yield* streamAnthropic(conn, req, fetchFn);
      return;
    case 'gemini':
      yield* streamGemini(conn, req, fetchFn);
      return;
    default:
      yield* streamOpenAICompatible(conn, req, fetchFn);
  }
}

// ---------------------------------------------------------------------------
// Anthropic Messages API (SSE)
// ---------------------------------------------------------------------------

async function* streamAnthropic(
  conn: AiConnection,
  req: StreamChatRequest,
  fetchFn: FetchFn,
): AsyncGenerator<StreamEvent> {
  const body: Record<string, unknown> = {
    model: conn.model,
    max_tokens: req.maxTokens ?? 4096,
    system: req.system,
    stream: true,
    messages: req.messages.map(m => {
      if (m.role === 'user' && !m.toolResults?.length) {
        return { role: 'user', content: m.content };
      }
      if (m.role === 'user' && m.toolResults?.length) {
        // Tool results ride as a user-turn content blocks array.
        return {
          role: 'user',
          content: m.toolResults.map(r => ({
            type: 'tool_result',
            tool_use_id: r.toolCallId,
            content: r.content,
            is_error: r.isError === true,
          })),
        };
      }
      // assistant: prose plus any tool_use blocks it emitted.
      const content: Array<Record<string, unknown>> = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      }
      return { role: 'assistant', content };
    }),
  };
  if (req.tools?.length) {
    body.tools = req.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.jsonSchema,
    }));
  }

  const res = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: req.signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': conn.apiKey,
      'anthropic-version': '2023-06-01',
      // Direct browser→API call with a user-supplied key; Anthropic gates this
      // behind an explicit opt-in header. The key never touches our (nonexistent)
      // servers.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  await ensureOk(res, 'Anthropic');

  // Accumulate a streaming tool_use block (input_json_delta fragments).
  let tool: { id: string; name: string; json: string } | null = null;
  let stop: StreamEvent & { type: 'done' } = { type: 'done', stopReason: 'unknown' };

  for await (const data of sseLines(res)) {
    let evt: Record<string, unknown>;
    try { evt = JSON.parse(data); } catch { continue; }
    const type = evt.type as string;
    if (type === 'content_block_start') {
      const block = evt.content_block as Record<string, unknown> | undefined;
      if (block?.type === 'tool_use') {
        tool = { id: String(block.id ?? ''), name: String(block.name ?? ''), json: '' };
      }
    } else if (type === 'content_block_delta') {
      const delta = evt.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        yield { type: 'text', text: delta.text };
      } else if (delta?.type === 'input_json_delta' && tool && typeof delta.partial_json === 'string') {
        tool.json += delta.partial_json;
      }
    } else if (type === 'content_block_stop' && tool) {
      yield { type: 'tool_use', call: finishToolCall(tool) };
      tool = null;
    } else if (type === 'message_delta') {
      const delta = evt.delta as Record<string, unknown> | undefined;
      const reason = delta?.stop_reason;
      stop = {
        type: 'done',
        stopReason: reason === 'tool_use' ? 'tool_use'
          : reason === 'max_tokens' ? 'max_tokens'
          : reason === 'end_turn' ? 'end_turn' : 'unknown',
      };
    }
  }
  // A stream that ended mid-tool-call still surfaces the partial call — the
  // executor will validate args and reject cleanly if they're incomplete.
  if (tool) yield { type: 'tool_use', call: finishToolCall(tool) };
  yield stop;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible Chat Completions (SSE) — OpenAI, OpenRouter, Ollama, …
// ---------------------------------------------------------------------------

interface OaiToolBuf { id: string; name: string; json: string }

async function* streamOpenAICompatible(
  conn: AiConnection,
  req: StreamChatRequest,
  fetchFn: FetchFn,
): AsyncGenerator<StreamEvent> {
  const base = (conn.baseUrl ?? '').replace(/\/+$/, '');
  const body: Record<string, unknown> = {
    model: conn.model,
    stream: true,
    max_tokens: req.maxTokens ?? 4096,
    messages: [
      { role: 'system', content: req.system },
      ...req.messages.flatMap((m): Array<Record<string, unknown>> => {
        if (m.role === 'assistant') {
          return [{
            role: 'assistant',
            content: m.content || null,
            ...(m.toolCalls?.length ? {
              tool_calls: m.toolCalls.map(c => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            } : {}),
          }];
        }
        if (m.toolResults?.length) {
          // OpenAI wants one message per tool result, role 'tool'.
          return m.toolResults.map(r => ({
            role: 'tool',
            tool_call_id: r.toolCallId,
            content: r.content,
          }));
        }
        return [{ role: 'user', content: m.content }];
      }),
    ],
  };
  if (req.tools?.length) {
    body.tools = req.tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.jsonSchema },
    }));
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (conn.apiKey) headers.authorization = `Bearer ${conn.apiKey}`;
  if (conn.provider === 'openrouter') {
    headers['http-referer'] = 'https://jsas.github.io/retired/';
    headers['x-title'] = 'RE:tired';
  }

  const res = await fetchFn(`${base}/chat/completions`, {
    method: 'POST',
    signal: req.signal,
    headers,
    body: JSON.stringify(body),
  });
  await ensureOk(res, 'Provider');

  const tools = new Map<number, OaiToolBuf>();
  let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'unknown' = 'unknown';

  for await (const data of sseLines(res)) {
    if (data === '[DONE]') break;
    let evt: Record<string, unknown>;
    try { evt = JSON.parse(data); } catch { continue; }
    const choice = (evt.choices as Array<Record<string, unknown>> | undefined)?.[0];
    if (!choice) continue;
    const delta = choice.delta as Record<string, unknown> | undefined;
    if (typeof delta?.content === 'string' && delta.content) {
      yield { type: 'text', text: delta.content };
    }
    for (const tc of (delta?.tool_calls as Array<Record<string, unknown>> | undefined) ?? []) {
      const idx = typeof tc.index === 'number' ? tc.index : 0;
      const buf = tools.get(idx) ?? { id: '', name: '', json: '' };
      if (typeof tc.id === 'string' && tc.id) buf.id = tc.id;
      const fn = tc.function as Record<string, unknown> | undefined;
      if (typeof fn?.name === 'string' && fn.name) buf.name = fn.name;
      if (typeof fn?.arguments === 'string') buf.json += fn.arguments;
      tools.set(idx, buf);
    }
    const finish = choice.finish_reason;
    if (finish === 'tool_calls') stopReason = 'tool_use';
    else if (finish === 'stop') stopReason = 'end_turn';
    else if (finish === 'length') stopReason = 'max_tokens';
  }
  for (const buf of [...tools.values()].filter(b => b.name)) {
    yield { type: 'tool_use', call: finishToolCall(buf) };
  }
  if (tools.size > 0 && stopReason === 'unknown') stopReason = 'tool_use';
  yield { type: 'done', stopReason };
}

// ---------------------------------------------------------------------------
// Gemini generateContent (SSE alt=sse)
// ---------------------------------------------------------------------------

async function* streamGemini(
  conn: AiConnection,
  req: StreamChatRequest,
  fetchFn: FetchFn,
): AsyncGenerator<StreamEvent> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(conn.model)}` +
    `:streamGenerateContent?alt=sse&key=${encodeURIComponent(conn.apiKey)}`;

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.messages.flatMap(m => {
      const parts: Array<Record<string, unknown>> = [];
      if (m.role === 'assistant') {
        if (m.content) parts.push({ text: m.content });
        for (const c of m.toolCalls ?? []) {
          parts.push({ functionCall: { name: c.name, args: c.args } });
        }
        return parts.length ? [{ role: 'model', parts }] : [];
      }
      if (m.toolResults?.length) {
        return [{
          role: 'user',
          parts: m.toolResults.map(r => ({
            functionResponse: {
              // Gemini matches responses by NAME (no call ids); the executor
              // stores the tool name on the result content's id slot.
              name: r.toolCallId,
              response: { result: r.content },
            },
          })),
        }];
      }
      return [{ role: 'user', parts: [{ text: m.content }] }];
    }),
  };
  if (req.tools?.length) {
    body.tools = [{
      functionDeclarations: req.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.jsonSchema,
      })),
    }];
  }

  const res = await fetchFn(url, {
    method: 'POST',
    signal: req.signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  await ensureOk(res, 'Gemini');

  let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'unknown' = 'unknown';
  let callSeq = 0;
  for await (const data of sseLines(res)) {
    let evt: Record<string, unknown>;
    try { evt = JSON.parse(data); } catch { continue; }
    const cand = (evt.candidates as Array<Record<string, unknown>> | undefined)?.[0];
    if (!cand) continue;
    const parts = ((cand.content as Record<string, unknown> | undefined)?.parts
      ?? []) as Array<Record<string, unknown>>;
    for (const p of parts) {
      if (typeof p.text === 'string' && p.text) yield { type: 'text', text: p.text };
      const fc = p.functionCall as Record<string, unknown> | undefined;
      if (fc?.name) {
        callSeq += 1;
        const name = String(fc.name);
        yield {
          type: 'tool_use',
          call: {
            // Gemini gives no call id; synthesize one and let the executor
            // echo the NAME back in functionResponse (see above).
            id: name,
            name,
            args: (fc.args as Record<string, unknown> | undefined) ?? {},
          },
        };
        stopReason = 'tool_use';
        void callSeq;
      }
    }
    const fr = cand.finishReason;
    if (fr === 'STOP' && stopReason !== 'tool_use') stopReason = 'end_turn';
    else if (fr === 'MAX_TOKENS') stopReason = 'max_tokens';
  }
  yield { type: 'done', stopReason };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function ensureOk(res: Response, who: string): Promise<void> {
  if (res.ok) return;
  let detail = '';
  try {
    const text = await res.text();
    // Provider error bodies are JSON with a message field; keep it short.
    const msg = JSON.parse(text);
    detail = msg?.error?.message ?? msg?.message ?? text;
  } catch { /* keep generic */ }
  const retryable = res.status === 429 || res.status >= 500;
  const hint =
    res.status === 401 || res.status === 403 ? ' — check the API key'
    : res.status === 429 ? ' — rate limited; try again shortly'
    : '';
  throw new ProviderError(`${who} error ${res.status}${hint}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`, res.status, retryable);
}

function finishToolCall(buf: { id: string; name: string; json: string }): AgentToolCall {
  let args: Record<string, unknown> = {};
  if (buf.json.trim()) {
    try {
      const parsed = JSON.parse(buf.json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
    } catch { /* executor's Zod validation will report empty/invalid args */ }
  }
  return { id: buf.id || `call-${Date.now().toString(36)}`, name: buf.name, args };
}

/**
 * Iterate `data:` payloads of an SSE response. Handles CRLF/LF, multi-line
 * buffering, and chunk boundaries; ignores comments and non-data fields.
 */
async function* sseLines(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new ProviderError('Empty response body (streaming unsupported?)');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Events are separated by blank lines; a data: field may repeat.
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const rawEvent = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        for (const line of rawEvent.split(/\r?\n/)) {
          if (line.startsWith('data:')) {
            const payload = line.slice(5).replace(/^ /, '');
            if (payload) yield payload;
          }
        }
      }
    }
    // Flush anything trailing without a blank-line terminator.
    for (const line of buf.split(/\r?\n/)) {
      if (line.startsWith('data:')) {
        const payload = line.slice(5).replace(/^ /, '');
        if (payload) yield payload;
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}
