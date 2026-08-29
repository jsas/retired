// The app-facing memory adapter: persists memories in the project's existing
// SQLite database (AppDatabase, sql.js/WASM) so they ride the same backup /
// OPFS / localStorage mirroring as scenarios and AI settings.
//
// The bundled sql.js has NO FTS5 (verified), so search is done in the store:
// the adapter hands over every row (memory sets are small, ≤ 50 per scope)
// and MemoryStore.recall scores keyword overlap itself. The table lives in
// the same database file, so a backup carries memories for free; the class
// keeps all SQL in one place and speaks only the MemoryAdapter interface.
//
// This module owns its table's schema (AppDatabase deliberately doesn't know
// about it), so column additions run here: on open, PRAGMA table_info checks
// for the keywords column and ALTERs it in when missing — legacy databases
// upgrade in place with no SCHEMA_VERSION bump.

import type { AppDatabase } from '../../data/db';
import type { MemoryAdapter, MemoryRecord } from './store';

const TABLE = 'memories';

export class SqliteMemoryAdapter implements MemoryAdapter {
  private db: AppDatabase;
  private persist: () => void;

  constructor(db: AppDatabase, persist: () => void = () => {}) {
    this.db = db;
    this.persist = persist;
    db.withTransaction(() => {
      db.run(`CREATE TABLE IF NOT EXISTS ${TABLE} (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        text TEXT NOT NULL,
        keywords TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        importance REAL NOT NULL,
        access_count INTEGER NOT NULL
      )`);
      // Databases created before keywords existed lack the column (the CREATE
      // above is a no-op for them) — add it in place. The DEFAULT '' keeps
      // old rows valid; the store derives their keywords from text on read.
      const cols = db.exec(`PRAGMA table_info(${TABLE})`);
      const names = cols.length ? cols[0].values.map(r => r[1]) : [];
      if (!names.includes('keywords')) {
        db.run(`ALTER TABLE ${TABLE} ADD COLUMN keywords TEXT NOT NULL DEFAULT ''`);
      }
    });
  }

  all(): MemoryRecord[] {
    const res = this.db.exec(`SELECT id, scope, scope_key, text, keywords, created_at,
      last_accessed_at, importance, access_count FROM ${TABLE} ORDER BY created_at`);
    if (res.length === 0) return [];
    return res[0].values.map(([id, scope, scopeKey, text, keywords, createdAt, lastAccessedAt, importance, accessCount]) => ({
      id: id as string,
      scope: scope as 'scenario' | 'global',
      scopeKey: scopeKey as string,
      text: text as string,
      keywords: (keywords as string).split(' ').filter(Boolean),
      createdAt: createdAt as number,
      lastAccessedAt: lastAccessedAt as number,
      importance: importance as number,
      accessCount: accessCount as number,
    }));
  }

  put(record: MemoryRecord): void {
    const keywords = (record.keywords ?? []).join(' ');
    this.db.run(
      `INSERT INTO ${TABLE} (id, scope, scope_key, text, keywords, created_at, last_accessed_at, importance, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         scope = excluded.scope, scope_key = excluded.scope_key, text = excluded.text,
         keywords = excluded.keywords, created_at = excluded.created_at,
         last_accessed_at = excluded.last_accessed_at,
         importance = excluded.importance, access_count = excluded.access_count`,
      [record.id, record.scope, record.scopeKey, record.text, keywords, record.createdAt,
       record.lastAccessedAt, record.importance, record.accessCount],
    );
    this.persist();
  }

  delete(id: string): void {
    this.db.run(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
    this.persist();
  }
}
