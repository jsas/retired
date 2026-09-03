/**
 * Exact-string patch primitives. `find` must occur exactly once — this is
 * the safety property that makes model-produced source edits trustworthy:
 * ambiguous patches fail closed instead of corrupting a file.
 *
 * The one tolerance: newlines. Models emit LF line endings; a Windows
 * checkout has CRLF files. A multi-line `find` that's otherwise verbatim
 * must still apply, so each `\n` in `find` matches `\r?\n` in the file —
 * and the replacement adopts the matched region's line-ending style so we
 * never mix endings inside one file.
 */

export interface PatchResult {
  ok: boolean
  /** New file content when ok. */
  content?: string
  /** Machine-readable reason when not ok. */
  reason?: 'not-found' | 'ambiguous'
  /** How many occurrences of `find` were present. */
  occurrences?: number
}

export function applyTextPatch(content: string, find: string, replace: string): PatchResult {
  if (find === '') return { ok: false, reason: 'ambiguous', occurrences: content.length + 1 }

  // Fast path: byte-exact match.
  const first = content.indexOf(find)
  if (first !== -1) {
    const second = content.indexOf(find, first + 1)
    if (second !== -1) return { ok: false, reason: 'ambiguous', occurrences: 2 }
    return {
      ok: true,
      content: content.slice(0, first) + replace + content.slice(first + find.length),
    }
  }

  // Single-line finds have nothing to normalize — it really isn't there.
  if (!find.includes('\n')) return { ok: false, reason: 'not-found', occurrences: 0 }

  // Line-ending-tolerant match: every newline in `find` accepts CRLF or LF.
  const matches = findNewlineTolerant(content, find)
  if (matches.length === 0) return { ok: false, reason: 'not-found', occurrences: 0 }
  if (matches.length > 1) return { ok: false, reason: 'ambiguous', occurrences: matches.length }

  const m = matches[0]!
  const matched = content.slice(m.index, m.index + m.length)
  const eol = matched.includes('\r\n') ? '\r\n' : '\n'
  const normalizedReplace = replace.replace(/\r\n/g, '\n').split('\n').join(eol)
  return {
    ok: true,
    content: content.slice(0, m.index) + normalizedReplace + content.slice(m.index + m.length),
  }
}

/** All spans where `find` matches `content`, treating each `\n` as `\r?\n`. */
function findNewlineTolerant(content: string, find: string): Array<{ index: number; length: number }> {
  const normFind = find.replace(/\r\n/g, '\n')
  const pattern = new RegExp(
    normFind
      .split('\n')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\r?\\n'),
    'g',
  )
  const out: Array<{ index: number; length: number }> = []
  for (const m of content.matchAll(pattern)) {
    out.push({ index: m.index, length: m[0].length })
    if (out.length > 1) break // ambiguity is all the caller needs
  }
  return out
}
