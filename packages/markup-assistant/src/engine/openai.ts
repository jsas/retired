/**
 * OpenAI-compatible chat-completions adapter. Works against OpenAI,
 * OpenRouter, Ollama (/v1), LM Studio — anything speaking
 * { messages } -> { choices[0].message }.
 *
 * The model must answer with one apply_edits tool call; a rejection is an
 * empty edits array plus a note.
 */
import type { DomOp, Edit, Intent } from '../core/protocol.js'
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
  /**
   * When the model rejects with "please share the file containing X", any
   * the host can hand back via this hook gets appended to the conversation
   * and the retry is told it arrived. In the vite bridge this hits /source.
   */
  fetchSource?: (file: string) => Promise<string | undefined>
  /** Dev-only: observe the exact request payload sent to the model. */
  requestLogger?: (payload: { messages: unknown[] }) => void
}

const DEFAULT_SYSTEM_PROMPT = [
  'You are a UI editing agent. The user marked up a screenshot of their running app:',
  'drawings, arrows, notes, and element drags. You get the markup image and DOM metadata.',
  'Interpret the markup and emit edits that make the app match what the user drew.',
  'A gesture alone can be ambiguous — pair it with the element named in the prompt and,',
  "when present, the user's note text.",
  'Some input is a QUESTION, not a change request ("what is this?", "why is this here?").',
  'For those, fill "answer" with a direct reply and leave "edits" empty — do NOT treat',
  'a question as a failed edit.',
  'Rules:',
  '- Edits are applied to the app SOURCE files (text find/replace, file writes) —',
  '  the change must survive a reload. DOM ops are NOT applied in this loop, so',
  '  never answer a change request with a dom edit; find the source that renders',
  '  the marked-up element and edit that instead.',
  '- Prefer minimal edits. Do not rewrite files wholesale unless asked.',
  '- For source edits use exact "find" strings that appear exactly once in the file.',
  '- If a change request is ambiguous, return zero edits and explain in "note".',
  '- Use the `file:` header line from each source excerpt as your `edit.file` value EXACTLY.',
  '  Never name a file the excerpt did not label — a guessed path fails application',
  '  with "file unreadable". If no excerpt shows the element, reject with a note saying',
  '  which file is missing.',
  '- The gesture names the element by its ON-SCREEN TEXT (e.g. "WITHDRAWAL RATE").',
  '  Edit the file whose excerpt contains that exact text. Do NOT pick a file just',
  '  because it shares a CSS class with the marked element — many files share classes;',
  '  the label text is the reliable fingerprint.',
].join('\n')

export class OpenAIEngine implements Engine {
  private readonly opts: OpenAIEngineOptions & { temperature: number }

  constructor(options: OpenAIEngineOptions) {
    if (!options.endpoint) throw new Error('OpenAIEngine: endpoint is required')
    if (!options.model) throw new Error('OpenAIEngine: model is required')
    this.fetchSource = options.fetchSource
    this.requestLogger = options.requestLogger
    this.opts = { temperature: 0.2, ...options }
  }

  /** Also settable post-construction so the app plugin can wire /source in. */
  fetchSource: OpenAIEngineOptions['fetchSource']
  /** Dev-only: settable post-construction (the vite bridge attaches it when
   *  MARKUP_DEBUG_LOG is set, after openaiEngineFromEnv built the engine). */
  requestLogger: OpenAIEngineOptions['requestLogger']

  /**
   * Rolling transcript of what the user asked and what the model concluded,
   * kept across interactions so a follow-up ("yes, that one", "now make it
   * sparklier") lands with the thread intact. Cleared by clearConversation();
   * the overlay calls that when the user wipes the markup.
   */
  private transcript: Array<{ role: string; content: string }> = []
  /** Conversation turns kept; oldest drop off so the context window stays bounded. */
  private readonly maxTurns = 20

  clearConversation(): void {
    this.transcript = []
  }

