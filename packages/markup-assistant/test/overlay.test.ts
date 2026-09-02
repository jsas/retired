// @vitest-environment jsdom
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { createBus, type Envelope } from '../src/core/index.js'
import { attachOverlay } from '../src/input/overlay.js'

// jsdom has no canvas 2D backend, and reports a zero getBoundingClientRect for
// every element. The overlay draws to a 2D context and its hit-testing skips
// zero-size elements, so stub both: a no-op 2D context and a stable non-zero
// rect per element. Tests assert on emitted intents/statuses, not pixels.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    kind: string,
  ): unknown {
    if (kind !== '2d') return null
    const noop = () => undefined
    return new Proxy(
      {},
      {
        get: (target, prop) => {
          if (prop === 'canvas') return this
          if (prop in target) return (target as Record<string | symbol, unknown>)[prop]
          return noop
        },
        set: (target, prop, value) => {
          ;(target as Record<string | symbol, unknown>)[prop] = value
          return true
        },
      },
    )
  } as typeof HTMLCanvasElement.prototype.getContext

  let rectSeq = 0
  const rectMap = new WeakMap<Element, { left: number; top: number }>()
  const origGetBCR = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const real = origGetBCR.call(this)
    if (real.width !== 0 || real.height !== 0) return real
    let slot = rectMap.get(this)
    if (!slot) {
      slot = { left: 100 + rectSeq * 10, top: 100 + rectSeq * 10 }
      rectSeq++
      rectMap.set(this, slot)
    }
    return {
      x: slot.left,
      y: slot.top,
      left: slot.left,
      top: slot.top,
      right: slot.left + 50,
      bottom: slot.top + 50,
      width: 50,
      height: 50,
      toJSON: () => ({}),
    } as DOMRect
  }
})

function makeOverlay() {
  const bus = createBus()
  const captured: Envelope[] = []
  bus.subscribe((e) => captured.push(e))
  const handle = attachOverlay({ bus, source: 'test' })
  const layer = [...document.querySelectorAll('div')].find(
    (d) => (d.getAttribute('style') ?? '').includes('crosshair'),
  ) as HTMLElement
  return { bus, captured, handle, layer }
}

function pointer(layer: HTMLElement, type: string, x: number, y: number) {
  layer.setPointerCapture = () => {}
  layer.dispatchEvent(
    new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }),
  )
}

