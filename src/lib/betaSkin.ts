// Skin gate — the f7 design IS the app now; the old UI survives one flag away
// as a live reference while we finish comparing against it.
//
//   /the-site/              → the app (the former beta)
//   /the-site/?beta         → sets the `beta-version` cookie, shows the OLD UI
//   /the-site/?beta=off     → clears it, back to the app
//   (any later visit)       → the cookie alone decides
//
// The param kept its name on purpose: bookmarks and muscle memory that used to
// opt INTO the redesign now opt OUT to the reference build — same flag,
// reversed polarity. The decision logic is pure — strings in, strings out —
// so it tests without a DOM; `applyBetaAtBoot` is the thin glue that reads
// window/document and is the only function that touches globals. Once the old
// UI stops being useful as a reference, retire this file and the stable
// render branch with it.

export const BETA_COOKIE_NAME = 'beta-version';
export const BETA_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // a year — survives between dev sessions

// Values that turn the reference (old) UI OFF — i.e. back to the app. Anything
// else present (including `?beta` alone, which URLSearchParams gives back as
// '') turns the reference ON: if you asked for the old site, you get it.
const OFF_VALUES = new Set(['0', 'off', 'false', 'no']);

/** Raw value of the `beta` URL parameter, or null when absent.
 *  `?beta` and `?beta=` both yield ''. Accepts search with or without '?'. */
export function parseBetaParam(search: string): string | null {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return sp.has('beta') ? sp.get('beta') : null;
}

/** The reference flag from a raw Cookie header — strictly `beta-version=1`. */
export function readBetaCookie(header: string): boolean {
  return header.split(';').some((pair) => pair.trim() === `${BETA_COOKIE_NAME}=1`);
}

export interface BetaDecision {
  /** Which skin to render at boot: true = the app (default), false = the old reference UI. */
  beta: boolean;
  /** String to hand to document.cookie, or null when the cookie needs no change. */
  set: string | null;
}

/** The whole rule, pure: URL search + cookie header → what to show + what to write. */
export function decideBeta(search: string, cookieHeader: string): BetaDecision {
  const value = parseBetaParam(search);
  if (value !== null) {
    const reference = !OFF_VALUES.has(value.toLowerCase());
    return {
      beta: !reference,
      // path=/ so it works on localhost dev and the Pages project subpath alike
      set: `${BETA_COOKIE_NAME}=${reference ? 1 : 0}; path=/; max-age=${reference ? BETA_MAX_AGE_SECONDS : 0}`,
    };
  }
  // No claim in the URL: a `1` cookie keeps the visitor on the reference UI;
  // absent or `0` (including cookies written before the flip) means the app.
  return { beta: !readBetaCookie(cookieHeader), set: null };
}

/** Browser glue, run once at boot before React mounts. Returns true when the
 *  app (f7 skin) should render; an explicit ?beta writes/refreshes the cookie. */
export function applyBetaAtBoot(): boolean {
  const d = decideBeta(window.location.search, document.cookie);
  if (d.set) document.cookie = d.set;
  return d.beta;
}
