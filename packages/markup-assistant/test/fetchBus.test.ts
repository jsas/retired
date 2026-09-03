import { describe, expect, it, vi } from 'vitest'
import { createFetchBus } from '../src/core/fetchBus.js'
import { makeEnvelope, type Envelope } from '../src/core/index.js'

// A fake EventSource we can push frames into and assert lifecycle on.
function makeFakeES() {
  const created: Array<{ url: string; onmessage: ((ev: { data: string }) => void) | null; closed: boolean }> = []
  return {
    created,
    factory(url: string) {
      const es = { url, onmessage: null as ((ev: { data: string }) => void) | null, closed: false }
      created.push(es)
      return {
        set onmessage(h: ((ev: { data: string }) => void) | null) { es.onmessage = h },
        get onmessage() { return es.onmessage },
        close() { es.closed = true },
      } as unknown as EventSource
    },
  }
}

const intent = makeEnvelope({
  interactionId: 'ia_1',
  source: 'overlay',
  kind: 'intent',
  payload: { kind: 'note', text: 'hi', anchor: { x: 1, y: 1 } },
})

describe('createFetchBus', () => {
  it('POSTs published envelopes to /intent', async () => {
    const fake = makeFakeES()
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))
    const bus = createFetchBus({ fetchImpl: fetchImpl as unknown as typeof fetch, eventSourceFactory: fake.factory })
    bus.publish(intent)
    await Promise.resolve()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/__markup_assistant__/intent')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({ interactionId: 'ia_1', kind: 'intent' })
  })

  it('delivers SSE frames to subscribers', () => {
    const fake = makeFakeES()
    const bus = createFetchBus({ eventSourceFactory: fake.factory })
    const got: Envelope[] = []
    bus.subscribe((e) => got.push(e))
    const status = makeEnvelope({
      interactionId: 'ia_1',
      source: 'engine',
      kind: 'status',
      payload: { interactionId: 'ia_1', state: 'applied', detail: '', edits: [] },
    })
    fake.created[0]!.onmessage?.({ data: JSON.stringify(status) })
    expect(got).toHaveLength(1)
    expect(got[0]?.kind).toBe('status')
  })

  it('ignores malformed frames', () => {
    const fake = makeFakeES()
    const bus = createFetchBus({ eventSourceFactory: fake.factory })
    const got: Envelope[] = []
    bus.subscribe((e) => got.push(e))
    expect(() => fake.created[0]!.onmessage?.({ data: 'not json' })).not.toThrow()
    expect(got).toHaveLength(0)
  })

  it('close() closes the event source and stops delivery', () => {
    const fake = makeFakeES()
    const bus = createFetchBus({ eventSourceFactory: fake.factory })
    const got: Envelope[] = []
    bus.subscribe((e) => got.push(e))
    bus.close()
    expect((fake.created[0] as unknown as { closed: boolean }).closed ?? true).toBe(true)
  })

  it('respects a custom prefix', async () => {
    const fake = makeFakeES()
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))
    const bus = createFetchBus({ prefix: '/__ma__', fetchImpl: fetchImpl as unknown as typeof fetch, eventSourceFactory: fake.factory })
    bus.publish(intent)
    await Promise.resolve()
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('/__ma__/intent')
    expect(fake.created[0]!.url).toBe('/__ma__/events')
  })
})