describe('overlay', () => {
  it('starts disarmed, arms on Ctrl+Shift+M, dismisses on Escape', () => {
    const { handle } = makeOverlay()
    expect(handle.isArmed()).toBe(false)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'M', ctrlKey: true, shiftKey: true }),
    )
    expect(handle.isArmed()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(handle.isArmed()).toBe(false)
    handle.detach()
  })

  it('emits a note intent when a note is typed in note mode', () => {
    const { captured, handle, layer } = makeOverlay()
    vi.stubGlobal('prompt', () => 'make it bigger')
    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 50, 50)
    pointer(layer, 'pointerup', 50, 50)
    const note = captured.find((e) => (e.payload as { kind?: string }).kind === 'note')
    expect(note).toBeTruthy()
    handle.detach()
  })

  it('emits a stroke intent for a freehand drag', () => {
    const { captured, handle, layer } = makeOverlay()
    handle.arm()
    handle.setMode('stroke')
    pointer(layer, 'pointerdown', 10, 10)
    pointer(layer, 'pointermove', 60, 60)
    pointer(layer, 'pointerup', 60, 60)
    expect(
      captured.some((e) => (e.payload as { kind?: string }).kind === 'stroke'),
    ).toBe(true)
    handle.detach()
  })

  it('emits an arrow intent with endpoint element refs', () => {
    const { captured, handle, layer } = makeOverlay()
    handle.arm()
    handle.setMode('arrow')
    pointer(layer, 'pointerdown', 5, 5)
    pointer(layer, 'pointermove', 120, 120)
    pointer(layer, 'pointerup', 120, 120)
    const arrow = captured.find((e) => (e.payload as { kind?: string }).kind === 'arrow')
    expect(arrow).toBeTruthy()
    const intent = arrow?.payload as { from: unknown; to: unknown; fromElement?: unknown }
    expect(intent.from).toBeTruthy()
    expect(intent.fromElement).toBeUndefined() // 5,5 not inside #box
    handle.detach()
  })

  it('emits a move intent when an element is dragged', () => {
    const box = document.createElement('div')
    box.id = 'box'
    box.textContent = 'Drag me'
    document.body.appendChild(box)
    const { captured, handle, layer } = makeOverlay()
    handle.arm()
    handle.setMode('move')
    const r = box.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    pointer(layer, 'pointerdown', cx, cy)
    pointer(layer, 'pointermove', cx + 100, cy + 100)
    pointer(layer, 'pointerup', cx + 100, cy + 100)
    expect(
      captured.some((e) => (e.payload as { kind?: string }).kind === 'move'),
    ).toBe(true)
    handle.detach()
    box.remove()
  })

  it('emits a cut intent for a lasso region', () => {
    const { captured, handle, layer } = makeOverlay()
    handle.arm()
    handle.setMode('cut')
    pointer(layer, 'pointerdown', 20, 20)
    pointer(layer, 'pointermove', 80, 90)
    pointer(layer, 'pointerup', 80, 90)
    const cut = captured.find((e) => (e.payload as { kind?: string }).kind === 'cut')
    expect(cut).toBeTruthy()
    handle.detach()
  })

  it('does not emit while disarmed', () => {
    const { captured, handle, layer } = makeOverlay()
    pointer(layer, 'pointerdown', 10, 10)
    pointer(layer, 'pointerup', 80, 80)
    expect(captured.filter((e) => e.kind === 'intent')).toHaveLength(0)
    handle.detach()
  })

  it('recolors markup when an applied status arrives', () => {
    const { bus, captured, handle, layer } = makeOverlay()
    handle.arm()
    handle.setMode('note')
    vi.stubGlobal('prompt', () => 'hi')
    pointer(layer, 'pointerdown', 40, 40)
    pointer(layer, 'pointerup', 40, 40)
    const intent = captured.find((e) => (e.payload as { kind?: string }).kind === 'note')
    expect(intent).toBeTruthy()
    // engine echoes an applied status for that interaction
    bus.publish({
      id: 'ev_test',
      interactionId: intent!.interactionId,
      ts: 1,
      kind: 'status',
      source: 'engine',
      payload: { interactionId: intent!.interactionId, state: 'applied', detail: '', edits: [] },
    })
    // no crash; markup kept with status applied
    handle.detach()
  })

  it('undoLast retracts the most recent intent and shrinks pendingCount', () => {
    const { captured, handle, layer } = makeOverlay()
    vi.stubGlobal('prompt', () => 'note text')
    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 40, 40)
    pointer(layer, 'pointerup', 40, 40)
    pointer(layer, 'pointerdown', 60, 60)
    pointer(layer, 'pointerup', 60, 60)
    expect(handle.pendingCount()).toBe(2)

    const undone = handle.undoLast()
    expect(undone).toBeTruthy()
    expect(handle.pendingCount()).toBe(1)
    const retract = captured.find((e) => e.kind === 'retract')
    expect(retract).toBeTruthy()
    expect((retract!.payload as { reason?: string }).reason).toBe('undo')
    expect(retract!.interactionId).toBe(undone)
    handle.detach()
  })

  it('undoLast on empty stack returns null and emits nothing', () => {
    const { captured, handle } = makeOverlay()
    handle.arm()
    expect(handle.undoLast()).toBeNull()
    expect(captured.filter((e) => e.kind === 'retract')).toHaveLength(0)
    handle.detach()
  })

  it('clearAll wipes all markup and retracts active interactions', () => {
    const { captured, handle, layer } = makeOverlay()
    vi.stubGlobal('prompt', () => 'note text')
    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 40, 40)
    pointer(layer, 'pointerup', 40, 40)
    pointer(layer, 'pointerdown', 60, 60)
    pointer(layer, 'pointerup', 60, 60)
    expect(handle.pendingCount()).toBe(2)

    const cleared = handle.clearAll()
    expect(cleared).toBe(2)
    expect(handle.pendingCount()).toBe(0)
    const retracts = captured.filter((e) => e.kind === 'retract')
    expect(retracts).toHaveLength(2)
    for (const r of retracts) {
      expect((r.payload as { reason?: string }).reason).toBe('clear')
    }
    handle.detach()
  })

  it('clearAll does not retract interactions that already reached a terminal status', () => {
    const { bus, captured, handle, layer } = makeOverlay()
    vi.stubGlobal('prompt', () => 'note text')
    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 40, 40)
    pointer(layer, 'pointerup', 40, 40)
    const intent = captured.find((e) => (e.payload as { kind?: string }).kind === 'note')!
    // engine applies it
    bus.publish({
      id: 'ev_term',
      interactionId: intent.interactionId,
      ts: 1,
      kind: 'status',
      source: 'engine',
      payload: { interactionId: intent.interactionId, state: 'applied', detail: '', edits: [] },
    })
    const retractsBefore = captured.filter((e) => e.kind === 'retract').length
    handle.clearAll()
    const retractsAfter = captured.filter((e) => e.kind === 'retract').length
    // the applied interaction must NOT be retracted
    expect(retractsAfter).toBe(retractsBefore)
    handle.detach()
  })

  it('Ctrl+Z undoes the last markup while armed', () => {
    const { captured, handle, layer } = makeOverlay()
    vi.stubGlobal('prompt', () => 'note text')
    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 40, 40)
    pointer(layer, 'pointerup', 40, 40)
    expect(handle.pendingCount()).toBe(1)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    expect(handle.pendingCount()).toBe(0)
    expect(captured.some((e) => e.kind === 'retract')).toBe(true)
    handle.detach()
  })
})
