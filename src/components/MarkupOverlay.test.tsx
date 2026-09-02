// @vitest-environment jsdom
/**
 * The MarkupOverlay mounts the drawing overlay + a bridge-backed session and
 * routes proposed DOM edits through a confirm card before applying. These
 * tests drive the real overlay gesture pipeline (note intent → bus → session →
 * engine) with a controllable fake engine so the whole confirm flow runs
 * without a model: the engine holds its decision until the test releases it,
 * then we assert the card appears, Apply writes to the live DOM, and Discard
 * leaves it untouched.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import type { Engine, EngineDecision } from '@retired/markup-assistant'
import type { AiSettings } from '../lib/aiSettings'
import { MarkupOverlay } from './MarkupOverlay'

// --- Engine + bridge fakes -------------------------------------------------
// createBridgeEngine only calls bridge.chat(); everything else (selection,
// streaming) is irrelevant here. We return the fake engine's decision.

let pendingDecision: Promise<EngineDecision> | null = null
let releaseDecision: ((d: EngineDecision) => void) | null = null
const fakeEngine: Engine = {
  decide: () => {
    pendingDecision = new Promise<EngineDecision>((resolve) => {
      releaseDecision = resolve
    })
    return pendingDecision
  },
}
const fakeBridge = {
  chat: vi.fn(async () => {
    // Bridge out the real engine: the chat surface just proxies to fakeEngine.
    const d = await fakeEngine.decide({ interactionId: 'x', intents: [] })
    if (d.rejection) return { text: JSON.stringify({ rejection: d.rejection }) }
    return { text: JSON.stringify({ edits: d.edits }) }
  }),
}

vi.mock('@retired/ai-bridge', () => ({
  createBridge: () => fakeBridge,
}))
vi.mock('@retired/markup-assistant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@retired/markup-assistant')>()
  return {
    ...actual,
    // Swap the real bridge engine for one that delegates to our controllable
    // fake, keeping the rest of the session/overlay/dom-sink pipeline intact.
    createBridgeEngine: () => fakeEngine,
  }
})

// --- jsdom canvas + rect stubs (overlay needs both to draw and hit-test) ---
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    kind: string,
  ): unknown {
    if (kind !== '2d') return null
    const noop = () => undefined
    return new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'canvas') return this
        if (prop in target) return (target as Record<string | symbol, unknown>)[prop]
        return noop
      },
      set: (target, prop, value) => {
        ;(target as Record<string | symbol, unknown>)[prop] = value
        return true
      },
    })
  } as typeof HTMLCanvasElement.prototype.getContext
})

const settings: AiSettings = { connections: [], activeConnectionId: null, prompts: [] }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  pendingDecision = null
  releaseDecision = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

/** Arm the overlay, then commit a note via the inline composer. */
async function commitNote(text: string) {
  act(() => {
    // Ctrl+Shift+M arms the overlay.
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, shiftKey: true, bubbles: true }),
    )
  })
  const noteBtn = document.querySelector('button[data-mode="note"]')
  const capture = [...document.querySelectorAll('div[data-ma-overlay]')].find(
    (d) => (d.getAttribute('style') ?? '').includes('crosshair'),
  ) as HTMLElement
  act(() => {
    noteBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  act(() => {
    capture?.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 120, clientY: 120, bubbles: true }),
    )
  })
  // The drawing is a draft — finalize it through the panel's composer input.
  const panels = [...document.querySelectorAll('div[data-ma-overlay]')] as HTMLElement[]
  const openPanel = panels.find((p) => p.style.display !== 'none' && p.querySelector('input'))
  const input = openPanel?.querySelector('input') as HTMLInputElement
  act(() => {
    input.value = text
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
  })
}

describe('MarkupOverlay confirm flow', () => {
  it('shows no card before the model proposes anything', () => {
    act(() => {
      root.render(<MarkupOverlay settings={settings} />)
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('applies proposed DOM edits to the live document on Apply', async () => {
    // A target element for the model's edit.
    const target = document.createElement('h1')
    target.id = 'headline'
    target.textContent = 'Old'
    document.body.appendChild(target)

    act(() => {
      root.render(<MarkupOverlay settings={settings} />)
    })
    await commitNote('make the headline shout')
    expect(pendingDecision).not.toBeNull()

    await act(async () => {
      releaseDecision?.({
        edits: [
          {
            kind: 'dom',
            description: 'Shout the headline',
            ops: [{ op: 'setText', selector: '#headline', text: 'NEW' }],
          },
        ],
      })
      await pendingDecision
    })

    const card = document.querySelector('[role="dialog"]')
    expect(card).not.toBeNull()
    expect(card?.textContent).toContain('Shout the headline')

    const applyBtn = [...card!.querySelectorAll('button')].find((b) => b.textContent?.includes('Apply'))
    await act(async () => {
      applyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(document.querySelector('#headline')?.textContent).toBe('NEW')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('leaves the document untouched on Discard', async () => {
    const target = document.createElement('h1')
    target.id = 'headline'
    target.textContent = 'Old'
    document.body.appendChild(target)

    act(() => {
      root.render(<MarkupOverlay settings={settings} />)
    })
    await commitNote('delete it')
    await act(async () => {
      releaseDecision?.({
        edits: [
          { kind: 'dom', description: 'Remove the headline', ops: [{ op: 'remove', selector: '#headline' }] },
        ],
      })
      await pendingDecision
    })

    const card = document.querySelector('[role="dialog"]')
    const discardBtn = [...card!.querySelectorAll('button')].find((b) => b.textContent?.includes('Discard'))
    await act(async () => {
      discardBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(document.querySelector('#headline')).not.toBeNull()
    expect(document.querySelector('#headline')?.textContent).toBe('Old')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
