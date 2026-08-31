// Encode a plan into a URL hash for sharing (no server). The hash is the
// base64url plan code from planTransfer (UTF-8 JSON), so it survives
// copy/paste and chat clients — and so a link and a pasted plan code are the
// SAME payload in two wire shapes, decoded by the one defensive parser.
// Any decode failure returns null and the app boots from localStorage as usual.

import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import { buildPlanCode, parsePlanCode, type DecodedPlan } from './planTransfer';

const HASH_KEY = '#plan=';

export function encodePlanToHash(inputs: RetirementInputs, name?: string): string {
  return HASH_KEY + buildPlanCode(inputs, name);
}

export function buildShareUrl(inputs: RetirementInputs, name?: string): string {
  const base = window.location.origin + window.location.pathname;
  return base + encodePlanToHash(inputs, name);
}

// Read and clear a #plan= hash if present. Returns the decoded plan (inputs +
// optional name) or null. The hash is cleared on read so a later refresh
// doesn't re-import over local edits. Legacy links (bare inputs, no envelope)
// still decode — parsePlanCode accepts both shapes.
export function consumePlanFromHash(): DecodedPlan | null {
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_KEY)) return null;
  const plan = parsePlanCode(hash.slice(HASH_KEY.length));
  if (!plan) return null;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return plan;
}
