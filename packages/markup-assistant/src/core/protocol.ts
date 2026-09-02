import { z } from 'zod'

/**
 * Wire protocol shared by every surface: input adapters emit Intents, the
 * engine emits Statuses + Edits, sinks consume Edits. Everything travels in
 * an Envelope so any transport (in-memory, BroadcastChannel, SSE) can carry
 * it without knowing what's inside.
 */

// The overlay's activation chord lives here (not input/) so the node-side
// envConfig can describe it without pulling in the DOM-heavy overlay module.
export interface Hotkey {
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  key: string
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export const Point = z.object({
  x: z.number(),
  y: z.number(),
})
export type Point = z.infer<typeof Point>

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
})
export type Rect = z.infer<typeof Rect>

// ---------------------------------------------------------------------------
// Markup primitives (what a human drew / typed / dragged)
// ---------------------------------------------------------------------------

export const Stroke = z.object({
  /** Points in viewport CSS pixels, in draw order. */
  points: z.array(Point).min(1),
  color: z.string().default('#ff3b30'),
  width: z.number().positive().default(3),
})
export type Stroke = z.infer<typeof Stroke>

/**
 * A reference to an element in the live page, resolved by the input side so
 * the engine never has to guess selectors from pixels alone.
 */
export const ElementRef = z.object({
  /** A stable-ish CSS selector produced by the input adapter. */
  selector: z.string(),
  /** Bounding rect at interaction time (viewport coordinates). */
  rect: Rect,
  /** Tag + identifying attrs, for model context. */
  tag: z.string(),
  id: z.string().optional(),
  classes: z.array(z.string()).default([]),
  /** Short text content, truncated by the adapter. */
  textPreview: z.string().max(200).optional(),
})
export type ElementRef = z.infer<typeof ElementRef>

/** Inline image payload (data URL). Kept small by the input adapter. */
export const ImagePayload = z.object({
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  /** base64, no data: prefix. */
  data: z.string(),
  /** Natural width/height of the capture. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})
export type ImagePayload = z.infer<typeof ImagePayload>

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

export const NoteIntent = z.object({
  kind: z.literal('note'),
  text: z.string().min(1),
  /** Where the note was anchored on screen (viewport px). */
  anchor: Point,
  /** Element under the anchor, if the adapter could resolve one. */
  element: ElementRef.optional(),
})

export const StrokeIntent = z.object({
  kind: z.literal('stroke'),
  strokes: z.array(Stroke).min(1),
  /** Bounding box of all strokes (viewport px). */
  bounds: Rect,
  /** Free-text the user typed alongside the drawing. */
  note: z.string().optional(),
  element: ElementRef.optional(),
})

export const ArrowIntent = z.object({
  kind: z.literal('arrow'),
  /** Viewport px where the arrow starts (the "take this" side). */
  from: Point,
  /** Viewport px where it points (the "put it here" side). */
  to: Point,
  /** Element at the arrow's start, when the adapter resolved one. */
  fromElement: ElementRef.optional(),
  /** Element at the arrow's head, when the adapter resolved one. */
  toElement: ElementRef.optional(),
  note: z.string().optional(),
})

export const MoveIntent = z.object({
  kind: z.literal('move'),
  /** The element (or screen region) being moved. */
  target: ElementRef,
  /** Where it should end up (viewport px, top-left). */
  to: Point,
  note: z.string().optional(),
})

export const CutIntent = z.object({
  kind: z.literal('cut'),
  /** Screen region cut out (viewport px). */
  region: Rect,
  /** Where the cut piece should land (viewport px, top-left). */
  to: Point,
  /** Region contents, when the adapter could capture them. */
  image: ImagePayload.optional(),
  note: z.string().optional(),
})

export const ScreenshotIntent = z.object({
  kind: z.literal('screenshot'),
  image: ImagePayload,
  note: z.string().optional(),
  element: ElementRef.optional(),
})

export const DomIntent = z.object({
  kind: z.literal('dom'),
  /** Serialized subtree the adapter chose to send. */
  snapshot: z.string(),
  note: z.string().optional(),
  element: ElementRef.optional(),
})

export const Intent = z.discriminatedUnion('kind', [
  NoteIntent,
  StrokeIntent,
  ArrowIntent,
  MoveIntent,
  CutIntent,
  ScreenshotIntent,
  DomIntent,
])
export type Intent = z.infer<typeof Intent>
export type IntentKind = Intent['kind']

// ---------------------------------------------------------------------------
// Edits — what the engine decided should change
// ---------------------------------------------------------------------------

export const TextEdit = z.object({
  kind: z.literal('text'),
  /** Repo-relative file path. */
  file: z.string(),
  /** Exact text to find. Must appear exactly once for the edit to apply. */
  find: z.string(),
  replace: z.string(),
  description: z.string().default(''),
})
export type TextEdit = z.infer<typeof TextEdit>

