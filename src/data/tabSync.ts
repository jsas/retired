import { DB_STORAGE_KEY } from './db';

// Cross-tab sync (#47). OPFS has no change notification, but every persist()
// also mirrors the DB into localStorage — and localStorage writes fire a
// `storage` event in every OTHER open tab. So after each save we additionally
// touch this throwaway key (a fresh value each time, so the event always
// fires even for back-to-back writes); other tabs listen for it and react:
// clean tab → silently reload from the store; dirty tab → conflict banner.
//
// Writing a separate key instead of relying on the big mirrored blob keeps
// the signal cheap and coalesces multiple writes inside one persist batch.
export const TAB_SYNC_KEY = `${DB_STORAGE_KEY}_touched`;

export function signalTabSync(): void {
  try {
    localStorage.setItem(TAB_SYNC_KEY, `${Date.now()}-${Math.random()}`);
  } catch {
    // Storage unavailable (e.g. blocked cookies) — other tabs just won't
    // live-update; persistence itself is unaffected.
  }
}

/**
 * Invoke `handler` whenever another tab signals a persist. Returns an
 * unsubscribe function. `target` is injectable so tests can drive the
 * listener with a plain EventTarget instead of the global window.
 */
export function onExternalChange(
  handler: () => void,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const listener = (e: StorageEvent) => {
    // key === null means localStorage.clear() — treat that as a change too.
    if (e.key === null || e.key === TAB_SYNC_KEY) handler();
  };
  target.addEventListener('storage', listener as EventListener);
  return () => target.removeEventListener('storage', listener as EventListener);
}
