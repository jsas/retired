# RE:tired — UX Makeover Requirements

**Status:** proposal · **Branch:** `makeover-proposals` · **Date:** 2026-08-30
**Scope:** the app's core UX language — verdict, controls, and how the dashboard is organized.

---

## 1. Problem

RE:tired's engine is strong and the app is honest, but the interface buries the answer:

- "Am I OK?" is card #4 of 4 inside a collapsible panel, in 10–12px type.
- Finance jargon (withdrawal rate, depletion age, Monte Carlo) stands between the user and the verdict.
- The stress tests that justify the verdict (Monte Carlo, backtest) live in the header, disconnected from the answer.
- Controls state a value but not its consequence — the user has to know what to change and what it does.

## 2. Principles (from the user's taste, wave 1)

1. **Verdict first.** The page opens with the answer in plain English: *"Your money lasts until you're 96."* Everything else is evidence.
2. **Plain English only.** "Runs out at 89", "left over at 95", "stormy / ordinary / kind". No "depletion age", "withdrawal rate", "Monte Carlo" on the surface.
3. **Few controls, shown consequences.** At most three dials on the front door (stop working at · spend a year · saved so far) — each stating what moving it does.
4. **One primary action per page.**
5. **Live, not batch.** Dragging any control re-simulates immediately.
6. **Honesty.** The failing plan says so, with the one change that fixes it. The demo model intentionally defaults to a failing plan (runs out at 89) so this state is always visible.

## 3. The shared interaction model (all 40 designs use it)

- **Inputs:** current age, retire age, max age, savings, yearly contribution, yearly spending, CPP+OAS per year, benefit start age.
- **Weather** (market mood): `stormy / ordinary / kind` — the layperson's Monte Carlo.
- **Outputs:** the verdict sentence, "money lasts to", "left at 95", the balance-over-age curve, yearly rows (age / in / out / balance).
- Single source of truth: `model.js` — every design computes through `simulate()`. Nothing hardcoded. **At defaults the plan fails** (money out at 89) — this is intentional so the "runs short" state is exercised.
- Storm test = re-run with `sky: 'storm'`.

## 4. The collection

| # | Name | One-line concept |
|---|------|------------------|
| 01 | Verdict-first dashboard | The answer as hero, stress tests as cards |
| 02 | Dark editorial welcome | The question huge on a dark landing |
| 03 | Steering control room | Score pinned, pad dominant, faders explain |
| 04 | Range | Money as a fuel gauge |
| 05 | The Sentence | Plan as one editable first-person sentence |
| 06 | The River | Scroll your life downstream |
| 07 | Calm Focus | One enormous number, three steppers |
| 08 | Life Timeline | Age axis with draggable milestone pins |
| 09 | One Question at a Time | Typeform-calm card wizard |
| 10 | Split Answer | Controls left, sticky verdict right (Linear) |
| 11 | Bento Board | Plan as balanced grid of tiles |
| 12 | Plan Score | Honest 0–100 ring with 3 ingredients |
| 13 | The Printed Plan | Typeset private-bank letter |
| 14 | Terminal | `plan> retire 64` green-on-black |
| 15 | Glass Night | Indigo night, frosted glass |
| 16 | Contour Map | Success terrain as topo lines, drag the dot |
| 17 | Conversation | Four chat questions, verdict as message |
| 18 | Instrument Dials | Rotary knobs, amber VFD readout |
| 19 | The Year Strip | One bar per year, scrub across decades |
| 20 | One Breath | 90% empty: number, arrows, bottom sheet |
| 21 | The Statement | Bank statement: verdict box + yearly rows |
| 22 | Swiss Poster | Typographic grid, 140px verdict, one red |
| 23 | Morning Briefing | Email digest: TL;DR + what to watch |
| 24 | The Ledger | Ruled notebook, margin notes, ink stamp |
| 25 | The Spreadsheet | Live spreadsheet with formula-bar words |
| 26 | Big Canvas | Dense 12-col panel dashboard |
| 27 | The Forecast | Weather-report metaphor, 5-period chips |
| 28 | The Rings | Apple-Watch rings: Outlast / Cushion / Weatherproof |
| 29 | Road Trip | Age axis as road, stops & finish banner |
| 30 | The Checklist | Aviation preflight with inline fixes |
| 31 | Card Deck | One fact per card, keys + dots |
| 32 | The Comic | Three drawn panels with live captions |
| 33 | Blueprint | Plan as technical elevation drawing |
| 34 | Retro Broadcast | CRT TV, ticker, lower-third verdict |
| 35 | Crayon | Hand-drawn workbook for spreadsheet-fearers |
| 36 | Ambient | Full-viewport gradient, ghost controls |
| 37 | The Paystub | Inverse paystub for a chosen future age |
| 38 | Kitchen Table | Draggable paper cards on a wood table |
| 39 | Voice Briefing | 5 spoken lines that fade in sequence |
| 40 | Split Worlds | Draggable A/B split, winner pill |

