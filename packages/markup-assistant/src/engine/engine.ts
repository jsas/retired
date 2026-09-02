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
  /**
   * Relevant excerpts of the app's source files, when the host can supply
   * them (the vite plugin searches the project for text visible in the DOM
   * snapshot). This is what lets a change request become a real find/replace
   * edit instead of a guess — without it the model has never seen the file
   * it's being asked to edit.
   */
  source?: string
}

export interface EngineDecision {
  edits: Edit[]
  /** Set instead of edits when the engine cannot proceed. */
  rejection?: string
  /**
   * Set when the input was a question (or anything with nothing to change):
   * the engine answers directly instead of editing. Distinct from rejection —
   * a rejection means "I can't/won't", an answer means "here's what you asked".
   */
  answer?: string
}

