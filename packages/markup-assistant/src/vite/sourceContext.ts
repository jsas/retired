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
    /** Every line containing at least one needle (ascending). */
    hitLines: number[]
    /** Distinct needles found in the file — breadth beats raw line count. */
    matches: number
    tier: number
  }
  const candidates: Candidate[] = []
  const lowerNeedles = clean.map((n) => n.toLowerCase())
  // Needle weight decays with gesture-proximity rank: the first needle (the
  // circled element's own class chain) is worth far more than the 20th (some
  // toolbar button three screens away). Without decay, a file can outscore
  // the circled component purely by matching many far-away junk needles.
  const weight = (n: number): number => 1 / (1 + n * 0.2)
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
    let score = 0
    const hitLines: number[] = []
    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] ?? '').toLowerCase()
      let hit = false
      for (let n = 0; n < lowerNeedles.length; n++) {
        if (matched.has(n)) continue
        if (line.includes(lowerNeedles[n]!)) {
          matched.add(n)
          score += weight(n)
          hit = true
        }
      }
      if (hit) hitLines.push(i)
    }
    if (hitLines.length === 0) continue
    candidates.push({
      rel: file.slice(rootAbs.length + 1).replace(/\\/g, '/'),
      hitLines,
      matches: score,
      tier,
    })
  }
  if (!candidates.length) return undefined

  // UI components before stylesheets before logic; within a tier, the file
  // scoring highest wins — score weights each matched needle by its
  // gesture-proximity rank, so a component carrying the circled element's
  // own class chain and on-screen text outranks a file that merely matches
  // many far-away toolbar needles.
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
    const [from, to] = excerptWindow(cand.hitLines, lines.length)
    // Show the lines VERBATIM (no line-number gutter): the model copies this
    // text into a `find` string, and any prefix we add would never match the
    // file on disk. The header carries the starting line for orientation.
    const body = lines.slice(from, to).join('\n')
    // "file: <path>" header — a component name alone invites the model to
    // guess ("ProjectionSummary.tsx" for a circled summary card that really
    // lives in MetricCards.tsx), and a guessed path fails with file
    // unreadable.
    const section = `file: ${cand.rel} (lines ${from + 1}-${to})\n${body}`
    // `continue`, not `break`: one candidate whose window overflows the
    // budget must not starve every smaller candidate behind it.
    if (total + section.length > maxChars) continue
    sections.push(section)
    total += section.length + 2
  }
  return sections.length ? sections.join('\n\n') : undefined
}

/** Max lines one file's excerpt may span; windows beyond this get truncated. */
const MAX_WINDOW_LINES = 90

/**
 * Pick the excerpt window for a file's hit lines. When the hits cluster (the
 * normal case — the circled component's classes+text hit within a few lines),
 * the window spans them all, padded. When junk needles scatter hits across a
 * huge file, a first→last span would be the whole file; fall back to the
 * densest window — the region with the most distinct hits per line.
 */
function excerptWindow(hitLines: number[], lineCount: number): [number, number] {
  const pad = CONTEXT_LINES
  const first = hitLines[0]!
  const last = hitLines[hitLines.length - 1]!
  if (last - first + 1 + 2 * pad <= MAX_WINDOW_LINES) {
    return [Math.max(0, first - pad), Math.min(lineCount, last + pad + 1)]
  }
  // Densest window: slide a MAX_WINDOW_LINES-wide frame, maximize hit count
  // inside it (ties → earlier window, stable for tests and retries).
  const width = MAX_WINDOW_LINES
  let bestStart = first
  let bestCount = -1
  for (const startHit of hitLines) {
    const start = startHit
    const end = start + width
    let count = 0
    for (const h of hitLines) {
      if (h >= start && h < end) count += 1
      else if (h >= end) break
    }
    if (count > bestCount) {
      bestCount = count
      bestStart = start
    }
  }
  return [Math.max(0, bestStart - pad), Math.min(lineCount, bestStart + width)]
}

/**
 * Search needles from serializeDom snapshot lines. Two kinds, most
 * discriminating first. A serializeDom line looks like:
 *
 *   <div.bg-white.border.p-3> [420,96 200x16] "WITHDRAWAL RATE"
 *
 * (tag+classes in angle brackets, geometry in […], text preview quoted at
 * the end). Two needle kinds:
 *
 *  1. Class strings. `<div.bg-white.border.p-3>` becomes `bg-white border
 *     p-3` — which appears VERBATIM inside the JSX `className="..."`
 *     attribute that renders the element. This is the needle that finds the
 *     component when the on-screen text is dynamic ("Never", "$2,824,194").
 *  2. Text previews (`... "some visible text"`), longest first — a full
 *     sentence pins the exact component; a four-letter word matches half
 *     the repo.
 */
