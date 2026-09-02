/**
 * The markup overlay. Dormant until summoned with a hotkey (default
 * Ctrl+Shift+M): a toolbar appears and the page beneath goes inert while
 * you mark it up. Gestures: pen strokes, click-to-type notes, arrows from
 * A to B ("take what is at A, put it at B"), drag an element to a new
 * spot, and lasso-cut a region elsewhere.
 *
 * Every gesture emits an Intent on the bus carrying what the adapter could
 * capture (markup bundle image + DOM metadata for touched elements).
 * Status envelopes flow back and recolor in-flight markup: accepted ->
 * blue, applied -> green, failed/rejected -> red.
 */
import type { Bus, ElementRef, ImagePayload, Intent, Stroke } from '../core/index.js'
import { makeEnvelope } from '../core/index.js'
import {
  buildToolbar,
  describeElement,
  elementAt,
  highlightToolbar,
  intentEnvelope,
  makeInteractionId,
  serializeDom,
} from './overlay-parts.js'

const COLORS = ['#ff3b30', '#0a84ff', '#30d158', '#ff9f0a', '#bf5af2']
const MIN_DRAG_DISTANCE = 4
/** How long the green 'applied' recolor shows before the markup clears. */
const APPLIED_FLASH_MS = 900

export type OverlayMode = 'select' | 'note' | 'stroke' | 'arrow' | 'move' | 'cut' | 'ask'

import type { Hotkey } from '../core/protocol.js'
export type { Hotkey }

export interface OverlayOptions {
  bus: Bus
  /** Emitter name recorded on every envelope. */
  source: string
  /** Elements eligible for move/cut. Default: `body *`. */
  interactive?: string
  /** Canvas z-index. Default 2147483000. */
  zIndex?: number
  /** Activation hotkey. Default: Ctrl+Shift+M (Escape dismisses). */
  hotkey?: Hotkey
  /**
   * Attach the markup-layer image to every gesture's intent (for
   * vision-capable models). Default off — only `cut` captures an image.
   */
  captureImage?: boolean
  /**
   * Attach a serialized DOM snapshot to every gesture's intent, so the model
   * sees the page structure, not just pixels. Default off.
   */
  captureDom?: boolean
  /**
   * Show a small floating toggle button (bottom-right corner) that arms or
   * disarms the overlay with no keyboard. Default on. When the gesture-driven
   * hotkey isn't feasible (e.g. mobile, embedded viewer), this is the primary
   * arming surface.
   */
  showToggle?: boolean
}

export interface OverlayHandle {
  detach(): void
  setMode(mode: OverlayMode): void
  getMode(): OverlayMode
  isArmed(): boolean
  arm(): void
  disarm(): void
  /** Remove the most recent markup from the canvas and retract it from the engine. */
  undoLast(): string | null
  /** Remove every committed markup on the canvas and retract it from the engine. */
  clearAll(): number
  /** Number of committed (not-yet-undone) markup items. */
  pendingCount(): number
}

interface LiveStroke {
  points: Array<{ x: number; y: number }>
  color: string
}

interface DragState {
  kind: 'move' | 'cut'
  startX: number
  startY: number
  currentX: number
  currentY: number
  target: Element | null
}

interface CommittedEntry {
  kind: OverlayMode
  data: Record<string, unknown>
  status?: string
}

