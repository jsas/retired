import { describe, expect, it } from 'vitest'
import { createBus, makeEnvelope, type Edit, type Envelope } from '../src/core/index.js'
import { startSession, createStubEngine, type Sink } from '../src/engine/index.js'

function noteIntent(interactionId: string) {
  return makeEnvelope({
    interactionId,
    source: 'test-input',
    kind: 'intent',
    payload: { kind: 'note', text: 'be bigger', anchor: { x: 1, y: 1 } },
  })
}

describe('session conversation reset', () => {
  it('clears the engine conversation on a reset envelope', async () => {
    const bus = createBus()
    let cleared = 0
    const engine = {
      async decide() {
        return { edits: [] as Edit[], rejection: 'nope' }
      },
      clearConversation() {
        cleared += 1
      },
    }
    startSession({ bus, engine, sinks: [] })
    bus.publish(
      makeEnvelope({ interactionId: 'conversation', source: 'overlay', kind: 'reset', payload: {} }),
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(cleared).toBe(1)
  })
})

describe('session orchestration', () => {
  it('drives received -> accepted -> processing -> applied with stub engine', async () => {
    const bus = createBus()
    const statuses: Array<{ state: string; edits: Edit[] }> = []
    bus.subscribe((e: Envelope) => {
      if (e.kind === 'status') {
        const p = e.payload as { state: string; edits: Edit[] }
        statuses.push({ state: p.state, edits: p.edits })
      }
    })
    const applied: Edit[] = []
    const sink: Sink = {
      name: 'recorder',
      async apply(edit) {
        applied.push(edit)
        return 'applied'
      },
    }
    startSession({ bus, engine: createStubEngine(), sinks: [sink] })

    bus.publish(noteIntent('ia_1'))
    await new Promise((r) => setTimeout(r, 20))

    expect(statuses.map((s) => s.state)).toEqual(['accepted', 'processing', 'applied'])
    expect(applied).toHaveLength(1)
    expect(applied[0]?.kind).toBe('dom')
    expect(statuses[2]?.edits).toHaveLength(1)
  })

  it('publishes answered (not rejected) when the engine returns an answer', async () => {
    const bus = createBus()
    const states: string[] = []
    bus.subscribe((e) => {
      if (e.kind === 'status') states.push((e.payload as { state: string }).state)
    })
    const engine = {
      async decide() {
        return { edits: [] as Edit[], answer: 'That word is "you".' }
      },
    }
    startSession({ bus, engine, sinks: [] })
    bus.publish(noteIntent('ia_q'))
    await new Promise((r) => setTimeout(r, 20))
    expect(states).toEqual(['accepted', 'processing', 'answered'])
  })

  it('publishes failed when a sink fails', async () => {
    const bus = createBus()
    const states: string[] = []
    bus.subscribe((e) => {
      if (e.kind === 'status') states.push((e.payload as { state: string }).state)
    })
    const badSink: Sink = {
      name: 'bad',
      async apply() {
        return 'failed'
      },
    }
    startSession({ bus, engine: createStubEngine(), sinks: [badSink] })
    bus.publish(noteIntent('ia_2'))
    await new Promise((r) => setTimeout(r, 20))
    expect(states).toEqual(['accepted', 'processing', 'failed'])
  })

  it('surfaces the sink failure reason in the failed detail', async () => {
    const bus = createBus()
    let detail = ''
    bus.subscribe((e) => {
      if (e.kind === 'status') {
        const p = e.payload as { state: string; detail?: string }
        if (p.state === 'failed') detail = p.detail ?? ''
      }
    })
    const badSink: Sink = {
      name: 'source',
      async apply() {
        return { state: 'failed', reason: 'not-found' }
      },
    }
    startSession({ bus, engine: createStubEngine(), sinks: [badSink] })
    bus.publish(noteIntent('ia_reason'))
    await new Promise((r) => setTimeout(r, 20))
    expect(detail).toContain('not-found')
    // the failing edit is named so the user sees which one
    expect(detail).toContain('dom')
  })

  it('treats screenshot/dom intents as context, folded into the gesture run', async () => {
    const bus = createBus()
    const seen: Array<{ intents: unknown[]; screenshot?: unknown; dom?: string }> = []
    const engine = {
      async decide(input: {
        interactionId: string
        intents: unknown[]
        screenshot?: unknown
        dom?: string
      }) {
        seen.push(input)
        return { edits: [] as Edit[], rejection: 'context noted' }
      },
    }
    startSession({ bus, engine, sinks: [] })

    // A screenshot + DOM snapshot arrive under the interaction id, then the
    // gesture. The engine should run ONCE on the gesture with both attached.
    bus.publish(
      makeEnvelope({
        interactionId: 'ia_3',
        source: 'x',
        kind: 'intent',
        payload: { kind: 'screenshot', image: { mime: 'image/png', data: 'AAA', width: 2, height: 2 } },
      }),
    )
    bus.publish(
      makeEnvelope({
        interactionId: 'ia_3',
        source: 'x',
        kind: 'intent',
        payload: { kind: 'dom', snapshot: '<h1>Hi</h1>' },
      }),
    )
    bus.publish(
      makeEnvelope({
        interactionId: 'ia_3',
        source: 'x',
        kind: 'intent',
        payload: { kind: 'note', text: 'be bigger', anchor: { x: 1, y: 1 } },
      }),
    )
    await new Promise((r) => setTimeout(r, 20))

    expect(seen).toHaveLength(1)
    expect(seen[0]?.screenshot).toEqual({ mime: 'image/png', data: 'AAA', width: 2, height: 2 })
    expect(seen[0]?.dom).toBe('<h1>Hi</h1>')
    expect(seen[0]?.intents).toHaveLength(1)
  })

  it('passes host sourceContext excerpts to the engine', async () => {
    const bus = createBus()
    const seen: Array<{ dom?: string; source?: string }> = []
    const domArgs: string[] = []
    const engine = {
      async decide(input: { interactionId: string; intents: unknown[]; dom?: string; source?: string }) {
        seen.push(input)
        return { edits: [] as Edit[], rejection: 'ok' }
      },
    }
    startSession({
      bus,
      engine,
      sinks: [],
      sourceContext: (dom: string) => {
        domArgs.push(dom)
        return '--- src/app.css ---\n   1 | .x { color: red }'
      },
    })
    bus.publish(
      makeEnvelope({
        interactionId: 'ia_src',
        source: 'x',
        kind: 'intent',
        payload: { kind: 'dom', snapshot: 'div "hi" [0,0 1x1]' },
      }),
    )
    bus.publish(
      makeEnvelope({
        interactionId: 'ia_src',
        source: 'x',
        kind: 'intent',
        payload: { kind: 'note', text: 'make it green', anchor: { x: 1, y: 1 } },
      }),
    )
    await new Promise((r) => setTimeout(r, 20))

    expect(domArgs).toEqual(['div "hi" [0,0 1x1]'])
    expect(seen[0]?.source).toContain('.x { color: red }')
  })

  it('reports rejected when every sink skipped the edit (nothing landed)', async () => {
    const bus = createBus()
    const detail: string[] = []
    bus.subscribe((e) => {
      if (e.kind === 'status') detail.push((e.payload as { detail?: string }).detail ?? '')
    })
    const engine = {
      async decide() {
        return { edits: [{ kind: 'write', file: 'x.ts', content: 'c', description: '' } as Edit] }
      },
    }
    // Sink advertises text edits only — a write edit never reaches it, so
    // nothing lands. Without a status.diag the user sees '0 applied'.
    const sink = {
      name: 'source',
      supports: (edit: Edit) => edit.kind === 'text' && false,
      async apply() {
        return 'applied' as const
      },
    }
    startSession({ bus, engine, sinks: [sink] })
    bus.publish(noteIntent('ia_4'))
    await new Promise((r) => setTimeout(r, 20))
    expect(detail.some((d) => d.includes('skipped'))).toBe(true)
  })
})
