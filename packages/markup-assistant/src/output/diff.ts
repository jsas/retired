/**
 * Exact-string patch primitives. `find` must occur exactly once — this is
 * the safety property that makes model-produced source edits trustworthy:
 * ambiguous patches fail closed instead of corrupting a file.
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
  const first = content.indexOf(find)
  if (first === -1) return { ok: false, reason: 'not-found', occurrences: 0 }
  const second = content.indexOf(find, first + 1)
  if (second !== -1) return { ok: false, reason: 'ambiguous', occurrences: 2 }
  return {
    ok: true,
    content: content.slice(0, first) + replace + content.slice(first + find.length),
  }
}
