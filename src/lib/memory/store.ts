// Memory store: what the assistant remembers across conversations.
//
// Two scopes:
//   - 'scenario' — facts about ONE plan (spouse's pension details, a decision
//     the user made, an important figure they quoted). Shown only in chats on
//     that scenario.
//   - 'global'   — facts about the USER that travel across plans (they're 62,
//     they prefer plain language, they want to retire to Nova Scotia).
//
// Design constraints (from the product brief):
//   - BOUNDED. A memory store that only grows becomes noise the model can't
//     use. Count per scope is capped (MAX_PER_SCOPE); when full, the LOWEST-
//     ranked memory is evicted. Rank = weight × recency decay; every access
//     (recall hit) strengthens a memory, every idle day weakens it.
//   - SEARCHABLE. A query is TOKENIZED and matched against each memory's
//     keywords — the words of the fact itself, plus hypernyms captured at
//     write time ("fruit" for "likes oranges"). Matches score by the fraction
//     of query tokens hit, ranked by score then weight × recency. Lexical
//     only (no FTS5 in the bundled sql.js, no embeddings) — memory sets are
//     small (hundreds at most), so token overlap is plenty and keeps the
//     store dependency-free.
//   - STANDALONE. This module knows nothing about retirement, scenarios-as-
//     storage, or the agent loop. It's a generic weighted-memory store over a
//     persistence adapter, deliberately cleavable as a library later. The ONLY
//     imports are types.

/** What the assistant should remember. Persisted verbatim as JSON. */
export interface MemoryRecord {
  id: string;
  /** 'scenario' memories are scoped to scopeKey (a scenario id); 'global'
   *  ones ignore it. */
  scope: 'scenario' | 'global';
  /** When scope === 'scenario': which plan it belongs to. '' for global. */
  scopeKey: string;
  /** The fact itself, one or two sentences, self-contained ("Spouse's DB
   *  pension pays $1,200/mo from age 65" — not "it pays that"). */
  text: string;
  /** Search indicators: words of the fact plus hypernyms a future question
   *  might use ("fruit", "city", "preference"). Optional so records written
   *  before keywords existed still load — recall backfills them from text. */
  keywords?: string[];
  /** When the fact was captured (epoch ms). */
  createdAt: number;
  /** Last access (recall hit or write); drives recency ranking. */
  lastAccessedAt: number;
  /** Importance 0..1, set at write and mutable. Access does NOT raise
   *  importance (that would let the model hype its own facts) — it refreshes
   *  lastAccessedAt and bumps accessCount, which is the "useful" signal. */
  importance: number;
  accessCount: number;
}

/** Where memories live. The app provides an adapter backed by its SQLite
 *  store; tests use an in-memory one. The store NEVER touches storage
 *  directly — that's what keeps it portable. */
export interface MemoryAdapter {
  /** All records (any scope), oldest first. */
  all(): MemoryRecord[];
  /** Insert or replace by id. */
  put(record: MemoryRecord): void;
  /** Remove by id. */
  delete(id: string): void;
}

// ---------------------------------------------------------------------------
// Tunables — the "reasonably limited" dials.
// ---------------------------------------------------------------------------

/** Max memories retained per scope (scenario scopes and the global scope each
 *  get this budget). Past it, the lowest-ranked memory is evicted on write. */
export const MAX_PER_SCOPE = 50;

/** Recency half-life in days: a memory untouched for this long ranks at half
 *  its weight in the eviction/recall ordering. 30 days: a month of silence
 *  visibly demotes a memory without erasing it. */
const RECENCY_HALF_LIFE_DAYS = 30;

/** A memory whose rank has decayed below this is pruned on maintenance even
 *  if the scope isn't full — stale noise shouldn't ride on the cap. */
const PRUNE_RANK_FLOOR = 0.04;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MemoryWrite {
  scope: 'scenario' | 'global';
  scopeKey?: string;   // required when scope === 'scenario'
  text: string;
  importance?: number; // default 0.5
  /** Extra search words beyond the fact's own (hypernyms: "fruit" for
   *  "likes oranges"). Merged with the auto-extracted ones at write. */
  keywords?: string[];
}

export interface RecallOptions {
  /** Max memories returned (most relevant first). Default 6. */
  limit?: number;
  /** Only this scope; omit for scope + global together (the usual chat need:
   *  "what's true about this plan AND about the user"). */
  scopeKey?: string;
}

