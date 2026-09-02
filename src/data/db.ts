import initSqlJs, { type Database } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { Plan } from '@retired/engine-core/types';
import { migrateInputs } from './migrations';
import { validateAppConfig, DEFAULT_APP_CONFIG, type AppConfig } from '@retired/engine-core/appConfig';
import { appDbDocSchema, type AppDbDoc } from './schemas';
import { AsyncOpfsBackend, requestPersistentStorage, type OpfsBackend } from './opfs';

/**
 * The app's persistent store: a real SQLite database (sql.js / WASM) whose
 * bytes are mirrored into localStorage on every write and re-opened on load.
 *
 * Schema (SCHEMA_VERSION bump = run the migrations below):
 *   meta(key TEXT PK, value TEXT)      — schema_version, active_scenario_id
 *   plans(id TEXT PK, name TEXT,   — one row per saved plan
 *             inputs TEXT,             — RetirementInputs as JSON
 *             updated_at TEXT)
 *   kv(key TEXT PK, value TEXT)        — engine config ('config') as JSON, plus
 *                                        opt-in app data ('retirement_ai_chats',
 *                                        'retirement_ai_settings') when the user
 *                                        includes it in a backup, and the UI
 *                                        preferences ('wealthconsole_panel_state',
 *                                        'wealthconsole_eq') mirrored there by
 *                                        lib/prefKv so they travel with every backup
 *
 * Why a document-per-row model rather than one column per input field: the
 * engine's input shape is deep and still evolving (spouse blocks, events,
 * reverse mortgages); a relational decomposition would need a migration per
 * feature for zero query benefit at this scale (dozens of plans). The SQLite
 * file IS the database — SQL tooling can open the exported file directly —
 * while field-level validation lives in the Zod layer (schemas.ts).
 */

const STORAGE_KEY = 'wealthconsole_db';
const SCHEMA_VERSION = 1;

let wasmPromise: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;

/** sql.js needs its .wasm file; Vite gives us a URL (multi-file build) or an
 *  inlined base64 data URI (the single-file build, via assetsInlineLimit).
 *  Under Vitest (Node) that URL is a root-absolute POSIX path
 *  ('/node_modules/sql.js/dist/...') which fs resolves against the current
 *  drive — joining it with cwd breaks in worktrees, where the repo lives
 *  deeper than the cwd root. Resolve through the package's own export map
 *  instead: anchored at this module, it lands on the real file wherever the
 *  project is checked out. Built lazily so the Node-only module never loads
 *  in the browser bundle. */
type NodeRequire = { resolve(specifier: string): string };
let nodeRequire: NodeRequire | null = null;

async function loadSqlJs() {
  if (typeof window === 'undefined' && !sqlWasmUrl.startsWith('data:')) {
    const { createRequire } = await import('node:module');
    nodeRequire ??= createRequire(import.meta.url) as unknown as NodeRequire;
  }
  wasmPromise ??= initSqlJs({
    locateFile: (file: string) =>
      nodeRequire ? nodeRequire.resolve(`sql.js/dist/${file}`) : sqlWasmUrl,
  });
  return wasmPromise;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Synchronous first-paint seed: read the plan rows straight out of the
 * localStorage mirror of the SQL blob, without waiting for the wasm to load.
 * The mirror is the SQL store's own compatibility copy (written on every
 * persist), so this is a cache read of the same source of truth — not a fork.
 * Returns null when there's no mirror or it can't be decoded (the caller then
 * seeds first-run examples). Rows are NOT migrated here — that's the async
 * open path's job; this seed is swapped for the authoritative store contents
 * the moment it opens.
 */
