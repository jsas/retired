import { describe, expect, it } from 'vitest'
import { createBus } from '../src/core/bus.js'
import { createLinkedTransport } from '../src/core/transport.js'
import {
  canTransition,
  isTerminalStatus,
  makeEnvelope,
  makeStatus,
  type StatusState,
} from '../src/core/protocol.js'

function noteIntentEnvelope(interactionId: string, source = 'test') {
  return makeEnvelope({
    interactionId,
    source,
    kind: 'intent',
    payload: { kind: 'note', text: 'hello', anchor: { x: 10, y: 20 } },
  })
}

function statusEnvelope(interactionId: string, state: StatusState, source = 'engine') {
  return makeEnvelope({
    interactionId,
    source,
    kind: 'status',
    payload: makeStatus(interactionId, state, 'detail'),
  })
}

describe('protocol status machine', () => {
  it('allows received → accepted → processing → applied', () => {
    expect(canTransition('received', 'accepted')).toBe(true)
    expect(canTransition('accepted', 'processing')).toBe(true)
    expect(canTransition('processing', 'applied')).toBe(true)
  })

  it('allows failure and rejection from any active state', () => {
    expect(canTransition('received', 'failed')).toBe(true)
    expect(canTransition('accepted', 'failed')).toBe(true)
    expect(canTransition('processing', 'failed')).toBe(true)
    expect(canTransition('received', 'rejected')).toBe(true)
    expect(canTransition('processing', 'rejected')).toBe(true)
  })

  it('forbids illegal moves', () => {
    expect(canTransition('received', 'applied')).toBe(false)
    expect(canTransition('applied', 'received')).toBe(false)
    expect(canTransition('processing', 'accepted')).toBe(false)
    expect(canTransition('failed', 'accepted')).toBe(false)
    expect(canTransition('processing', 'processing')).toBe(false)
  })

  it('marks applied/failed/rejected terminal', () => {
    const terminal: StatusState[] = ['applied', 'failed', 'rejected']
    for (const s of terminal) {
      expect(isTerminalStatus(s)).toBe(true)
      expect(canTransition(s, 'processing')).toBe(false)
    }
  })
})

describe('bus', () => {
  it('delivers to every subscriber until unsubscribed', () => {
    const bus = createBus()
    const seen: string[] = []
    const off = bus.subscribe((e) => seen.push(e.id))
    bus.publish(noteIntentEnvelope('i1'))
    expect(seen).toHaveLength(1)
    off()
    bus.publish(noteIntentEnvelope('i2'))
    expect(seen).toHaveLength(1)
  })
})

describe('linked transport', () => {
  it('forwards A→B and B→A', () => {
    const transport = createLinkedTransport()
    const a = transport.connectSideA()
    const b = transport.connectSideB()

    const atA: string[] = []
    const atB: string[] = []
    a.subscribe((e) => atA.push(e.id))
    b.subscribe((e) => atB.push(e.id))

    a.publish(noteIntentEnvelope('x', 'side-a'))
    b.publish(statusEnvelope('y', 'accepted', 'side-b'))

    expect(atA).toHaveLength(1)
    expect(atB).toHaveLength(1)
  })

  it('does not echo a publish back to its own side', () => {
    const transport = createLinkedTransport()
    const a = transport.connectSideA()
    const b = transport.connectSideB()

    const atA: string[] = []
    const atB: string[] = []
    a.subscribe((e) => atA.push(e.id))
    b.subscribe((e) => atB.push(e.id))

    a.publish(noteIntentEnvelope('x', 'side-a'))

    expect(atA).toHaveLength(0)
    expect(atB).toHaveLength(1)
  })
})
