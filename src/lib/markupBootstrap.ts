/**
 * Facade injected by the dev markup plugin. Attaches the overlay to the
 * dev-server bus via the fetch/SSE transport and supplies the non-secret
 * config the plugin serialized into the page (hotkey, vision, dom-snapshot).
 * Model credentials never leave the dev server; the page only calls the
 * same-origin /__markup_assistant__ endpoints.
 */
import { attachOverlay } from '@retired/markup-assistant'
import { createFetchBus } from '@retired/markup-assistant'

declare global {
  const __MARKUP_ASSISTANT_CONFIG__: {
    hotkey: unknown
    captureImage: boolean
    captureDom: boolean
  }
}

const cfg = __MARKUP_ASSISTANT_CONFIG__
const bus = createFetchBus({ prefix: '/__markup_assistant__' })
attachOverlay({
  bus,
  source: 'overlay',
  hotkey: (cfg.hotkey ?? undefined) as never,
  captureImage: cfg.captureImage,
  captureDom: cfg.captureDom,
})
