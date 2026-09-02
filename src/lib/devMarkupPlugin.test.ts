import { describe, expect, it } from 'vitest'
import { devMarkupOverlay } from './devMarkupPlugin.js'

describe('devMarkupOverlay', () => {
  it('returns no plugins when MARKUP_MODEL_ENDPOINT is unset', () => {
    expect(devMarkupOverlay({ env: {} })).toEqual([])
    expect(devMarkupOverlay({ env: { MARKUP_MODEL_API_KEY: 'x' } })).toEqual([])
  })

  it('builds bridge + bootstrap plugins when enabled', () => {
    const plugins = devMarkupOverlay({
      env: { MARKUP_MODEL_ENDPOINT: 'http://x', MARKUP_MODEL: 'm' },
    })
    expect(plugins).toHaveLength(2)
    const names = plugins.map((p) => p?.name ?? '')
    expect(names).toContain('markup-assistant')
    expect(names).toContain('dev-markup-overlay-bootstrap')
  })

  it('falls back to the stub engine when endpoint set but model missing', () => {
    // Endpoint-only env: still enabled (you can exercise the loop offline).
    const plugins = devMarkupOverlay({ env: { MARKUP_MODEL_ENDPOINT: 'http://x' } })
    expect(plugins).toHaveLength(2)
  })

  it('honors auto-apply and vision toggles without throwing', () => {
    const plugins = devMarkupOverlay({
      env: {
        MARKUP_MODEL_ENDPOINT: 'http://x',
        MARKUP_MODEL: 'm',
        MARKUP_AUTO_APPLY: '0',
        MARKUP_MODEL_VISION: '1',
        MARKUP_HOTKEY: 'alt+k',
      },
    })
    expect(plugins).toHaveLength(2)
  })
})
