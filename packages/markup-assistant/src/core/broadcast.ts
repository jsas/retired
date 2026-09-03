import type { Bus } from './bus.js'
import type { Envelope } from './protocol.js'
import type { Transport } from './transport.js'

export interface BroadcastChannelTransportOptions {
  channelName?: string
}

/**
 * Transport over BroadcastChannel: same-origin pages (app tab, extension
 * overlay, preview windows) share one logical bus without needing a dev
 * server. Each side publishes to the channel and receives everything the
 * other sides publish (its own messages are filtered out by sender id).
 */
export function createBroadcastChannelTransport(
  options: BroadcastChannelTransportOptions = {},
): Transport {
  const channelName = options.channelName ?? 'markup-assistant'
  const senderId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

  const broadcast: BroadcastChannel | null =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null

  const handlers = new Set<(e: Envelope) => void>()

  if (broadcast) {
    broadcast.onmessage = (event: MessageEvent) => {
      const envelope = event.data as (Envelope & { senderId?: string }) | undefined
      if (!envelope || typeof envelope !== 'object') return
      if (envelope.senderId === senderId) return // our own echo
      for (const h of [...handlers]) h(envelope)
    }
  }

  const publishAll = (envelope: Envelope) => {
    const tagged: Envelope & { senderId: string } = { ...envelope, senderId }
    broadcast?.postMessage(tagged)
  }

  const makeSide = (): Bus => ({
    publish(envelope) {
      publishAll(envelope)
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  })

  return {
    connectSideA: makeSide,
    connectSideB: makeSide,
  }
}