export function readSeedScenariosFromMirror(): { plans: Plan[]; activePlanId: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const bytes = base64ToBytes(raw);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

    const plans: Plan[] = [];
    // Plan inputs are JSON with no NUL bytes; the row layout is
    //   <id>\x00<name>\x00<inputs-json>\x00<updated_at>
    // so each "…{json}\x00" capture is one row's inputs.
    const rowRe = /(\{[^\x00]*?\})\x00/g;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = rowRe.exec(text)) !== null) {
      const inputs = JSON.parse(m[1]) as Plan['inputs'];
      plans.push({ id: `seed-${i}`, name: `Plan ${i + 1}`, inputs });
      i++;
    }
    if (plans.length === 0) return null;

    // The active id is stored under meta key 'active_scenario_id'. We can't
    // recover real plan ids from this positional scan (they'd need full
    // SQLite page decoding), so match the active row by its position among the
    // text columns: meta rows precede the plan rows, and
    // 'active_scenario_id' is the id's column index within the meta block.
    let activePlanId = plans[0].id;
    const metaIdx = text.indexOf('active_scenario_id');
    if (metaIdx !== -1) {
      const nulBefore = text.slice(0, metaIdx).split('\x00').length - 1;
      const activeIdx = nulBefore - 1; // columns before it: 'schema_version','1', key itself
      if (activeIdx >= 0 && activeIdx < plans.length) {
        activePlanId = plans[activeIdx].id;
      }
    }
    return { plans, activePlanId };
  } catch {
    return null;
  }
}

/** Apply schema migrations in order. Each entry runs inside the caller's
 *  transaction and is idempotent — CREATE TABLE IF NOT EXISTS etc. */
