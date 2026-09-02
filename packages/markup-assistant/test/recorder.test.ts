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

  it('stays safe on missing/unexpected payloads', () => {
    const bus = createBus()
    const rec = createRecorder(bus)
    bus.publish(
      makeEnvelope({ interactionId: 'i2', source: 'engine', kind: 'status', payload: makeStatus('i2', 'processing', '…') }),
    )
    expect(rec.get('i2')?.lastStatus).toBe('processing')
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