export const FileWrite = z.object({
  kind: z.literal('write'),
  file: z.string(),
  content: z.string(),
  description: z.string().default(''),
})
export type FileWrite = z.infer<typeof FileWrite>

/**
 * Live DOM operation for preview surfaces. Coordinates with TextEdit via
 * `interactionId` — the beacon applies these immediately, the source patch
 * lands on disk for HMR to pick up.
 */
export const DomOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setText'), selector: z.string(), text: z.string() }),
  z.object({ op: z.literal('setAttr'), selector: z.string(), name: z.string(), value: z.string() }),
  z.object({ op: z.literal('setStyle'), selector: z.string(), styles: z.record(z.string(), z.string()) }),
  z.object({ op: z.literal('move'), selector: z.string(), x: z.number(), y: z.number() }),
  z.object({ op: z.literal('remove'), selector: z.string() }),
])
export type DomOp = z.infer<typeof DomOp>

export const DomEdit = z.object({
  kind: z.literal('dom'),
  ops: z.array(DomOp).min(1),
  description: z.string().default(''),
})
export type DomEdit = z.infer<typeof DomEdit>

export const Edit = z.discriminatedUnion('kind', [TextEdit, FileWrite, DomEdit])
export type Edit = z.infer<typeof Edit>
export type SourceEdit = TextEdit | FileWrite

export function isSourceEdit(edit: Edit): edit is SourceEdit {
  return edit.kind === 'text' || edit.kind === 'write'
}

// ---------------------------------------------------------------------------
// Envelope + statuses
// ---------------------------------------------------------------------------

export const EnvelopeKind = z.enum(['intent', 'status', 'hello', 'retract'])
export type EnvelopeKind = z.infer<typeof EnvelopeKind>

/** Input-side undo: the human withdrew this interaction before it landed. */
export const Retract = z.object({
  interactionId: z.string(),
  reason: z.enum(['undo', 'clear']).default('undo'),
})
export type Retract = z.infer<typeof Retract>

export const StatusState = z.enum([
  'received', // input side emitted, nothing has decided yet
  'accepted', // engine took the interaction into its queue
  'processing', // model is working
  'applied', // every edit landed on every sink
  'failed', // engine or sink error, retryable in principle
  'rejected', // engine decided this needs a human, e.g. missing context
  'cancelled', // input side retracted the interaction (undo/clear)
])
export type StatusState = z.infer<typeof StatusState>

export const INTERACTION_STATUSES = StatusState.options
const TERMINAL: ReadonlySet<StatusState> = new Set([
  'applied',
  'failed',
  'rejected',
  'cancelled',
])

export function isTerminalStatus(state: StatusState): boolean {
  return TERMINAL.has(state)
}

/** Legal transitions — sinks and HUDs rely on this never going backwards. */
const TRANSITIONS: Record<StatusState, readonly StatusState[]> = {
  received: ['accepted', 'rejected', 'failed', 'cancelled'],
  accepted: ['processing', 'failed', 'rejected', 'cancelled'],
  processing: ['applied', 'failed', 'rejected', 'cancelled'],
  applied: [],
  failed: [],
  rejected: [],
  cancelled: [],
}

export function canTransition(from: StatusState, to: StatusState): boolean {
  return from !== to && TRANSITIONS[from].includes(to)
}

export const Status = z.object({
  interactionId: z.string(),
  state: StatusState,
  /** Human-readable, shown verbatim in the on-page HUD. */
  detail: z.string().default(''),
  /** Edits that were applied — set on `applied`. */
  edits: z.array(Edit).default([]),
})
export type Status = z.infer<typeof Status>

export const Hello = z.object({
  surface: z.string(),
  /** e.g. 'overlay' | 'beacon' | 'extension' | 'engine' */
  role: z.enum(['input', 'output', 'engine', 'viewer']),
})
export type Hello = z.infer<typeof Hello>

export const Envelope = z.object({
  id: z.string(),
  /** Groups every intent/status belonging to one user interaction. */
  interactionId: z.string(),
  ts: z.number(),
  kind: EnvelopeKind,
  /** Which surface sent it ('overlay', 'extension', 'engine', ...). */
  source: z.string(),
  payload: z.union([Intent, Status, Hello, Retract]),
})
export type Envelope = z.infer<typeof Envelope>

let counter = 0
export function makeId(prefix = 'ev'): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`
}

export function makeEnvelope(args: {
  interactionId: string
  source: string
  kind: EnvelopeKind
  payload: Intent | Status | Hello | Retract
}): Envelope {
  return {
    id: makeId(),
    interactionId: args.interactionId,
    ts: Date.now(),
    kind: args.kind,
    source: args.source,
    payload: args.payload,
  }
}

export function makeStatus(
  interactionId: string,
  state: StatusState,
  detail = '',
  edits: Edit[] = [],
): Status {
  return { interactionId, state, detail, edits }
}
