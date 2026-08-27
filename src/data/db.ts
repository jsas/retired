import initSqlJs, { type Database } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { Scenario } from '../lib/scenarioStorage';
import { migrateInputs } from '../lib/scenarioStorage';
import { validateAppConfig } from '../lib/appConfig';
import { appDbDocSchema, type AppDbDoc } from './schemas';

/**
 * The app's persistent store: a real SQLite database (sql.js / WASM) whose
 * bytes are mirrored into localStorage on every write and re-opened on load.
 *
 * Schema (SCHEMA_VERSION bump = run the migrations below):
 *   meta(key TEXT PK, value TEXT)      — schema_version, active_scenario_id
 *   scenarios(id TEXT PK, name TEXT,   — one row per saved plan
 *             inputs TEXT,             — RetirementInputs as JSON
 *             updated_at TEXT)
 *   kv(key TEXT PK, value TEXT)        — engine config ('config') as JSON
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
 *  Under Vitest (Node), that URL is the project-relative path — resolve it
 *  against the working directory so the file can be read from disk. */
function loadSqlJs() {
  wasmPromise ??= initSqlJs({
    locateFile: () =>
      typeof window === 'undefined' && !sqlWasmUrl.startsWith('data:')
        ? `${(globalThis as { process?: { cwd(): string } }).process?.cwd() ?? '.'}/${sqlWasmUrl}`
        : sqlWasmUrl,
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

/** Apply schema migrations in order. Each entry runs inside the caller's
 *  transaction and is idempotent — CREATE TABLE IF NOT EXISTS etc. */
const MIGRATIONS: Array<(db: Database) => void> = [
  // 0 → 1: initial schema.
  (db) => {
    db.run(`CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS scenarios (
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
  private constructor(db: Database) {
    this.db = db;
  }

  /** Open the store: bytes from localStorage when present (or `seed` for
   *  tests / imports), else a fresh database. Migrations run to current. */
  static async open(seed?: Uint8Array): Promise<AppDatabase> {
    const SQL = await loadSqlJs();
    let bytes: Uint8Array | null = seed ?? null;
    if (!bytes) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) bytes = base64ToBytes(raw);
      } catch { /* storage unavailable — run in-memory */ }
    }
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    const app = new AppDatabase(db);
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

  /** Serialize and stash the whole database. The mirror is best-effort:
   *  quota failures leave the in-memory db authoritative for the session. */
  save(): void {
    const b64 = bytesToBase64(this.db.export());
    try {
      localStorage.setItem(STORAGE_KEY, b64);
    } catch (err) {
      console.warn('Failed to persist the database to localStorage:', err);
    }
  }

  /** The raw SQLite file — this is what "save a backup to disk" downloads. */
  exportBytes(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    this.db.close();
  }

  // ---- scenarios -----------------------------------------------------------

  loadScenarios(): Scenario[] {
    const res = this.db.exec(`SELECT id, name, inputs FROM scenarios ORDER BY rowid`);
    if (res.length === 0) return [];
    return res[0].values.map(([id, name, inputs]) => ({
      id: id as string,
      name: name as string,
      // Migrated on the way out so older rows gain newer fields.
      inputs: migrateInputs(JSON.parse(inputs as string)),
    }));
  }

  /** Full replace — scenarios are few and written as a set, never one row at
   *  a time from the UI, so a transaction around delete+inserts is simplest
   *  and keeps the store consistent on any failure. */
  saveScenarios(scenarios: Scenario[]): void {
    this.db.run('BEGIN');
    try {
      this.db.run('DELETE FROM scenarios');
      const stmt = this.db.prepare(
        `INSERT INTO scenarios (id, name, inputs, updated_at) VALUES (?, ?, ?, ?)`,
      );
      const now = new Date().toISOString();
      for (const s of scenarios) {
        stmt.run([s.id, s.name, JSON.stringify(s.inputs), now]);
      }
      stmt.free();
      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  // ---- active scenario id --------------------------------------------------

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

  // ---- whole-document interchange ------------------------------------------

  /** Snapshot the store as the validated app-database document, or null when
   *  the contents don't parse (a store the app has never written to). */
  toDoc(): AppDbDoc | null {
    const scenarios = this.loadScenarios();
    if (scenarios.length === 0) return null;
    const configRaw = this.loadConfig();
    const config = configRaw ? validateAppConfig(configRaw) : null;
    if (!config) return null;
    const activeScenarioId = this.loadActiveScenarioId() ?? scenarios[0].id;
    const parsed = appDbDocSchema.safeParse({ version: SCHEMA_VERSION, scenarios, activeScenarioId, config });
    return parsed.success ? parsed.data : null;
  }

  /** Replace the store's contents with a validated document. */
  loadDoc(doc: AppDbDoc): void {
    this.saveScenarios(doc.scenarios);
    this.saveActiveScenarioId(doc.activeScenarioId);
    this.saveConfig(doc.config);
  }
}

export const DB_STORAGE_KEY = STORAGE_KEY;
