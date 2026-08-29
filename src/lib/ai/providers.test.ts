import { describe, it, expect } from 'vitest';
import {
  streamChat, listModels, testConnection, ProviderError,
  type StreamEvent, type ChatMessage,
} from './providers';
import { DEFAULT_MAX_TOKENS, type AiConnection } from '../aiSettings';

/** Build a fake fetch returning an SSE stream of the given `data:` payloads. */
function sseFetch(payloads: string[], status = 200, capture?: (url: string, init: RequestInit) => void) {
  const body = payloads.map(p => `data: ${p}`).join('\n\n') + '\n\n';
  return async (url: unknown, init?: RequestInit): Promise<Response> => {
    capture?.(String(url), init ?? {});
    if (status !== 200) {
      return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status });
    }
    return new Response(new TextEncoder().encode(body), {
      status,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
}

async function collect(gen: AsyncGenerator<StreamEvent>) {
  const events: StreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

const anthropic: AiConnection = {
  id: 'c', provider: 'anthropic', label: '', apiKey: 'sk-ant-test',
  model: 'claude-sonnet-4-20250514',
};
const openai: AiConnection = {
  id: 'c', provider: 'openai', label: '', apiKey: 'sk-test',
  model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1',
};
const gemini: AiConnection = {
  id: 'c', provider: 'gemini', label: '', apiKey: 'gm-test', model: 'gemini-2.0-flash',
};

const userTurn: ChatMessage[] = [{ role: 'user', content: 'hello' }];

describe('anthropic adapter', () => {
  it('streams text deltas and an end_turn stop reason', async () => {
    const events = await collect(streamChat(anthropic, { system: 's', messages: userTurn },
      sseFetch([
        JSON.stringify({ type: 'content_block_start', content_block: { type: 'text' } }),
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }),
        JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: ', world' } }),
        JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
        JSON.stringify({ type: 'message_stop' }),
      ])));
    const texts = events.filter(e => e.type === 'text').map(e => (e as { text: string }).text);
    expect(texts.join('')).toBe('Hello, world');
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('accumulates a tool_use block from json deltas', async () => {
    const events = await collect(streamChat(anthropic, {
      system: 's', messages: userTurn,
      tools: [{ name: 'get_scenario', description: 'd', jsonSchema: {} }],
    }, sseFetch([
      JSON.stringify({ type: 'content_block_start', content_block: { type: 'tool_use', id: 'tu_1', name: 'get_scenario' } }),
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"sect' } }),
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'ion":"full"}' } }),
      JSON.stringify({ type: 'content_block_stop' }),
      JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
    ])));
    const call = events.find(e => e.type === 'tool_use');
    expect(call).toEqual({ type: 'tool_use', call: { id: 'tu_1', name: 'get_scenario', args: { section: 'full' } } });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('sends the browser-access and version headers with the key', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    await collect(streamChat(anthropic, { system: 's', messages: userTurn },
      sseFetch([], 200, (url, init) => { seen = { url, init }; })));
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('serializes tool results as a user-turn tool_result block', async () => {
    let body = '';
    await collect(streamChat(anthropic, {
      system: 's',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'tu_1', name: 'get_scenario', args: {} }] },
        { role: 'user', content: '', toolResults: [{ toolCallId: 'tu_1', content: '{"ok":true}' }] },
      ],
    }, sseFetch([], 200, (_u, init) => { body = String(init.body); })));
    const msgs = JSON.parse(body).messages;
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content[0]).toEqual({ type: 'tool_use', id: 'tu_1', name: 'get_scenario', input: {} });
    expect(msgs[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 'tu_1', content: '{"ok":true}', is_error: false });
  });

  it('throws a ProviderError with status on HTTP failure', async () => {
    await expect(collect(streamChat(anthropic, { system: 's', messages: userTurn },
      sseFetch(['x'], 401)))).rejects.toThrow(ProviderError);
  });
});

