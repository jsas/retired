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

/** After a gesture is drawn, type a note in the composer and press Enter. */
function commitComposer(text: string) {
  const input = document.querySelector('div[data-ma-overlay] input') as HTMLInputElement
  if (!input) throw new Error('composer not open')
  input.value = text
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
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

  it('ctrl spec on mac matches the Cmd modifier (primary modifier union)', () => {
    const { handle } = makeOverlay()
    expect(handle.isArmed()).toBe(false)
    // 'ctrl+shift+m' set; mac user presses Cmd+Shift+M — treated as the same.
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'M', metaKey: true, shiftKey: true }),
    )
    expect(handle.isArmed()).toBe(true)
    handle.detach()
  })

  it('a bare letter (no modifier) does not arm', () => {
    const { handle } = makeOverlay()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M' }))
    expect(handle.isArmed()).toBe(false)
    handle.detach()
  })

  it('arms + disarms via the corner toggle button', () => {
    const { handle } = makeOverlay()
    const toggle = [...document.querySelectorAll('button[data-ma-overlay]')].find(
      (b) => (b as HTMLButtonElement).textContent === 'markup',
    ) as HTMLButtonElement
    expect(toggle).toBeTruthy()
    expect(handle.isArmed()).toBe(false)
    toggle.click()
    expect(handle.isArmed()).toBe(true)
    expect(toggle.textContent).toBe('markup ✕')
    toggle.click()
    expect(handle.isArmed()).toBe(false)
    handle.detach()
  })

  it('showToggle:false makes no corner button', () => {
    const bus = createBus()
    const handle = attachOverlay({ bus, source: 'test', showToggle: false })
    const toggle = [...document.querySelectorAll('button[data-ma-overlay]')].find(
      (b) => (b as HTMLButtonElement).textContent === 'markup',
    )
    expect(toggle).toBeUndefined()
    handle.detach()
  })

  it('ask mode opens the composer and Enter emits the note', () => {
    const { captured, handle, layer } = makeOverlay()
    handle.arm()
    handle.setMode('ask')
    pointer(layer, 'pointerdown', 50, 50)
    const input = document.querySelector('div[data-ma-overlay] input') as HTMLInputElement
    expect(input).toBeTruthy()
    input.value = 'what does headcount mean?'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    const note = captured.find((e) => (e.payload as { kind?: string }).kind === 'note')
    expect(note).toBeTruthy()
    handle.detach()
  })

  it('Esc in the composer closes without emitting', () => {
    const { captured, handle, layer } = makeOverlay()
    handle.arm()
    handle.setMode('ask')
    pointer(layer, 'pointerdown', 50, 50)
    const input = document.querySelector('div[data-ma-overlay] input') as HTMLInputElement
    input.value = 'dropped'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(captured.filter((e) => e.kind === 'intent')).toHaveLength(0)
    handle.detach()
  })

  it('emits a note intent when a note is typed in note mode', () => {
    const { captured, handle, layer } = makeOverlay()

    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 50, 50)
    pointer(layer, 'pointerup', 50, 50)
    commitComposer('make it bigger')
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
    commitComposer('add margin here')
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
    commitComposer('route there')
    const arrow = captured.find((e) => (e.payload as { kind?: string }).kind === 'arrow')
    expect(arrow).toBeTruthy()
    const intent = arrow?.payload as { from: unknown; to: unknown; fromElement?: unknown }
    expect(intent.from).toBeTruthy()
    expect(intent.fromElement).toBeUndefined() // 5,5 not inside #box
    handle.detach()
  })

  it('prefills "move this here" in the composer for a move gesture', () => {
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
    // Composer opens with the default text already selected; Enter keeps it.
    const input = document.querySelector('div[data-ma-overlay] input') as HTMLInputElement
    expect(input.value).toBe('move this here')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    const move = captured.find((e) => (e.payload as { kind?: string }).kind === 'move')
    expect((move?.payload as { note?: string }).note).toBe('move this here')
    handle.detach()
    box.remove()
  })

  it('emits a move intent when an element is dragged + the note is set', () => {
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
    commitComposer('move it down')
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
    commitComposer('crop to this')
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

  it('flashes applied then clears the markup (snapped layer removed)', () => {
    vi.useFakeTimers()
    try {
      const { bus, captured, handle, layer } = makeOverlay()
      handle.arm()
      handle.setMode('note')
      pointer(layer, 'pointerdown', 40, 40)
      pointer(layer, 'pointerup', 40, 40)
      commitComposer('hi')
      const intent = captured.find((e) => (e.payload as { kind?: string }).kind === 'note')
      expect(intent).toBeTruthy()
      bus.publish({
        id: 'ev_test',
        interactionId: intent!.interactionId,
        ts: 1,
        kind: 'status',
        source: 'engine',
        payload: { interactionId: intent!.interactionId, state: 'applied', detail: '', edits: [] },
      })
      // After the flash window, the committed entry is gone (canvas would've redrawn).
      vi.advanceTimersByTime(1200)
      expect(handle.pendingCount()).toBe(0)
      handle.detach()
    } finally {
      vi.useRealTimers()
    }
  })

  it("surfaces terminal detail in the HUD (the model's reply text)", () => {
    const { bus, captured, handle, layer } = makeOverlay()
    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 40, 40)
    pointer(layer, 'pointerup', 40, 40)
    commitComposer('why is this here?')
    const intent = captured.find(
      (e) => (e.payload as { kind?: string }).kind === 'note',
    )!
    bus.publish({
      id: 'ev_reject',
      interactionId: intent.interactionId,
      ts: 1,
      kind: 'status',
      source: 'engine',
      payload: {
        interactionId: intent.interactionId,
        state: 'rejected',
        detail: 'the underline points at <h2> but nothing actionable — what should I change?',
        edits: [],
      },
    })
    // HUD is the overlay-owned div at bottom-right with the status pill.
    const overlays = [...document.querySelectorAll('div[data-ma-overlay]')] as HTMLElement[]
    const hud = overlays.find((d) => /bottom:\s*56px/.test(d.getAttribute('style') ?? ''))
    expect(hud).toBeTruthy()
    expect(hud!.style.display).toBe('block')
    expect(hud!.textContent).toContain('✖ rejected')
    expect(hud!.textContent).toContain('what should I change?')
    handle.detach()
  })

  it('keeps a failed interaction on the canvas (clearAll reports it still committed)', () => {
    const { bus, captured, handle, layer } = makeOverlay()
    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 40, 40)
    pointer(layer, 'pointerup', 40, 40)
    commitComposer('hi')
    const intent = captured.find((e) => (e.payload as { kind?: string }).kind === 'note')!
    bus.publish({
      id: 'ev2',
      interactionId: intent.interactionId,
      ts: 1,
      kind: 'status',
      source: 'engine',
      payload: { interactionId: intent.interactionId, state: 'rejected', detail: '', edits: [] },
    })
    // Out of the undo stack, but still drawn — clearAll still counts it and
    // does NOT retract a terminal interaction.
    expect(handle.pendingCount()).toBe(0)
    expect(handle.clearAll()).toBe(1)
    expect(captured.filter((e) => e.kind === 'retract')).toHaveLength(0)
    handle.detach()
  })

  it('undoLast retracts the most recent intent and shrinks pendingCount', () => {
    const { captured, handle, layer } = makeOverlay()
    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 40, 40)
    pointer(layer, 'pointerup', 40, 40)
    commitComposer('one')
    pointer(layer, 'pointerdown', 60, 60)
    pointer(layer, 'pointerup', 60, 60)
    commitComposer('two')
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
    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 40, 40)
    pointer(layer, 'pointerup', 40, 40)
    commitComposer('one')
    pointer(layer, 'pointerdown', 60, 60)
    pointer(layer, 'pointerup', 60, 60)
    commitComposer('two')
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
    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 40, 40)
    pointer(layer, 'pointerup', 40, 40)
    commitComposer('hi')
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
    handle.arm()
    handle.setMode('note')
    pointer(layer, 'pointerdown', 40, 40)
    pointer(layer, 'pointerup', 40, 40)
    commitComposer('hi')
    expect(handle.pendingCount()).toBe(1)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    expect(handle.pendingCount()).toBe(0)
    expect(captured.some((e) => e.kind === 'retract')).toBe(true)
    handle.detach()
  })
})
