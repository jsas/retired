/**
 * A markup Engine backed by the shared @retired/ai-bridge. The human's markup
 * (pen strokes, notes, arrows, drags, cuts) plus the captured DOM metadata are
 * described textually and sent to the selected model, which replies with a
 * fenced-JSON decision: either the DOM edits to apply, or a rejection with a
 * reason.
 *
 * This runs the SAME bridge the app's assistant uses, so the model + options
 * the user configured for the chat drive markup interpretation too — one
 * selection surface. Images are described, not attached, because the bridge's
 * request/response chat surface is text-only today; vision support is a
 * follow-up (the overlay already captures a markup-bundle image).
 *
 * The decision is parsed defensively: anything unparseable, any non-dom edit
 * (source patches belong to the vite dev bridge, not the live preview), and
 * any empty-but-not-rejected reply degrades to a rejection rather than
 * throwing — the session's status machine turns it into a visible failure.
 */
import type { Bridge } from '@retired/ai-bridge'
import { z } from 'zod'
import type { Edit, Intent } from '../core/index.js'
import { DomEdit } from '../core/index.js'
import type { Engine, EngineDecision, EngineInput } from './engine.js'

export interface BridgeEngineOptions {
  /** Override the system prompt. */
  systemPrompt?: string
}

const SYSTEM_PROMPT = [
  'You are a UI editing agent. The user marked up a live web app with pen',
  'strokes, typed notes, arrows, element drags, and region cuts. Each markup',
  'is described below with its geometry and the DOM metadata of any element it',
  'touched. Decide what the user wants and reply with ONLY a fenced JSON code',
  'block (```json ... ```) — no prose — in one of these two shapes:',
  '',
  'Apply DOM edits (a live preview the user confirms):',
  '{ "edits": [{ "kind": "dom", "description": "...", "ops": [ ... ] }] }',
  '',
  'Each op is one of:',
  '  { "op": "setText",  "selector": "css", "text": "..." }',
  '  { "op": "setAttr",  "selector": "css", "name": "...", "value": "..." }',
  '  { "op": "setStyle", "selector": "css", "styles": { "k": "v" } }',
  '  { "op": "move",     "selector": "css", "x": 0, "y": 0 }',
  '  { "op": "remove",   "selector": "css" }',
  '',
  'Prefer the smallest change that satisfies the markup. Use the selectors from',
  'the supplied element metadata verbatim. If the markup is ambiguous,',
  'contradictory, or you cannot tell what is wanted, reply with:',
  '{ "rejection": "one plain sentence explaining what you need" }',
].join('\n')

export function createBridgeEngine(bridge: Bridge, options: BridgeEngineOptions = {}): Engine {
  const system = options.systemPrompt ?? SYSTEM_PROMPT
  return {
    async decide(input: EngineInput): Promise<EngineDecision> {
      const first = input.intents[0]
      if (!first) return { edits: [], rejection: 'no intent provided' }

      const user = buildUserMessage(input)
      let reply: string
      try {
        const out = await bridge.chat({ system, messages: [{ role: 'user', content: user }] })
        reply = out.text
      } catch (err) {
        return { edits: [], rejection: `model call failed: ${err instanceof Error ? err.message : String(err)}` }
      }
      return parseDecision(reply)
    },
  }
}

function buildUserMessage(input: EngineInput): string {
  const parts: string[] = ['Markup the user made:', describeIntents(input.intents)]
  if (input.dom) parts.push(`\nDOM snapshot:\n${input.dom.slice(0, 40000)}`)
  if (input.screenshot) {
    parts.push('\n(A markup-bundle image was captured but is described textually above.)')
  }
  return parts.join('\n')
}

function describeIntents(intents: Intent[]): string {
  const lines: string[] = []
  for (const i of intents) {
    switch (i.kind) {
      case 'note':
        lines.push(`- note: "${i.text}" at (${i.anchor.x},${i.anchor.y})`)
        break
      case 'stroke':
        lines.push(
          `- freehand strokes (${i.strokes.length}) in bounds (${i.bounds.x},${i.bounds.y} ${i.bounds.w}x${i.bounds.h})` +
            (i.note ? ` with note "${i.note}"` : ''),
        )
        break
      case 'arrow':
        lines.push(
          `- arrow from (${i.from.x},${i.from.y}) to (${i.to.x},${i.to.y})` +
            (i.note ? ` with note "${i.note}"` : ''),
        )
        break
      case 'move':
        lines.push(`- drag of <${i.target.tag}> (${i.target.selector}) to (${i.to.x},${i.to.y})`)
        break
      case 'cut':
        lines.push(`- cut of region (${i.region.x},${i.region.y} ${i.region.w}x${i.region.h}) to (${i.to.x},${i.to.y})`)
        break
      case 'screenshot':
        lines.push('- screenshot attached')
        break
      case 'dom':
        lines.push('- dom snapshot attached')
        break
    }
  }
  return lines.join('\n')
}

/** Zod schema for the model's reply: either edits (dom only) or a rejection. */
const DecisionSchema = z.union([
  z.object({ edits: z.array(DomEdit).min(1) }),
  z.object({ rejection: z.string().min(1) }),
])

function parseDecision(reply: string): EngineDecision {
  const json = extractJson(reply)
  if (!json) return { edits: [], rejection: 'could not parse the model reply as JSON' }
  const parsed = DecisionSchema.safeParse(json)
  if (!parsed.success) {
    return { edits: [], rejection: 'model reply did not match the expected edit/rejection shape' }
  }
  if ('rejection' in parsed.data) return { edits: [], rejection: parsed.data.rejection }
  return { edits: parsed.data.edits as Edit[] }
}

/** Pull the first fenced ```json block (or a bare {...}) out of the reply. */
function extractJson(reply: string): unknown | null {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1]! : reply
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}
