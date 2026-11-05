# REVIEW.md — Code review: what's left

**Review date:** 2026-08-29 · **Baseline:** `main` @ e305d53 (730/730 tests, 43 files)
**Last pruned:** 2026-08-30 · Tree at prune time: 824/824 tests, 47 files, `tsc` clean.

This file was a full stone-by-stone review of the engine, tax layer, solvers,
data layer, AI subsystem, and UI (coverage list at the bottom). **Every actionable
finding from it is done** — fixed or verified-closed via squash-merged PRs
#44–#103, each with regression tests. What remains here is (a) the open work and
(b) the Info findings kept on record so verified-correct areas aren't re-audited.
Full per-finding write-ups live in git history (`git log --follow REVIEW.md`).

Severity scale used below: **MEDIUM** (edge-case wrongness or fragility) ·
**LOW** (polish, docs, theoretical) · **INFO** (verified correct / deliberate
tradeoff, no action).

---

## Still open

| ID / Issue | Severity | What it is | Suggested next step |
|------------|----------|------------|---------------------|
| **#24** | Feature | Track TFSA/RRSP contribution room; overflow deposits to taxable. No contribution-room model exists yet. | Annual limits are already in config (`engine.tfsaAnnualLimit`, `engine.rrspAnnualMax`). Its own feature PR. |
| **#104** | Bug (AI chat) | Phi-4-mini repeat-loop word salad burns the whole token budget. | Open issue; branch `issue/104-phi4-repeat-loop` exists. |
| **E-MC-01** | Test gap | The explicit couple regression issue #33 asked for — `simulate()` agreeing with `runMonteCarlo()` when the primary silo depletes but the household survives — was never written. Verdict logic is aligned and covered indirectly. | Small test in a `monteCarlo`/`strategies` suite. |
| **H-02** | LOW (optional) | Backtest is primary-only by construction: `runBacktest` strips the spouse (historicalReturns.ts:113-116), so couple plans backtest the primary silo and the panel doesn't say so. | Cheapest: label the panel "primary plan only". Larger: aligned-age couple windows. |

---

## Info findings — kept so they aren't re-audited

**Engine / tax**
- **T-04** — GIS single-vs-couple reduction base: `gisAnnual` reduces on
  income-excluding-OAS; `gisAnnualCouple` on combined fixed + own registered. The
  partner-draws approximation was the subject of #26 (fixed, PR #69). No further bug.

**Strategies / solvers**
- **S-04** — Gap-targeted work-stint gross-up uses a flat 30% marginal
  (`worst / 0.7`, strategies.ts). Heuristic for a labelled-approximate suggestion. Fine.
- **S-05** — `buildStrategies` runs one extra `calculateHousehold` pass to find the
  gap window before the variant runs. Perf note only (worker-offloaded path).
- `spendingSolver.ts`, `eqSolver.ts`, `run*.ts`/workers — clean, no findings.
  (eqSolver hard-codes `GRID_MIN_AGE = 40`; no axis goes below it today.)

**Data layer**
- **D-06** — `saveScenarios` does full DELETE+re-INSERT per persist inside a
  transaction (db.ts). Fine at this scale (dozens of plans); comment justifies it.
  `recordRevisions` diffs pre-save rows correctly, so rollbacks don't fabricate
  duplicate revisions.

**AI subsystem**
- **A-01** — Tool surface well-defended: every mutation tool returns a `mutation`
  proposal that the UI confirms; Zod schemas reject bad args before they touch
  state; element tools re-validate the merged element; `propose_revert` is
  diff-based. Confirm-before-apply invariant holds.
- **A-04** — `compareMetrics` is household-first and correct (`householdOutcome`
  for status/depletion, `null` → ±∞ for ordering).
- **A-05** — `memory/store.ts` clean and well-bounded: capped per-scope, recency
  decay, duplicate refresh, eviction only when the newcomer outranks, conservative
  stemming/prefix guards. Standalone, adapter-injected.

