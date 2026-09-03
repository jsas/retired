/**
 * Tests for the recorder + revert ledger. The recorder subscribes to the bus
 * and folds intents/status into a ledger; the revert ledger holds
 * before/after content per file.
 */
import { describe, expect, it } from 'vitest'
import { createBus } from '../src/core/bus.js'
import { makeEnvelope, makeStatus, type Edit, type Envelope } from '../src/core/protocol.js'
import { createRecorder } from '../src/engine/recorder.js'
import { createRevertLedger } from '../src/engine/revertable.js'

describe('recorder', () => {
  it('folds gesture + context + status into one history entry', () => {
    const bus = createBus()
    const rec = createRecorder(bus)
    bus.publish(makeEnvelope({ interactionId: 'i1', source: 'probe', kind: 'intent', payload: { kind: 'screenshot', image: { mime: 'image/png', data: 'b', width: 4, height: 4 } } } as Pick<Envelope,'interactionId'|'source'|'kind'|'payload'> as Envelope))
    bus.publish(makeEnvelope({ interactionId: 'i1', source: 'probe', kind: 'intent', payload: { kind: 'dom', snapshot: '<div>' } } as unknown as Envelope))
    bus.publish(makeEnvelope({ interactionId: 'i1', source: 'probe', kind: 'intent', payload: { kind: 'note', text: 'make it bold', anchor: { x: 0, y: 0 } } as unknown as Envelope['payload'] } as unknown as Envelope))
    bus.publish(
      makeEnvelope({
        interactionId: 'i1',
        source: 'engine',
        kind: 'status',
        payload: makeStatus('i1', 'applied', 'done', [
          { kind: 'text', file: 'a.ts', find: 'a', replace: 'b', description: '' } as Edit,
        ]),
      }),
    )
    const list = rec.list()
    expect(list).toHaveLength(1)
    const e = list[0]
    expect(e.gesture?.kind).toBe('note')
    expect(e.context.map((c) => c.kind)).toEqual(['screenshot', 'dom'])
    expect(e.terminal).toBe('applied')
    expect(e.edits[0]!.kind).toBe('text')
    rec.close()
  })

  it('keeps the screenshot image base64 for the console\'s thumbnail', () => {
    const bus = createBus()
    const rec = createRecorder(bus)
    bus.publish(
      makeEnvelope({
        interactionId: 'i3',
        source: 'probe',
        kind: 'intent',
        payload: { kind: 'screenshot', image: { mime: 'image/png', data: 'AAABBB', width: 2, height: 2 } },
      } as unknown as Parameters<typeof bus.publish>[0]),
    )
    const entry = rec.get('i3')
    expect(entry?.image).toBe('data:image/png;base64,AAABBB')
    rec.close()
  })

  it('stays safe on missing/unexpected payloads', () => {
    const bus = createBus()
    const rec = createRecorder(bus)
    bus.publish(
      makeEnvelope({ interactionId: 'i2', source: 'engine', kind: 'status', payload: makeStatus('i2', 'processing', '…') }),
    )
    expect(rec.get('i2')?.lastStatus).toBe('processing')
    rec.close()
  })

  it('folds user note text into the gesture summary + text', () => {
    const bus = createBus()
    const rec = createRecorder(bus)
    bus.publish(
      makeEnvelope({
        interactionId: 'i9',
        source: 'probe',
        kind: 'intent',
        payload: {
          kind: 'stroke',
          strokes: [{ points: [{ x: 1, y: 1 }], color: '#f00', width: 3 }],
          bounds: { x: 1, y: 1, w: 10, h: 10 },
          note: 'make this bigger',
          element: {
            tag: 'h2',
            selector: 'h2.hero',
            textPreview: 'The verdict',
            rect: { x: 0, y: 0, w: 1, h: 1 },
            classes: ['hero'],
          },
        } as unknown as Parameters<typeof bus.publish>[0]['payload'],
      } as unknown as Parameters<typeof bus.publish>[0]),
    )
    const entry = rec.get('i9')
    expect(entry?.gesture?.summary).toContain('note: "make this bigger"')
    expect(entry?.gesture?.summary).toContain('h2.hero')
    expect(entry?.gesture?.summary).toContain('"The verdict"')
    expect(entry?.gesture?.text).toBe('make this bigger')
    rec.close()
  })
})

describe('revert ledger', () => {
  it('records prior/new per file; take pops newest', () => {
    const led = createRevertLedger()
    const edit: Edit = { kind: 'text', file: 'x.ts', find: 'a', replace: 'b', description: '' }
    led.record(edit, 'old', 'new')
    led.record(edit, 'older', 'newer')
    expect(led.planned()).toHaveLength(2)
    const head = led.take('x.ts')
    expect(head?.oldContent).toBe('older')
    expect(led.take('x.ts')?.oldContent).toBe('old')
    expect(led.take('x.ts')).toBeUndefined()
  })

  it('ignores dom edits', () => {
    const led = createRevertLedger()
    led.record({ kind: 'dom', ops: [], description: '' } as Edit, 'a', 'b')
    expect(led.planned()).toHaveLength(0)
  })
})
