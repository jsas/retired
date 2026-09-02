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
})