  async decide(input: EngineInput): Promise<EngineDecision> {
    const messages = this.buildConversation(input)
    const first = await this.callModel(messages)
    const decision = this.interpret(first, input)

    // A change request that came back with no edits gets ONE more round
    // trip. Two shapes of comeback:
    //  - "please share the file with the X component" — the /source hook
    //    (when the host provides one) is called and its content appended,
    //    so the retry really gets the file.
    //  - described-in-prose ("set their background to green") — the model's
    //    own words are echoed and it's told to make the actual tool call.
    const said = (first.content ?? '').trim() || (decision.rejection ?? '').trim()
    const needsNudge = Boolean(decision.rejection) && !looksLikeQuestion(input) && said.length > 0
    if (!needsNudge) {
      this.remember(input, decision)
      return decision
    }

    messages.push({ role: 'assistant', content: said })

    const requestedFile = filenameWanted(said)
    let brought: string | undefined
    if (this.fetchSource && requestedFile) {
      try {
        brought = await this.fetchSource(requestedFile)
      } catch {
        brought = undefined
      }
    }
    messages.push({
      role: 'user',
      content:
        (requestedFile && brought
          ? `Here is the file you asked for:\n\nfile: ${requestedFile}\n${brought}\n\n`
          : '') +
        'You just described the change in prose instead of making it. Do it now: ' +
        'call apply_edits with the real edits (exact find/replace against the ' +
        'source excerpts). Do not explain — only make the tool call.',
    })
    const second = await this.callModel(messages)
    const retry = this.interpret(second, input)
    // Keep the more informative reply if the nudge also produced nothing.
    const out = retry.edits.length > 0 || retry.answer ? retry : decision
    this.remember(input, out)
    return out
  }

  /** Record the outcome of a decided interaction for later turns. */
  private remember(input: EngineInput, decision: EngineDecision): void {
    const userText = describeIntents(input.intents)
    // A rejection must NOT be remembered in the model's own words. When a
    // source-search bug makes it say "the excerpt only covers the first card",
    // that false claim sits in the transcript and every later turn
    // pattern-matches it — even after the bug is fixed. Remember the FACT
    // (this request was rejected and why, roughly) without the model's
    // possibly-wrong narrative.
    const outcome = decision.answer
      ? `answered: ${decision.answer}`
      : decision.rejection
        ? 'rejected — the change could not be made on that attempt'
        : decision.edits.length
          ? `applied ${decision.edits.length} edit(s)`
          : ''
    if (!userText.trim() && !outcome) return
    this.transcript.push({ role: 'user', content: userText })
    this.transcript.push({ role: 'assistant', content: outcome })
    // Keep the tail within bounds — drop whole turns (pairs) from the front.
    while (this.transcript.length > this.maxTurns * 2) this.transcript.splice(0, 2)
  }

  /** Build the message list for a fresh interaction, seeded with prior turns. */
  private buildConversation(input: EngineInput): unknown[] {
    const messages = buildMessages(input, this.opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT)
    // Insert the rolling transcript between the system prompt and this turn.
    return [messages[0], ...this.transcript, ...messages.slice(1)]
  }

  /** One chat-completions round trip; returns the assistant message. */
  private async callModel(messages: unknown[]): Promise<AssistantMessage> {
    this.requestLogger?.({ messages })
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
        messages,
        tools: [APPLY_EDITS_TOOL],
        tool_choice: { type: 'function', function: { name: 'apply_edits' } },
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenAIEngine: HTTP ${res.status} ${body.slice(0, 300)}`)
    }
    const json = (await res.json()) as OpenAIResponse
    return json.choices?.[0]?.message ?? {}
  }

  /** Turn one assistant message (tool call or prose) into a decision. */
  private interpret(message: AssistantMessage, input: EngineInput): EngineDecision {
    const call = message.tool_calls?.[0]

    // The happy path is the forced apply_edits tool call. Some models/endpoints
    // ignore tool_choice and print the arguments as plain text instead —
    // salvage that too rather than discarding the model's work.
    let rawArgs: string | undefined
    if (call?.function && call.function.name === 'apply_edits') {
      rawArgs = call.function.arguments
    } else {
      rawArgs = extractJsonFromText(message.content ?? '')
    }
    if (rawArgs === undefined) {
      return replyWithText(message.content ?? '', input)
    }
    let parsed: { note?: string; answer?: string; edits?: unknown }
    try {
      parsed = JSON.parse(rawArgs)
    } catch {
      return replyWithText(message.content ?? '', input)
    }
    return finish(parsed, input)
  }
}

interface AssistantMessage {
  content?: string
  tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>
}

/** Turn a parsed apply_edits payload (tool call or salvaged text) into a decision. */
function finish(
  parsed: { note?: string; answer?: string; edits?: unknown },
  input: EngineInput,
): EngineDecision {
  const edits = normalizeEdits(parsed.edits)
  // A question / nothing-to-change reply: answer text with no edits.
  if (typeof parsed.answer === 'string' && parsed.answer.trim()) {
    return { edits: [], answer: parsed.answer.trim() }
  }
  if (edits.length === 0) {
    // Small models often ignore the `answer` field and put the reply in
    // `note`. If the user asked a question, that note IS the answer — don't
    // dress it up as a rejection.
    const note = parsed.note ?? ''
    if (looksLikeQuestion(input) && note.trim()) {
      return { edits: [], answer: note.trim() }
    }
    return { edits: [], rejection: note || 'model produced no edits' }
  }
  return { edits }
}

/**
 * The model answered in prose instead of a tool call. Never throw its words
 * away: a question gets the prose as an answer; a change request gets it as
 * the rejection reason so the user can actually see what the model said.
 */
function replyWithText(text: string, input: EngineInput): EngineDecision {
  const clean = text.trim()
  if (!clean) {
    return { edits: [], rejection: 'model did not call apply_edits and returned no text' }
  }
  if (looksLikeQuestion(input)) return { edits: [], answer: clean }
  return { edits: [], rejection: clean.slice(0, 400) }
}

/**
 * When the whole reply is a JSON object (bare or fenced in ```json), treat it
 * as the apply_edits arguments the model meant to send as a tool call.
 */
function extractJsonFromText(content: string): string | undefined {
  let text = content.trim()
  if (!text) return undefined
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence?.[1]) text = fence[1].trim()
  return text.startsWith('{') ? text : undefined
}

