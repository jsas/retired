/**
 * Mounts the markup overlay (Ctrl+Shift+M) on the main channel, behind the
 * aiSettings `markupOverlay` opt-in.
 *
 * Wiring: the overlay's gestures publish Intents on a bus; a session feeds
 * them to a bridge-backed Engine (the SAME bridge the assistant uses, built
 * from the saved connections); the model replies with DOM edits. Those edits
 * are intercepted by a confirming sink and surfaced as a review card — nothing
 * touches the live document until the human clicks Apply. That mirrors the
 * assistant's confirm-before-apply rule: markup proposes, the human disposes.
 *
 * The component renders only the pending-edit card (fixed above the overlay
 * canvas). All markup chrome — toolbar, pen strokes, status recoloring — is
 * drawn by the overlay itself onto its own fixed canvas.
 */
import { useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { createBridge } from '@retired/ai-bridge'
import {
  attachOverlay,
  createBus,
  createBridgeEngine,
  createDomSink,
  startSession,
  type Edit,
} from '@retired/markup-assistant'
import type { AiSettings } from '../lib/aiSettings'

/** One interaction's worth of model-proposed edits, awaiting a decision. */
interface PendingProposal {
  interactionId: string
  edits: Edit[]
}

export function MarkupOverlay({ settings }: { settings: AiSettings }) {
  const [proposal, setProposal] = useState<PendingProposal | null>(null)
  // Ref mirror so the (stable, mount-once) session closure can read the
  // current pending proposal without going stale.
  const proposalRef = useRef<PendingProposal | null>(null)
  proposalRef.current = proposal
  // Decisions for the confirming sink: interactionId -> resolve.
  const decisions = useRef(new Map<string, (approved: boolean) => void>())

  useEffect(() => {
    const bus = createBus()
    const bridge = createBridge({ connections: settings.connections })
    if (settings.activeConnectionId) bridge.selectConnection(settings.activeConnectionId)
    const engine = createBridgeEngine(bridge)
    const dom = createDomSink()
    // Snapshot the decisions map for the cleanup: by the time cleanup runs the
    // ref's identity is stable (it's created once), but lint wants a local.
    const pending = decisions.current

    attachOverlay({ bus, source: 'overlay' })

    const session = startSession({
      bus,
      engine,
      sinks: [
        {
          name: 'confirm-dom',
          supports: (edit) => edit.kind === 'dom',
          apply: async (edit, ctx) => {
            const approved = await requestDecision(ctx.interactionId, edit)
            if (!approved) return 'failed'
            return dom.apply(edit)
          },
        },
      ],
    })

    function requestDecision(interactionId: string, edit: Edit): Promise<boolean> {
      return new Promise((resolve) => {
        pending.set(interactionId, resolve)
        setProposal((prev) => ({
          interactionId,
          edits: [...(prev?.edits ?? []), edit],
        }))
      })
    }

    return () => {
      session.stop()
      // Reject anything still parked so the session doesn't hang on a card
      // that will never render again.
      for (const resolve of pending.values()) resolve(false)
      pending.clear()
    }
    // The bridge + session capture the connections at mount; re-running on
    // every render would tear the overlay down mid-gesture. Connection edits
    // land on next reload (same lifecycle as the assistant's bridge).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resolveProposal(approved: boolean) {
    const current = proposalRef.current
    if (!current) return
    const resolve = decisions.current.get(current.interactionId)
    decisions.current.delete(current.interactionId)
    setProposal(null)
    // 'false' marks the sink apply failed, so the session publishes a failed
    // (rejected-red) status and the markup recolors instead of going green.
    resolve?.(approved)
  }

  if (!proposal) return null

  return (
    <div
      role="dialog"
      aria-label="Markup changes proposed"
      className="fixed bottom-4 right-4 z-[2147483600] w-80 rounded-lg border border-neutral-300 bg-white p-3 shadow-xl"
    >
      <div className="mb-2 text-xs font-semibold text-slate-900">
        The assistant wants to change the page
      </div>
      <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto">
        {proposal.edits.map((edit, i) => (
          <li key={i} className="text-xs text-slate-600 leading-relaxed">
            {edit.kind === 'dom' ? edit.description : 'edit'}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button
          onClick={() => resolveProposal(true)}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          <Check size={13} /> Apply
        </button>
        <button
          onClick={() => resolveProposal(false)}
          className="flex flex-1 items-center justify-center gap-1 rounded-md border border-neutral-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-neutral-50"
        >
          <X size={13} /> Discard
        </button>
      </div>
    </div>
  )
}