**UI**
- **U-04** — `revisionNonce` double-bump on rollback is deliberate (persist runs
  with `skipRevisions:true`) but fragile if those semantics change. Correct today.
- **U-05** — Store-adoption effect correctly guards unsaved edits (functional
  `setHasUnsavedChanges` read, no stale closure).
- **U-06** — EQ grid/readout split is sound: `eqGridKey` excludes the two
  solver axes so pad drags re-run only the cheap readout; debounced; cancellable.
- **U-11** — ScheduleTable drill-down sound (detail lookup by age, column count
  with RM/RDSP/detail extras).
- **U-12** — MonteCarloChart clean (worker/inline fallback, percentile bands,
  hover crosshair, depletion histogram, `en-CA`/`CAD`).
- **U-13** — OptimizeCard & CompareCard clean (solver cancellation on unmount,
  baseline-dot selection, diff chips). Both route through the household verdict.
- **U-16** — EqPage + eqConstraints clean and household-first
  (`deterministicOutcome` → `householdOutcome`); RangeFader/XyPad hit-area
  handling correct; persisted crops reconciled.

**Cross-cutting**
- **X-02** *(resolves E-09)* — Every non-test `.status` consumer is
  household-first (MetricCards, compareMetrics, EqPage, agent paths since A-03).
  `PrintSummary`/`projectionExport` read the raw primary status, which the engine
  already makes household-aware. No disagreement remains.
- **X-03** — Tree green at prune time: `tsc` 0 errors, 824/824 tests (47 files).

---

## Issue accounting (final)

All issues open at the 2026-08-29 review (#18–#21, #24–#28, #33, #40) are now
**closed** — the bug findings as fixes, #33/#28 as verified-present/auto-closed,
with **#24** the only one still open as a feature. Remaining open issues
repo-wide: **#24** and **#104** (post-review, AI chat). No issues were filed from
this doc per the brief; findings became branches/PRs directly.

---

## Review coverage (stones turned)

- **Engine** `retirementEngine.ts` (2087 lines) — read in full → E-01…E-09
- **Tax** `canadianTax.ts` — read in full → T-01…T-04
- **Strategies/solvers** `strategies.ts`, `spendingSolver.ts`, `eqSolver.ts`,
  workers → S-01…S-05
- **Monte Carlo** `monteCarlo.ts`, `runMonteCarlo.ts` — verdict alignment
  confirmed (#33); E-MC-01 test gap remains
- **Backtest** `historicalReturns.ts`, `runBacktest` → H-01, H-02
- **Data** `db.ts`, `store.ts`, `opfs.ts`, `schemas.ts`, `scenarioStorage.ts`,
  `scenarioRevisions.ts`, `planTransfer.ts`, `shareLink.ts`, `appConfig.ts` → D-01…D-07
- **AI** `ai/tools.ts` (1205), `agentIngest.ts`, `agentQA.ts`, `memory/store.ts`,
  `eqConstraints.ts` → A-01…A-05
- **UI** `App.tsx` (1049), `MetricCards`, `ScheduleTable`, `TimelineChart`,
  `MonteCarloChart`, `OptimizeCard`, `CompareCard`, `EqPage`, `PrintSummary`,
  `SidebarForm` (withdrawal section) → U-01…U-16
- **Cross-cutting** — `.status` consumer grep, `withdrawalOrder` provenance grep,
  typecheck + full test run → X-01…X-04

**Not exhaustively line-read** (lower-risk; candidates for a follow-up pass, but
no money-path runs through them): the rest of `SidebarForm.tsx` (1645 lines — only
the withdrawal-order section read closely), `AgentPage.tsx` (2045 lines — chat UI;
its tool surface was reviewed via `tools.ts`), `ConnectionsPage`, `DataPage`,
`SettingsModal`, `HelpModal`, `ScenarioManager`, `SetupWizard`, `SharingPage`,
the small presentational components, and the AI provider/transport files
(`providers.ts`, `webLlm*.ts`, `agentLoop.ts`, `chatStore.ts`, `checkpoints.ts`,
`context.ts` — reviewed at the tool/memory boundary only).
