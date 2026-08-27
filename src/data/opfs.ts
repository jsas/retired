/**
 * OPFS (Origin Private File System) persistence for the SQLite bytes.
 *
 * The browser's origin-private filesystem is the right home for the database:
 * no ~5 MB localStorage ceiling, and it survives "clear site data" flows that
 * nuke localStorage/cookies on some browsers (and is what SQLite's own WASM
 * builds use). This module is deliberately tiny — the store stays a single
 * .sqlite file we read and write whole (sql.js is an in-memory engine; the
 * bytes are the source of truth).
 *
 * Layering: `OpfsBackend` is the minimal interface (read/write/clear), with
 * three implementations:
 *   - `SyncOpfsBackend`  — FileSystemSyncAccessHandle, only constructible in a
 *                          DedicatedWorker; the fastest, but our store runs on
 *                          the main thread, so this is future-proofing.
 *   - `AsyncOpfsBackend` — getFile() + createWritable() streams; works on the
 *                          main thread in every Baseline browser (Chrome/Edge
 *                          102+, Safari 15.2+, Firefox 111+).
 *   - detection returns null when OPFS is unavailable (private-mode Firefox,
 *                          very old browsers) and the caller silently falls
 *                          back to the localStorage mirror.
 */

export interface OpfsBackend {
  /** The stored database bytes, or null when nothing has been written yet. */
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
  clear(): Promise<void>;
}

const DB_FILENAME = 'wealthconsole.sqlite';

interface FileSystemDirectoryHandleLike {
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
  removeEntry(name: string): Promise<void>;
}

interface FileSystemFileHandleLike {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{ write(data: BufferSource): Promise<void>; close(): Promise<void> }>;
  createSyncAccessHandle?(): Promise<{
    read(buffer: Uint8Array, opts: { at: number }): number;
    write(buffer: Uint8Array, opts: { at: number }): number;
    truncate(size: number): void;
    getSize(): number;
    close(): void;
  }>;
}

function opfsRoot(): Promise<FileSystemDirectoryHandleLike> | null {
  const nav = navigator as Navigator & { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandleLike> } };
  if (typeof nav?.storage?.getDirectory !== 'function') return null;
  try {
    return nav.storage.getDirectory();
  } catch {
    return null;
  }
}

/** True when the async (main-thread) OPFS API is usable. */
export async function opfsAvailable(): Promise<boolean> {
  try {
    const root = await opfsRoot();
    return root != null;
  } catch {
    return false;
  }
}

/** Main-thread OPFS backend via getFile()/createWritable(). */
export class AsyncOpfsBackend implements OpfsBackend {
  private root: FileSystemDirectoryHandleLike;
  private constructor(root: FileSystemDirectoryHandleLike) {
    this.root = root;
  }

  static async open(): Promise<AsyncOpfsBackend | null> {
    try {
      const root = await opfsRoot();
      return root ? new AsyncOpfsBackend(root) : null;
    } catch {
      return null;
    }
  }

  async read(): Promise<Uint8Array | null> {
    try {
      const handle = await this.root.getFileHandle(DB_FILENAME);
      const file = await handle.getFile();
      const buf = await file.arrayBuffer();
      return buf.byteLength > 0 ? new Uint8Array(buf) : null;
    } catch {
      // NotFoundError = never written; anything else = treat as absent and
      // let the caller fall back rather than wedge the app.
      return null;
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    const handle = await this.root.getFileHandle(DB_FILENAME, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes as unknown as BufferSource);
    await writable.close();
  }

  async clear(): Promise<void> {
    try {
      await this.root.removeEntry(DB_FILENAME);
    } catch { /* already gone */ }
  }
}

/**
 * Ask the browser to pin this origin's storage so the database isn't evicted
 * under disk pressure. Best-effort: denied requests just mean normal eviction
 * rules apply. Returns true when persistence was granted (or already was).
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & { storage?: { persist?: () => Promise<boolean> } };
    return typeof nav?.storage?.persist === 'function' ? await nav.storage.persist() : false;
  } catch {
    return false;
  }
}
