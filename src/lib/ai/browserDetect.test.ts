import { describe, it, expect, afterEach } from 'vitest';
import { detectBrowser, isMac, isLikelyAppleSilicon, browserLabel } from './browserDetect';

// Swap navigator.userAgent per test, then restore. jsdom exposes it as a
// getter, so redefine the property.
const realNavigator = globalThis.navigator;
function setUA(ua: string) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ua },
    configurable: true,
    writable: true,
  });
}
afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: realNavigator,
    configurable: true,
    writable: true,
  });
});

const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const FIREFOX_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0';
const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const EDGE_MAC = CHROME_MAC + ' Edg/124.0.0.0';
const BRAVE_MAC = CHROME_MAC + ' Brave/124';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

describe('detectBrowser', () => {
  it('names each major browser', () => {
    setUA(SAFARI_MAC); expect(detectBrowser()).toBe('safari');
    setUA(FIREFOX_MAC); expect(detectBrowser()).toBe('firefox');
    setUA(CHROME_MAC); expect(detectBrowser()).toBe('chrome');
    setUA(EDGE_MAC); expect(detectBrowser()).toBe('edge');
  });

  it('does not call Edge or Brave "Chrome" even though their UA contains Chrome/', () => {
    setUA(EDGE_MAC); expect(detectBrowser()).toBe('edge');
    setUA(BRAVE_MAC); expect(detectBrowser()).toBe('other');
  });

  it('does not call Chrome "Safari"', () => {
    setUA(CHROME_MAC); expect(detectBrowser()).toBe('chrome');
  });

  it('falls back to "other" on an unknown UA', () => {
    setUA('TotallyMadeUpBrowser/1.0');
    expect(detectBrowser()).toBe('other');
  });
});

describe('isMac / isLikelyAppleSilicon', () => {
  it('is true on desktop macOS', () => {
    setUA(SAFARI_MAC);
    expect(isMac()).toBe(true);
    expect(isLikelyAppleSilicon()).toBe(true);
  });

  it('is false on iPadOS desktop-mode (reports Macintosh but is Mobile)', () => {
    setUA(IPAD_DESKTOP_UA);
    expect(isMac()).toBe(false);
    expect(isLikelyAppleSilicon()).toBe(false);
  });

  it('is false off-Mac', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    expect(isMac()).toBe(false);
  });
});

describe('browserLabel', () => {
  it('produces human-readable names', () => {
    expect(browserLabel('safari')).toBe('Safari');
    expect(browserLabel('other')).toBe('this browser');
  });
});
