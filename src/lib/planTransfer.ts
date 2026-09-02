// Common low-level import/export backend for moving a PLAN (a plan's
// inputs, plus a display name) between users and machines, with no server.
//
// One envelope format, two wire shapes:
//   - plan code  — base64url text you paste into a box (Sharing page)
//   - share link — the same payload in a URL #plan= fragment (shareLink.ts)
//
// Higher-level features build on this: the Sharing page names and previews
// plans, the Data page moves whole backups — but every plan payload
// funnels through buildPlanCode/parsePlanCode so there's exactly one place
// that validates and migrates incoming inputs.
//
// Decoding is defensive: any parse failure returns null and the caller falls
// back gracefully. Inputs pass through migrateInputs so plans saved by older
// app versions import cleanly.

import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import type { AppConfig } from '@retired/engine-core/appConfig';
import type { Plan } from '@retired/engine-core/types';
import { migrateInputs } from '../data/migrations';

export const PLAN_TRANSFER_VERSION = 1;

/**
 * Whole-app database document: plans + active plan + engine config in a
 * single JSON object. This is the shape a legacy whole-app JSON backup parses
 * into on the Data page (issue #21: legacy *reads* stay supported even though
 * nothing writes this format anymore — the SQL store is the source of truth).
 * The Zod-validated twin is `AppDbDoc` in data/schemas.ts; the two are kept in
 * lockstep — this one exists so the import path doesn't pull in the schema lib.
 */
export interface AppDb {
  version: number;
  exportedAt: string;
  plans: Plan[];
  activePlanId: string;
  config: AppConfig;
}

/** The envelope a plan travels in. `tool` is a fixed sentinel so a pasted
 *  blob can be recognized as one of ours before anything is applied. */
export interface PlanEnvelope {
  tool: 're-tired-plan';
  version: number;
  name?: string;
  inputs: RetirementInputs;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Serialize a plan to a portable plan code (base64url of the envelope JSON). */
export function buildPlanCode(inputs: RetirementInputs, name?: string): string {
  const env: PlanEnvelope = {
    tool: 're-tired-plan',
    version: PLAN_TRANSFER_VERSION,
    ...(name ? { name } : {}),
    inputs,
  };
  return toBase64Url(JSON.stringify(env));
}

/** The payload a decode yields: the validated, migrated inputs and an
 *  optional display name (undefined when the sender didn't include one). */
export interface DecodedPlan {
  name?: string;
  inputs: RetirementInputs;
}

/**
 * Decode any of the wire shapes this app produces:
 *   - a v1 envelope plan code (from buildPlanCode / a share link)
 *   - a bare inputs object (legacy share links, hand-built JSON)
 * Accepts either the base64url code or the raw JSON text. Returns null on any
 * failure. Inputs are migrated to the current schema before they're returned.
 */
export function parsePlanCode(code: string): DecodedPlan | null {
  const trimmed = code.trim();
  if (!trimmed) return null;

  // The code may arrive base64url-encoded or as raw JSON text.
  let jsonText: string;
  if (trimmed.startsWith('{')) {
    jsonText = trimmed;
  } else {
    try {
      jsonText = fromBase64Url(trimmed);
    } catch {
      return null;
    }
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object') return null;

  const obj = decoded as Record<string, unknown>;

  // v1 envelope: has our tool sentinel and a nested inputs object.
  if (obj.tool === 're-tired-plan' && obj.inputs && typeof obj.inputs === 'object') {
    const inputs = obj.inputs as Record<string, unknown>;
    if (typeof inputs.currentAge !== 'number') return null;
    return {
      name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : undefined,
      inputs: migrateInputs(inputs),
    };
  }

  // Bare inputs object (legacy share links): the inputs ARE the payload.
  if (typeof obj.currentAge === 'number') {
    return { inputs: migrateInputs(obj) };
  }

  return null;
}
