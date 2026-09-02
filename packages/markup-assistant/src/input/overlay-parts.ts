/**
 * Toolbar construction + pointer/keyboard handlers for the overlay.
 * Split from overlay.ts to keep each file readable.
 */
import type { Bus } from '../core/index.js'
import { makeEnvelope, type Intent } from '../core/index.js'
import type { OverlayMode } from './overlay.js'

export const MODES: OverlayMode[] = ['select', 'note', 'stroke', 'arrow', 'move', 'cut']

export interface ToolbarActions {
  onSelect: (m: OverlayMode) => void
  onUndo: () => void
  onClear: () => void
}

export function buildToolbar(currentMode: OverlayMode, actions: ToolbarActions): HTMLElement {
  const bar = document.createElement('div')
  bar.dataset.maOverlay = ''
  bar.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:2147483600;background:#1c1c1e;' +
    'color:#fff;border-radius:10px;padding:8px;display:flex;gap:6px;' +
    'align-items:center;font:12px system-ui;pointer-events:auto;'
  for (const m of MODES) {
    const b = document.createElement('button')
    b.textContent = m
    b.dataset.mode = m
    b.style.cssText =
      'background:transparent;color:#fff;border:1px solid #3a3a3c;' +
      'border-radius:6px;padding:4px 8px;cursor:pointer;'
    if (m === currentMode) b.style.background = '#0a84ff'
    b.addEventListener('click', () => actions.onSelect(m))
    bar.appendChild(b)
  }
  bar.appendChild(makeActionButton('undo', actions.onUndo))
  bar.appendChild(makeActionButton('clear', actions.onClear))
  return bar
}

function makeActionButton(label: 'undo' | 'clear', onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.dataset.action = label
  b.style.cssText =
    'background:transparent;color:#8e8e93;border:1px solid #3a3a3c;' +
    'border-radius:6px;padding:4px 8px;cursor:pointer;'
  b.addEventListener('click', onClick)
  return b
}

export function highlightToolbar(bar: HTMLElement, active: OverlayMode) {
  for (const el of bar.querySelectorAll('button[data-mode]')) {
    const btn = el as HTMLButtonElement
    btn.style.background = btn.dataset.mode === active ? '#0a84ff' : 'transparent'
  }
}

/** Small helper for input adapters that need element metadata. */
export function describeElement(el: Element, maxText = 80) {
  const rect = el.getBoundingClientRect()
  const id = el.id ? `#${el.id}` : ''
  const classes = [...el.classList].slice(0, 4)
  return {
    selector: id ? `#${el.id}` : classes.length ? `${el.tagName.toLowerCase()}.${classes.join('.')}` : el.tagName.toLowerCase(),
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    classes,
    textPreview: (el.textContent ?? '').trim().slice(0, maxText) || undefined,
  }
}

export function elementAt(x: number, y: number, selector: string): Element | null {
  const candidates = document.querySelectorAll(selector)
  let best: Element | null = null
  for (const el of candidates) {
    // Never resolve the overlay's own UI (canvas, toolbar, capture layer).
    if (el.closest('[data-ma-overlay]')) continue
    const style = window.getComputedStyle(el)
    if (style.pointerEvents === 'none' || style.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      // prefer the smallest (deepest) matching element
      if (!best || area(r) < area(best.getBoundingClientRect())) best = el
    }
  }
  return best
}

function area(r: DOMRect): number {
  return Math.max(0, r.width) * Math.max(0, r.height)
}

export function makeInteractionId(): string {
  return `ia_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function intentEnvelope(
  bus: Bus,
  source: string,
  intent: Intent,
  interactionId: string,
): void {
  bus.publish(
    makeEnvelope({
      interactionId,
      source,
      kind: 'intent',
      payload: intent,
    }),
  )
}
