// Beta-channel gate for the in-progress reskin.
//
//   /the-site/?beta        → sets the `beta-version` cookie, shows the new skin
//   /the-site/?beta=off    → clears it, back to the stable UI
//   (any later visit)      → the cookie alone decides
//
// The decision logic is pure — strings in, strings out — so it tests without a
// DOM; `applyBetaAtBoot` is the thin glue that reads window/document and is the
// only function that touches globals. As the skin reaches parity we promote it
// (flip the choice in main.tsx) and then retire this flag.

export const BETA_COOKIE_NAME = 'beta-version';
export const BETA_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // a year — survives between dev sessions

// Values that turn the beta OFF. Anything else present (including `?beta`
// alone, which URLSearchParams gives back as '') turns it ON: if you asked
// for the beta, you get the beta.
const OFF_VALUES = new Set(['0', 'off', 'false', 'no']);

/** Raw value of the `beta` URL parameter, or null when absent.
 *  `?beta` and `?beta=` both yield ''. Accepts search with or without '?'. */
export function parseBetaParam(search: string): string | null {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return sp.has('beta') ? sp.get('beta') : null;
}

/** The beta flag from a raw Cookie header — strictly `beta-version=1`. */
export function readBetaCookie(header: string): boolean {
  return header.split(';').some((pair) => pair.trim() === `${BETA_COOKIE_NAME}=1`);
}

export interface BetaDecision {
  /** Which skin to render at boot. */
  beta: boolean;
  /** String to hand to document.cookie, or null when the cookie needs no change. */
  set: string | null;
}

/** The whole rule, pure: URL search + cookie header → what to show + what to write. */
export function decideBeta(search: string, cookieHeader: string): BetaDecision {
  const value = parseBetaParam(search);
  if (value !== null) {
    const on = !OFF_VALUES.has(value.toLowerCase());
    return {
      beta: on,
      // path=/ so it works on localhost dev and the Pages project subpath alike
      set: `${BETA_COOKIE_NAME}=${on ? 1 : 0}; path=/; max-age=${on ? BETA_MAX_AGE_SECONDS : 0}`,
    };
  }
  return { beta: readBetaCookie(cookieHeader), set: null };
}

/** Browser glue, run once at boot before React mounts. Returns true when the
 *  beta skin should render; an explicit ?beta writes/refreshes the cookie. */
export function applyBetaAtBoot(): boolean {
  const d = decideBeta(window.location.search, document.cookie);
  if (d.set) document.cookie = d.set;
  return d.beta;
}
