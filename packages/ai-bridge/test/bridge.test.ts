import { describe, expect, it } from 'vitest'
import {
  createBridge,
  BUILTIN_MODELS,
  connectionReady,
  type AiConnection,
} from '../src/index.js'

const localConn: AiConnection = {
  id: 'c-local',
  provider: 'webllm',
  label: 'Local Qwen',
  apiKey: '',
  model: 'Qwen3.5-4B-q4f16_1-MLC',
}

const remoteConn: AiConnection = {
  id: 'c-remote',
  provider: 'anthropic',
  label: 'My Claude key',
  apiKey: 'sk-test',
  model: 'claude-sonnet-4-20250514',
}

describe('ai-bridge registry', () => {
  it('ships built-in local (webgpu) and remote models', () => {
    const local = BUILTIN_MODELS.filter((m) => m.local)
    const remote = BUILTIN_MODELS.filter((m) => !m.local)
    expect(local.length).toBeGreaterThan(0)
    expect(remote.length).toBeGreaterThan(0)
    expect(local.every((m) => m.provider === 'webllm')).toBe(true)
  })

  it('marks exactly one recommended model', () => {
    expect(BUILTIN_MODELS.filter((m) => m.recommended)).toHaveLength(1)
  })
})

describe('createBridge', () => {
  it('lists built-ins plus one model per saved connection', () => {
    const bridge = createBridge({ connections: [localConn, remoteConn] })
    expect(bridge.model('conn:c-local')?.label).toBe('Local Qwen')
    expect(bridge.model('conn:c-remote')?.requiresKey).toBe(true)
    // built-ins still present
    expect(bridge.model('local:qwen3.5-4b')).toBeTruthy()
  })

  it('prefers a ready connection over the registry recommendation', () => {
    const bridge = createBridge({ connections: [localConn] })
    expect(bridge.selected().id).toBe('conn:c-local')
  })

  it('falls back to the recommended built-in when nothing is ready', () => {
    // remote conn has no key -> not ready; should land on the recommended built-in
    const noKey: AiConnection = { ...remoteConn, apiKey: '' }
    const bridge = createBridge({ connections: [noKey] })
    expect(bridge.selected().recommended).toBe(true)
  })

  it('select switches the active model and rejects unknown ids', () => {
    const bridge = createBridge({ connections: [localConn, remoteConn] })
    bridge.select('local:phi4-mini')
    expect(bridge.selected().id).toBe('local:phi4-mini')
    expect(() => bridge.select('nope')).toThrow(/unknown model/)
  })

  it('exposes the selected model as a connection for streaming', () => {
    const bridge = createBridge({ connections: [remoteConn] })
    bridge.select('conn:c-remote')
    expect(bridge.connection().provider).toBe('anthropic')
    expect(bridge.connection().apiKey).toBe('sk-test')
    expect(bridge.ready()).toBe(true)
  })

  it('webgpu models are ready keyless; keyed remote models are not until configured', () => {
    const bridge = createBridge()
    bridge.select('local:qwen3.5-4b')
    expect(bridge.ready()).toBe(true)
    bridge.select('remote:claude-sonnet')
    expect(bridge.ready()).toBe(false) // registry preset carries no key
  })

  it('streamChat throws when the selected model is not ready', () => {
    const bridge = createBridge()
    bridge.select('remote:claude-sonnet')
    expect(() => bridge.streamChat({ system: '', messages: [] })).toThrow(/not ready/)
  })

  it('connectionReady still governs readiness semantics', () => {
    expect(connectionReady(localConn)).toBe(true)
    expect(connectionReady({ ...remoteConn, apiKey: '' })).toBe(false)
    expect(connectionReady(remoteConn)).toBe(true)
  })
})
