/**
 * Source context for the engine: given the DOM snapshot the overlay sent,
 * find where that text lives in the project's source files and hand the
 * model exact excerpts. This is what turns "make it bright green" into a
 * find/replace edit with a `find` string that actually exists on disk —
 * the model sees the real source instead of guessing.
 *
 * Deliberately dumb and bounded: substring search over text previews, a
 * fixed set of source extensions, a file-count cap, and a char budget.
 * Never follows symlinks, never leaves the root.
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
 * Walk `root`'s source files, find lines containing any of `needles`
 * (case-insensitive), and return per-file excerpts around the first hit,
 * most-needle-matching files first. Returns undefined when nothing matches.
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
    matches: number
  }
  const candidates: Candidate[] = []
  for (const file of files) {
    let content: string
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    let firstLine = -1
    let matches = 0
    for (let i = 0; i < lines.length; i++) {
      const line = (lines[i] ?? '').toLowerCase()
      const hit = clean.some((needle) => line.includes(needle.toLowerCase()))
      if (hit) {
        matches += 1
        if (firstLine === -1) firstLine = i
      }
    }
    if (firstLine === -1) continue
    candidates.push({
      rel: file.slice(rootAbs.length + 1).replace(/\\/g, '/'),
      firstLine,
      matches,
    })
  }
  if (!candidates.length) return undefined

  // Most matches first; ties keep walk order (shallower dirs already earlier).
  candidates.sort((a, b) => b.matches - a.matches)

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
    const from = Math.max(0, cand.firstLine - CONTEXT_LINES)
    const to = Math.min(lines.length, cand.firstLine + CONTEXT_LINES + 1)
    const body = lines
      .slice(from, to)
      .map((l, i) => `${String(from + i + 1).padStart(4, ' ')} | ${l}`)
      .join('\n')
    const section = `--- ${cand.rel} (line ${cand.firstLine + 1}, ${cand.matches} match${cand.matches === 1 ? '' : 'es'}) ---\n${body}`
    if (total + section.length > maxChars) break
    sections.push(section)
    total += section.length + 2
  }
  return sections.length ? sections.join('\n\n') : undefined
}

/**
 * Text previews from serializeDom snapshot lines as search needles. Lines
 * look like: `div "Some visible text" [12,34 100x40]`. Prefers longer
 * previews — they discriminate better — and strips truncation ellipses.
 */
export function needlesFromDomSnapshot(dom: string, max = 12): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const line of dom.split('\n')) {
    const m = line.match(/"([^"]{4,120})"/)
    if (!m?.[1]) continue
    const text = m[1].trim().replace(/(?:…|\.\.\.)+$/, '').trim()
    if (text.length < 4 || seen.has(text)) continue
    seen.add(text)
    found.push(text)
  }
  // Longest first: a full sentence pins the exact component, a four-letter
  // word matches half the repo.
  found.sort((a, b) => b.length - a.length)
  return found.slice(0, max)
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
