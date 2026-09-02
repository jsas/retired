/**
 * A deterministic StubEngine for tests and demos: maps intent kinds to
 * canned decisions without a network call. Note -> setText on h1, stroke ->
 * recolor h1, arrow/move/cut -> move #box.
 */
import type { Engine, EngineDecision, EngineInput } from './engine.js'

export interface StubEngineOptions {
  /** Override individual intent kinds for tests. */
  overrides?: Partial<Record<string, EngineDecision>>
}

export function createStubEngine(options: StubEngineOptions = {}): Engine {
  const overrides = options.overrides ?? {}
  return {
    async decide(input: EngineInput): Promise<EngineDecision> {
      const intent = input.intents[0]
      if (!intent) {
        return { edits: [], rejection: 'no intent provided' }
      }
      const override = overrides[intent.kind]
      if (override) return override

      switch (intent.kind) {
        case 'note':
          return {
            edits: [
              {
                kind: 'dom',
                description: 'apply the note text to the heading',
                ops: [{ op: 'setText', selector: 'h1', text: intent.text }],
              },
            ],
          }
        case 'stroke':
          return {
            edits: [
              {
                kind: 'dom',
                description: 'recolor the heading per the markup',
                ops: [
                  { op: 'setStyle', selector: 'h1', styles: { color: '#ff3b30' } },
                  { op: 'setText', selector: 'h1', text: 'marked up!' },
                ],
              },
            ],
          }
        case 'arrow':
        case 'move':
        case 'cut':
          return {
            edits: [
              {
                kind: 'dom',
                description: 'relocate the dragged element',
                ops: [{ op: 'move', selector: '#box', x: 40, y: 40 }],
              },
            ],
          }
        case 'screenshot':
        case 'dom':
          return { edits: [], rejection: `stub has no ${intent.kind} decision` }
      }
    },
  }
}
