import { describe, it, expect, beforeEach } from 'vitest';
import { signalTabSync, onExternalChange, TAB_SYNC_KEY } from './tabSync';

// Node environment: localStorage and window don't exist, so polyfill just
// enough of both. The listener under test only needs add/removeEventListener,
// which a plain EventTarget provides.
class LocalStoragePolyfill {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}
(globalThis as { localStorage?: Storage }).localStorage =
  new LocalStoragePolyfill() as unknown as Storage;

const fireStorage = (target: EventTarget, key: string | null) => {
  // Node has no StorageEvent constructor; the listener only reads `.key`.
  const event = new Event('storage');
  Object.defineProperty(event, 'key', { value: key });
  target.dispatchEvent(event);
};

describe('signalTabSync', () => {
  beforeEach(() => localStorage.clear());

  it('writes a fresh value to the sync key every call (so the event always fires)', () => {
    signalTabSync();
    const first = localStorage.getItem(TAB_SYNC_KEY);
    signalTabSync();
    const second = localStorage.getItem(TAB_SYNC_KEY);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('does not throw when storage is unavailable', () => {
    const real = globalThis.localStorage;
    // @ts-expect-error — simulate a blocked-storage environment
    delete globalThis.localStorage;
    expect(() => signalTabSync()).not.toThrow();
    (globalThis as { localStorage?: Storage }).localStorage = real;
  });
});

describe('onExternalChange', () => {
  it('fires the handler when the sync key is written', () => {
    const target = new EventTarget();
    let calls = 0;
    const off = onExternalChange(() => { calls++; }, target as unknown as Window);
    fireStorage(target, TAB_SYNC_KEY);
    expect(calls).toBe(1);
    off();
  });

  it('fires on key === null (localStorage.clear() in another tab)', () => {
    const target = new EventTarget();
    let calls = 0;
    const off = onExternalChange(() => { calls++; }, target as unknown as Window);
    fireStorage(target, null);
    expect(calls).toBe(1);
    off();
  });

  it('ignores unrelated storage keys', () => {
    const target = new EventTarget();
    let calls = 0;
    const off = onExternalChange(() => { calls++; }, target as unknown as Window);
    fireStorage(target, 'wealthconsole_db');
    fireStorage(target, 'some-other-key');
    expect(calls).toBe(0);
    off();
  });

  it('stops firing after unsubscribe', () => {
    const target = new EventTarget();
    let calls = 0;
    const off = onExternalChange(() => { calls++; }, target as unknown as Window);
    fireStorage(target, TAB_SYNC_KEY);
    off();
    fireStorage(target, TAB_SYNC_KEY);
    expect(calls).toBe(1);
  });
});
