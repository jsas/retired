// The app-facing memory adapter: persists memories in the project's existing
// SQLite database (AppDatabase, sql.js/WASM) so they ride the same backup /
// OPFS / localStorage mirroring as scenarios and AI settings.
//
// The bundled sql.js has NO FTS5 (verified), so search is `LIKE` over the text
// column — memory sets are small (≤ a few hundred), and LIKE matches exactly
// the substring semantics MemoryStore.recall re-ranks. The table lives in the
// same database file, so a backup carries memories for free; the class keeps
// all SQL in one place and speaks only the MemoryAdapter interface.
//
// LIKE special characters (% and _) in a query are escaped so a query for
// "100%" doesn't turn into a wildcard scan.

import type { AppDatabase } from '../../data/db';
import type { MemoryAdapter, MemoryRecord } from './store';

const TABLE = 'memories';

export class SqliteMemoryAdapter implements MemoryAdapter {
  private db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
    db.withTransaction(() => {
      db.run(`CREATE TABLE IF NOT EXISTS ${TABLE} (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        importance REAL NOT NULL,
        access_count INTEGER NOT NULL
      )`);
    });
  }

  all(): MemoryRecord[] {
    const res = this.db.exec(`SELECT id, scope, scope_key, text, created_at,
      last_accessed_at, importance, access_count FROM ${TABLE} ORDER BY created_at`);
    if (res.length === 0) return [];
    return res[0].values.map(([id, scope, scopeKey, text, createdAt, lastAccessedAt, importance, accessCount]) => ({
      id: id as string,
      scope: scope as 'scenario' | 'global',
      scopeKey: scopeKey as string,
      text: text as string,
      createdAt: createdAt as number,
      lastAccessedAt: lastAccessedAt as number,
      importance: importance as number,
      accessCount: accessCount as number,
    }));
  }

  put(record: MemoryRecord): void {
    this.db.run(
      `INSERT INTO ${TABLE} (id, scope, scope_key, text, created_at, last_accessed_at, importance, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         scope = excluded.scope, scope_key = excluded.scope_key, text = excluded.text,
         created_at = excluded.created_at, last_accessed_at = excluded.last_accessed_at,
         importance = excluded.importance, access_count = excluded.access_count`,
      [record.id, record.scope, record.scopeKey, record.text, record.createdAt,
       record.lastAccessedAt, record.importance, record.accessCount],
    );
  }

  delete(id: string): void {
    this.db.run(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
  }

  /** Substring search used by the tool layer: escapes LIKE wildcards so the
   *  query is literal. MemoryStore still does the final ranking; this just
   *  narrows the candidate set in SQL. */
  searchText(query: string): MemoryRecord[] {
    const escaped = query.trim().toLowerCase()
      .replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    if (!escaped) return this.all();
    const res = this.db.exec(`SELECT id, scope, scope_key, text, created_at,
      last_accessed_at, importance, access_count FROM ${TABLE}
      WHERE lower(text) LIKE '%' || ? || '%' ESCAPE '\\' ORDER BY created_at`, [escaped]);
    if (res.length === 0) return [];
    return res[0].values.map(([id, scope, scopeKey, text, createdAt, lastAccessedAt, importance, accessCount]) => ({
      id: id as string,
      scope: scope as 'scenario' | 'global',
      scopeKey: scopeKey as string,
      text: text as string,
      createdAt: createdAt as number,
      lastAccessedAt: lastAccessedAt as number,
      importance: importance as number,
      accessCount: accessCount as number,
    }));
  }
}