**Second-wave additions:** `dashboard.html` — a full multi-section dashboard (verdict / numbers / milestones / year-by-year / risks) showing how the real home page could be restructured; it merges the wave-1 winners.

## 5. Implementation contract (what building "the winner" means)

1. **New components only, additive.** The engine stays authoritative for numbers. (If the `retired-engine` extraction in §6 is undertaken, "no changes" means no *behavior* changes: golden-master tests stay green; import paths may move.)
2. **Verdict component** (`VerdictHero`): badge + sentence + sub-line + one-line fix; takes engine results, emits no edits.
3. **Three dials** (`PlanDials`): retire age, spending, savings; consequence line under each; writes through the normal `handleInputsChange` path (unsaved-edits flow unchanged).
4. **Plain-English mapping layer** (`plainEnglish.ts`): pure functions engine→words (verdict sentence, lasts-to, left-at-95, storm test, milestone list). Fully unit-testable; this is where jargon dies.
5. **Weather ↔ volatility mapping:** `stormy/ordinary/kind` maps to existing `returnVolatility` presets; no new engine knobs.
6. **Persistence:** any new view state uses the existing localStorage patterns (`wealthconsole_panel_state` style keys).
7. **Routing:** each new view is a hash-route page (`#/verdict` etc.) in `viewRoutes` — no changes to existing routes.
8. **Tests:** Vitest for the mapping layer + each new component's wiring, per repo convention. `npx vitest run` green before commit.
9. **Accessibility:** verdict is real text (not SVG), sliders are real `<input type=range>` with labels, color never the only signal (badge text always present).
10. **Rollout:** ship as an additional front-door view; existing dashboard unchanged behind it. The winner may later *replace* dashboard sections per section-4 table.

## 6. How to choose

- Browse `index.html` (gallery of 40) and `dashboard.html` (full-page dashboard).
- Pick one design (or a mashup) — the requirements above apply to whichever wins.
- The most buildable set: **01 (verdict hero) + 12 (honest score) + 08 (timeline)** merged — which is roughly what `dashboard.html` demonstrates.

## 7. Architecture requirement: `retired-engine` package + datasource layer

**The ask:** take *all* website function and turn it into a node package (`retired-engine`), and expose all data as datasource classes with eventing, so React components subscribe instead of owning state — making any reskin cheap.

This is the makeovers' precondition: §5 says "new components only, additive" because touching existing state flow is risky. A datasource layer removes that reason — the UI becomes a thin, replaceable skin over data sources.

### 7.1 Package boundary

- New workspace package `packages/retired-engine` (or `packages/retired-engine/` as a plain folder + workspace entry). The app depends on it as `@retired/engine`.
- **What moves in:** everything that is pure TypeScript with no DOM dependency —
  `retirementEngine.ts`, `strategies.ts`, `monteCarlo.ts`, `spendingSolver.ts`, `eqSolver.ts`, `eqConstraints.ts`, `eqSolver.ts`, `canadianTax.ts`, `engineMath.ts`, `historicalReturns.ts`, `householdTypes.ts`, `compareMetrics.ts`, `planTransfer.ts`, `projectionExport.ts`, `scenarioRevisions.ts`, `shareLink.ts`, `strategies.ts`, types from `appConfig.ts`, plus new `plainEnglish.ts`.
- **What stays in the app:** browser-bound code — `appDb.ts` / `data/db.ts` (sql.js), `opfs.ts`, `db.ts`, `store.ts`, the three workers, everything in `lib/ai/` (web-llm is browser-only), `aiSettings`, `eqStorage`, `printOptions`, `shareLink`'s URL I/O, UI helpers.
- **Known extraction wrinkles** (audit before moving): `appConfig.ts` mixes pure validation with `loadConfig`/`saveConfig` localStorage calls — split into `config-schema.ts` (types + `validateAppConfig`, moves) and `config-storage.ts` (localStorage, stays); `retirementEngine.ts` and `strategies.ts` matches were comment-only (verified — no browser APIs).
- **Public API** (one barrel export, versioned): `calculatePerson`, `calculateRetirement`, `calculateHousehold`, `combineHouseholdBreakdown`, `householdOutcome`, `cppAdjustmentMultiplier`, `runMonteCarlo`, solvers, all input/result types, `AppConfig` types + `validateAppConfig`, and `plainEnglish` mappers.
- **Engine tests travel with the code** (golden master, engineMath, etc. keep running against the package); they double as the extraction's regression net.
- **Packaging:** ESM, `type: module`, TS strict, one runtime dep — sql.js (already used by the app; pure wasm, identical in browser and node) — exports map for both `import` and types; no browser globals reachable from any module entry.

