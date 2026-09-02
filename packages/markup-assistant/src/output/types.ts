import type { Edit } from '../core/index.js'

/**
 * Output side of the loop. A sink receives each edit the engine produced and
 * reports whether it landed. Sinks are the only writers — nothing else in
 * the system mutates the page or the source tree.
 */
export interface SinkApplier {
  name: string
  supports(edit: Edit): boolean
  apply(edit: Edit): Promise<'applied' | 'failed'>
}