const MIGRATIONS: Array<(db: Database) => void> = [
  // 0 → 1: initial schema.
  (db) => {
    db.run(`CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      inputs TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  },
];

export class AppDatabase {
  private db: Database;
  private backend: OpfsBackend | null;
  /** Persist-outcome observers — called on durable-write failure (err set) and
   *  on durable-write success (err null). The UI subscribes via AppStore to
   *  show/clear a "changes may not be saved" banner (issue U-02); before this,
   *  a failed write was only a console.warn. */
  private saveListeners = new Set<(err: unknown | null) => void>();
  private constructor(db: Database, backend: OpfsBackend | null) {
    this.db = db;
    this.backend = backend;
  }

  /** Subscribe to persist outcomes: listener(err) on durable-write failure,
   *  listener(null) once a durable write lands again. Returns an unsubscribe
   *  function. */
  onSaveOutcome(listener: (err: unknown | null) => void): () => void {
    this.saveListeners.add(listener);
    return () => this.saveListeners.delete(listener);
  }

  private reportSaveOutcome(err: unknown | null): void {
    for (const listener of this.saveListeners) {
      try { listener(err); } catch { /* a broken observer must not break save */ }
    }
  }

  /** Open the store. Byte source priority: an explicit `seed` (tests,
   *  imports) → OPFS (the primary mirror) → the localStorage mirror (older
   *  builds and the fallback when OPFS is unavailable). Nothing anywhere → a
   *  fresh database. Migrations run to current before returning. */
  static async open(seed?: Uint8Array): Promise<AppDatabase> {
    const SQL = await loadSqlJs();
    const backend = await AsyncOpfsBackend.open();
    if (backend) {
      // Best-effort pin so the database isn't evicted under disk pressure.
      void requestPersistentStorage();
    }
    let bytes: Uint8Array | null = seed ?? null;
    if (!bytes && backend) {
      bytes = await backend.read();
    }
    if (!bytes) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) bytes = base64ToBytes(raw);
      } catch { /* storage unavailable — run in-memory */ }
    }
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    const app = new AppDatabase(db, backend);
    app.migrate();
    return app;
  }

  private migrate(): void {
    // A fresh database has no meta table at all — that's version 0.
    let from = 0;
    try {
      const row = this.db.exec(`SELECT value FROM meta WHERE key = 'schema_version'`);
      from = row.length > 0 ? Number(row[0].values[0][0]) : 0;
    } catch { /* no meta table yet */ }
    this.db.run('BEGIN');
    try {
      for (let v = from; v < SCHEMA_VERSION; v++) MIGRATIONS[v](this.db);
      this.db.run(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [String(SCHEMA_VERSION)],
      );
      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  /** Serialize and stash the whole database. Write-through: OPFS first (the
   *  durable home), then localStorage as the best-effort compatibility
   *  mirror — but ONLY after OPFS has the bytes. A failed OPFS write must not
   *  leave localStorage newer than OPFS: `open()` prefers OPFS, so a stale
   *  OPFS + fresh localStorage pair would silently roll the user back to the
   *  previous session on next load (issue #18). With the mirror sequenced
   *  after the durable write, the two can never diverge — at worst this
   *  session's changes stay in memory until OPFS recovers.
   *  localStorage failures are swallowed — quota there is a known ceiling,
   *  and OPFS already has the bytes. */
  save(): void {
    const bytes = this.db.export();
    if (this.backend) {
      this.backend.write(bytes)
        .then(() => {
          try {
            localStorage.setItem(STORAGE_KEY, bytesToBase64(bytes));
          } catch (err) {
            // OPFS already has the bytes, so this session's data is durable —
            // the loss is only the compatibility mirror. Still warn (the
            // user's NEXT session may read the stale localStorage copy on a
            // browser without OPFS), but don't alarm: not a save failure.
            console.warn('Failed to persist the database to localStorage:', err);
          }
          this.reportSaveOutcome(null); // durable write landed
        })
        .catch(err => {
          console.warn('Failed to persist the database to OPFS:', err);
          this.reportSaveOutcome(err); // nothing durable this save — tell the UI
        });
      return;
    }
    // No OPFS backend: localStorage is the only mirror — its failure IS the
    // save failing.
    try {
      localStorage.setItem(STORAGE_KEY, bytesToBase64(bytes));
      this.reportSaveOutcome(null);
    } catch (err) {
      console.warn('Failed to persist the database to localStorage:', err);
      this.reportSaveOutcome(err);
    }
  }

  /** Forget the OPFS backend (tests force the localStorage-only path). */
  detachBackend(): void {
    this.backend = null;
  }

  // ---- raw access for companion tables (agent memories) ---------------------
  // The memory store (lib/memory) manages its own table inside this database
  // file — same backup, same tooling — but owns its schema. These pass-throughs
  // keep that module's SQL in the memory module instead of growing AppDatabase
  // per feature.

  /** Run a statement (CREATE TABLE, INSERT, DELETE) with bound params. */
  run(sql: string, params?: Array<string | number>): void {
    this.db.run(sql, params);
  }

  /** Execute a query and return sql.js result sets verbatim. */
  exec(sql: string, params?: Array<string | number>): ReturnType<Database['exec']> {
    return this.db.exec(sql, params);
  }

  /** Run `body` inside BEGIN/COMMIT, rolling back on throw. */
  withTransaction(body: () => void): void {
    this.db.run('BEGIN');
    try {
      body();
      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  /** The raw SQLite file — this is what "save a backup to disk" downloads. */
  exportBytes(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    this.db.close();
  }

  // ---- plans -----------------------------------------------------------

  loadScenarios(): Plan[] {
    const res = this.db.exec(`SELECT id, name, inputs FROM plans ORDER BY rowid`);
    if (res.length === 0) return [];
    return res[0].values.map(([id, name, inputs]) => ({
      id: id as string,
      name: name as string,
      // Migrated on the way out so older rows gain newer fields.
      inputs: migrateInputs(JSON.parse(inputs as string)),
    }));
  }

  /** Full replace — plans are few and written as a set, never one row at
   *  a time from the UI, so a transaction around delete+inserts is simplest
   *  and keeps the store consistent on any failure. */
  saveScenarios(plans: Plan[]): void {
    this.db.run('BEGIN');
    try {
      this.db.run('DELETE FROM plans');
      const stmt = this.db.prepare(
        `INSERT INTO plans (id, name, inputs, updated_at) VALUES (?, ?, ?, ?)`,
      );
      const now = new Date().toISOString();
      for (const s of plans) {
        stmt.run([s.id, s.name, JSON.stringify(s.inputs), now]);
      }
      stmt.free();
      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  // ---- active plan id --------------------------------------------------

  loadActiveScenarioId(): string | null {
    const res = this.db.exec(`SELECT value FROM meta WHERE key = 'active_scenario_id'`);
    return res.length > 0 ? (res[0].values[0][0] as string) : null;
  }

  saveActiveScenarioId(id: string): void {
    this.db.run(
      `INSERT INTO meta (key, value) VALUES ('active_scenario_id', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [id],
    );
  }

  // ---- engine config -------------------------------------------------------

  loadConfig(): unknown | null {
    const res = this.db.exec(`SELECT value FROM kv WHERE key = 'config'`);
    return res.length > 0 ? JSON.parse(res[0].values[0][0] as string) : null;
  }

  saveConfig(config: unknown): void {
    this.db.run(
      `INSERT INTO kv (key, value) VALUES ('config', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify(config)],
    );
  }

  // ---- generic kv (AI chats, AI settings, …) --------------------------------

  /** Read a raw kv value by key (null when absent). Unlike loadConfig this
   *  returns the stored string verbatim — the caller owns (de)serialization
   *  and validation, so non-config app data can share the backup file. */
  getKv(key: string): string | null {
    const res = this.db.exec(`SELECT value FROM kv WHERE key = ?`, [key]);
    return res.length > 0 ? (res[0].values[0][0] as string) : null;
  }

  /** Write a raw kv value (insert-or-replace). */
  setKv(key: string, value: string): void {
    this.db.run(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  /** Remove a kv key (used to strip AI data from a backup that excludes it). */
  deleteKv(key: string): void {
    this.db.run(`DELETE FROM kv WHERE key = ?`, [key]);
  }

  // ---- whole-document interchange ------------------------------------------

  /** Snapshot the store as the validated app-database document, or null when
   *  the plans don't parse (a store the app has never written to). A
   *  missing or unreadable config does NOT null the doc: valid plans are
   *  the backup's whole point, so the doc carries DEFAULT_APP_CONFIG instead
   *  and `configWarning` says so — silently rejecting the whole file (the old
   *  behaviour) threw away every plan over a settings blob the importer
   *  could have skipped anyway. The plans-or-nothing shape still matches
   *  what the rest of the app REPLACES on loadDoc — partial salvage of an
   *  empty-plans store is the importer's call (salvageableContents), not
   *  this document's shape. */
  toDoc(): (AppDbDoc & { configWarning?: string }) | null {
    const plans = this.loadScenarios();
    if (plans.length === 0) return null;
    const configRaw = this.loadConfig();
    const config = configRaw ? validateAppConfig(configRaw) : null;
    const configWarning = config
      ? undefined
      : 'Engine settings in this backup could not be read; defaults will be used. '
        + 'Custom tax tables or engine settings are not included.';
    const activePlanId = this.loadActiveScenarioId() ?? plans[0].id;
    const effectiveConfig = config ?? DEFAULT_APP_CONFIG;
    const parsed = appDbDocSchema.safeParse({
      version: SCHEMA_VERSION, plans, activePlanId, config: effectiveConfig,
    });
    if (!parsed.success) return null;
    return configWarning ? { ...parsed.data, configWarning } : parsed.data;
  }

  /** What remains importable in a store whose plans table is empty —
   *  `kind` tells the importer which path to offer:
   *  - 'config': the kv config validates (settings-only backup).
   *  - 'ai-only': no config, but some kv payload (AI chats/settings, or the
   *    UI-preference blobs) is present. The store's fingerprints (meta
   *    .active_scenario_id, companion tables like scenario_revisions/memories)
   *    are deliberately NOT checked: they survive in truncated backups and
   *    would mislabel any SQLite file that merely shares our table names as a
   *    backup. The AI blob itself is not deep-validated here — chat payloads
   *    already self-validate on load (corrupt → empty), same as a corrupt
   *    blob in a full backup.
   *  - null: nothing of ours — not a backup of this app. */
  salvageableContents(): { kind: 'config'; config: AppConfig } | { kind: 'ai-only' } | null {
    if (this.loadScenarios().length > 0) return null; // a full store — toDoc handles it
    const configRaw = this.loadConfig();
    const config = configRaw ? validateAppConfig(configRaw) : null;
    if (config) return { kind: 'config', config };
    for (const key of ['retirement_ai_chats', 'retirement_ai_settings', 'wealthconsole_panel_state', 'wealthconsole_eq']) {
      if (this.getKv(key) !== null) return { kind: 'ai-only' };
    }
    return null;
  }

  /** Replace the store's contents with a validated document. */
  loadDoc(doc: AppDbDoc): void {
    this.saveScenarios(doc.plans);
    this.saveActiveScenarioId(doc.activePlanId);
    this.saveConfig(doc.config);
  }
}

export const DB_STORAGE_KEY = STORAGE_KEY;
