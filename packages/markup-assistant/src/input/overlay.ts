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

  // Interaction capture layer: full-page transparent div with pointer events.
  const captureLayer = document.createElement('div')
  captureLayer.dataset.maOverlay = ''
  captureLayer.style.cssText =
    `position:fixed;inset:0;z-index:${zIndex + 1};display:none;` +
    'background:transparent;cursor:crosshair;touch-action:none;user-select:none;' +
    '-webkit-user-select:none;'
  captureLayer.addEventListener('dragstart', (e) => e.preventDefault())
  document.body.appendChild(captureLayer)

  // ---------------------------------------------------------------------------
  // Floating control + expanded panel: one small orb bottom-right; click opens
  // the modal with the toolbar on top and a chat thread + composer below.
  // ---------------------------------------------------------------------------

  let panelOpen = false
  let panelPos: { x: number; y: number } | null = null

  // Floating orb — the always-visible entry point.
  let toggle: HTMLButtonElement | null = null
  if (showToggle) {
    toggle = document.createElement('button')
    toggle.dataset.maOverlay = ''
    toggle.type = 'button'
    toggle.textContent = '✎'
    toggle.title = 'markup'
    toggle.setAttribute('aria-pressed', 'false')
    toggle.style.cssText =
      `position:fixed;bottom:16px;right:16px;z-index:${zIndex + 2};` +
      'width:44px;height:44px;border-radius:50%;border:1px solid #3a3a3c;' +
      'background:#1c1c1e;color:#fff;font-size:18px;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center;' +
      'box-shadow:0 2px 12px rgba(0,0,0,0.4);'
    document.body.appendChild(toggle)
    toggle.addEventListener('click', () => {
      if (panelOpen) closePanel()
      else openPanel()
    })
  }

  // The panel: header-drag, toolbar row, chat thread, composer.
  const panel = document.createElement('div')
  panel.dataset.maOverlay = ''
  panel.style.cssText =
    `position:fixed;z-index:${zIndex + 2};display:none;` +
    'background:#161618;border:1px solid #3a3a3c;border-radius:12px;' +
    'width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.5);overflow:hidden;' +
    'font:13px ui-monospace,Menlo,Consolas,monospace;color:#eee;'
  document.body.appendChild(panel)

  // Header: drag handle + title + close.
  const panelHeader = document.createElement('div')
  panelHeader.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;' +
    'padding:8px 12px;background:#1c1c1e;border-bottom:1px solid #2c2c2e;' +
    'cursor:move;user-select:none;'
  const panelTitle = document.createElement('span')
  panelTitle.textContent = 'markup'
  panelTitle.style.cssText = 'font-weight:600;font-size:12px;letter-spacing:0.4px;'
  const panelClose = document.createElement('button')
  panelClose.textContent = '✕'
  panelClose.style.cssText =
    'background:transparent;border:0;color:#8e8e93;cursor:pointer;font-size:14px;padding:0 4px;'
  panelClose.addEventListener('click', () => closePanel())
  panelHeader.appendChild(panelTitle)
  panelHeader.appendChild(panelClose)
  panel.appendChild(panelHeader)

  // Toolbar row.
  const toolbar = buildToolbar(mode, {
    onSelect: (m) => api.setMode(m),
    onUndo: () => undoLast(),
    onClear: () => clearAll(),
  })
  toolbar.style.position = 'static'
  toolbar.style.borderRadius = '0'
  toolbar.style.padding = '6px 10px'
  toolbar.style.background = 'transparent'
  toolbar.style.borderBottom = '1px solid #2c2c2e'
  toolbar.style.flexWrap = 'wrap'
  panel.appendChild(toolbar)
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

  // Chat thread.
  const chat = document.createElement('div')
  chat.style.cssText =
    'max-height:300px;overflow-y:auto;padding:10px 12px;display:flex;' +
    'flex-direction:column;gap:8px;'
  panel.appendChild(chat)

  const chatEmpty = document.createElement('div')
  chatEmpty.textContent = 'mark up the page, or ask anything below.'
  chatEmpty.style.cssText = 'color:#636366;font-size:12px;padding:8px 0;text-align:center;'
  chat.appendChild(chatEmpty)

  function chatAdd(role: 'user' | 'model', text: string, status?: string) {
    if (chatEmpty.parentNode) chatEmpty.remove()
    const bubble = document.createElement('div')
    const mine = role === 'user'
    const statusColor =
      status === 'applied' ? '#30d158' :
      status === 'answered' ? '#30d158' :
      status === 'failed' || status === 'rejected' ? '#ff453a' :
      status === 'processing' ? '#0a84ff' : '#8e8e93'
    bubble.style.cssText =
      `align-self:${mine ? 'flex-end' : 'flex-start'};max-width:85%;` +
      `background:${mine ? '#0a84ff' : '#2c2c2e'};color:#fff;border-radius:10px;` +
      'padding:7px 11px;font-size:12px;line-height:1.4;white-space:pre-wrap;' +
      (status && !mine ? `border-left:2px solid ${statusColor};` : '')
    bubble.textContent = text
    chat.appendChild(bubble)
    chat.scrollTop = chat.scrollHeight
    return bubble
  }

  function chatUpdate(bubble: HTMLElement, status: string, detail?: string, edits?: unknown[]) {
    const statusColor =
      status === 'applied' ? '#30d158' :
      status === 'answered' ? '#30d158' :
      status === 'failed' || status === 'rejected' ? '#ff453a' :
      status === 'processing' ? '#0a84ff' : '#8e8e93'
    bubble.style.borderLeft = `2px solid ${statusColor}`
    // The reply line is the whole point of the bubble — replace the
    // 'processing…' placeholder with the terminal text. For an answer, the
    // detail IS the reply, so show it verbatim; other statuses lead with
    // their label.
    const reply =
      status === 'answered' && detail
        ? detail
        : `${STATUS_TEXT[status] ?? status}${detail ? ` — ${detail}` : ''}`
    bubble.textContent = reply
    // An applied interaction must show WHAT changed and WHERE: "2 edit(s)
    // applied" with no per-file detail is a black box — the user cannot tell
    // whether their card turned blue or some other file silently changed.
    if (edits?.length) {
      const block = document.createElement('div')
      block.style.cssText =
        'margin-top:6px;padding:6px 8px;background:#111;border:1px solid #3a3a3c;' +
        'border-radius:6px;font-family:ui-monospace,Menlo,Consolas,monospace;' +
        'font-size:10px;line-height:1.5;color:#c7c7cc;white-space:pre-wrap;word-break:break-all;'
      for (const e of edits as Array<{ kind?: string; file?: string; find?: string; replace?: string; description?: string }>) {
        const row = document.createElement('div')
        const file = document.createElement('div')
        file.style.cssText = 'color:#30d158;font-weight:600;margin-bottom:2px;'
        file.textContent = `✎ ${e.file ?? '(unknown file)'}`
        row.appendChild(file)
        if (e.description) {
          const d = document.createElement('div')
          d.style.cssText = 'color:#8e8e93;margin-bottom:2px;'
          d.textContent = e.description
          row.appendChild(d)
        }
        if (e.find != null || e.replace != null) {
          const diff = document.createElement('div')
          const f = document.createElement('div')
          f.style.cssText = 'color:#ff6961;'
          f.textContent = `- ${(e.find ?? '').replace(/\s+/g, ' ').slice(0, 120)}`
          const r = document.createElement('div')
          r.style.cssText = 'color:#7dffb0;'
          r.textContent = `+ ${(e.replace ?? '').replace(/\s+/g, ' ').slice(0, 120)}`
          diff.appendChild(f)
          diff.appendChild(r)
          row.appendChild(diff)
        }
        block.appendChild(row)
      }
      bubble.appendChild(block)
    }
  }

  // Composer row at the panel bottom.
  const composer = document.createElement('div')
  composer.dataset.maOverlay = ''
  composer.style.cssText =
    'display:flex;gap:6px;padding:8px 10px;border-top:1px solid #2c2c2e;' +
    'background:#1c1c1e;align-items:center;'
  const composerInput = document.createElement('input')
  composerInput.placeholder = 'ask anything…'
  composerInput.style.cssText =
    'flex:1;background:#0d0d0f;color:#fff;border:0;outline:none;padding:7px 10px;' +
    'border-radius:6px;font:13px ui-monospace,Menlo,Consolas,monospace;'
  composer.appendChild(composerInput)
  panel.appendChild(composer)

  // Panel drag (header only).
  let panelDrag: { dx: number; dy: number } | null = null
  panelHeader.addEventListener('pointerdown', (e) => {
    const r = panel.getBoundingClientRect()
    panelDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    panelHeader.setPointerCapture(e.pointerId)
  })
  panelHeader.addEventListener('pointermove', (e) => {
    if (!panelDrag) return
    panel.style.left = `${e.clientX - panelDrag.dx}px`
    panel.style.top = `${e.clientY - panelDrag.dy}px`
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
  })
  panelHeader.addEventListener('pointerup', () => {
    panelDrag = null
  })

  function positionPanel() {
    if (panelPos) {
      panel.style.left = `${panelPos.x}px`
      panel.style.top = `${panelPos.y}px`
    } else {
      panel.style.right = '16px'
      panel.style.bottom = '72px'
    }
  }

  function openPanel() {
    panelOpen = true
    armed = true
    positionPanel()
    panel.style.display = 'block'
    canvas.style.display = 'block'
    captureLayer.style.display = 'block'
    resize()
    updateToggle()
    setTimeout(() => composerInput.focus(), 0)
  }
  function closePanel() {
    panelOpen = false
    armed = false
    liveStroke = null
    drag = null
    panel.style.display = 'none'
    canvas.style.display = 'none'
    captureLayer.style.display = 'none'
    cancelDraft()
    updateToggle()
  }

  function updateToggle() {
    if (!toggle) return
    toggle.setAttribute('aria-pressed', panelOpen ? 'true' : 'false')
    toggle.style.background = panelOpen ? '#0a84ff' : '#1c1c1e'
  }

  const STATUS_TEXT: Record<string, string> = {
    received: 'received',
    accepted: 'accepted',
    processing: '🧠 thinking…',
    applied: '✔ applied',
    answered: '💬 answered',
    failed: '✖ failed',
    rejected: '✖ rejected',
    cancelled: '✕ cancelled',
  }

  // Per-interaction chat bubble so status updates find their row.
  const chatByInteraction = new Map<string, HTMLElement>()

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
      case 'answered':
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
      intentEnvelope(bus, source, { kind: 'dom', snapshot: serializeDom(document, 20000, bounds ?? undefined) }, interactionId)
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
    const gestureBounds = committedEntryBounds(merged)
    if (captureDom) {
      intentEnvelope(bus, source, { kind: 'dom', snapshot: serializeDom(document, 20000, gestureBounds ?? undefined) }, interactionId)
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
    const terminal = new Set(['applied', 'answered', 'failed', 'rejected', 'cancelled'])
    const entries = [...committed.entries()]
    committed.clear()
    order.splice(0, order.length)
    for (const [id, entry] of entries) {
      if (!entry.status || !terminal.has(entry.status)) retract(id, 'clear')
    }
    // A wiped canvas is a new sheet: drop the engine's carried-over
    // conversation so the next question starts fresh.
    bus.publish(
      makeEnvelope({
        interactionId: 'conversation',
        source,
        kind: 'reset',
        payload: {},
      }),
    )
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

  function openComposer(prefill = '') {
    if (!panelOpen) openPanel()
    composerInput.placeholder = draft ? 'what should I do? (Enter • Esc)' : 'ask anything…'
    composerInput.value = prefill
    setTimeout(() => {
      composerInput.focus()
      if (prefill) composerInput.select()
    }, 0)
  }
  function closeComposer() {
    composerInput.value = ''
    composerInput.placeholder = 'ask anything…'
  }

  composerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = composerInput.value.trim()
      if (draft) {
        // Capture the id BEFORE finalizeDraft clears it.
        const intentText = text
        finalizeDraft(text)
        closeComposer()
        if (intentText) chatAdd('user', intentText)
      } else if (text) {
        closeComposer()
        emit({ kind: 'note', text, anchor: { x: 16, y: 16 } } as Intent)
        chatAdd('user', text)
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
    const payload = envelope.payload as { interactionId?: string; state?: string; detail?: string; edits?: unknown[] }
    if (!payload.interactionId || typeof payload.state !== 'string') return
    const entry = committed.get(payload.interactionId)
    if (!entry) return
    entry.status = payload.state
    // The model's reply is always its OWN bubble (never appended to the
    // user's). Intermediate states get one 'processing' bubble that later
    // terminal states update in place, so the thread reads: user → model.
    if (payload.state === 'processing') {
      if (!chatByInteraction.has(payload.interactionId)) {
        const b = chatAdd('model', STATUS_TEXT.processing, 'processing')
        chatByInteraction.set(payload.interactionId, b)
      }
    } else if (['applied', 'answered', 'failed', 'rejected'].includes(payload.state)) {
      let bubble = chatByInteraction.get(payload.interactionId)
      if (!bubble) {
        bubble = chatAdd('model', STATUS_TEXT[payload.state] ?? payload.state, payload.state)
        chatByInteraction.set(payload.interactionId, bubble)
      }
      chatUpdate(bubble, payload.state, payload.detail, payload.edits)
    }
    // Once the engine is done with an interaction, retracting it can't
    // un-apply anything, so drop it from the undo stack.
    if (['applied', 'answered', 'failed', 'rejected', 'cancelled'].includes(payload.state)) {
      const at = order.indexOf(payload.interactionId)
      if (at !== -1) order.splice(at, 1)
    }
    // On 'applied' or 'answered' the interaction is complete — flash, then
    // clear the markup. (answered: nothing changed, but the question is done.)
    if (payload.state === 'applied' || payload.state === 'answered') {
      const id = payload.interactionId
      window.setTimeout(() => {
        committed.delete(id)
        redraw()
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
    openPanel()
  }

  function disarm() {
    closePanel()
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
      captureLayer.remove()
      panel.remove()
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
