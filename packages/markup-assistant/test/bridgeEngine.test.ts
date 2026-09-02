import { describe, expect, it } from 'vitest'
import type { Bridge } from '@retired/ai-bridge'
import { createBridgeEngine } from '../src/engine/bridgeEngine.js'
import type { Intent } from '../src/core/index.js'

/** A fake bridge whose chat() returns a scripted reply. */
function fakeBridge(reply: string): Bridge {
  return {
    chat: async () => ({ text: reply, stopReason: 'end_turn' }),
  } as unknown as Bridge
}

function noteIntent(text: string): Intent {
  return {
    kind: 'note',
    text,
    anchor: { x: 10, y: 10 },
  }
}

describe('createBridgeEngine', () => {
  it('rejects when there is no intent', async () => {
    const engine = createBridgeEngine(fakeBridge('{}'))
    const d = await engine.decide({ interactionId: 'x', intents: [] })
    expect(d.rejection).toMatch(/no intent/)
    expect(d.edits).toHaveLength(0)
  })

  it('parses a fenced-JSON dom edit decision', async () => {
    const reply =
      'Sure, applying that now.\n```json\n{"edits":[{"kind":"dom","description":"bigger heading","ops":[{"op":"setStyle","selector":"h1","styles":{"font-size":"2em"}}]}]}\n```'
    const engine = createBridgeEngine(fakeBridge(reply))
    const d = await engine.decide({ interactionId: 'x', intents: [noteIntent('make it bigger')] })
    expect(d.rejection).toBeUndefined()
    expect(d.edits).toHaveLength(1)
    const edit = d.edits[0]!
    expect(edit.kind).toBe('dom')
    if (edit.kind === 'dom') {
      expect(edit.ops[0]).toMatchObject({ op: 'setStyle', selector: 'h1' })
    }
  })

  it('parses a rejection decision', async () => {
    const engine = createBridgeEngine(fakeBridge('{"rejection":"which heading did you mean?"}'))
    const d = await engine.decide({ interactionId: 'x', intents: [noteIntent('bigger')] })
    expect(d.rejection).toBe('which heading did you mean?')
    expect(d.edits).toHaveLength(0)
  })

  it('rejects unparseable replies instead of throwing', async () => {
    const engine = createBridgeEngine(fakeBridge('no json here at all'))
    const d = await engine.decide({ interactionId: 'x', intents: [noteIntent('hi')] })
    expect(d.rejection).toMatch(/parse/)
  })

  it('rejects replies with the wrong shape (e.g. source edits)', async () => {
    const reply = '{"edits":[{"kind":"text","file":"a.ts","find":"x","replace":"y"}]}'
    const engine = createBridgeEngine(fakeBridge(reply))
    const d = await engine.decide({ interactionId: 'x', intents: [noteIntent('hi')] })
    // text edits are not valid here (only dom edits), so the schema rejects it
    expect(d.rejection).toBeTruthy()
    expect(d.edits).toHaveLength(0)
  })

  it('turns a thrown bridge.chat into a rejection', async () => {
    const bridge = {
      chat: async () => {
        throw new Error('model exploded')
      },
    } as unknown as Bridge
    const engine = createBridgeEngine(bridge)
    const d = await engine.decide({ interactionId: 'x', intents: [noteIntent('hi')] })
    expect(d.rejection).toMatch(/model exploded/)
  })
})