### 7.2 Datasource classes

One class per data domain, each: holds state, emits change events, exposes an async mutating action, and never imports React.

| Datasource | State it owns | Change events | Backed by |
|---|---|---|---|
| `ScenariosDatasource` | scenario list, active id, dirty flags | `change`, `switch`, `dirty` | `AppStore` (which wraps `AppDatabase`/sql.js) |
| `ResultsDatasource` | `calculateHousehold(...)` output for active inputs+config | `change` (debounced) | `@retired/engine` |
| `MonteCarloDatasource` | latest MC results + `running` flag | `status`, `result` | `monteCarlo.worker` via existing run helpers |
| `SolversDatasource` | EQ + spending solver state | `status`, `result` | eq/spending workers |
| `ConfigDatasource` | `AppConfig` | `change` | `config-storage.ts` |
| `RevisionsDatasource` | revision list | `change` | `SqliteRevisionStore` |
| `AiDatasource` | chat, provider, streaming state | `message`, `status` | `lib/ai/*` |

- **Tiny event emitter** (~30 lines, `on/off/once/emit`) in the package — no RxJS, no external deps. One `EventEmitter` base class, subclasses call `this.emit('change', payload)`.
- **One `DatasourceHost`** wires them together and owns cross-datasource reactions (inputs change → results recompute → MC invalidates). Datasources stay ignorant of each other where possible; the host sequences reactions. The host also owns the **sql.js handle** (§7.5): it constructs the `Database` from wherever the user's bytes live and passes it to the engine; every datasource persists through that one handle.
- **Subscribe via `useSyncExternalStore`** (React 19) — one 15-line hook `useDatasource(ds, selector)`, replacing the ~40 `useState`/`useMemo`/`useEffect` chains in `App.tsx` over time. Components get data by subscription, not props-drilled state.

### 7.3 Migration contract

1. **Golden-master safety:** `goldenMaster.test.ts` values must be byte-identical after the move.
2. **No behavior change:** same results for same inputs, same persistence keys, same URL shapes; users see nothing except faster reskins later.
3. **Strangler order** (each step ships independently, tests green after each):
   1. `retired-engine` package created with pure modules + their tests; app imports from the package; delete originals.
   2. Introduce `EventEmitter` + `ResultsDatasource` only — App.tsx's `results` memo becomes a subscription; everything else unchanged.
   3. Convert remaining domains one at a time (scenarios → config → MC → solvers → revisions → AI), app green after each.
4. **Don't rewrite what works:** the AI tools' direct `calculateHousehold` calls (`ai/tools.ts:623+`) can stay until they move to `ResultsDatasource` naturally.

### 7.4 Acceptance

- `npx vitest run` green at every step; golden master unchanged.
- After step 1, `grep -r "from './lib/retirementEngine'" src/` returns nothing (imports go through the package).
- After each datasource step, that domain's UI flow works identically (manual checklist per domain).
- A reskin test: build one mockup (e.g. 01) against the datasource layer with **zero changes to any datasource** — that's the proof the skin is thin.

### 7.5 Storage: the engine takes a sql.js handle

**The ask:** no backend zoo — the engine just takes an open sql.js `Database` handle. Whoever constructs it decides where the bytes live; the engine never knows.

**The seam.** sql.js works identically in browser and node and serializes/rehydrates whole databases via `export()` / `new Database(bytes)`. So the package's constructor is:

```ts
import initSqlJs, { Database } from 'sql.js';

const SQL = await initSqlJs();                          // wasm, either runtime
const db = new Database(myBytesOrUndefined);            // caller's bytes or fresh
const engine = new EngineStore(db);                     // engine owns schema + queries
```

The caller keeps the handle: the website passes one opened from OPFS/localStorage bytes (existing code, unchanged behavior); a node lib consumer passes one opened from their own file (`fs.readFileSync('plan.sqlite')`) or an in-memory db. Same schema (`APP_DB_VERSION`), same file, both sides.

