/**
 * SourceSink: forwards source edits (text patches, file writes) to a dev
 * server endpoint — the vite-plugin's /__markup_assistant__/apply — which
 * patches files on disk so HMR picks the change up. This keeps the browser
 * package filesystem-free.
 */
import type { Edit } from '../core/index.js'
import type { SinkApplier } from './types.js'

export interface SourceSinkOptions {
  /** e.g. http://localhost:5173 — the dev server origin. */
  origin: string
  fetchImpl?: typeof fetch
}

export function createSourceSink(options: SourceSinkOptions): SinkApplier {
  const doFetch = options.fetchImpl ?? fetch
  return {
    name: 'source',
    supports(edit: Edit): boolean {
      return edit.kind === 'text' || edit.kind === 'write'
    },
    async apply(edit: Edit): Promise<'applied' | 'failed'> {
      if (edit.kind !== 'text' && edit.kind !== 'write') return 'failed'
      try {
        const res = await doFetch(`${options.origin}/__markup_assistant__/apply`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ edit }),
        })
        return res.ok ? 'applied' : 'failed'
      } catch {
        return 'failed'
      }
    },
  }
}
