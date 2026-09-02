import { describe, expect, it } from 'vitest'
import { OpenAIEngine } from '../src/engine/openai.js'
import type { EngineInput } from '../src/engine/engine.js'

function questionInput(text: string): EngineInput {
  return {
    interactionId: 'ia_q',
    intents: [{ kind: 'note', text, anchor: { x: 1, y: 1 } } as EngineInput['intents'][number]],
  }
}

/** Stub fetch returning one apply_edits tool call with the given arguments. */
function fetchWith(args: object): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                { function: { name: 'apply_edits', arguments: JSON.stringify(args) } },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch
}

const OPTS = { endpoint: 'http://x', model: 'm' }

describe('OpenAIEngine question handling', () => {
  it('returns answer when the model fills the answer field', async () => {
    const eng = new OpenAIEngine({ ...OPTS, fetchImpl: fetchWith({ answer: 'It is "you".', edits: [] }) })
    const d = await eng.decide(questionInput('what is this word?'))
    expect(d.answer).toBe('It is "you".')
    expect(d.rejection).toBeUndefined()
  })

  it('treats a note-only reply to a question as an answer, not a rejection', async () => {
    const eng = new OpenAIEngine({
      ...OPTS,
      fetchImpl: fetchWith({ note: 'The circled word is "tired". No edit requested.', edits: [] }),
    })
    const d = await eng.decide(questionInput('what is this word'))
    expect(d.answer).toContain('tired')
    expect(d.rejection).toBeUndefined()
  })

  it('still rejects a zero-edit reply to a change request', async () => {
    const eng = new OpenAIEngine({
      ...OPTS,
      fetchImpl: fetchWith({ note: 'too ambiguous', edits: [] }),
    })
    const d = await eng.decide(questionInput('make it blue'))
    expect(d.answer).toBeUndefined()
    expect(d.rejection).toBe('too ambiguous')
  })
})