describe('openai-compatible adapter', () => {
  it('streams content deltas and stop → end_turn', async () => {
    const events = await collect(streamChat(openai, { system: 's', messages: userTurn },
      sseFetch([
        JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] }),
        JSON.stringify({ choices: [{ delta: { content: ' there' }, finish_reason: 'stop' }] }),
        '[DONE]',
      ])));
    expect(events.filter(e => e.type === 'text').map(e => (e as { text: string }).text).join('')).toBe('Hi there');
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('streams reasoning_content as reasoning events, separate from the answer', async () => {
    // gpt-oss / DeepSeek-R1 / Qwen3 put the chain of thought in a separate
    // delta field; it must arrive as 'reasoning' events, not be dropped (which
    // left the chat bubble stuck on "Thinking…") and not mixed into the prose.
    const events = await collect(streamChat(openai, { system: 's', messages: userTurn },
      sseFetch([
        JSON.stringify({ choices: [{ delta: { reasoning_content: 'The user is 60. ' } }] }),
        JSON.stringify({ choices: [{ delta: { reasoning_content: 'CPP at 65 is reduced.' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'Your plan lasts to 95.' }, finish_reason: 'stop' }] }),
        '[DONE]',
      ])));
    expect(events.filter(e => e.type === 'reasoning').map(e => (e as { text: string }).text).join(''))
      .toBe('The user is 60. CPP at 65 is reduced.');
    expect(events.filter(e => e.type === 'text').map(e => (e as { text: string }).text).join(''))
      .toBe('Your plan lasts to 95.');
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('also reads the `reasoning` delta alias some servers use', async () => {
    const events = await collect(streamChat(openai, { system: 's', messages: userTurn },
      sseFetch([
        JSON.stringify({ choices: [{ delta: { reasoning: 'thinking…' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] }),
        '[DONE]',
      ])));
    expect(events.find(e => e.type === 'reasoning')).toEqual({ type: 'reasoning', text: 'thinking…' });
  });

  it('accumulates streamed tool_calls fragments', async () => {
    const events = await collect(streamChat(openai, {
      system: 's', messages: userTurn,
      tools: [{ name: 'run_projection', description: 'd', jsonSchema: {} }],
    }, sseFetch([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'run_projection', arguments: '' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"withSp' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ending":true}' } }] } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      '[DONE]',
    ])));
    expect(events.find(e => e.type === 'tool_use')).toEqual({
      type: 'tool_use',
      call: { id: 'call_1', name: 'run_projection', args: { withSpending: true } },
    });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('hits {base}/chat/completions with a bearer token', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    await collect(streamChat(openai, { system: 's', messages: userTurn },
      sseFetch(['[DONE]'], 200, (url, init) => { seen = { url, init }; })));
    expect(seen!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('omits the authorization header when no key (ollama)', async () => {
    const ollama: AiConnection = { ...openai, provider: 'ollama', apiKey: '', baseUrl: 'http://localhost:11434/v1' };
    let headers: Record<string, string> = {};
    await collect(streamChat(ollama, { system: 's', messages: userTurn },
      sseFetch(['[DONE]'], 200, (_u, init) => { headers = init.headers as Record<string, string>; })));
    expect(headers.authorization).toBeUndefined();
  });

  it('serializes tool results as role:tool messages', async () => {
    let body = '';
    await collect(streamChat(openai, {
      system: 's',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'get_scenario', args: {} }] },
        { role: 'user', content: '', toolResults: [{ toolCallId: 'call_1', content: '42' }] },
      ],
    }, sseFetch(['[DONE]'], 200, (_u, init) => { body = String(init.body); })));
    const msgs = JSON.parse(body).messages;
    expect(msgs[2].tool_calls[0].function.name).toBe('get_scenario');
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '42' });
  });
});

describe('gemini adapter', () => {
  it('streams text parts and STOP → end_turn', async () => {
    const events = await collect(streamChat(gemini, { system: 's', messages: userTurn },
      sseFetch([
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hello' }] } }] }),
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '!' }] }, finishReason: 'STOP' }] }),
      ])));
    expect(events.filter(e => e.type === 'text').map(e => (e as { text: string }).text).join('')).toBe('Hello!');
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn' });
  });

  it('maps functionCall parts to tool_use with the name as id', async () => {
    const events = await collect(streamChat(gemini, {
      system: 's', messages: userTurn,
      tools: [{ name: 'get_scenario', description: 'd', jsonSchema: {} }],
    }, sseFetch([
      JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'get_scenario', args: { section: 'full' } } }] } }] }),
    ])));
    expect(events.find(e => e.type === 'tool_use')).toEqual({
      type: 'tool_use',
      call: { id: 'get_scenario', name: 'get_scenario', args: { section: 'full' } },
    });
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_use' });
  });

  it('serializes tool results as functionResponse parts keyed by name', async () => {
    let body = '';
    await collect(streamChat(gemini, {
      system: 's',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'get_scenario', name: 'get_scenario', args: {} }] },
        { role: 'user', content: '', toolResults: [{ toolCallId: 'get_scenario', content: '{"ok":true}' }] },
      ],
    }, sseFetch([], 200, (_u, init) => { body = String(init.body); })));
    const contents = JSON.parse(body).contents;
    expect(contents[1].role).toBe('model');
    expect(contents[1].parts[0].functionCall.name).toBe('get_scenario');
    expect(contents[2].parts[0].functionResponse.name).toBe('get_scenario');
    expect(contents[2].parts[0].functionResponse.response).toEqual({ result: '{"ok":true}' });
  });
});