/**
 * The model said "please share the file / the file containing / I need the
 * component that renders" — pull the first source-path-ish token out of the
 * sentence so the host's /source hook can bring it back.
 */
function filenameWanted(text: string): string | undefined {
  const match = text.match(
    /(?:src|packages|app)\/[\w./-]+(?:\.tsx?|\.jsx?|\.css|\.html)\b/i,
  )
  return match?.[0]
}

/** True when the interaction text reads as a question, not a change request. */
function looksLikeQuestion(input: EngineInput): boolean {
  const texts = input.intents
    .map((i) => {
      if (i.kind === 'note') return i.text
      return (i as { note?: string }).note ?? ''
    })
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (!texts) return false
  if (texts.includes('?')) return true
  return /^(what|why|how|when|where|which|who|whose|is|are|does|do|did|can|could|should|would|tell me)\b/.test(
    texts.trim(),
  )
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string
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
  if (input.source) {
    messages.push({
      role: 'user',
      content:
        `Source excerpts from the app's own files, found by searching for text visible ` +
        `in the DOM snapshot. Base your text edits' \`find\` strings on this real source:\n\n` +
        input.source.slice(0, 30000),
    })
  }
  return messages
}

function describeIntents(intents: Intent[]): string {
  const lines: string[] = []
  for (const i of intents) {
    switch (i.kind) {
      case 'note': {
        lines.push(`note: "${i.text}" at (${i.anchor.x},${i.anchor.y})${elRef(i.element)}`)
        break
      }
      case 'stroke': {
        lines.push(`freehand strokes (${i.strokes.length}) in bounds (${i.bounds.x},${i.bounds.y} ${i.bounds.w}x${i.bounds.h})${i.note ? ` with note "${i.note}"` : ''}${elRef(i.element)}`)
        break
      }
      case 'arrow': {
        lines.push(`arrow from (${i.from.x},${i.from.y}) to (${i.to.x},${i.to.y})${i.note ? ` with note "${i.note}"` : ''}`)
        break
      }
      case 'move': {
        lines.push(`drag of <${i.target.tag}> (${i.target.selector}) to (${i.to.x},${i.to.y})`)
        break
      }
      case 'cut': {
        lines.push(`cut of region (${i.region.x},${i.region.y} ${i.region.w}x${i.region.h}) to (${i.to.x},${i.to.y})`)
        break
      }
      case 'screenshot': {
        lines.push('screenshot attached')
        break
      }
      case 'dom': {
        lines.push('dom snapshot attached')
        break
      }
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

/** One-line, plain-text element description placed on the intent line. */
function elRef(element: { tag?: string; selector?: string; textPreview?: string } | undefined): string {
  if (!element) return ''
  const preview = element.textPreview ? ` "${element.textPreview}"` : ''
  return ` on <${element.tag ?? 'el'}>${preview} (${element.selector})`
}
