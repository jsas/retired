/**
 * Recorder: subscribes to the bus and keeps a per-interaction ledger of:
 * every intent it saw (gesture + context), every status transition, and the
 * edits applied (from the 'applied' status). Console endpoints read through
 * this — it's the bus subscriber type the session expects anyway.
 */
import type { Bus } from '../core/bus.js'
import type { Edit, Envelope, StatusState } from '../core/protocol.js'

export interface HistoryEntry {
  interactionId: string
  /** First-seen timestamp for the entry (ms). */
  ts: number
  /** Gesture intent summary (kind + small preview). */
  gesture?: { kind: string; summary: string; text?: string }
  /** Context (screenshot/dom) summaries before the gesture. */
  context: Array<{ kind: 'screenshot' | 'dom'; summary: string }>
  /**
   * Base64 data-URL of the captured image, when vision is on. Included so the
   * console can render it for debugging (send the model sees the same bytes).
   */
  image?: string
  /**
   * The raw DOM snapshot the overlay sent (when dom-capture is on). Kept so the
   * console / debugging can see EXACTLY what the source-search parsed — the
   * needle extractor's behaviour is only reproducible against the real text.
   */
  dom?: string
  /** Latest non-terminal status seen. */
  lastStatus?: StatusState
  /** Applied edits snapshot (full Edit objects). */
  edits: Edit[]
  /** Terminal state reached, e.g. 'applied' on the final status. */
  terminal?: StatusState
  /** Detail from the terminal status. */
  detail?: string
}

export interface Recorder {
  /** All entries, most recent first. */
  list(): HistoryEntry[]
  /** Look up one interaction (or undefined). */
  get(interactionId: string): HistoryEntry | undefined
  /** Unsubscribe. */
  close(): void
}

export function createRecorder(bus: Bus): Recorder {
  const entries = new Map<string, HistoryEntry>()
  const off = bus.subscribe((envelope) => {
    record(entries, envelope)
  })
  return {
    list: () => [...entries.values()].sort((a, b) => b.ts - a.ts),
    get: (id) => entries.get(id),
    close: off,
  }
}

function record(entries: Map<string, HistoryEntry>, envelope: Envelope): void {
  const entry = upsert(entries, envelope.interactionId, envelope.ts)
  if (envelope.kind === 'retract') {
    entry.terminal = 'cancelled'
    return
  }
  const payload = envelope.payload as
    | { kind: string; [k: string]: unknown }
    | { state: string; [k: string]: unknown }
    | { surface: string; role: string }
  if (envelope.kind === 'intent') {
    const p = payload as { kind: string; [k: string]: unknown }
    if (p.kind === 'screenshot') {
      entry.context.push({ kind: 'screenshot', summary: summarizeIntent(p) })
      // The captured image is a small data-URL (vision intent, bounded by the
      // adapter); keep one per interaction so the console can render it.
      const img = p.image as { mime?: string; data?: string } | undefined
      if (img?.data && img.mime) {
        entry.image = `data:${img.mime};base64,${img.data}`
      }
    } else if (p.kind === 'dom') {
      entry.context.push({ kind: 'dom', summary: summarizeIntent(p) })
      // Keep the raw snapshot so debugging sees exactly what the search parsed.
      const snap = (p as { snapshot?: unknown }).snapshot
      if (typeof snap === 'string') entry.dom = snap
    } else {
      const text = (p.note ?? p.text ?? payloadText(p)) as string | undefined
      entry.gesture = { kind: p.kind, summary: summarizeIntent(p), text: typeof text === 'string' ? text : undefined }
    }
    return
  }
  if (envelope.kind === 'status') {
    const p = payload as {
      state: (typeof import('../core/protocol.js').StatusState)['_output']
      detail: string
      edits: (typeof import('../core/protocol.js').Edit)['_output'][]
    }
    entry.lastStatus = p.state
    if (p.state === 'applied') entry.edits = p.edits
    entry.detail = p.detail
    if (
      p.state === 'applied' ||
      p.state === 'answered' ||
      p.state === 'failed' ||
      p.state === 'rejected' ||
      p.state === 'cancelled'
    ) {
      entry.terminal = p.state
    }
    return
  }
}

function upsert(entries: Map<string, HistoryEntry>, interactionId: string, ts: number): HistoryEntry {
  let e = entries.get(interactionId)
  if (!e) {
    e = { interactionId, ts, context: [], edits: [] }
    entries.set(interactionId, e)
  }
  return e
}

function payloadText(payload: { kind: string; [k: string]: unknown }): unknown {
  return (payload as { note?: unknown }).note ?? (payload as { text?: unknown }).text
}

/** Tiny one-line summary per gesture; surfaced on the console verbatim. */
function summarizeIntent(payload: { kind: string; [k: string]: unknown }): string {
  // User-supplied words are the most debuggable part — always lead with them.
  const noteText = (payload as { note?: string }).note
  const rawText = (payload as { text?: string }).text
  const text = noteText ?? rawText
  switch (payload.kind) {
    case 'note':
      return `note: ${String(rawText ?? '')}`
    case 'stroke': {
      const strokes = (payload as { strokes?: unknown[] }).strokes ?? []
      const el = payload.element as { tag?: string; selector?: string; textPreview?: string } | undefined
      const elDesc = el?.selector
        ? ` on <${el.tag ?? 'el'}>${el.textPreview ? ` "${el.textPreview}"` : ''} (${el.selector})`
        : ''
      return `strokes(${strokes.length})${elDesc}${text ? ` note: "${text}"` : ''}`
    }
    case 'arrow':
      return `arrow${text ? ` note: "${text}"` : ''}`
    case 'move':
      return `move${text ? ` note: "${text}"` : ''}`
    case 'cut':
      return `cut${text ? ` note: "${text}"` : ''}`
    case 'screenshot':
      return `image(${(payload as { image?: { width?: number; height?: number } }).image?.width ?? '?'}x${(payload as { image?: { height?: number } }).image?.height ?? '?'})`
    case 'dom':
      return `dom(${String((payload as { snapshot?: string }).snapshot ?? '').length} chars)`
    default:
      return payload.kind
  }
}