// ---------------------------------------------------------------------------
// Test connection + model discovery (Connections page)
// ---------------------------------------------------------------------------

/** A fetch double returning a canned JSON body. */
function fakeFetch(
  handler: (url: string, init?: RequestInit) => { status?: number; body: unknown },
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const out = handler(u, init);
    return new Response(JSON.stringify(out.body), {
      status: out.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fn, calls };
}

const compatBase: AiConnection = {
  id: 'c1', provider: 'openai-compatible', label: '', apiKey: '', model: 'm',
};

describe('listModels', () => {
  it('GETs {baseUrl}/models for OpenAI-compatible endpoints (LM Studio, Ollama, …)', async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: { data: [{ id: 'qwen2.5-7b', owned_by: 'lmstudio' }, { id: 'gemma-2-2b' }] },
    }));
    const models = await listModels({ ...compatBase, baseUrl: 'http://localhost:1234/v1' }, fn);
    expect(calls[0].url).toBe('http://localhost:1234/v1/models');
    expect(models.map(m => m.id)).toEqual(['gemma-2-2b', 'qwen2.5-7b']);
    expect(models.find(m => m.id === 'qwen2.5-7b')?.detail).toBe('lmstudio');
  });

  it('sends the API key as a Bearer token when one is set', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ id: 'gpt-4o-mini' }] } }));
    await listModels(
      { ...compatBase, provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' },
      fn,
    );
    expect(calls[0].init?.headers && (calls[0].init.headers as Record<string, string>).authorization)
      .toBe('Bearer sk-test');
  });

  it('throws a helpful error when no base URL is set', async () => {
    await expect(listModels(compatBase, fakeFetch(() => ({ body: {} })).fn))
      .rejects.toThrow(/base URL/);
  });

  it('wraps provider HTTP errors with the status and detail', async () => {
    const { fn } = fakeFetch(() => ({ status: 401, body: { error: { message: 'bad key' } } }));
    await expect(
      listModels({ ...compatBase, baseUrl: 'http://x/v1' }, fn),
    ).rejects.toThrow(/401.*bad key/);
  });

  it('lists Gemini models, filtering to chat-capable ones and stripping the prefix', async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: {
        models: [
          { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ],
      },
    }));
    const models = await listModels({ ...compatBase, provider: 'gemini', apiKey: 'k' }, fn);
    expect(calls[0].url).toContain('v1beta/models?key=k');
    expect(models).toEqual([{ id: 'gemini-2.0-flash', detail: 'Gemini 2.0 Flash' }]);
  });

  it('lists Anthropic models via /v1/models with the key header', async () => {
    const { fn, calls } = fakeFetch(() => ({
      body: { data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }] },
    }));
    const models = await listModels({ ...compatBase, provider: 'anthropic', apiKey: 'sk-ant' }, fn);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(calls[0].init?.headers && (calls[0].init.headers as Record<string, string>)['x-api-key'])
      .toBe('sk-ant');
    expect(models).toEqual([{ id: 'claude-sonnet-4-20250514', detail: 'Claude Sonnet 4' }]);
  });

  it('refuses web-llm (its catalog is local)', async () => {
    await expect(listModels({ ...compatBase, provider: 'webllm' })).rejects.toThrow(ProviderError);
  });
});

