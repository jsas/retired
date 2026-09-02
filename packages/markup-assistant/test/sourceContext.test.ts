import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { gatherSourceContext, needlesFromDomSnapshot } from '../src/vite/sourceContext.js'

const root = mkdtempSync(join(tmpdir(), 'ma-src-'))
mkdirSync(join(root, 'src/components'), { recursive: true })
mkdirSync(join(root, 'node_modules/fake'), { recursive: true })
writeFileSync(
  join(root, 'src/components/Welcome.tsx'),
  [
    'export function Welcome() {',
    '  return (',
    '    <div className="welcome">',
    '      <h1>Welcome to your retirement plan</h1>',
    '      <p>Track your savings here.</p>',
    '    </div>',
    '  )',
    '}',
  ].join('\n'),
)
writeFileSync(join(root, 'src/app.css'), '.welcome { color: navy; }\n')
writeFileSync(join(root, 'node_modules/fake/index.ts'), '// Welcome to your retirement plan\n')

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('needlesFromDomSnapshot', () => {
  it('extracts quoted text previews, longest first, deduped', () => {
    const dom = [
      'div "Plan" [0,0 10x10]',
      'h1 "Welcome to your retirement plan" [0,20 300x40]',
      'p "Track your savings here." [0,70 300x20]',
      'h1 "Welcome to your retirement plan" [0,20 300x40]',
    ].join('\n')
    const needles = needlesFromDomSnapshot(dom)
    expect(needles).toEqual([
      'Welcome to your retirement plan',
      'Track your savings here.',
      'Plan',
    ])
  })

  it('strips truncation ellipses and skips tiny fragments', () => {
    const dom = 'span "A" [0,0 1x1]\np "Some longer sentence tha…" [0,0 9x9]'
    expect(needlesFromDomSnapshot(dom)).toEqual(['Some longer sentence tha'])
  })
})

describe('gatherSourceContext', () => {
  it('finds the file containing the needle and returns a verbatim excerpt', () => {
    const ctx = gatherSourceContext(root, ['Welcome to your retirement plan'])
    expect(ctx).toBeDefined()
    expect(ctx).toContain('src/components/Welcome.tsx')
    // The excerpt line must match the file byte-for-byte (no gutter): the
    // model copies it into a `find` string that has to hit on disk.
    expect(ctx).toContain('      <h1>Welcome to your retirement plan</h1>')
    expect(ctx).not.toMatch(/\|.*<h1>/)
    // the header orients with the line range
    expect(ctx).toContain('(lines 1-8)')
  })

  it('orders files by match count and respects the char budget', () => {
    const ctx = gatherSourceContext(root, [
      'Welcome to your retirement plan',
      'Track your savings here',
      'color: navy',
    ])
    expect(ctx).toContain('src/components/Welcome.tsx')
    expect(ctx).toContain('src/app.css')
    const tiny = gatherSourceContext(root, ['Welcome to your retirement plan'], 40)
    expect(tiny).toBeUndefined() // excerpt header alone exceeds the budget
  })

  it('never reaches into node_modules and returns undefined on no hits', () => {
    const ctx = gatherSourceContext(root, ['Welcome to your retirement plan'])
    expect(ctx).not.toContain('node_modules')
    expect(gatherSourceContext(root, ['zzz nothing matches this zzz'])).toBeUndefined()
    expect(gatherSourceContext(root, [])).toBeUndefined()
  })
})