export function needlesFromDomSnapshot(dom: string, max = 24): string[] {
  // serializeDom emits the snapshot FOCUS-SORTED — the element nearest the
  // gesture comes first. That ordering is the single most reliable signal we
  // have for which element the user means, so preserve it: a needle's rank is
  // its distance from the gesture. (Re-sorting by text length or rarity would
  // throw the proximity signal away and let a dense form's many junk labels
  // flood out the one label that identifies the circled element.)
  const classNeedles: string[] = []
  const textNeedles: string[] = []
  const seenClasses = new Set<string>()
  const seenText = new Set<string>()
  for (const line of dom.split('\n')) {
    // Selector token inside the angle brackets: `tag.cls.cls`, `tag#id`, or
    // Tailwind arbitrary values like `text-[10px]`. Capture up to whitespace
    // or `>` — the old `[\w.#-]*` regex stopped dead at `[`, dropping the
    // class chain of EVERY element carrying an arbitrary-value class.
    const sel = line.match(/<\s*([^\s>]+)/)?.[1]
    if (sel && sel.includes('.')) {
      const raw = sel
        .split('.')
        .slice(1) // drop the tag name
        .filter((c) => c && !c.startsWith('#'))
      // Tailwind decimals (`gap-1.5`, `mt-0.5`) split on the '.' separator —
      // `gap-1` + `5`. A purely-numeric fragment is the decimal tail of the
      // previous class, never a standalone class; merge it back so the needle
      // matches the className attribute verbatim.
      const classes: string[] = []
      for (const c of raw) {
        const prev = classes[classes.length - 1]
        if (prev && /^\d{1,2}$/.test(c)) classes[classes.length - 1] = `${prev}.${c}`
        else classes.push(c)
      }
      // Two or more classes joined with spaces match a real className
      // attribute; one class alone matches half the app.
      if (classes.length >= 2) {
        const needle = classes.join(' ')
        if (!seenClasses.has(needle)) {
          seenClasses.add(needle)
          classNeedles.push(needle)
        }
      }
    }
    const m = line.match(/"([^"]{4,120})"/)
    if (!m?.[1]) continue
    const text = m[1].trim().replace(/(?:…|\.\.\.)+$/, '').trim()
    if (text.length < 4 || seenText.has(text)) continue
    // serializeDom truncates previews at 60 chars; a LEAF element (a label, a
    // value) stays under that. A PARENT element concatenates its whole
    // subtree's text ("Withdrawal Rate5.3%spouse 3.1%") — that blob can never
    // match a source line and only burns search slots (and, at the hard cap,
    // crowds out the leaf label that would have). Skip previews that read like
    // a concatenation: multiple run-together words with no separator.
    if (isGluedBlob(text)) continue
    seenText.add(text)
    textNeedles.push(text)
  }
  // Class needles first (they pin the component even when its text is dynamic
  // like "$2,824,194") — but only the closest-to-gesture ones. A busy page
  // yields dozens of neighbor class chains (icon kits, toolbars) that would
  // crowd out the element's OWN on-screen text — the needle that actually
  // discriminates between components. So: lead with the nearest class chains,
  // reserve slots for text previews, then let remaining chains fill any room.
  const CLASS_LEAD = 10
  return [
    ...classNeedles.slice(0, CLASS_LEAD),
    ...textNeedles,
    ...classNeedles.slice(CLASS_LEAD),
  ].slice(0, max)
}

/**
 * True when a text preview reads like a parent element's concatenated subtree
 * ("Projection SummaryHousehold Wealth…", "$2,824,194you $1,596,455",
 * "Withdrawal Rate5.3%spouse 3.1%"): fingerprints of run-together subtree
 * text — lowercase→uppercase inside a word, a digit glued to a lowercase
 * word, or a lowercase word glued to a digit. Leaf text ("Withdrawal Rate",
 * "5.3%", "spouse 3.1%") never has any of these.
 */
function isGluedBlob(text: string): boolean {
  return /[a-z][A-Z]/.test(text) || /\d[a-z]/.test(text) || /[a-z]\d/.test(text)
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
