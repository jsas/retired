/**
 * A Bus that bridges the page to the dev server over the markup-assistant
 * endpoints: publishes POST to `${prefix}/intent`, and an EventSource on
 * `${prefix}/events` delivers server-side envelopes (statuses) to subscribers.
 *
 * This is what lets the overlay talk to the dev-server session + engine while
 * the model credentials stay server-side — the page only ever calls the
 * same-origin dev endpoint, never the provider. Dev-only: there is no auth on
 * the endpoint, so it must never be exposed beyond localhost.
 */
import type { Bus } from './bus.js'
import type { Envelope } from './protocol.js'

export interface FetchBusOptions {
  /** Endpoint prefix; must match the vite plugin. Default '/__markup_assistant__'. */
  prefix?: string
  fetchImpl?: typeof fetch
  /** Injectable for tests (jsdom has EventSource but it never connects). */
  eventSourceFactory?: (url: string) => EventSource
}

export function createFetchBus(options: FetchBusOptions = {}): Bus & { close(): void } {
  const prefix = options.prefix ?? '/__markup_assistant__'
  const doFetch = options.fetchImpl ?? fetch
  const makeES = options.eventSourceFactory ?? ((url: string) => new EventSource(url))

  const handlers = new Set<(e: Envelope) => void>()
  const es = makeES(`${prefix}/events`)
  es.onmessage = (ev) => {
    try {
      const envelope = JSON.parse(ev.data as string) as Envelope
      for (const h of [...handlers]) h(envelope)
    } catch {
      // ignore malformed server frames
    }
  }

  return {
    publish(envelope) {
      // Fire-and-forget: the overlay shouldn't block on the round trip.
      void doFetch(`${prefix}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      }).catch(() => {})
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    close() {
      es.close()
      handlers.clear()
    },
  }
}
