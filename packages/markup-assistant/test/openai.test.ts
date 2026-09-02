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

/** Stub fetch returning a plain-text assistant message (no tool call). */
function textWith(content: string): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch
}

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

  it('detects a question carried in a stroke note', async () => {
    const eng = new OpenAIEngine({
      ...OPTS,
      fetchImpl: fetchWith({ note: 'The checkbox suppresses the welcome screen.', edits: [] }),
    })
    const input: EngineInput = {
      interactionId: 'ia_s',
      intents: [
        {
          kind: 'stroke',
          strokes: [{ points: [{ x: 1, y: 1 }], color: '#f00', width: 3 }],
          bounds: { x: 1, y: 1, w: 20, h: 20 },
          note: 'what is this?',
        } as EngineInput['intents'][number],
      ],
    }
    const d = await eng.decide(input)
    expect(d.answer).toContain('checkbox')
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

  it('includes source excerpts as their own message when provided', async () => {
    let sent: { messages: Array<{ role: string; content: unknown }> } | undefined
    const spy = (async (_url: unknown, init: unknown) => {
      sent = JSON.parse(String((init as { body: string }).body))
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: 'apply_edits',
                      arguments: JSON.stringify({ edits: [] , note: 'done' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch
    const eng = new OpenAIEngine({ ...OPTS, fetchImpl: spy })
    await eng.decide({
      interactionId: 'ia_src',
      intents: [
        { kind: 'note', text: 'make it green', anchor: { x: 1, y: 1 } },
      ] as EngineInput['intents'],
      source: '--- src/app.css (line 1) ---\n   1 | .welcome { color: navy; }',
    })
    expect(sent).toBeDefined()
    const srcMsg = sent!.messages.find(
      (m) => typeof m.content === 'string' && m.content.includes('.welcome { color: navy; }'),
    )
    expect(srcMsg?.content).toContain('Source excerpts')
  })
})

describe('OpenAIEngine prose salvage (no tool call)', () => {
  it('answers a question with the model\'s plain text', async () => {
    const eng = new OpenAIEngine({
      ...OPTS,
      fetchImpl: textWith('The projection summary shows your household wealth at retirement.'),
    })
    const d = await eng.decide(questionInput('what is this section?'))
    expect(d.answer).toContain('household wealth')
    expect(d.rejection).toBeUndefined()
  })

  it('surfaces prose as the rejection reason for a change request', async () => {
    const eng = new OpenAIEngine({
      ...OPTS,
      fetchImpl: textWith('I could not find which element you circled.'),
    })
    const d = await eng.decide(questionInput('make it green'))
    expect(d.answer).toBeUndefined()
    expect(d.rejection).toContain('could not find')
  })

  it('parses a fenced JSON body as apply_edits arguments', async () => {
    const body = '```json\n{"edits":[{"kind":"text","file":"src/a.css","find":"color: navy","replace":"color: green","description":"green"}]}\n```'
    const eng = new OpenAIEngine({ ...OPTS, fetchImpl: textWith(body) })
    const d = await eng.decide(questionInput('make it green'))
    expect(d.edits).toHaveLength(1)
    expect(d.edits[0]).toMatchObject({ kind: 'text', file: 'src/a.css' })
    expect(d.rejection).toBeUndefined()
  })

  it('rejects with an explanation when the model returns nothing at all', async () => {
    const eng = new OpenAIEngine({ ...OPTS, fetchImpl: textWith('   ') })
    const d = await eng.decide(questionInput('make it green'))
    expect(d.rejection).toContain('apply_edits')
  })
})
