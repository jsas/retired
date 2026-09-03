/**
 * Source context for the engine: given the DOM snapshot the overlay sent,
 * find where that text lives in the project's source files and hand the
 * model exact excerpts. This is what turns "make it bright green" into a
 * find/replace edit with a `find` string that actually exists on disk —
 * the model sees the real source instead of guessing.
 *
 * Deliberately dumb and bounded: substring search over text previews and
 * element class strings, a fixed set of source extensions, a file-count
 * cap, and a char budget. Never follows symlinks, never leaves the root.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SOURCE_EXTS = new Set(['.tsx', '.ts', '.jsx', '.js', '.css', '.html'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.vite'])
const MAX_FILES = 400
const MAX_FILE_BYTES = 200_000
const CONTEXT_LINES = 6
const DEFAULT_BUDGET = 14_000

/**
 * Relevance tier for a file name: components that render UI come first.
 * Without this, a *.test.ts fixture full of on-screen strings ("Never",
 * "5.3%") outranks the component that actually renders them and eats the
 * char budget — the model then complains the real file wasn't included.
 */
function tierOf(name: string): number {
  if (/\.test\.|\.spec\.|\.stories\./.test(name)) return 99
  const dot = name.lastIndexOf('.')
  const ext = dot === -1 ? '' : name.slice(dot).toLowerCase()
  if (ext === '.tsx' || ext === '.jsx') return 0
  if (ext === '.css' || ext === '.html') return 1
  return 2
}

/**
 * Walk `root`'s source files, find lines containing any of `needles`
 * (case-insensitive), and return per-file excerpts around the first hit —
 * UI source first, then by match count. Returns undefined when nothing
 * matches.
 */
export function gatherSourceContext(
  root: string,
  needles: string[],
  maxChars = DEFAULT_BUDGET,
): string | undefined {
  const clean = [...new Set(needles.map((n) => n.trim()).filter((n) => n.length >= 4))]
  if (!clean.length) return undefined
  const files = listSourceFiles(resolve(root))
  if (!files.length) return undefined

  const rootAbs = resolve(root)
  interface Candidate {
    rel: string
    firstLine: number
    /** Last line containing a needle — the excerpt must span the whole hit range. */
    lastLine: number
    /** Distinct needles found in the file — breadth beats raw line count. */
    matches: number
    tier: number
  }
  const candidates: Candidate[] = []
  const lowerNeedles = clean.map((n) => n.toLowerCase())
  for (const file of files) {
    const sepIdx = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
    const name = sepIdx === -1 ? file : file.slice(sepIdx + 1)
    const tier = tierOf(name)
    if (tier === 99) continue
    let content: string
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    const matched = new Set<number>()
    const hitLines: number[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] ?? '').toLowerCase()
      let hit = false
      for (let n = 0; n < lowerNeedles.length; n++) {
        if (matched.has(n)) continue
        if (line.includes(lowerNeedles[n]!)) {
          matched.add(n)
          hit = true
        }
      }
      if (hit) hitLines.push(i)
    }
    if (hitLines.length === 0) continue
    candidates.push({
      rel: file.slice(rootAbs.length + 1).replace(/\\/g, '/'),
      firstLine: hitLines[0]!,
      lastLine: hitLines[hitLines.length - 1]!,
      matches: matched.size,
      tier,
    })
  }
  if (!candidates.length) return undefined

  // UI components before stylesheets before logic; within a tier, the file
  // matching the most DISTINCT needles wins — a component carrying both the
  // element's classes and its exact on-screen text is the one the user
  // circled, not some other file that shares a common Tailwind class.
  candidates.sort((a, b) => a.tier - b.tier || b.matches - a.matches)

  const sections: string[] = []
  let total = 0
  for (const cand of candidates) {
    let content: string
    try {
      content = readFileSync(join(rootAbs, ...cand.rel.split('/')), 'utf8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    // The excerpt must span the whole hit range: a card grid's four cards can
    // sit 20+ lines apart, so centering on the first hit would cut off the
    // card the user actually circled. Pad a little on each side.
    const from = Math.max(0, cand.firstLine - CONTEXT_LINES)
    const to = Math.min(lines.length, cand.lastLine + CONTEXT_LINES + 1)
    // Show the lines VERBATIM (no line-number gutter): the model copies this
    // text into a `find` string, and any prefix we add would never match the
    // file on disk. The header carries the starting line for orientation.
    const body = lines.slice(from, to).join('\n')
    // "file: <path>" header — a component name alone invites the model to
    // guess ("ProjectionSummary.tsx" for a circled summary card that really
    // lives in MetricCards.tsx), and a guessed path fails with file
    // unreadable.
    const section = `file: ${cand.rel} (lines ${from + 1}-${to})\n${body}`
    if (total + section.length > maxChars) break
    sections.push(section)
    total += section.length + 2
  }
  return sections.length ? sections.join('\n\n') : undefined
}

/**
 * Search needles from serializeDom snapshot lines. Two kinds, most
 * discriminating first:
 *
 *  1. Class strings. A line's selector token `div.bg-white.border.p-3`
 *     becomes `bg-white border p-3` — which appears VERBATIM inside the
 *     JSX `className="..."` attribute that renders the element. This is the
 *     needle that finds the component when the on-screen text is dynamic
 *     ("Never", "$2,824,194") and lives in engine code, not markup.
 *  2. Text previews (`... "some visible text"`), longest first — a full
 *     sentence pins the exact component; a four-letter word matches half
 *     the repo.
 */
export function needlesFromDomSnapshot(dom: string, max = 12): string[] {
  const classNeedles: string[] = []
  const textNeedles: string[] = []
  const seen = new Set<string>()
  for (const line of dom.split('\n')) {
    // Selector token: first non-space run, e.g. `div.bg-white.border.p-3`
    // or `#metric-card`. Only the leading token of a snapshot line.
    const sel = line.match(/^\s*([a-zA-Z][\w.#-]*)/)?.[1]
    if (sel && sel.includes('.')) {
      const classes = sel
        .split('.')
        .slice(1) // drop the tag name
        .filter((c) => c && !c.startsWith('#'))
      // Two or more classes joined with spaces match a real className
      // attribute; one class alone matches half the app.
      if (classes.length >= 2) {
        const needle = classes.join(' ')
        if (!seen.has(needle)) {
          seen.add(needle)
          classNeedles.push(needle)
        }
      }
    }
    const m = line.match(/"([^"]{4,120})"/)
    if (!m?.[1]) continue
    const text = m[1].trim().replace(/(?:…|\.\.\.)+$/, '').trim()
    if (text.length < 4 || seen.has(text)) continue
    seen.add(text)
    textNeedles.push(text)
  }
  textNeedles.sort((a, b) => b.length - a.length)
  return [...classNeedles, ...textNeedles].slice(0, max)
}

function listSourceFiles(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || files.length >= MAX_FILES) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    entries.sort()
    for (const name of entries) {
      if (files.length >= MAX_FILES) return
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(full, depth + 1)
        continue
      }
      const dot = name.lastIndexOf('.')
      if (dot === -1) continue
      if (!SOURCE_EXTS.has(name.slice(dot).toLowerCase())) continue
      if (st.size > MAX_FILE_BYTES) continue
      files.push(full)
    }
  }
  walk(root, 0)
  return files
}