**EngineStore surface** (replaces today's `AppDatabase`'s storage concerns, keeps its query surface): `loadScenarios`, `saveScenarios`, `loadConfig`, `saveConfig`, `save()`, `export(): Uint8Array`, `close()` — plus kv/meta passthroughs for the memory store's table. The engine does **not** auto-persist: the handle's owner decides when bytes hit disk (`db.export()` → write wherever). The website keeps its write-through OPFS+mirror semantics in the caller; the lib consumer just writes the file.

**Backup/restore in the library** (the website calls it; raw sqlite bytes need no new container):

- `createBackup(db): Uint8Array` — `db.export()` (already the format).
- `restoreBackup(db, bytes): RestoreReport` — validate sqlite header + `schema_version` against `APP_DB_VERSION`, restore inside a transaction, per-table salvage (same semantics as `salvageableContents`), report what was skipped and why.
- `'restored'` event → host drops all datasource caches and reloads.

**Where the bytes live (app-side, unchanged):** OPFS primary + localStorage mirror, exactly as today (`src/data/opfs.ts`, `save()` in `src/data/db.ts`). A user-picked file via File System Access can come later as an app-side choice — the engine doesn't care.

**Tests** (per [[tests-with-every-feature]]): EngineStore round-trips against an in-memory sql.js db in plain node (no DOM); corrupt/truncated-bytes restore paths; version-mismatch refusal; golden master untouched; cross-boundary proof — bytes exported in one runtime restore in the other.

## 8. Current-UI inventory (scraped) — what any winning design must hold

**Rule:** whichever design wins must support *all* of this without it looking like a bolt-on. If the design is a "verdict + three dials" surface, the rest needs a deliberate home — otherwise we haven't redesigned, we've deleted features.

### 8.1 The two-site split

- **Site 1 — landing.** Public, static, zero app weight: what it is, privacy promise (no servers, no accounts, data never leaves your browser), **legal** (not financial/tax/investment advice — currently one sentence in `WelcomeCard.tsx:112`; landing makes it a real page), open-source note, donate, and one door: **"Open the app."** Mockups 02 (dark editorial welcome) and 23 (morning briefing) are the natural shapes.
- **Site 2 — the app.** The dashboard itself. Everything below lives here. Same origin, different routes — `#/` landing vs `#/app/…` — or a separate build; decide with the winner.

### 8.2 Views (17 hash routes in `viewRoutes.ts`)

| Route | What it is today | Where it goes in the new site |
|---|---|---|
| `projection` | the dashboard: TimelineChart + MetricCards + ScheduleTable | the core of Site 2 |
| `year-math` | per-year receipts (MathPage) | "the receipts" — one level under a stat |
| `steering` | EqPage: XY pad (retire age × spending) + RangeFader guardrails + spending bands | the dials page — closest to the mockups |
| `optimize` | withdrawal-strategy optimizer (OptimizeCard) | a "what would a machine do" card |
| `compare` | side-by-side scenario comparison (CompareCard) | keep, or fold into scenario manager |
| `monte-carlo` | Monte Carlo runs + chart | part of the verdict's storm test |
| `backtest` | historical-sequence backtest (BacktestPanel) | sibling of Monte Carlo |
| `print` | PrintSummary (the printable plan) | becomes the "one-page plan" export |
| `export` | DataPage: projection export, full backup, import | Site 2 settings/data |
| `scenarios` | ScenarioManager: list, revisions, rollback | the "plans" surface |
| `sharing` | share-link import/export (SharingPage) | small surface, keep |
| `donate` | DonateCard | moves to Site 1 |
| `assistant` | AgentPage: in-browser AI with tools | its own site-2 page, keep |
| `connections` | AI provider connections | nested under assistant |
| `welcome` | WelcomeCard first-run | becomes Site 1 |
| `help` | HelpModal documentation | keep, linkable from both sites |
| `settings` | engine settings (SettingsModal) | Site 2 settings |

### 8.3 The input surface (SidebarForm, ~900 lines, 13 collapsible sections)

Personal Profile · Account Balances · Contribution Rates · RDSP · Government Benefits (CPP/OAS/GIS, start ages) · Pensions (multiple, windows, indexation) · Employment Income (part-time work, dest account, top-up spending) · Cash Events (one-time/recurring, transfers between accounts/spouses) · Spending Phases (bands: from-age + % of desired) · Spouse (full second input set + baseline toggle) · Withdrawal Strategy (account order) · Home Equity (reverse mortgage / HELOC) · Market Hypotheses (returns, volatility, inflation).

