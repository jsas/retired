import { describe, expect, it } from 'vitest'
import {
  markupEnvEnabled,
  openaiEngineFromEnv,
  parseHotkey,
  readMarkupEnv,
} from '../src/engine/envConfig.js'

describe('parseHotkey', () => {
  it('defaults to ctrl+shift+m', () => {
    expect(parseHotkey(undefined)).toEqual({ ctrl: true, shift: true, meta: false, key: 'm' })
  })
  it('parses a custom chord', () => {
    expect(parseHotkey('ctrl+shift+k')).toEqual({ ctrl: true, shift: true, meta: false, key: 'k' })
    expect(parseHotkey('alt+m')).toEqual({ ctrl: false, shift: false, meta: false, key: 'm' })
    expect(parseHotkey('meta+shift+z')).toEqual({ ctrl: false, shift: true, meta: true, key: 'z' })
  })
  it('is case-insensitive and tolerates spaces', () => {
    expect(parseHotkey(' Ctrl + Shift + M ')).toEqual({ ctrl: true, shift: true, meta: false, key: 'm' })
  })
  it('falls back on an empty spec', () => {
    expect(parseHotkey('')).toEqual({ ctrl: true, shift: true, meta: false, key: 'm' })
  })
})

describe('readMarkupEnv', () => {
  it('reads the model endpoint/key/model', () => {
    const cfg = readMarkupEnv({
      MARKUP_MODEL_ENDPOINT: 'http://localhost:1234/v1/chat/completions',
      MARKUP_MODEL_API_KEY: 'secret',
      MARKUP_MODEL: 'qwen-vl',
    })
    expect(cfg.endpoint).toBe('http://localhost:1234/v1/chat/completions')
    expect(cfg.apiKey).toBe('secret')
    expect(cfg.model).toBe('qwen-vl')
  })

  it('vision is opt-in (off unless truthy)', () => {
    expect(readMarkupEnv({}).vision).toBe(false)
    expect(readMarkupEnv({ MARKUP_MODEL_VISION: '0' }).vision).toBe(false)
    expect(readMarkupEnv({ MARKUP_MODEL_VISION: '1' }).vision).toBe(true)
    expect(readMarkupEnv({ MARKUP_MODEL_VISION: 'true' }).vision).toBe(true)
  })

  it('auto-apply defaults on, off when explicitly falsy', () => {
    expect(readMarkupEnv({}).autoApply).toBe(true)
    expect(readMarkupEnv({ MARKUP_AUTO_APPLY: '1' }).autoApply).toBe(true)
    expect(readMarkupEnv({ MARKUP_AUTO_APPLY: '0' }).autoApply).toBe(false)
    expect(readMarkupEnv({ MARKUP_AUTO_APPLY: 'false' }).autoApply).toBe(false)
  })

  it('dom snapshot defaults on, off when explicitly falsy', () => {
    expect(readMarkupEnv({}).domSnapshot).toBe(true)
    expect(readMarkupEnv({ MARKUP_DOM_SNAPSHOT: '0' }).domSnapshot).toBe(false)
  })

  it('threads the hotkey + system prompt through', () => {
    const cfg = readMarkupEnv({ MARKUP_HOTKEY: 'alt+k', MARKUP_SYSTEM_PROMPT: 'be terse' })
    expect(cfg.hotkey).toEqual({ ctrl: false, shift: false, meta: false, key: 'k' })
    expect(cfg.systemPrompt).toBe('be terse')
  })
})

describe('markupEnvEnabled / openaiEngineFromEnv', () => {
  it('is disabled without an endpoint', () => {
    expect(markupEnvEnabled({})).toBe(false)
    expect(markupEnvEnabled({ MARKUP_MODEL_API_KEY: 'x' })).toBe(false)
    expect(markupEnvEnabled({ MARKUP_MODEL_ENDPOINT: 'http://x' })).toBe(true)
  })

  it('builds an engine only when endpoint AND model are set', () => {
    expect(openaiEngineFromEnv({})).toBeNull()
    expect(openaiEngineFromEnv({ MARKUP_MODEL_ENDPOINT: 'http://x' })).toBeNull()
    expect(
      openaiEngineFromEnv({ MARKUP_MODEL_ENDPOINT: 'http://x', MARKUP_MODEL: 'm' }),
    ).not.toBeNull()
  })
})