export function attachOverlay(options: OverlayOptions): OverlayHandle {
  const bus = options.bus
  const source = options.source
  const interactiveSelector = options.interactive ?? 'body *'
  const zIndex = options.zIndex ?? 2147483000
  const hotkey = options.hotkey ?? { ctrl: true, shift: true, key: 'm' }
  const captureImage = options.captureImage ?? false
  const captureDom = options.captureDom ?? false
  const showToggle = options.showToggle ?? true

  let mode: OverlayMode = 'stroke'
  let armed = false
  let detached = false
  let color = COLORS[0] ?? '#ff3b30'
  let liveStroke: LiveStroke | null = null
  let drag: DragState | null = null

  const canvas = document.createElement('canvas')
  canvas.dataset.maOverlay = ''
  canvas.style.cssText =
    `position:fixed;inset:0;width:100%;height:100%;z-index:${zIndex};` +
    'pointer-events:none;display:none;touch-action:none;'
  document.body.appendChild(canvas)
  const canvasCtx = canvas.getContext('2d')
  if (!canvasCtx) throw new Error('overlay: 2d canvas unavailable')
  // Annotated const so the non-null type survives into nested closures.
  const ctx: CanvasRenderingContext2D = canvasCtx

  const toolbar = buildToolbar(mode, {
    onSelect: (m) => api.setMode(m),
    onUndo: () => {
      undoLast()
    },
    onClear: () => {
      clearAll()
    },
  })
  toolbar.style.display = 'none'
  document.body.appendChild(toolbar)

  for (const c of COLORS) {
    const sw = document.createElement('button')
    sw.style.cssText =
      `width:16px;height:16px;border-radius:50%;border:1px solid #3a3a3c;` +
      `background:${c};cursor:pointer;padding:0;`
    sw.addEventListener('click', () => {
      color = c
      if (mode === 'select') api.setMode('stroke')
    })
    toolbar.appendChild(sw)
  }

  // Interaction capture layer: full-page transparent div with pointer events.
  // user-select:none + dragstart suppression are what make mouse dragging
  // work in Chrome — otherwise the browser starts a native text selection
  // drag, fires pointercancel, and the gesture is lost.
  const captureLayer = document.createElement('div')
  captureLayer.dataset.maOverlay = ''
  captureLayer.style.cssText =
    `position:fixed;inset:0;z-index:${zIndex + 1};display:none;` +
    'background:transparent;cursor:crosshair;touch-action:none;user-select:none;' +
    '-webkit-user-select:none;'
  captureLayer.addEventListener('dragstart', (e) => e.preventDefault())
  document.body.appendChild(captureLayer)

  // Corner toggle: keyboard-free arming surface. Always rendered (hidden
  // when showToggle=false, or visible all the time so the user can reach it
  // even before the overlay is armed).
  let toggle: HTMLButtonElement | null = null
  if (showToggle) {
    toggle = document.createElement('button')
    toggle.dataset.maOverlay = ''
    toggle.type = 'button'
    toggle.textContent = 'markup'
    toggle.setAttribute('aria-pressed', 'false')
    toggle.style.cssText =
      `position:fixed;bottom:14px;right:14px;z-index:${zIndex + 1};` +
      'background:#1c1c1e;color:#fff;border:1px solid #3a3a3c;border-radius:6px;' +
      'padding:6px 10px;font:12px ui-monospace,Menlo,Consolas,monospace;cursor:pointer;' +
      'opacity:0.85;'
    document.body.appendChild(toggle)
    toggle.addEventListener('click', () => {
      if (armed) disarm()
      else arm()
    })
  }

  function updateToggle() {
    if (!toggle) return
    toggle.textContent = armed ? 'markup ✕' : 'markup'
    toggle.setAttribute('aria-pressed', armed ? 'true' : 'false')
    toggle.style.opacity = armed ? '1' : '0.85'
  }

  // HUD: recolors with the live status chain for the active interaction.
  // Clickable: opens the loaded /__markup_assistant__/record page when the
  // prefix is discoverable. Appears when anything lands. Terminal replies
  // (rejected/failed) expand to show the model's detail text — that's the
  // actual response, and the plain status pill alone never says it.
  const hud = document.createElement('div')
  hud.dataset.maOverlay = ''
  hud.style.cssText =
    `position:fixed;bottom:56px;right:14px;z-index:${zIndex + 1};display:none;` +
    'background:#1c1c1e;color:#fff;border:1px solid #3a3a3c;border-radius:6px;' +
    'padding:6px 10px;font:12px ui-monospace,Menlo,Consolas,monospace;cursor:pointer;' +
    'max-width:380px;white-space:pre-wrap;'
  hud.addEventListener('click', () => {
    const prefix = '/__markup_console__'
    window.open(prefix, '_blank')
  })
  document.body.appendChild(hud)

  const STATUS_TEXT: Record<string, string> = {
    received: 'received',
    accepted: 'accepted',
    processing: '🧠 thinking…',
    applied: '✔ applied',
    failed: '✖ failed',
    rejected: '✖ rejected',
    cancelled: '✕ cancelled',
  }

  function hudShow(status: string, color: string, detail?: string) {
    const label = STATUS_TEXT[status] ?? status
    // Reply case: detail on terminal statuses is the model/user-visible answer.
    const hasReply = detail && detail !== label
    hud.style.cssText =
      `position:fixed;bottom:56px;right:14px;z-index:${zIndex + 1};display:block;` +
      `background:#1c1c1e;color:#fff;border:1px solid ${color};border-radius:6px;` +
      `padding:6px 10px;font:12px ui-monospace,Menlo,Consolas,monospace;cursor:pointer;` +
      (hasReply ? 'max-width:420px;white-space:pre-wrap;line-height:1.4;' : 'max-width:380px;')
    hud.textContent = hasReply ? `${label}\n${detail}` : label
  }
  function hudHide(ms = 0) {
    window.setTimeout(() => {
      hud.style.display = 'none'
    }, ms)
  }

  const committed = new Map<string, CommittedEntry>()
  /** Undo stack: interactions still retractable (not yet terminal). */
  const order: string[] = []

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio
    canvas.height = window.innerHeight * devicePixelRatio
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    redraw()
  }

  function statusColor(entry: CommittedEntry): string | null {
    switch (entry.status) {
      case 'applied':
        return '#30d158'
      case 'accepted':
      case 'processing':
      case 'received':
        return '#0a84ff'
      case 'failed':
      case 'rejected':
        return '#ff453a'
      default:
        return null
    }
  }

  function redraw() {
    const w = canvas.width / devicePixelRatio
    const h = canvas.height / devicePixelRatio
    ctx.clearRect(0, 0, w, h)
    for (const [, entry] of committed) drawEntry(ctx, entry)
    if (liveStroke) strokePath(ctx, liveStroke.points, liveStroke.color, 3)
    if (drag) drawDrag(drag)
  }

  function drawEntry(target: CanvasRenderingContext2D, entry: CommittedEntry) {
    const override = statusColor(entry)
    const d = entry.data as Record<string, any>
    switch (entry.kind) {
      case 'stroke':
        for (const stroke of d.strokes as Stroke[]) {
          strokePath(target, stroke.points, override ?? stroke.color, stroke.width)
        }
        return
      case 'arrow':
        drawArrowhead(target, d.from, d.to, override ?? '#ff3b30')
        return
      case 'move':
        drawArrowhead(target, { x: d.to.x, y: d.to.y }, { x: d.to.x, y: d.to.y }, override ?? '#0a84ff')
        return
      case 'cut':
        target.strokeStyle = override ?? '#ff9f0a'
        target.setLineDash([6, 4])
        target.strokeRect(d.region.x, d.region.y, d.region.w, d.region.h)
        target.setLineDash([])
        drawArrowhead(
          target,
          { x: d.region.x + d.region.w / 2, y: d.region.y + d.region.h / 2 },
          d.to,
          override ?? '#ff9f0a',
        )
        return
      case 'note':
        target.fillStyle = override ?? '#ff3b30'
        target.fillRect(d.anchor.x - 6, d.anchor.y - 6, 12, 12)
        return
    }
  }

  function strokePath(
    target: CanvasRenderingContext2D,
    points: Array<{ x: number; y: number }>,
    c: string,
    width: number,
  ) {
    target.strokeStyle = c
    target.lineWidth = width
    target.lineCap = 'round'
    target.lineJoin = 'round'
    target.beginPath()
    points.forEach((p, i) => (i === 0 ? target.moveTo(p.x, p.y) : target.lineTo(p.x, p.y)))
    target.stroke()
  }

  function drawArrowhead(
    target: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    c: string,
  ) {
    target.strokeStyle = c
    target.lineWidth = 3
    target.beginPath()
    target.moveTo(from.x, from.y)
    target.lineTo(to.x, to.y)
    target.stroke()
    const angle = Math.atan2(to.y - from.y, to.x - from.x)
    target.beginPath()
    target.moveTo(to.x, to.y)
    target.lineTo(to.x - 12 * Math.cos(angle - Math.PI / 6), to.y - 12 * Math.sin(angle - Math.PI / 6))
    target.moveTo(to.x, to.y)
    target.lineTo(to.x - 12 * Math.cos(angle + Math.PI / 6), to.y - 12 * Math.sin(angle + Math.PI / 6))
    target.stroke()
  }

  function drawDrag(d: DragState) {
    if (d.kind === 'cut') {
      ctx.strokeStyle = '#ff9f0a'
      ctx.setLineDash([6, 4])
      const r = rectFromPoints(d)
      ctx.strokeRect(r.x, r.y, r.w, r.h)
      ctx.setLineDash([])
    } else {
      drawArrowhead(ctx, { x: d.startX, y: d.startY }, { x: d.currentX, y: d.currentY }, '#0a84ff')
    }
  }

  function emit(intent: Intent): string {
    const interactionId = makeInteractionId()
    committed.set(interactionId, {
      kind: intent.kind as OverlayMode,
      data: intent as unknown as Record<string, unknown>,
    })
    order.push(interactionId)

    // Context travels as its own screenshot/dom intents under the same
    // interaction id, published before the gesture so the session has the
    // full picture by the time the gesture arrives.
    const bounds = committedEntryBounds(intent)
    if (captureImage && bounds) {
      const image = captureMarkupImage(bounds)
      if (image) intentEnvelope(bus, source, { kind: 'screenshot', image }, interactionId)
    }
    if (captureDom) {
      intentEnvelope(bus, source, { kind: 'dom', snapshot: serializeDom(document) }, interactionId)
    }

    intentEnvelope(bus, source, intent, interactionId)
    redraw()
    return interactionId
  }

  // ---------------------------------------------------------------------------
  // Draft: drawn gesture awaiting text. The canvas layer already shows the
  // drawing; we keep the intent cached until Enter, then call emit with it.
  // ---------------------------------------------------------------------------

  interface DraftState {
    intent: Intent
    interactionId: string
  }
  let draft: DraftState | null = null

  function beginDraft(intent: Intent): string {
    const interactionId = makeInteractionId()
    committed.set(interactionId, {
      kind: intent.kind as OverlayMode,
      data: intent as unknown as Record<string, unknown>,
    })
    order.push(interactionId)
    redraw()
    draft = { intent, interactionId }
    openComposer(defaultIntentFor(draft.intent))
    return interactionId
  }

  /**
   * First-guess text for gestures whose meaning is usually obvious: the user
   * can hit Enter to take the default or type something else. Strokes/notes
   * stay blank — their intent is rarely the same twice.
   */
  function defaultIntentFor(intent: Intent): string {
    switch (intent.kind) {
      case 'move':
        return 'move this here'
      case 'cut':
        return 'move this region to the new spot'
      case 'arrow':
        return 'take what is at the start and put it at the end'
      default:
        return ''
    }
  }

  function finalizeDraft(text: string) {
    if (!draft) return
    const { intent, interactionId } = draft
    const merged: Intent =
      intent.kind === 'note'
        ? ({ ...intent, text } as Intent)
        : ({ ...intent, note: text } as Intent)
    draft = null
    commitAndEmit(interactionId, merged)
  }

  function cancelDraft() {
    if (!draft) return
    const { interactionId } = draft
    committed.delete(interactionId)
    const at = order.indexOf(interactionId)
    if (at !== -1) order.splice(at, 1)
    draft = null
    redraw()
  }

  function commitAndEmit(interactionId: string, merged: Intent): void {
    if (captureDom) {
      intentEnvelope(bus, source, { kind: 'dom', snapshot: serializeDom(document) }, interactionId)
    }
    if (captureImage) {
      const bounds = committedEntryBounds(merged)
      if (bounds) {
        const image = captureMarkupImage(bounds)
        if (image) intentEnvelope(bus, source, { kind: 'screenshot', image }, interactionId)
      }
    }
    intentEnvelope(bus, source, merged, interactionId)
  }

  function retract(id: string, reason: 'undo' | 'clear') {
    bus.publish(
      makeEnvelope({
        interactionId: id,
        source,
        kind: 'retract',
        payload: { interactionId: id, reason },
      }),
    )
  }

  function undoLast(): string | null {
    const id = order.pop()
    if (!id) return null
    committed.delete(id)
    retract(id, 'undo')
    redraw()
    return id
  }

  /**
   * Wipe every drawing from the canvas. Interactions the engine hasn't
   * finalized also get retracted (so nothing half-processed lands later);
   * applied/failed/rejected ones are just visual cleanup — un-applying edits
   * is the sink side's job.
   */
  function clearAll(): number {
    const terminal = new Set(['applied', 'failed', 'rejected', 'cancelled'])
    const entries = [...committed.entries()]
    committed.clear()
    order.splice(0, order.length)
    for (const [id, entry] of entries) {
      if (!entry.status || !terminal.has(entry.status)) retract(id, 'clear')
    }
    redraw()
    return entries.length
  }

  /** Render committed markup in a region to a PNG payload for the model. */
  function captureMarkupImage(region: { x: number; y: number; w: number; h: number }): ImagePayload | undefined {
    try {
      const off = document.createElement('canvas')
      off.width = Math.max(1, Math.round(region.w))
      off.height = Math.max(1, Math.round(region.h))
      const offCtx = off.getContext('2d')
      if (!offCtx) return undefined
      offCtx.fillStyle = 'rgba(255,255,255,0.5)'
      offCtx.fillRect(0, 0, off.width, off.height)
      offCtx.translate(-region.x, -region.y)
      for (const [, entry] of committed) drawEntry(offCtx, entry)
      const url = off.toDataURL('image/png')
      return {
        mime: 'image/png',
        data: url.slice(url.indexOf(',') + 1),
        width: off.width,
        height: off.height,
      }
    } catch {
      return undefined
    }
  }

  function refAt(x: number, y: number): ElementRef | undefined {
    const el = elementAt(x, y, interactiveSelector)
    if (!el) return undefined
    return describeElement(el) as unknown as ElementRef
  }

  // ---------------------------------------------------------------------------
  // Pointer handlers
  // ---------------------------------------------------------------------------

  captureLayer.addEventListener('pointerdown', (e) => {
    if (!armed) return
    // Without this, Chrome can start a native select/drag on mousedown and
    // kill our gesture with a pointercancel.
    e.preventDefault()
    if (mode === 'stroke' || mode === 'arrow') {
      const first = { x: e.clientX, y: e.clientY }
      const second = mode === 'arrow' ? [{ x: first.x + 0.1, y: first.y }] : []
      liveStroke = { points: [first, ...second], color }
      captureLayer.setPointerCapture(e.pointerId)
    } else if (mode === 'note') {
      openNotePrompt(e.clientX, e.clientY)
    } else if (mode === 'ask') {
      openComposer()
    } else if (mode === 'move') {
      drag = {
        kind: 'move',
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        target: elementAt(e.clientX, e.clientY, interactiveSelector),
      }
      captureLayer.setPointerCapture(e.pointerId)
    } else if (mode === 'cut') {
      drag = {
        kind: 'cut',
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        target: null,
      }
      captureLayer.setPointerCapture(e.pointerId)
    }
    redraw()
  })

  captureLayer.addEventListener('pointermove', (e) => {
    if (!armed) return
    if (liveStroke && mode === 'arrow') {
      const first = liveStroke.points[0]
      if (first) liveStroke.points = [first, { x: e.clientX, y: e.clientY }]
      redraw()
    } else if (liveStroke && mode === 'stroke') {
      liveStroke.points.push({ x: e.clientX, y: e.clientY })
      redraw()
    } else if (drag) {
      drag.currentX = e.clientX
      drag.currentY = e.clientY
      redraw()
    }
  })

  // If the browser steals a gesture (pointercancel), drop the in-flight
  // state so the NEXT gesture starts clean instead of wedging.
  captureLayer.addEventListener('pointercancel', () => {
    liveStroke = null
    drag = null
    redraw()
  })

  captureLayer.addEventListener('pointerup', (e) => {
    if (!armed) return
    if (captureLayer.hasPointerCapture?.(e.pointerId)) {
      captureLayer.releasePointerCapture(e.pointerId)
    }
    if (liveStroke) {
      const points = liveStroke.points
      const first = points[0]
      if (mode === 'stroke' && first && points.length > 1) {
        beginDraft({
          kind: 'stroke',
          strokes: [{ points, color: liveStroke.color, width: 3 }],
          bounds: boundsOf(points),
          element: refAt(first.x, first.y),
        } as Intent)
      } else if (mode === 'arrow' && first && points[1] && dist(first, points[1]) > MIN_DRAG_DISTANCE) {
        beginDraft({
          kind: 'arrow',
          from: first,
          to: points[1],
          fromElement: refAt(first.x, first.y),
          toElement: refAt(points[1].x, points[1].y),
        } as Intent)
      }
      liveStroke = null
    } else if (drag) {
      const traveled = dist(
        { x: drag.startX, y: drag.startY },
        { x: drag.currentX, y: drag.currentY },
      )
      if (drag.kind === 'move' && drag.target && traveled > MIN_DRAG_DISTANCE) {
        beginDraft({
          kind: 'move',
          target: describeElement(drag.target) as unknown as ElementRef,
          to: { x: drag.currentX, y: drag.currentY },
        } as Intent)
      } else if (drag.kind === 'cut') {
        const region = rectFromPoints(drag)
        if (region.w > MIN_DRAG_DISTANCE && region.h > MIN_DRAG_DISTANCE) {
          beginDraft({
            kind: 'cut',
            region,
            to: { x: drag.currentX, y: drag.currentY },
            image: captureMarkupImage(region),
          } as Intent)
        }
      }
      drag = null
    }
    redraw()
  })

  function openNotePrompt(x: number, y: number) {
    beginDraft(
      {
        kind: 'note',
        text: '',
        anchor: { x, y },
        element: refAt(x, y),
      } as Intent,
    )
  }

  // ---- Composer: free-text finalized (draft) or ask raw (no drawing) ----
  const composer = document.createElement('div')
  composer.dataset.maOverlay = ''
  composer.style.cssText =
    `position:fixed;bottom:14px;left:14px;z-index:${zIndex + 1};display:none;` +
    'background:#1c1c1e;border:1px solid #3a3a3c;border-radius:6px;padding:6px;' +
    'display:flex;gap:6px;align-items:center;'

  const composerInput = document.createElement('input')
  composerInput.placeholder = 'what should I do? (Enter • Esc)'
  composerInput.style.cssText =
    'background:#0d0d0f;color:#fff;border:0;outline:none;padding:6px 8px;width:340px;' +
    'font:13px ui-monospace,Menlo,Consolas,monospace;'
  composer.appendChild(composerInput)

  document.body.appendChild(composer)

  function openComposer(prefill = '') {
    composer.style.display = 'flex'
    composerInput.placeholder = draft ? 'what should I do? (Enter • Esc)' : 'ask anything…'
    composerInput.value = prefill
    // Select prefill text so typing replaces it, Enter keeps it.
    setTimeout(() => {
      composerInput.focus()
      if (prefill) composerInput.select()
    }, 0)
  }
  function closeComposer() {
    composer.style.display = 'none'
    composerInput.value = ''
  }

  composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = composerInput.value.trim()
      closeComposer()
      if (draft) {
        finalizeDraft(text)
      } else if (text) {
        // A pure question: emit as a note with no anchor element.
        emit({ kind: 'note', text, anchor: { x: 16, y: 16 } } as Intent)
      }
      e.preventDefault()
    } else if (e.key === 'Escape') {
      closeComposer()
      cancelDraft()
      e.preventDefault()
    }
  })

  // ---------------------------------------------------------------------------
  // Status feedback: recolor committed markup as the engine works
  // ---------------------------------------------------------------------------

  const offBus = bus.subscribe((envelope) => {
    if (envelope.kind !== 'status') return
    const payload = envelope.payload as { interactionId?: string; state?: string; detail?: string }
    if (!payload.interactionId || typeof payload.state !== 'string') return
    const entry = committed.get(payload.interactionId)
    if (!entry) return
    entry.status = payload.state
    // Recolor the canvas entry and show the HUD in step with the chain.
    hudShow(payload.state, statusColor(entry) ?? '#8e8e93', payload.detail)
    // Once the engine is done with an interaction, retracting it can't
    // un-apply anything, so drop it from the undo stack.
    if (['applied', 'failed', 'rejected', 'cancelled'].includes(payload.state)) {
      const at = order.indexOf(payload.interactionId)
      if (at !== -1) order.splice(at, 1)
    }
    // On 'applied' the change is real (source written / DOM updated) — flash
    // green, then remove the snapped layer so the canvas reflects the source,
    // not a stale drawing. Failures stay visible so you see what didn't land.
    if (payload.state === 'applied') {
      const id = payload.interactionId
      window.setTimeout(() => {
        committed.delete(id)
        redraw()
        hudHide()
      }, APPLIED_FLASH_MS)
    }
    redraw()
  })

  // ---------------------------------------------------------------------------
  // Hotkey arming + visibility
  // ---------------------------------------------------------------------------

  function matchesHotkey(e: KeyboardEvent): boolean {
    // A 'ctrl' spec is the "primary modifier": matches Ctrl on Windows/Linux
    // or Cmd on mac. An explicit 'meta/cmd' spec restricts to Cmd.
    const primary = e.ctrlKey || e.metaKey
    const wantsPrimary = !!hotkey.ctrl || !!hotkey.meta
    return (
      e.key.toLowerCase() === hotkey.key.toLowerCase() &&
      primary === wantsPrimary &&
      !!e.shiftKey === !!hotkey.shift
    )
  }

  function onKeyDown(e: KeyboardEvent) {
    if (armed && e.key === 'Escape') {
      disarm()
      return
    }
    if (armed && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      undoLast()
      return
    }
    if (armed && (e.ctrlKey || e.metaKey) && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault()
      clearAll()
      return
    }
    if (!matchesHotkey(e)) return
    e.preventDefault()
    if (armed) disarm()
    else arm()
  }

  function arm() {
    armed = true
    canvas.style.display = 'block'
    captureLayer.style.display = 'block'
    toolbar.style.display = 'flex'
    resize()
    updateToggle()
  }

  function disarm() {
    armed = false
    liveStroke = null
    drag = null
    canvas.style.display = 'none'
    captureLayer.style.display = 'none'
    toolbar.style.display = 'none'
    updateToggle()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', resize)

  const api: OverlayHandle = {
    detach() {
      if (detached) return
      detached = true
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', resize)
      offBus()
      canvas.remove()
      toolbar.remove()
      captureLayer.remove()
      hud.remove()
      composer.remove()
      toggle?.remove()
    },
    setMode(next) {
      mode = next
      highlightToolbar(toolbar, next)
    },
    getMode() {
      return mode
    },
    isArmed() {
      return armed
    },
    undoLast,
    clearAll,
    pendingCount() {
      return order.length
    },
    arm,
    disarm,
  }
  return api
}