**Requirement:** the three mockup dials (stop working · spend · saved) are a *progressive-disclosure layer over this*, not a replacement. Every section must still be reachable — the design needs a "more detail" path that doesn't feel like falling into a form-dungeon.

### 8.4 Engine outputs that must stay visible

Verdict (money lasts to N) · end balance at max age · tax paid / lifetime tax drag · CPP/OAS/GIS amounts with clawback · per-account balances over time (RRSP/TFSA/taxable/RDSP) · year-by-year table (ScheduleTable) · household combined + per-person breakdowns · Monte Carlo percentiles · backtest worst/best historical windows · milestone ages (retire, benefit start, depletion, OAS clawback thresholds).

### 8.5 The AI agent (AgentPage + lib/ai)

In-browser LLM (web-llm) with tool access: reads the plan, runs `calculateHousehold`, applies input patches, creates scenarios, compares. Tool names defined in `ai/tools.ts`. **Requirement:** the agent is a first-class surface, not a chat box glued to the side — the design needs a home for it (its own page today; could be a panel that *shows its work* inline with the plan).

### 8.6 Data & safety surfaces

Save/dirty-state flow (SavePromptModal) · scenario revisions with rollback (ScenarioManager) · full backup/restore JSON (DataPage, incl. optional AI data) · projection export (CSV/PDF options) · share links · localStorage/OPFS persistence (→ §7.5 handle) · setup wizard (first-run, applies to plan inputs) · help modal · engine settings (tax tables, RRIF rates, volatility presets) · connections (AI provider setup).

### 8.7 Bolt-on test

For each item in 8.2–8.6, the winning design must name its home: (a) visible by default, (b) one click away in a named place, or (c) deliberately dropped with a reason. Anything without a home is a bolt-on. The review of the winner = walking this table.

### 8.8 Landing/legal checklist (Site 1)

- What it is, in one sentence (verdict-first: "knows if your money outlasts you")
- Privacy: no servers/accounts, data stays in the browser (from DonateCard copy — keep that voice)
- **Legal page:** not financial/tax/investment advice; educational modeling only; rules are Canadian tax & benefit approximations (expand WelcomeCard:112 into a real page)
- Open-source link, donate link, help/docs link

### 8.9 Schedule page: user-selectable columns

The schedule table (`ScheduleTable.tsx`) currently renders ~19–22 columns
hard-coded — every engine output always on. The beta keeps the table (§8.2:
"the receipts") but puts the user in charge of its width.

- **A simple control in the table header** (a "Columns" button opening a
  checklist) selects which columns are visible. One click to toggle, no modal
  ceremony, applied immediately.
- **A good starter set is the default**, not everything: Age · Starting
  Balance · Contributions · Market Gains · Withdrawals · Ending Balance ·
  CPP · OAS. The rest (tax columns, GIS, pension, per-account balances, RDSP,
  home equity) are available in the picker but off by default. The full set is
  one "show all" away.
- **The chevron/expand column and conditional columns** (RDSP, home equity)
  still appear only when the feature produced them — the picker governs the
  always-on set, feature-gating stays automatic.
- **Persistence via the prefs mechanism** (`prefKV`, issue #20): the visible-
  column set is plan-adjacent UI state, so it rides the same kv-table +
  localStorage-mirror path as `wealthconsole_panel_state` — captured by every
  full backup, restored on import, readable synchronously at first paint. Add
  the key to `PREF_KEYS`; do not invent a parallel localStorage key.

### 8.10 Design source of truth

The beta skin's visual language is **not** rediscovered per page — it lives
in one place and every surface builds from it:

- **`STYLEGUIDE.md`** (repo root) — the principles in prose: flat, hairline,
  one accent; verdict-first; touch first-class.
- **`src/design/`** — the same rules as live code: `tokens.ts` (every colour,
  size, shared class named once), `primitives.tsx` (`Fader`, `Chip`,
  `VerdictHero`, `Panel`, …), `StyleGuide.tsx` (a page rendering all of it
  live at `#/styleguide`).
- **Rule:** a new surface composes `src/design/` primitives. If a needed
  style isn't there, it gets *added* there (and appears on the style-guide
  page) — never forked one-off inside a page. This is the §7 "thin skin"
  made concrete: the vocabulary is a dependency, not a copy.
- The door: "Open the app" → Site 2
