/**
 * DomSink: applies DomEdit ops to the live document — the "instant preview"
 * half of the loop, so the user sees the model's interpretation immediately,
 * before/alongside any source patch.
 */
import type { DomOp, Edit } from '../core/index.js'
import type { SinkApplier } from './types.js'

export interface DomSinkOptions {
  /** Root element; defaults to document. */
  root?: Document | Element
  /** When true, `move` ops set position:absolute with viewport-relative coords. */
  absoluteMoves?: boolean
}

export function createDomSink(options: DomSinkOptions = {}): SinkApplier {
  const root = options.root ?? document
  const absoluteMoves = options.absoluteMoves ?? true

  return {
    name: 'dom',
    supports(edit: Edit): boolean {
      return edit.kind === 'dom'
    },
    async apply(edit: Edit): Promise<'applied' | 'failed'> {
      if (edit.kind !== 'dom') return 'failed'
      let ok = true
      for (const op of edit.ops) {
        try {
          applyOp(root, op, absoluteMoves)
        } catch {
          ok = false
        }
      }
      return ok ? 'applied' : 'failed'
    },
  }
}

function applyOp(root: Document | Element, op: DomOp, absoluteMoves: boolean): void {
  switch (op.op) {
    case 'setText': {
      const el = requireElement(root, op.selector)
      el.textContent = op.text
      return
    }
    case 'setAttr': {
      const el = requireElement(root, op.selector)
      el.setAttribute(op.name, op.value)
      return
    }
    case 'setStyle': {
      const el = requireElement(root, op.selector)
      for (const [name, value] of Object.entries(op.styles)) {
        el.style.setProperty(name, value)
      }
      return
    }
    case 'move': {
      const el = requireElement(root, op.selector)
      if (absoluteMoves) {
        el.style.position = 'absolute'
        el.style.left = `${op.x}px`
        el.style.top = `${op.y}px`
      }
      return
    }
    case 'remove': {
      const el = requireElement(root, op.selector)
      el.remove()
      return
    }
  }
}

function requireElement(root: Document | Element, selector: string): HTMLElement {
  const el = root.querySelector(selector)
  if (!el) throw new Error(`dom-sink: no element for ${selector}`)
  if (!(el instanceof HTMLElement)) throw new Error(`dom-sink: not an HTMLElement for ${selector}`)
  return el
}
