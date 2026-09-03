import type { Bus } from './bus.js'
import type { Envelope } from './protocol.js'

/**
 * A transport links two buses across some boundary (page↔extension,
 * browser↔dev-server, in-process↔in-process). Each side gets a bus whose
 * `publish` forwards to the peer side's subscribers, and whose own
 * subscribers receive the peer's publications.
 */
export interface Transport {
  connectSideA(): Bus
  connectSideB(): Bus
}

export function createLinkedTransport(): Transport {
  const aHandlers = new Set<(e: Envelope) => void>()
  const bHandlers = new Set<(e: Envelope) => void>()

  const forward = (to: Set<(e: Envelope) => void>) => (envelope: Envelope) => {
    for (const h of [...to]) h(envelope)
  }

  return {
    connectSideA(): Bus {
      return {
        publish: forward(bHandlers),
        subscribe(handler) {
          aHandlers.add(handler)
          return () => aHandlers.delete(handler)
        },
      }
    },
    connectSideB(): Bus {
      return {
        publish: forward(aHandlers),
        subscribe(handler) {
          bHandlers.add(handler)
          return () => bHandlers.delete(handler)
        },
      }
    },
  }
}
