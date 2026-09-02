/**
 * OpenAI-compatible chat-completions adapter. Works against OpenAI,
 * OpenRouter, Ollama (/v1), LM Studio — anything speaking
 * { messages } -> { choices[0].message }.
 *
 * The model must answer with one apply_edits tool call; a rejection is an
 * empty edits array plus a note.
 */
import type { DomOp, Edit, Intent } from '../core/index.js'
import type { Engine, EngineDecision, EngineInput } from './engine.js'
import { APPLY_EDITS_TOOL } from './tool-schema.js'

export interface OpenAIEngineOptions {
  /** e.g. https://api.openai.com/v1/chat/completions */
  endpoint: string
  apiKey?: string
  model: string
  /** System prompt override; a default is provided. */
  systemPrompt?: string
  temperature?: number
  fetchImpl?: typeof fetch
}

const DEFAULT_SYSTEM_PROMPT = [
  'You are a UI editing agent. The user marked up a screenshot of their running app:',
  'drawings, arrows, notes, and element drags. You get the markup image and DOM metadata.',
  'Interpret the markup and emit edits that make the app match what the user drew.',
  'Rules:',
  '- Prefer minimal edits. Do not rewrite files wholesale unless asked.',
  '- For source edits use exact "find" strings that appear exactly once in the file.',
  '- If the markup is ambiguous, return zero edits and explain in "note".',
].join('\n')

export class OpenAIEngine implements Engine {
  private readonly opts: OpenAIEngineOptions & { temperature: number }

  constructor(options: OpenAIEngineOptions) {
    if (!options.endpoint) throw new Error('OpenAIEngine: endpoint is required')
    if (!options.model) throw new Error('OpenAIEngine: model is required')
    this.opts = { temperature: 0.2, ...options }
  }

  async decide(input: EngineInput): Promise<EngineDecision> {
    const doFetch = this.opts.fetchImpl ?? fetch
    const res = await doFetch(this.opts.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.opts.model,
        temperature: this.opts.temperature,
        messages: buildMessages(input, this.opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT),
        tools: [APPLY_EDITS_TOOL],
        tool_choice: { type: 'function', function: { name: 'apply_edits' } },
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenAIEngine: HTTP ${res.status} ${body.slice(0, 300)}`)
    }
    const json = (await res.json()) as OpenAIResponse
    const call = json.choices?.[0]?.message?.tool_calls?.[0]
    if (!call?.function || call.function.name !== 'apply_edits') {
      return { edits: [], rejection: 'model did not call apply_edits' }
    }
    let parsed: { note?: string; edits?: unknown }
    try {
      parsed = JSON.parse(call.function.arguments ?? '{}')
    } catch {
      return { edits: [], rejection: 'model produced unparseable tool arguments' }
    }
    const edits = normalizeEdits(parsed.edits)
    if (edits.length === 0) {
      return { edits: [], rejection: parsed.note ?? 'model produced no edits' }
    }
    return { edits }
  }
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
    }
  }>
}

function buildMessages(input: EngineInput, systemPrompt: string): unknown[] {
  const messages: unknown[] = [{ role: 'system', content: systemPrompt }]
  const text = describeIntents(input.intents)
  const image = input.screenshot
  if (image) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } },
      ],
    })
  } else {
    messages.push({ role: 'user', content: text })
  }
  if (input.dom) {
    messages.push({ role: 'user', content: `DOM snapshot:\n${input.dom.slice(0, 40000)}` })
  }
  return messages
}

function describeIntents(intents: Intent[]): string {
  const lines: string[] = []
  for (const i of intents) {
    switch (i.kind) {
      case 'note':
        lines.push(`note: "${i.text}" at (${i.anchor.x},${i.anchor.y})`)
        break
      case 'stroke':
        lines.push(`freehand strokes (${i.strokes.length}) in bounds (${i.bounds.x},${i.bounds.y} ${i.bounds.w}x${i.bounds.h})${i.note ? ` with note "${i.note}"` : ''}`)
        break
      case 'arrow':
        lines.push(`arrow from (${i.from.x},${i.from.y}) to (${i.to.x},${i.to.y})${i.note ? ` with note "${i.note}"` : ''}`)
        break
      case 'move':
        lines.push(`drag of <${i.target.tag}> (${i.target.selector}) to (${i.to.x},${i.to.y})`)
        break
      case 'cut':
        lines.push(`cut of region (${i.region.x},${i.region.y} ${i.region.w}x${i.region.h}) to (${i.to.x},${i.to.y})`)
        break
      case 'screenshot':
        lines.push('screenshot attached')
        break
      case 'dom':
        lines.push('dom snapshot attached')
        break
    }
  }
  return lines.join('\n')
}

function normalizeEdits(raw: unknown): Edit[] {
  if (!Array.isArray(raw)) return []
  const edits: Edit[] = []
  for (const candidate of raw) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const e = candidate as Record<string, unknown>
    if (e.kind === 'text' && typeof e.file === 'string' && typeof e.find === 'string' && typeof e.replace === 'string') {
      edits.push({
        kind: 'text',
        file: e.file,
        find: e.find,
        replace: e.replace,
        description: typeof e.description === 'string' ? e.description : '',
      })
    } else if (e.kind === 'write' && typeof e.file === 'string' && typeof e.content === 'string') {
      edits.push({
        kind: 'write',
        file: e.file,
        content: e.content,
        description: typeof e.description === 'string' ? e.description : '',
      })
    } else if (e.kind === 'dom' && Array.isArray(e.ops)) {
      edits.push({
        kind: 'dom',
        ops: e.ops as DomOp[],
        description: typeof e.description === 'string' ? e.description : '',
      })
    }
  }
  return edits
}
