// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { serializeDom } from '../src/input/overlay-parts.js'

/** jsdom rects are all zero; stub per-element rects via a data attribute. */
function withRects(run: () => void) {
  const orig = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const v = (this as HTMLElement).dataset?.rect
    if (v) {
      const [x, y, w, h] = v.split(',').map(Number)
      return { x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h } as DOMRect
    }
    return orig.call(this)
  }
  try {
    run()
  } finally {
    Element.prototype.getBoundingClientRect = orig
  }
}

function el(tag: string, rect: string, text: string, id?: string): HTMLElement {
  const e = document.createElement(tag)
  e.dataset.rect = rect
  e.textContent = text
  if (id) e.id = id
  document.body.appendChild(e)
  return e
}

describe('serializeDom focus ordering', () => {
  it('puts the focused element first even when it is last in document order', () => {
    withRects(() => {
      document.body.innerHTML = ''
      el('h1', '10,10,300,40', 'Top heading')
      el('p', '10,80,400,60', 'Some intro text')
      const target = el('input', '496,701,26,20', '', 'show-again')
      el('footer', '10,900,800,40', 'Footer far below')

      const snap = serializeDom(document, 20000, { x: 496, y: 701, w: 26, h: 20 })
      const firstLine = snap.split('\n')[0]
      expect(firstLine).toContain('#show-again')
      expect(firstLine).toContain('[496,701')
      expect(target.id).toBe('show-again')
    })
  })

  it('includes viewport geometry in every line', () => {
    withRects(() => {
      document.body.innerHTML = ''
      el('h2', '24,148,620,40', 'Will your money outlast you?')
      const snap = serializeDom(document, 20000)
      expect(snap).toContain('[24,148 620x40]')
      expect(snap).toContain('Will your money outlast you?')
    })
  })

  it('a far element survives a tight char budget when it is the focus', () => {
    withRects(() => {
      document.body.innerHTML = ''
      // Fill the top of the page with enough text to blow the budget.
      for (let i = 0; i < 60; i++) {
        el('p', `10,${i * 30},600,24`, `filler paragraph number ${i} with some words to take up space`)
      }
      const target = el('button', '496,701,80,30', 'Get started', 'cta')
      const snap = serializeDom(document, 1200, { x: 496, y: 701, w: 80, h: 30 })
      // The CTA is far down the page but is the focus — it must be present.
      expect(snap).toContain('#cta')
      expect(target).toBeTruthy()
    })
  })
})
