/**
 * RevertableSink: wraps the source-sink endpoint call with a before/after
 * ledger keyed by file. For each applied edit, it records the disk content
 * before the write (oldContent) and the content after (newContent). Revert
 * puts the old content back.
 *
 * The ledger lives on the dev server; nothing crosses to the client except
 * the file path + a marker that a revert exists. That keeps secrets out.
 */
import type { Edit } from '../core/protocol.js'
import { isSourceEdit } from '../core/protocol.js'

export interface RevertEntry {
  file: string
  /** Content before the edit applied. */
  oldContent: string
  /** Content after the edit applied (what the client is on now). */
  newContent: string
  at: number
}

export interface RevertLedger {
  record(edit: Edit, oldContent: string, newContent: string): void
  /** All entries with enough history to revert; most recent first. */
  planned(): RevertEntry[]
  /** Pop the newest entry for this file, so reverts stack per-file. */
  take(file: string): RevertEntry | undefined
  /** Current newest entry for a file, without consuming it. */
  peek(file: string): RevertEntry | undefined
}

export function createRevertLedger(): RevertLedger {
  const entries = new Map<string, RevertEntry[]>()
  return {
    record(edit, oldContent, newContent) {
      if (!isSourceEdit(edit)) return
      const arr = entries.get(edit.file) ?? []
      arr.push({ file: edit.file, oldContent, newContent, at: Date.now() })
      entries.set(edit.file, arr)
    },
    planned() {
      const all: RevertEntry[] = []
      for (const arr of entries.values()) all.push(...arr)
      return all.sort((a, b) => b.at - a.at)
    },
    take(file) {
      const arr = entries.get(file)
      const head = arr?.[arr.length - 1]
      if (arr && head) arr.pop()
      if (arr && arr.length === 0) entries.delete(file)
      return head
    },
    peek(file) {
      const arr = entries.get(file)
      return arr?.[arr.length - 1]
    },
  }
}
