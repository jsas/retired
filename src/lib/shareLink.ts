// Encode a scenario's inputs into a URL hash for sharing (no server).
// The hash is base64url of the UTF-8 JSON so it survives copy/paste and chat
// clients. Decoding is defensive: any parse failure returns null and the app
// boots from localStorage as usual.

import type { RetirementInputs } from './retirementEngine';

const HASH_KEY = '#plan=';

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

export function encodePlanToHash(inputs: RetirementInputs): string {
  return HASH_KEY + toBase64Url(JSON.stringify(inputs));
}

export function buildShareUrl(inputs: RetirementInputs): string {
  const base = window.location.origin + window.location.pathname;
  return base + encodePlanToHash(inputs);
}

// Read and clear a #plan= hash if present. Returns the decoded inputs or null.
export function consumePlanFromHash(): RetirementInputs | null {
  const hash = window.location.hash;
  if (!hash.startsWith(HASH_KEY)) return null;
  try {
    const decoded = JSON.parse(fromBase64Url(hash.slice(HASH_KEY.length)));
    // Clear the hash so a later refresh doesn't re-import over local edits.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (decoded && typeof decoded === 'object' && typeof decoded.currentAge === 'number') {
      return decoded as RetirementInputs;
    }
    return null;
  } catch {
    return null;
  }
}
