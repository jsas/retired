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
  gesture?: { kind: string; summary: string }
  /** Context (screenshot/dom) summaries before the gesture. */
  context: Array<{ kind: 'screenshot' | 'dom'; summary: string }>
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
    if (p.kind === 'screenshot' || p.kind === 'dom') {
      entry.context.push({ kind: p.kind as 'screenshot' | 'dom', summary: summarizeIntent(p) })
    } else {
      entry.gesture = { kind: p.kind, summary: summarizeIntent(p) }
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
    if (p.state === 'applied' || p.state === 'failed' || p.state === 'rejected' || p.state === 'cancelled') {
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

/** Tiny one-line summary per intent; serialized to the console. */
function summarizeIntent(payload: { kind: string; [k: string]: unknown }): string {
  switch (payload.kind) {
    case 'note':
      return `note: ${String(payload.text ?? '')}`
    case 'stroke': {
      const strokes = (payload as { strokes?: unknown[] }).strokes ?? []
      return `strokes(${strokes.length})`
    }
    case 'arrow':
      return 'arrow'
    case 'move':
      return 'move'
    case 'cut':
      return 'cut'
    case 'screenshot':
      return `image(${(payload as { image?: { width?: number; height?: number } }).image?.width ?? '?'}x${(payload as { image?: { height?: number } }).image?.height ?? '?'})`
    case 'dom':
      return `dom(${String((payload as { snapshot?: string }).snapshot ?? '').length} chars)`
    default:
      return payload.kind
  }
}
