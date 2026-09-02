/**
 * Engine interface + the session orchestrator.
 *
 * An Engine turns a bundle of Intents (what the human did) plus optional
 * page context (screenshot, DOM snapshot) into a decision: either Edits to
 * apply, or a rejection with a human-readable reason.
 */
import type { Edit, ImagePayload, Intent } from '../core/protocol.js'

export interface Engine {
  /** Produce a decision for one interaction. Must not throw. */
  decide(input: EngineInput): Promise<EngineDecision>
}

export interface EngineInput {
  interactionId: string
  intents: Intent[]
  /** Viewport screenshot taken at interaction time, if the input side had one. */
  screenshot?: ImagePayload
  /** Serialized DOM at interaction time, if the input side had one. */
  dom?: string
}

export interface EngineDecision {
  edits: Edit[]
  /** Set instead of edits when the engine cannot proceed. */
  rejection?: string
}