// ---------------------------------------------------------------------------
// Keywords — the search indicators a recall query is matched against
// ---------------------------------------------------------------------------

/** Common English glue words: never useful as search keys (a query of "what
 *  is my favourite fruit" would otherwise match everything via "what"/"is").
 *  Generic, deliberately small — this module knows nothing about retirement. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can',
  'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his',
  'how', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of',
  'on', 'or', 'our', 'she', 'so', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'to', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
]);

/** Cap on stored keywords per memory: enough room for the fact's own words
 *  plus the model-supplied hypernyms, without letting keywords bloat rows. */
const MAX_KEYWORDS = 24;

/** Lowercase word tokens worth indexing: split on non-word characters
 *  (keeping $ and digits so "$1,200" yields "$1" and "200"), drop glue words
 *  and single characters, dedupe. Order is stable, source text first. */
export function extractKeywords(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9$]+/)) {
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    if (!out.includes(raw)) out.push(raw);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

/** Conservative stem: strips common English inflections so "pensions" matches
 *  "pension" and "downsizing" matches "downsize" without a real stemmer.
 *  Deliberately cautious — each rule requires a comfortable remainder, so
 *  "gas" stays "gas" and "ness" stays "ness". Applied to BOTH query tokens
 *  and keywords at match time; the stored form stays verbatim. */
function normalizeToken(t: string): string {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 5 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  if (t.length > 4 && t.endsWith('ed')) return t.slice(0, -2);
  return t;
}

/** A query token T hits keyword K when their normalized forms are equal, or
 *  one is a prefix of the other and the overlap is long enough to be
 *  meaningful ("downsize" ↔ "downsizing", "retire" ↔ "retirement") rather
 *  than accidental ("age" must not hit "agent"). */
function tokenHits(token: string, keyword: string): boolean {
  const t = normalizeToken(token);
  const k = normalizeToken(keyword);
  if (t === k) return true;
  const short = Math.min(t.length, k.length);
  return short >= 4 && (k.startsWith(t) || t.startsWith(k));
}

/** The indexed keywords for a record: stored ones if present, else derived
 *  from the text — so memories written before keywords existed (and any
 *  adapter that drops the field) keep matching without a data migration. */
function keywordsOf(record: MemoryRecord): string[] {
  return record.keywords?.length ? record.keywords : extractKeywords(record.text);
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** Exponential recency decay: 1.0 when just accessed, 0.5 at the half-life,
 *  approaching 0 but never reaching it (id: a 90-day-old important memory
 *  still beats a fresh trivial one if its weight is high enough). */
export function recencyFactor(lastAccessedAt: number, now: number): number {
  const days = Math.max(0, (now - lastAccessedAt) / DAY_MS);
  return Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

/** Rank = importance × recency. This is the eviction order (evict lowest) and
 *  the recall ordering (show highest). */
export function rank(record: MemoryRecord, now: number): number {
  return record.importance * recencyFactor(record.lastAccessedAt, now);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export class MemoryStore {
  private adapter: MemoryAdapter;
  private clock: () => number;

  constructor(adapter: MemoryAdapter, clock: () => number = Date.now) {
    this.adapter = adapter;
    this.clock = clock;
  }

  /** Write a memory. When its scope is full the new memory replaces the
   *  lowest-ranked resident IF the new one outranks it; otherwise the write
   *  is refused (returning null) rather than silently dropping the better
   *  candidate. Duplicate text in the same scope updates the existing record
   *  (refresh access, raise importance if the writer asked for more) instead
   *  of piling up copies. */
  write(input: MemoryWrite): MemoryRecord | null {
    const text = input.text.trim();
    if (!text) return null;
    const now = this.clock();
    const scopeKey = input.scope === 'scenario' ? (input.scopeKey ?? '') : '';
    if (input.scope === 'scenario' && !scopeKey) return null;

    const existing = this.adapter.all().find(
      m => m.scope === input.scope && m.scopeKey === scopeKey && m.text === text,
    );
    if (existing) {
      const refreshed: MemoryRecord = {
        ...existing,
        importance: Math.min(1, Math.max(existing.importance, input.importance ?? 0)),
        lastAccessedAt: now,
        accessCount: existing.accessCount + 1,
      };
      this.adapter.put(refreshed);
      return refreshed;
    }

    // The fact's own words are indexed automatically; anything the writer
    // supplied on top (hypernyms like "fruit" for "likes oranges") is merged
    // in, deduped, capped.
    const keywords = [...extractKeywords(text)];
    for (const k of input.keywords ?? []) {
      const norm = k.trim().toLowerCase();
      if (norm && !keywords.includes(norm)) keywords.push(norm);
    }

    const record: MemoryRecord = {
      id: `mem-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      scope: input.scope,
      scopeKey,
      text,
      keywords: keywords.slice(0, MAX_KEYWORDS),
      createdAt: now,
      lastAccessedAt: now,
      importance: Math.min(1, Math.max(0, input.importance ?? 0.5)),
      accessCount: 0,
    };

    const inScope = this.adapter.all().filter(
      m => (m.scope === 'global' ? 'global' : m.scopeKey) === (scopeKey || 'global'),
    );
    if (inScope.length >= MAX_PER_SCOPE) {
      const weakest = inScope.reduce((a, b) => (rank(b, now) < rank(a, now) ? b : a));
      if (rank(record, now) <= rank(weakest, now)) return null; // refuse, don't churn
      this.adapter.delete(weakest.id);
    }
    this.adapter.put(record);
    return record;
  }

  /** Keyword search over memory text, ranked. The query is tokenized; a
   *  memory matches when at least one query token hits one of its keywords,
   *  and scores by the FRACTION of query tokens hit (relevance first) with
   *  weight × recency as the tiebreak — a partial match on an important,
   *  recently-used memory beats an every-word match on a stale trivial one
   *  only when the fractions are equal, which is the right bias. A literally
   *  empty query returns the highest-ranked memories outright (the "remind
   *  me what matters" path); a NON-empty query with no usable tokens ("what
   *  is my") matches nothing — it's a real question, just unmatchable, and
   *  the tool layer answers with its closest-memories fallback. Every
   *  returned record has its access stamped — recall IS use. */
  recall(query: string, opts: RecallOptions = {}): MemoryRecord[] {
    const now = this.clock();
    const limit = opts.limit ?? 6;
    const tokens = extractKeywords(query);
    const listAll = query.trim() === '';

    const pool = this.adapter.all().filter(m => {
      if (opts.scopeKey !== undefined) {
        // The asked-for scenario's memories plus the global ones.
        return m.scope === 'global' || m.scopeKey === opts.scopeKey;
      }
      return true;
    });

    const scored = listAll
      ? pool.map(m => ({ m, score: 1 }))
      : pool.map(m => {
          const keywords = keywordsOf(m);
          const hit = tokens.filter(t => keywords.some(k => tokenHits(t, k))).length;
          return { m, score: hit / tokens.length };
        }).filter(({ score }) => score > 0);

    const ranked = scored
      .sort((a, b) => (b.score - a.score) || (rank(b.m, now) - rank(a.m, now)))
      .slice(0, limit);

    // Stamp access on what we returned: strengthens frequently-useful
    // memories, which is exactly the weighting signal the brief asked for.
    // The stamped copies ARE what we hand back, so callers see the record
    // reflecting its own fresh access.
    return ranked.map(({ m }) => {
      const stamped = { ...m, lastAccessedAt: now, accessCount: m.accessCount + 1 };
      this.adapter.put(stamped);
      return stamped;
    });
  }

  /** Forget one memory by id (user or model-initiated). */
  forget(id: string): void {
    this.adapter.delete(id);
  }

  /** Maintenance: drop memories whose rank has decayed below the floor. Call
   *  opportunistically (on store open, say) — it's the second limiter after
   *  the count cap: the cap bounds a FULL store, this bounds a STALE one. */
  prune(): number {
    const now = this.clock();
    let removed = 0;
    for (const m of this.adapter.all()) {
      if (rank(m, now) < PRUNE_RANK_FLOOR) {
        this.adapter.delete(m.id);
        removed++;
      }
    }
    return removed;
  }

  /** Everything in a scope (+ global), newest first — the user-visible list
   *  in a future "what do you remember about me?" panel. No access stamping:
   *  listing isn't using. */
  list(scopeKey?: string): MemoryRecord[] {
    return this.adapter.all()
      .filter(m => (scopeKey !== undefined ? m.scope === 'global' || m.scopeKey === scopeKey : true))
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }
}
