import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AsyncOpfsBackend } from './opfs';
import { AppDatabase } from './db';
import { baseInputs } from '../test/helpers';
import type { Scenario } from '../lib/types';

/**
 * OPFS integration for the store. The browser API is faked with an in-memory
 * FileSystemDirectoryHandle stand-in so the tests exercise the real
 * read/write/clear code paths (and the store's read-through / write-through
 * behaviour) in Node.
 */

// localStorage polyfill (Node test env has none).
const storage = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => storage.clear(),
};

// In-memory OPFS fake: files held in a Map, handles mimic the async API.
function makeOpfsFake() {
  const files = new Map<string, Uint8Array>();
  const root = {
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!opts?.create) {
          const err = new Error('NotFoundError');
          err.name = 'NotFoundError';
          throw err;
        }
        files.set(name, new Uint8Array());
      }
      return {
        getFile: async () => ({
          arrayBuffer: async () => {
            const b = files.get(name)!;
            return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
          },
        }),
        createWritable: async () => ({
          write: async (data: BufferSource) => {
            files.set(name, new Uint8Array((data as Uint8Array).slice()));
          },
          close: async () => { /* no-op */ },
        }),
      };
    },
    removeEntry: async (name: string) => {
      if (!files.has(name)) {
        const err = new Error('NotFoundError');
        err.name = 'NotFoundError';
        throw err;
      }
      files.delete(name);
    },
  };
  return { files, root };
}

let fake: ReturnType<typeof makeOpfsFake>;

beforeEach(() => {
  storage.clear();
  fake = makeOpfsFake();
  vi.stubGlobal('navigator', {
    storage: {
      getDirectory: async () => fake.root,
      persist: async () => true,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const scenarios = (): Scenario[] => [
  { id: 'one', name: 'First plan', inputs: baseInputs({ currentAge: 52 }) },
];

describe('AsyncOpfsBackend', () => {
  it('read returns null when nothing was written', async () => {
    const backend = await AsyncOpfsBackend.open();
    expect(backend).not.toBeNull();
    expect(await backend!.read()).toBeNull();
  });

  it('write then read round-trips the bytes', async () => {
    const backend = (await AsyncOpfsBackend.open())!;
    const bytes = new TextEncoder().encode('fake-sqlite-bytes');
    await backend.write(bytes);
    expect(await backend.read()).toEqual(bytes);
  });

  it('clear removes the file; a second clear is a no-op', async () => {
    const backend = (await AsyncOpfsBackend.open())!;
    await backend.write(new Uint8Array([1, 2, 3]));
    await backend.clear();
    expect(await backend.read()).toBeNull();
    await expect(backend.clear()).resolves.toBeUndefined();
  });
});

describe('AppDatabase + OPFS', () => {
  it('persists to OPFS on save and re-opens from it (no localStorage needed)', async () => {
    const db = await AppDatabase.open();
    db.saveScenarios(scenarios());
    db.saveActiveScenarioId('one');
    db.save();
    db.close();
    // The write is async behind save() — let it land.
    await vi.waitFor(() => expect(fake.files.size).toBe(1));

    // Wipe localStorage: OPFS alone must be enough to restore the store.
    storage.clear();
    const reopened = await AppDatabase.open();
    expect(reopened.loadScenarios().map(s => s.name)).toEqual(['First plan']);
    expect(reopened.loadActiveScenarioId()).toBe('one');
    reopened.close();
  });

  it('OPFS wins over the localStorage mirror when both have data', async () => {
    // Old build wrote only localStorage; new build wrote OPFS after an edit.
    const legacy = await AppDatabase.open();
    legacy.detachBackend(); // force the localStorage-only path
    legacy.saveScenarios([{ id: 'old', name: 'Old local plan', inputs: baseInputs() }]);
    legacy.save();
    legacy.close();
    await vi.waitFor(() => expect(fake.files.size).toBe(0)); // nothing in OPFS yet

    const current = await AppDatabase.open(); // reads localStorage (OPFS empty), adopts it
    current.saveScenarios([{ id: 'new', name: 'New OPFS plan', inputs: baseInputs() }]);
    current.save();
    await vi.waitFor(() => expect(fake.files.size).toBe(1));
    current.close();

    // Now both mirrors have data — reopening must follow OPFS.
    const third = await AppDatabase.open();
    expect(third.loadScenarios().map(s => s.name)).toEqual(['New OPFS plan']);
    third.close();
  });

  it('falls back to localStorage when OPFS is unavailable', async () => {
    vi.stubGlobal('navigator', { storage: {} }); // no getDirectory
    const db = await AppDatabase.open();
    db.saveScenarios(scenarios());
    db.save();
    db.close();

    const reopened = await AppDatabase.open();
    expect(reopened.loadScenarios().map(s => s.id)).toEqual(['one']);
    reopened.close();
  });
});
