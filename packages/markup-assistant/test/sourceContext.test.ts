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
    // REAL serializeDom output: <tag.cls> [x,y wxh] "text"
    const dom = [
      '<div> [0,0 10x10] "Plan"',
      '<h1.title> [0,20 300x40] "Welcome to your retirement plan"',
      '<p> [0,70 300x20] "Track your savings here."',
      '<h1.title> [0,20 300x40] "Welcome to your retirement plan"',
    ].join('\n')
    const needles = needlesFromDomSnapshot(dom)
    expect(needles).toEqual([
      'Welcome to your retirement plan',
      'Track your savings here.',
      'Plan',
    ])
  })

  it('strips truncation ellipses and skips tiny fragments', () => {
    const dom = '<span> [0,0 1x1] "A"\n<p> [0,0 9x9] "Some longer sentence tha…"'
    expect(needlesFromDomSnapshot(dom)).toEqual(['Some longer sentence tha'])
  })

  it('turns angle-bracket class chains into verbatim className needles, first', () => {
    // The snapshot's `<div.bg-white.border.p-3>` mirrors the JSX attribute
    // `className="bg-white border p-3"` — the needle that finds the component
    // when the visible text is dynamic. (The leading `<` used to break the
    // selector match entirely.)
    const dom = [
      '<div.bg-white.border.p-3> [16,120 60x36] "Never"',
      '<div> [16,160 220x16] "combined accounts · you 84 · spouse never"',
    ].join('\n')
    const needles = needlesFromDomSnapshot(dom)
    expect(needles[0]).toBe('bg-white border p-3')
    expect(needles).toContain('combined accounts · you 84 · spouse never')
  })

  it('ignores single-class selectors (too common to discriminate)', () => {
    const dom = '<div.card> [0,0 9x9] "Some visible text here"'
    expect(needlesFromDomSnapshot(dom)).toEqual(['Some visible text here'])
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

  it('skips test/spec files so fixtures never outrank real components', () => {
    writeFileSync(
      join(root, 'src', 'Welcome.test.tsx'),
      'const fixture = "Welcome to your retirement plan" // test fixture\n',
    )
    const ctx = gatherSourceContext(root, ['Welcome to your retirement plan'])
    expect(ctx).toBeDefined()
    expect(ctx).toContain('src/components/Welcome.tsx')
    expect(ctx).not.toContain('Welcome.test.tsx')
    rmSync(join(root, 'src', 'Welcome.test.tsx'), { force: true })
  })

  it('never reaches into node_modules and returns undefined on no hits', () => {
    const ctx = gatherSourceContext(root, ['Welcome to your retirement plan'])
    expect(ctx).not.toContain('node_modules')
    expect(gatherSourceContext(root, ['zzz nothing matches this zzz'])).toBeUndefined()
    expect(gatherSourceContext(root, [])).toBeUndefined()
  })
})