/** Region to capture for a gesture, so vision models get a bounded image. */
function committedEntryBounds(intent: Intent): { x: number; y: number; w: number; h: number } | null {
  switch (intent.kind) {
    case 'stroke':
      return pad(intent.bounds)
    case 'note':
      return pad({ x: intent.anchor.x, y: intent.anchor.y, w: 1, h: 1 })
    case 'arrow':
      return pad(boundsOf([intent.from, intent.to]))
    case 'move':
      return pad({ x: intent.target.rect.x, y: intent.target.rect.y, w: intent.target.rect.w, h: intent.target.rect.h })
    case 'cut':
      return pad(intent.region)
    default:
      return null
  }
}

/** Grow a region by a margin so the capture includes surrounding context. */
function pad(r: { x: number; y: number; w: number; h: number }, margin = 60) {
  const x = Math.max(0, r.x - margin)
  const y = Math.max(0, r.y - margin)
  return { x, y, w: r.w + margin * 2, h: r.h + margin * 2 }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function boundsOf(points: Array<{ x: number; y: number }>) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function rectFromPoints(d: {
  startX: number
  startY: number
  currentX: number
  currentY: number
}) {
  const x = Math.min(d.startX, d.currentX)
  const y = Math.min(d.startY, d.currentY)
  return { x, y, w: Math.abs(d.currentX - d.startX), h: Math.abs(d.currentY - d.startY) }
}
