// Detect the current browser and platform from the user-agent so the
// no-WebGPU guidance can name *this* browser and give the right fix, instead
// of a generic "try another browser". Best-effort: UA strings lie, so these
// return null / 'other' rather than throwing when they can't tell.
//
// Order matters: the Chrome check deliberately excludes Edge/Brave/Opera/
// Samsung/Vivaldi, which all contain "Chrome/" in their UA. macOS detection
// excludes iPadOS-as-desktop (which reports "Macintosh" but has "Mobile").

export type DetectedBrowser = 'safari' | 'firefox' | 'chrome' | 'edge' | 'other';

function ua(): string {
  try {
    return typeof navigator !== 'undefined' ? navigator.userAgent : '';
  } catch {
    return '';
  }
}

/** Best-effort browser name for guidance copy. */
export function detectBrowser(): DetectedBrowser {
  const s = ua();
  if (/\bEdg(e|A|iOS)?\//.test(s)) return 'edge';
  if (/Firefox\//.test(s)) return 'firefox';
  // Chrome-but-not-a-Chromium-reskin: the reskins all append their own token,
  // so exclude any UA that also carries one of these.
  if (/Chrome\//.test(s) && !/(Edg|OPR|Opera|Brave|SamsungBrowser|Vivaldi)\//.test(s)) {
    return 'chrome';
  }
  if (/Safari\//.test(s) && !/Chrome\//.test(s)) return 'safari';
  return 'other';
}

/** True on macOS (desktop), false on iOS/iPadOS even in desktop-UA mode. */
export function isMac(): boolean {
  const s = ua();
  return /Macintosh|Mac OS X/.test(s) && !/Mobile\//.test(s);
}

/**
 * Best-effort Apple-Silicon signal. Browsers don't expose the chip name, so
 * this is macOS + (Apple device) + not an obvious Intel-era UA. Used only to
 * *add* a reassuring unified-memory note — never to block anything, so a
 * false positive is harmless.
 */
export function isLikelyAppleSilicon(): boolean {
  return isMac();
}

/** Human-readable browser label for sentences like "you're on Safari". */
export function browserLabel(b: DetectedBrowser): string {
  switch (b) {
    case 'safari': return 'Safari';
    case 'firefox': return 'Firefox';
    case 'chrome': return 'Chrome';
    case 'edge': return 'Edge';
    default: return 'this browser';
  }
}
