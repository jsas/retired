/**
 * The session orchestrator: watches the bus for Intent envelopes, asks the
 * Engine for a decision, then publishes the status choreography
 * (received -> accepted -> processing -> applied/failed/rejected) and
 * dispatches edits to registered sinks.
 *
 * Also honors `retract` envelopes from the input side (undo/clear): an
 * interaction that has not reached a terminal state is cancelled, and any
 * in-flight engine run drops its edits without applying them.
 */
import type { Bus, Edit, Envelope, Intent } from '../core/index.js'
import { isTerminalStatus, makeEnvelope, makeStatus } from '../core/index.js'
import type { Engine, EngineDecision } from './engine.js'

export interface Sink {
  name: string
  /** Optional: sinks that only handle some edit kinds can skip the rest. */
  supports?(edit: Edit): boolean
  /** Apply one edit; must not throw — report failure via the returned state. */
  apply(edit: Edit, ctx: SinkContext): Promise<'applied' | 'failed'>
}

export interface SinkContext {
  interactionId: string
}

export interface SessionOptions {
  bus: Bus
  engine: Engine
  sinks: Sink[]
  /** Emitter name for status envelopes. Default 'engine'. */
  source?: string
}

export function startSession(options: SessionOptions): { stop(): void } {
  const bus = options.bus
  const engine = options.engine
  const sinks = options.sinks
  const source = options.source ?? 'engine'
  const seen = new Set<string>()
  /** Interaction ids whose run was retracted; checked at each await point. */
  const cancelled = new Set<string>()
  /** Interactions that already reached a terminal status. */
  const done = new Set<string>()
  let stopped = false

  async function handle(envelope: Envelope) {
    if (stopped) return

    if (envelope.kind === 'retract') {
      const id = envelope.interactionId
      if (cancelled.has(id)) return
      // Too late to cancel an already-terminal interaction; the input side
      // removes its own drawing locally either way.
      if (done.has(id)) return
      cancelled.add(id)
      if (!seen.has(id)) {
        // Intent hasn't reached us yet (or never will); remember the retraction
        // so a late arrival is ignored and never applied.
        seen.add(id)
      }
      publish(id, 'cancelled', 'input side retracted the interaction')
      return
    }

    if (envelope.kind !== 'intent') return
    if (!isIntentPayload(envelope.payload)) return

    const interactionId = envelope.interactionId
    // One engine run per interaction; retracted ones never run.
    if (seen.has(interactionId)) return
    seen.add(interactionId)
    if (cancelled.has(interactionId)) return

    publish(interactionId, 'accepted', 'engine queued the interaction')
    publish(interactionId, 'processing', 'model is working')

    let decision: EngineDecision
    try {
      decision = await engine.decide({
        interactionId,
        intents: [envelope.payload],
      })
    } catch (err) {
      if (!cancelled.has(interactionId)) {
        publish(interactionId, 'failed', `engine error: ${String(err)}`)
      }
      return
    }

    if (cancelled.has(interactionId)) return

    if (decision.rejection) {
      publish(interactionId, 'rejected', decision.rejection)
      return
    }

    const edits = decision.edits
    if (edits.length === 0) {
      publish(interactionId, 'rejected', 'engine produced no edits')
      return
    }

    let applied = 0
    let failures = 0
    const results: Edit[] = []
    for (const edit of edits) {
      if (cancelled.has(interactionId)) return
      for (const sink of sinks) {
        if (sink.supports && !sink.supports(edit)) continue
        try {
          const result = await sink.apply(edit, { interactionId })
          if (result === 'applied') {
            applied += 1
            results.push(edit)
          } else {
            failures += 1
          }
        } catch {
          failures += 1
        }
      }
    }

    if (cancelled.has(interactionId)) return

    if (failures > 0) {
      publish(interactionId, 'failed', `${failures} sink application(s) failed`)
      return
    }
    publish(
      interactionId,
      'applied',
      `${applied} edit(s) applied via sinks`,
      results,
    )
  }

  function publish(
    interactionId: string,
    state: Parameters<typeof makeStatus>[1],
    detail: string,
    edits: Edit[] = [],
  ) {
    if (isTerminalStatus(state) && cancelled.has(interactionId) && state !== 'cancelled') {
      return
    }
    if (isTerminalStatus(state)) done.add(interactionId)
    bus.publish(
      makeEnvelope({
        interactionId,
        source,
        kind: 'status',
        payload: makeStatus(interactionId, state, detail, edits),
      }),
    )
  }

  const off = bus.subscribe((envelope) => {
    void handle(envelope)
  })

  return {
    stop() {
      stopped = true
      off()
    },
  }
}

function isIntentPayload(p: unknown): p is Intent {
  if (typeof p !== 'object' || p === null || !('kind' in p)) return false
  const kind = (p as { kind: unknown }).kind
  return (
    kind === 'note' ||
    kind === 'stroke' ||
    kind === 'arrow' ||
    kind === 'move' ||
    kind === 'cut' ||
    kind === 'screenshot' ||
    kind === 'dom'
  )
}