describe('testConnection', () => {
  it('is a no-op for the on-computer engine', async () => {
    await expect(testConnection({ ...compatBase, provider: 'webllm' })).resolves.toBeUndefined();
  });

  it('probes Ollama via /api/tags', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { models: [] } }));
    await testConnection(
      { ...compatBase, provider: 'ollama', baseUrl: 'http://localhost:11434/v1' }, fn,
    );
    expect(calls[0].url).toBe('http://localhost:11434/api/tags');
  });

  it('falls back to /v1/models when /api/tags 404s', async () => {
    const { fn, calls } = fakeFetch(url =>
      url.endsWith('/api/tags')
        ? { status: 404, body: {} }
        : { body: { data: [{ id: 'llama3.1' }] } },
    );
    await testConnection(
      { ...compatBase, provider: 'ollama', baseUrl: 'http://localhost:11434/v1' }, fn,
    );
    expect(calls.map(c => c.url)).toEqual([
      'http://localhost:11434/api/tags',
      'http://localhost:11434/v1/models',
    ]);
  });

  it('succeeds for an OpenAI-compatible endpoint that answers /models', async () => {
    const { fn } = fakeFetch(() => ({ body: { data: [{ id: 'm' }] } }));
    await expect(
      testConnection({ ...compatBase, baseUrl: 'http://localhost:1234/v1' }, fn),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Per-connection generation settings (Connections page "Generation" block)
// ---------------------------------------------------------------------------

describe('generation settings', () => {
  const done = () => sseFetch(['[DONE]']);

  it('defaults anthropic max_tokens to the generous DEFAULT_MAX_TOKENS', async () => {
    let body = '';
    await collect(streamChat(anthropic, { system: 's', messages: userTurn },
      sseFetch([], 200, (_u, init) => { body = String(init.body); })));
    expect(JSON.parse(body).max_tokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it('honors a connection maxTokens override (openai-compatible)', async () => {
    const tuned: AiConnection = { ...openai, generation: { maxTokens: 32768 } };
    let body = '';
    await collect(streamChat(tuned, { system: 's', messages: userTurn },
      sseFetch(['[DONE]'], 200, (_u, init) => { body = String(init.body); })));
    expect(JSON.parse(body).max_tokens).toBe(32768);
  });

  it('lets a per-call maxTokens beat the connection default (digest call stays cheap)', async () => {
    let body = '';
    await collect(streamChat(openai, { system: 's', messages: userTurn, maxTokens: 400 },
      sseFetch(['[DONE]'], 200, (_u, init) => { body = String(init.body); })));
    expect(JSON.parse(body).max_tokens).toBe(400);
  });

  it('sends temperature only when the connection sets one (openai-compatible)', async () => {
    let unset = '';
    await collect(streamChat(openai, { system: 's', messages: userTurn },
      done() && sseFetch(['[DONE]'], 200, (_u, init) => { unset = String(init.body); })));
    expect('temperature' in JSON.parse(unset)).toBe(false);

    const tuned: AiConnection = { ...openai, generation: { temperature: 0.7 } };
    let set = '';
    await collect(streamChat(tuned, { system: 's', messages: userTurn },
      sseFetch(['[DONE]'], 200, (_u, init) => { set = String(init.body); })));
    expect(JSON.parse(set).temperature).toBe(0.7);
  });

  it('sends temperature to Anthropic only when set', async () => {
    let unset = '';
    await collect(streamChat(anthropic, { system: 's', messages: userTurn },
      sseFetch([], 200, (_u, init) => { unset = String(init.body); })));
    expect('temperature' in JSON.parse(unset)).toBe(false);

    const tuned: AiConnection = { ...anthropic, generation: { temperature: 1 } };
    let set = '';
    await collect(streamChat(tuned, { system: 's', messages: userTurn },
      sseFetch([], 200, (_u, init) => { set = String(init.body); })));
    expect(JSON.parse(set).temperature).toBe(1);
  });

  it('maps generation settings into Gemini generationConfig', async () => {
    const tuned: AiConnection = { ...gemini, generation: { maxTokens: 8192, temperature: 0.2 } };
    let body = '';
    await collect(streamChat(tuned, { system: 's', messages: userTurn },
      sseFetch([], 200, (_u, init) => { body = String(init.body); })));
    const gc = JSON.parse(body).generationConfig;
    expect(gc.maxOutputTokens).toBe(8192);
    expect(gc.temperature).toBe(0.2);
  });
});
