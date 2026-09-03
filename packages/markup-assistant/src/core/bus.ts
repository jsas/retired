import type { Envelope } from './protocol.js'

export type Unsubscribe = () => void

/**
 * Publish/subscribe for envelopes. The single connection point between
 * input surfaces, the engine, and output sinks — any transport
 * (in-memory, BroadcastChannel, SSE) delivers into one of these.
 */
export interface Bus {
  publish(envelope: Envelope): void
  subscribe(handler: (envelope: Envelope) => void): Unsubscribe
}

export function createBus(): Bus {
  const handlers = new Set<(envelope: Envelope) => void>()
  return {
    publish(envelope) {
      for (const handler of [...handlers]) handler(envelope)
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
}
