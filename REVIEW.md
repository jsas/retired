# REVIEW.md — Full Project Code Review & Issue Accounting

**Date:** 2026-08-29 · **Reviewer:** Claude (working session) · **Baseline:** `main` @ e305d53
**Test baseline:** 730/730 passing (43 files) · `npx vitest run` green at start.

This document tracks (A) the accounting of every GitHub issue — closing the ones that
are actually complete — and (B) a stone-by-stone code review of the engine, tax layer,
library modules, workers, data layer, and UI. Each finding gets an ID, a severity, a
short description, and what's needed. **No GitHub issues were filed from this doc** —
it is the raw material for future issues.

Severity scale: **BLOCKER** (wrong money / crash / data loss) · **HIGH** (likely-wrong
output or broken flow in realistic use) · **MEDIUM** (edge-case wrongness or fragility)
· **LOW** (polish, docs, dead code, theoretical).

---

## PART A — Issue accounting

### Snapshot (from GitHub API, 2026-08-29)

| # | State | Title |
|---|-------|-------|
| 1–17 | closed | (historical — verified closed) |
| 18 | **open** | OPFS-stale/localStorage-newer: one-session rollback on OPFS write failure |
| 19 | **open** | Hand-corrupted config silently resets to defaults, no warning |
| 20 | **open** | Fold UI-preference keys into the store's kv table |
| 21 | **open** | Remove all legacy localStorage storage: single source of truth |
| 22–23 | closed | Employment income (done, PR #23) |
| 24 | **open** | Track TFSA/RRSP contribution room, overflow to taxable |
| 25 | **open** | Pre-retirement RRSP-meltdown transfers taxed from $0 |
| 26 | **open** | Couple GIS ignores partner's discretionary registered draws |
| 27 | **open** | Re-homed cross-age transfers dated in the past silently dropped |
| 28 | **open** | grossTaxableWithdrawal expansion loop has no iteration cap |
| 29–32 | closed | AI assistant + agent tool surface (done) |
| 33 | **open** | Solver/strategy success verdict diverges from Monte Carlo screen |
| 34–39 | closed | Chat polish, HELOC/RDSP (done) |
| 40 | **open** | Strategy Explorer: optimize employer/DB pension start ages |
| 41–43 | closed | Scenario revision history, true-reset erase (done, PR #43) |

### Verified-closeable candidates (work is in `main`, issue left open)

- **#33 — Solver/strategy verdict divergence. ✅ CLOSED 2026-08-29.** The prescribed fix
  is fully present in `main`: `simulate()` in `monteCarlo.ts:187-208` and `runMonteCarlo`
  both score with `householdOutcome()`; `strategies.ts:264-272` uses
  `ho.depletionAge`/`ho.endingBalance`; `sustainableSpending` (`strategies.ts:80`) uses
  `householdOutcome(...)`. Both solvers route through `simulate()`. The content landed
  via PR #36 (`7e1311b`) and PR #15 (`eeaa9b9`), **not** via PR #35 — which was **closed
  without merging** (`merged:false`, head `issue/33-household-verdict`). That branch is
  stale bookkeeping. **Closed with a pointer to where the fix lives.**
  - *Residual (non-blocking):* the explicit regression test #33 asked for (couple fixture
    where the primary's silo depletes but household survives — `simulate()` must agree
    with `runMonteCarlo()`) does **not** appear in the monteCarlo/strategies suites.
    Verdict logic is aligned and covered indirectly; tracked as Finding **E-MC-01**.

### Genuinely-open work (confirmed still outstanding, kept open)

Each of these was re-verified against `main` during the review. **All stay open** —
none are complete. Cross-references point at the detailed finding.

- **#18** OPFS write-failure rollback — **KEPT OPEN.** Confirmed: `db.ts:150-161`
  `save()` fires the OPFS write with only `console.warn` on failure, then the sync
  localStorage mirror. One-session rollback risk is real. → Finding **D-01**.
- **#19** silent config reset — **KEPT OPEN.** Confirmed: `validateAppConfig`
  back-fills defaults for added fields without surfacing a warning. → Finding **D-02**.
- **#20** UI-pref keys not in kv table — **KEPT OPEN.** Confirmed: five UI-preference
  keys still bypass the store. → Finding **D-03**.
- **#21** legacy localStorage removal — **KEPT OPEN.** Large refactor; dual-source
  still live (`getSyncSeed` App.tsx:61-68, `importLegacyKeys` store.ts:200). → Finding **D-04**.
- **#24** TFSA/RRSP room tracking — **KEPT OPEN (feature, not a bug).** Not implemented;
  no contribution-room model exists. Out of scope for the bug review.
- **#25** pre-retirement meltdown taxed from $0 — **KEPT OPEN.** Confirmed in engine:
  `applyTransferEvent` uses `accumTransferBaseGross` starting at 0 pre-retirement
  (engine:941,982). → Finding **E-07**.
- **#26** couple GIS asymmetry — **KEPT OPEN.** Confirmed: `gisAt()` (engine:1284-1296)
  passes own discretionary draws but not the partner's. → Finding **E-06**.
- **#27** re-homed past-dated transfer dropped — **KEPT OPEN.** Confirmed: `rehome`
  shifts age by the current-age gap and the `e.age >= currentAge` filter (engine:579)
  drops past-dated events. → Finding **E-08**.
- **#28** unbounded gross-up loop — **✅ CLOSED 2026-08-30** (auto-closed by PR #48,
  `closes #28`). Both loops now have iteration caps. → Findings **E-05** / **T-01**
  (both resolved).
- **#40** employer-pension start-age optimization — **KEPT OPEN (feature).** Not
  implemented; the strategy explorer has no pension-start-age lever. Related: **S-03**
  (RDSP also missing from the explorer's orderings).

> **Issue-accounting outcome:** 40 issues reviewed. #33 **closed** (work verified in
> `main`). #28 **closed** (auto-closed by PR #48). The critical-bug fixes (E-01, E-03,
> E-05/T-01, U-07, U-08/09/10, U-14) were merged to `main` via PRs #44–#49 on
> 2026-08-30. #18/#19/#20/#21/#24/#25/#26/#27/#40 **confirmed genuinely open** and left
> open — each has a corresponding code-review finding as its verification and technical
> write-up, and none are resolved by the merged fixes. No new issues were filed (per the
> brief); PART B is the raw material for future issue-filing.

---

## PART B — Code review findings

_(Findings are appended below as the review proceeds, grouped by area.)_

### B.1 Engine — `src/lib/retirementEngine.ts` (2087 lines)

**E-01 · BLOCKER · RDSP is never drawn down for spending. ✅ FIXED 2026-08-29**
(branch `fix/rdsp-drawdown`, commit `c7561a9`). The engine had a complete RDSP
drawdown path (`drawFrom('rdsp')`) that only ran when `'rdsp'` appeared in
`withdrawalOrder` — and no default, UI widget, or ingest path ever put it there, so
an enabled RDSP accumulated grants/bonds/growth and was never spent.
**Fix:** the engine now injects `'rdsp'` into the *effective* drawdown order (ahead
of `taxable`) whenever an RDSP is active (`enabled && dtcEligible && balance>0`) and
the stored order doesn't already place it; an explicit order that places `'rdsp'` is
honoured as-is. The sidebar withdrawal-order widget mirrors that effective order (so
the RDSP row shows up and persists on first reorder), and `agentIngest` now accepts
`'rdsp'` in the order (it was always schema-valid). Added 4 regression tests
(`RDSP auto-injection into the drawdown order`). 734/734 green; golden master
unaffected (injection only fires when an RDSP is enabled). ~~BLOCKER~~ → resolved.

**E-02 · MEDIUM (plausible, not confirmed-wrong) · Inter-spousal transfer re-run may
leave the primary one oscillation stale.**
`calculateHousehold` runs primary → spouse → (if spouse→primary deposits exist) primary
again → spouse again (engine:1672-1742). When a spouse→primary transfer exists, the
spouse is re-run with `pToS2` (from the re-run primary) but the **primary keeps `sToP`
from the first spouse run** — it is not re-run a third time after the final spouse run.
If the final spouse run's cross-deposits differ from the first's (possible when the
spouse's second run had different inbound `pToS2`, changing its balances → meltdown tax →
net sent back), the primary's injected `sToP` reflects a stale spouse state.
**Probed 2026-08-29:** with benign inputs (zero/low tax) the two-way case conserves
exactly (primary TFSA 8,000 = spouse's net; spouse TFSA 10,000 = primary's net). With
taxable CPP income both directions still reconcile to the dollar (primary TFSA 6,476 =
spouse net; spouse TFSA 8,095 = primary net). No consumer-visible divergence found in
these probes — the residual risk is a second-order tax-bracket wobble in narrow
two-way-recurring cases, bounded by one oscillation. There is no fixed-point oracle to
diff against, so this stays *plausible*, not confirmed-wrong.
**Needed:** either iterate to a fixed point (≤3 passes, stop when cross-deposits stabilize
within a tolerance) or assert single-oscillation convergence with a two-way recurring
conservation test. The committed `src/test/tmp/bug2.test.ts` probes exactly this but uses
`console.log` (swallowed by vitest — the anti-pattern CLAUDE.md forbids) and lives in a
`tmp/` dir; it should be promoted to a real assertion or deleted. (See X-01.)

**E-03 · MEDIUM → confirmed → ✅ FIXED 2026-08-29 · RRIF minimum was computed on the
post-transfer balance.** (branch `fix/rrif-min-jan1`, commit `603c904`). The transfer
loop ran before the RRIF-minimum block and `acct.take('rrsp')` drains the RRIF first, so
a same-year RRSP-meltdown transfer shrank the balance the minimum was computed on.
**Probed 2026-08-29:** age = rrifConversionAge, $500k RRSP→RRIF, $50k meltdown, zero
spending → min taken was **23,760** (post-transfer $450k) instead of **26,400** (Jan-1
$500k). **Fix:** capture `rrifJan1` right after the RRSP→RRIF conversion (before any
draws) and compute the minimum on it, clamped to the live balance for the degenerate
case where transfers drain the RRIF below the Jan-1 figure. Golden master unaffected
(its scenario has no same-year meltdown transfer in RRIF years). Regression test added
(age 72, $500k→RRIF, $50k meltdown → min = 27,000 Jan-1, not 24,300). ~~MEDIUM~~ → resolved.

**E-04 · MEDIUM · RRIF-minimum excess redeposit ignores the mandatory minimum's ACB-free nature — verify.**
The RRIF-min excess (net above need) is redeposited into taxable and added to ACB
(engine:1260-1263). That's correct (after-tax money in = principal). No bug; noted only
to confirm the redeposit is *not* double-taxed. Verified OK.

**E-05 · LOW → ✅ FIXED 2026-08-29 · `grossTaxableWithdrawal` upper-bound loop was
unbounded.** (== issue #28; branch `fix/grossup-loop-caps`, commit `6f71317`)
engine:2042 `while (net(upper) < neededAfterTax) upper *= 1.5;` had no iteration cap —
reachable only if a user-edited config makes `net()` non-monotonic (a marginal rate
≥ 100%), in which case it hung the tab. **Fix:** capped the expansion at
`MAX_TAX_ITERATIONS`. Shipped config was always safe; the cap is a robustness guard.
Closes the engine half of #28 (the tax half is T-01, same commit). ~~LOW~~ → resolved.

**E-06 · MEDIUM · Couple GIS: own draws counted in-year, partner's never.** (== issue #26,
confirmed) `gisAt()` (engine:1284-1296) passes own `registeredGross + capitalGains +
rdspTaxable` plus partner's *fixed* income (`sp.fixed` = CPP+pension+employment) but not
the partner's discretionary registered draws. Both partners drawing RRIF → each shown
too much GIS. The comment (engine:497-498) rationalizes it as "partner's draws land next
year," but own draws count in-year → asymmetric. **Needed:** household fixed-point for
GIS, or document the deliberate simplification; tracked by open issue #26.

**E-07 · MEDIUM → ✅ FIXED 2026-08-30 · Pre-retirement registered transfer taxed from
$0.** (== issue #25; branch `fix/preretirement-transfer-tax-floor`). The accumulation
phase seeded the transfer-tax base at 0, so a pre-retirement meltdown was taxed as the
year's only income even when wages/pensions were active. **Fix:** the accumulation loop
now computes a pre-retirement income floor (employment + DB/bridge pensions active that
year, with the same window/indexation rules as the decumulation phase) and seeds
`accumTransferBaseGross` with it. Used only as the transfer-tax base — reported
pre-retirement balances/contributions are unchanged. Two regression tests added.
~~MEDIUM~~ → resolved.

**E-08 · MEDIUM → ✅ FIXED 2026-08-30 · Re-homed past-dated transfer silently
dropped.** (== issue #27; branch `fix/rehome-pastdated-transfer`). `rehome` shifts the
event age by the current-age gap; when that lands before the *receiver's* current age,
the `e.age >= currentAge` filter dropped it with no warning — the transfer never fired
anywhere. **Fix:** `rehome` clamps a re-homed transfer's age to the receiver's current
age (fire as soon as possible) and clamps `endAge` to the same floor so a recurring
window stays valid. Two regression tests: a one-time past-dated transfer fires on the
receiver's first year; a recurring window clamps to a valid range and fires in each
remaining year. ~~MEDIUM~~ → resolved.

**E-09 · LOW · `depletionAge` semantics differ between per-person and household verdict.**
Per-person `depletionAge` (engine:1500) fires when `endingTotal <= 0` regardless of
shortfall; `householdOutcome` (engine:1865) requires `endingBalance <= 0 AND shortfall > 0`.
This is intentional (#33) but the per-person `status: 'SHORTFALL'` (engine:1573-1576)
still uses the raw depletionAge, so a single person whose CPP/OAS/GIS covers spending
after the portfolio hits $0 gets `status='SHORTFALL'` on the per-person result while
`householdOutcome` says `ON_TRACK`. Consumers that read `.status` directly (not via
`householdOutcome`) could disagree with the MC screen. **Needed:** audit every `.status`
reader to confirm it goes through `householdOutcome` for the headline verdict. (See B.7.)

_(engine review continues below — accumulation/event edge cases)_

### B.2 Tax layer — `src/lib/canadianTax.ts` (221 lines)

Reviewed in full. Logic is a faithful port of the reference engine; bracket math,
QC abatement, ONT surtax, OAS/GIS, RRIF minimums all read correctly.

**T-01 · LOW → ✅ FIXED 2026-08-29 · `findGrossIncomeForTakeHome` upper-bound loop was
unbounded** — same shape as #28/E-05 (branch `fix/grossup-loop-caps`, commit `6f71317`).
canadianTax.ts:84-86 `while (calculateTax(upperBound…).takeHome < desiredTakeHome)
upperBound *= 1.5;`. **Fix:** capped at `MAX_BOUND_EXPANSION` (60). Regression test added
with a flat 100%-marginal config proving the solver terminates and returns a finite
number instead of hanging. Together with E-05 this closes #28. ~~LOW~~ → resolved.

**T-02 · LOW · `taxOnTable` basic-exemption assumes the lowest bracket rate.**
canadianTax.ts:38 `raw − table.exemption * table.rates[0]`. This models the basic
personal amount as a *credit at the lowest marginal rate* — correct for Canada. But it
hard-assumes `rates[0]` is the credit rate; if a province's table is ever given a
non-standard first rate the BPA credit is mis-valued. Documented behaviour, fine for
shipped tables; note only.

**T-03 · LOW · OAS `yearsInCanada` is not re-pro-rated when residency < full but
start-age deferral is applied.** oasAnnualGross pro-rates by residency then multiplies
by the deferral multiplier — order matches CRA. Verified OK (no bug).

**T-04 · INFO · GIS single-vs-couple reduction base.** `gisAnnual` reduces on
income-excluding-OAS (correct); `gisAnnualCouple` reduces on combined fixed + own
registered. The documented approximation (partner's discretionary draws excluded) is
the subject of #26/E-06. No additional bug here.

### B.3 Strategies / solvers — `strategies.ts`, `spendingSolver.ts`, `eqSolver.ts`, `run*.ts`, workers

~~**S-01 · MEDIUM · `runOne` scores the household outcome against `inputs`, not `merged`.**~~ ✅ **FIXED 2026-08-30** (`fix/s01-strategy-scoring`)
strategies.ts:264 `const ho = householdOutcome(r, inputs)` — but `r = calculateHousehold(
merged, config)`. `householdOutcome` uses `inputs.currentAge`/`inputs.spouse.currentAge`
to align the two spouses' age axes (via `combineHouseholdBreakdown`). For every current
strategy the patch only touches CPP/OAS age, withdrawal order, RM, or employment — never
currentAge or spouse — so `inputs` and `merged` align and the result is correct **today**.
But it's a latent trap: any future strategy that patches `currentAge`, spouse presence, or
spouse ages would score the verdict against the wrong age axis. **Needed:** pass `merged`
to `householdOutcome`. One-line, zero-risk.
**Fix:** `runOne` now passes `merged` to `householdOutcome` (with a comment explaining why).
The audit confirmed every other call site (monteCarlo, eqConstraints, compareMetrics,
sustainableSpending) already passes the inputs the engine ran on. Tests: `runOne`/`StrategySpec`
are now exported so a synthetic maxAge-patching spec proves the verdict matches
`householdOutcome(run, merged)` field-for-field, and a companion test locks the
`status` horizon semantics (depletion at 93 reads SHORTFALL at horizon 95, ON_TRACK at 90).
778/778 tests, `tsc` clean.

**S-02 · LOW · `sustainableSpending` hi-expansion can leave `lo`/`hi` straddling nothing.**
strategies.ts:82-90: `hi` starts at 500k, expands ×1.5 while `survives(hi)` (guard 40,
abs ceiling 5M). If `survives(hi)` is still true at the ceiling, the loop exits with
`hi` = a surviving value and the binary search then assumes `hi` fails — the invariant
(`lo` survives, `hi` fails) is violated, so the search returns ~`hi` (a surviving value)
rather than a true bracket. Result is a *lower bound* on sustainable spending in that
runaway case, not the max. Acceptable (the plan is absurdly over-funded), but the
returned number isn't "the highest flat spending that survives" — it's "≥ ceiling."
**Needed:** mirror `spendingSolver`'s explicit `unconstrained` flag, or document that a
ceiling-hit returns the ceiling. Compare spendingSolver.ts:100-107 which handles this.

**S-03 · LOW · Strategy withdrawal-order variants omit RDSP.** `ORDERINGS` (strategies.ts:61-68)
is the 6 permutations of tfsa/taxable/rrsp — no `'rdsp'`, consistent with E-01. Once E-01
is fixed (RDSP enters the order), the explorer's order variants should include RDSP
positions or it will silently never test drawing the RDSP. Tracked with E-01.

**S-04 · INFO · Gap-targeted work stint gross-up uses a flat 30% marginal.** strategies.ts:242
`worst / 0.7`. Fine as a heuristic for a *suggestion*, clearly labelled approximate. No bug.

**S-05 · INFO · `buildStrategies` runs `calculateHousehold` once just to find the gap
window** (strategies.ts:233), then `runStrategies` runs it again for the baseline and once
per variant. For a couple this is 2× the engine runs of the variant count. Not a bug;
noted as a possible perf tidy on the (already worker-offloaded?) path — see whether the
OptimizeCard calls it on the main thread (B.7).

**spendingSolver.ts** — clean. Deterministic shared futures, explicit feasibility /
unconstrained handling, monotonicity argument sound. No findings.

**eqSolver.ts** — clean. Shared seeded batch, center-out row streaming, row-sharding for
the worker pool. `GRID_MIN_AGE = 40` hard-codes the youngest sequence start; if an axis
ever allowed retirementAge < 40 the sequences would be mis-keyed, but no axis goes that
low today. No findings.

**runMonteCarlo.ts / runSpendingSolver.ts / workers** — clean worker-with-inline-fallback
pattern; the file:// single-file fallback is handled. No findings.

### B.4 Monte Carlo / historical / backtest

_(pending)_

### B.5 Data layer — `src/data/*`, `scenarioStorage`, `appConfig`, `appDb`, `planTransfer`, `shareLink`, revisions

**D-01 · MEDIUM (low-probability, data-loss-shaped) → ✅ FIXED 2026-08-30 · OPFS-write failure → one-session
rollback.** (== issue #18, confirmed) `AppDatabase.save()` (db.ts:150-161) fires
`backend.write(bytes)` and only `console.warn`s on failure, then synchronously writes
the same bytes to the localStorage mirror. Load precedence is OPFS-first (db.ts:108-115).
So a failed OPFS write leaves OPFS stale-but-valid and localStorage newer; the next
session loads the stale OPFS and silently rolls back the most recent save. Comment at
db.ts:146-149 acknowledges OPFS is "the primary copy." Tracked by open issue #18.
*(Aside: issue #18's body says the write is "fire-and-forget, failures only console.warn'd
then writes the same bytes to the localStorage mirror synchronously" — accurate.)*
**Fix:** `save()` now sequences the localStorage mirror behind the OPFS write (Option A
from PLAN D-01). On OPFS failure the mirror is skipped, so localStorage can never be
newer than OPFS — no silent rollback. Branch `issue/18-opfs-rollback`.

**D-02 · LOW · Silent config reset on corruption.** (== issue #19, confirmed) On load,
`validateAppConfig` replaces any failing block with defaults (store.ts:83, db.ts:302) with
no user-facing note. A hand-corrupted `kv.config` silently loses tax-table customizations.
Tracked by open issue #19.

**D-03 · LOW · UI-preference keys bypass the store.** (== issue #20, confirmed) Five
modules still read/write raw `localStorage` (printOptions, projectionExport, eqStorage,
WelcomeCard, CollapsiblePanel) so they don't travel with the .sqlite backup. Tracked by
open issue #20.

**D-04 · MEDIUM (refactor, not a bug) · Legacy localStorage dual-source still live.**
(== issue #21, confirmed) `importLegacyKeys` (store.ts:200) + `LEGACY_*` constants still
import the split keys on first run; `scenarioStorage.ts`/`appConfig.ts` still seed first
paint. Large, well-mapped refactor — issue #21 has the full plan. Not a defect; kept open.

**D-05 · LOW · `revSeq` module counter resets per session; revision ids rely on
`Date.now()` + a per-session seq.** store.ts:29,135. Across two sessions the same
`(Date.now(), seq)` pair can regenerate if the clock is unchanged — but `Date.now()` ms
resolution makes a collision across sessions vanishingly unlikely, and ids only need
uniqueness within a scenario's history for rollback ordering (which also compares `at`).
No real-world impact; note only.

**D-06 · INFO · `saveScenarios` does full DELETE+re-INSERT each persist** (db.ts:221-238)
inside a transaction — fine at this scale (dozens of plans), and the comment justifies it.
`recordRevisions` diffs against the pre-save table rows (store.ts:123-147) correctly so a
rollback doesn't fabricate duplicate revisions. Verified sound.

**D-07 · LOW · `toDoc()` returns null when `validateAppConfig` yields null, silently
dropping the export** (db.ts:302-303). A store whose config block is entirely absent
(config never saved) can't be exported as a doc even though scenarios are valid. Edge
case (config is always written on first persist); note only.

### B.6 AI subsystem — `src/lib/ai/*`, `agentIngest`, `agentQA`, `memory/*`

_(pending)_

### B.7 UI — `App.tsx` + `src/components/*`

~~**U-01 · MEDIUM · Two SQLite connections can be open at once during full export.**~~ ✅ **FIXED 2026-08-30** (`fix/u01-stale-export`)
`handleExportFull` (App.tsx:254) calls `AppDatabase.open()` — a *fresh* connection that
re-opens OPFS/localStorage — while the main `store` already holds an open `AppDatabase`.
sql.js is in-memory per connection, so the export snapshot is built from a *second* DB
that reads whatever OPFS/localStorage held at that instant, NOT the live in-memory state
the user just edited. If the user edits a scenario and immediately exports without the
persist effect's OPFS write having landed, the backup can contain stale bytes. Compounds
with D-01 (OPFS write is fire-and-forget). **Needed:** export via the *existing* open
`store.exportBytes()` (which serializes the live in-memory db), not a fresh
`AppDatabase.open()`. The chosen-scenario subset filtering can still run against the live
`scenarios` state for the scenario rows.
**Fix:** `handleExportFull` now seeds the throwaway export DB with `store.exportBytes()`
(the live in-memory bytes) via `AppDatabase.open(seed)`, so the starting point is always
current. Covered by a store.test.ts test proving `exportBytes` reflects the most recent
persist immediately.

~~**U-02 · MEDIUM · Persist effects are fire-and-forget; no durability feedback.**~~ ✅ **FIXED 2026-08-30** (`fix/u02-durability-feedback`)
App.tsx:202 `store?.persist({ scenarios, activeScenarioId })` and :208 `persist({ config })`
don't await `db.save()`'s OPFS write (which is itself fire-and-forget — D-01). A user who
saves and closes the tab within the OPFS write window can lose the save (mitigated by the
synchronous localStorage mirror, which *is* written before save() returns). The
localStorage mirror makes this low-probability, but the app gives no "saving…/saved"
signal, so a failed persist is invisible. Related to #18. **Needed:** surface a save
indicator; consider awaiting the OPFS write for the explicit Save action (vs the
auto-persist).
**Fix:** `AppDatabase.save()` now reports every durable-write outcome through an
`onSaveOutcome` listener channel (failure → err, later success → null); `AppStore`
re-exposes it and App.tsx drives a dismissible amber banner ("Changes may not be saved")
that clears itself on the next durable write. Covered by three store tests (OPFS failure,
failure→success recovery, localStorage-only failure). 776/776 tests, `tsc` clean.

**U-03 · LOW · `getSyncSeed` reads legacy localStorage for first paint** (App.tsx:61-68) —
this is the legacy dual-source #21 targets. Known/tracked; not a new bug.

**U-04 · LOW · `revisionNonce` double-bump on rollback.** `handleRollback` (App.tsx:378-394)
persists with `skipRevisions:true` then manually bumps the nonce (the comment explains the
persist effect won't fire). Correct, but fragile: if `skipRevisions` semantics change, the
history list could go stale or double-refresh. Note only.

**U-05 · INFO · Store-adoption effect correctly guards unsaved edits.** App.tsx:180-189 uses
the `setHasUnsavedChanges(dirty => …)` functional form to read the latest dirty flag without
a stale closure, skipping the store swap mid-edit. Verified correct — a subtle race handled
well. No bug.

**U-06 · INFO · EQ grid/readout split is sound.** The `eqGridKey` (App.tsx:535-544) strips
`retirementAge`/`desiredSpending` so pad-thumb drags don't re-fire the 81-node worker grid;
only the cheap readout re-runs. Debounced (150ms readout, 250ms grid). Cancellation via
`cancelEqSolveRef` on cleanup. Well-engineered; no bug.

**U-07 · MEDIUM → ✅ FIXED 2026-08-29 · Wrong currency code/locale in two display
components.** (branch `fix/currency-cad`, commit `32c37d5`). A Canadian app, but
`MetricCards.tsx` and `ScheduleTable.tsx` built their formatter as `en-US`/`USD` while
every other component uses `en-CA`/`CAD`. **Fix:** switched both to `'en-CA'`/`'CAD'`.
Presentational only; no engine change, golden master untouched. The follow-on nicety
(hoisting a single shared `fmtMoney` to `src/lib` so this can't drift again) remains a
nice-to-have, not a correctness item. ~~MEDIUM~~ → resolved.

**U-08 · HIGH · TimelineChart spending-band drag writes the % against the wrong
reference age. ✅ FIXED 2026-08-29** (branch `fix/timeline-band-drag`, commit
`6fee616`). The band drag deflated the dragged nominal level at `fromAge` but divided
by today's-dollar `desiredSpending`, so the written `pctOfBase` was off by the
inflation factor; the handle was also placed at `row.spendingTarget` (which folds in
cash events + RM interest) while the drag wrote a base-only %. **Fix:** a single
analytic base-spending level — `nominalBaseAt(age) = inflate(desiredSpending, age) ×
bandPct(age)` (no events/RM) — now drives both placement and drag; band % divides the
dragged nominal by the base nominal *at the same age*, so the inflation factor
cancels. The EqPage embeds this chart, so the fix covers the EQ projection too. ~~HIGH~~ → resolved.

**U-09 · MEDIUM · Base-spending handle conflates events into the drag. ✅ FIXED
2026-08-29** (same commit `6fee616`). The base handle was *drawn* at `spendingTarget −
retirement-year events` but its drag *wrote* the raw level straight to `desiredSpending`
— draw and write disagreed. **Fix:** the base handle is now drawn at the analytic base
`nominalBaseAt(retirementAge)` (events/RM excluded) and its drag still writes
`desiredSpending` (base only) — one consistent convention both ways. ~~MEDIUM~~ → resolved.

**U-10 · LOW · Event-diamond amount dragged through a spurious inflation factor. ✅
FIXED 2026-08-29** (same commit `6fee616`). Event diamonds were drawn and dragged at
`ev.amount × (1+infl)^(age-currentAge)`, but event amounts are stored **nominal**
(confirmed by probe: the engine adds `eventOutAt(age)` to `yearSpending` uninflated),
so the inflation factor was wrong — dragging an event vertically shrank its written
amount by the inflation factor. **Fix:** event diamonds use `ev.amount` directly
(identity), both for placement and drag. The remaining cosmetic note (a very large
event saturates the spending-panel scale, which is sized to `maxSpend`) stands as a
UX nicety, not a correctness bug. ~~LOW~~ → resolved (the correctness half).

**U-11 · INFO · ScheduleTable drill-down is sound.** Re-read in full: household per-person
detail lookup by age, correct `colCount = 19 + (hasRm?1:0) + (hasRdsp?1:0)`, expansion
logic, and per-account columns all consistent. Only the USD formatter (U-07) is wrong.

**U-12 · INFO · MonteCarloChart clean.** Worker/inline fallback, percentile band paths,
hover crosshair + tooltip, depletion histogram all correct; `formatMoneyFull` correctly
uses `en-CA`/`CAD`. Success-rate colour thresholds (≥0.9 green / ≥0.75 amber) reasonable.

**U-13 · INFO · OptimizeCard & CompareCard clean.** OptimizeCard: strategies table +
solver tab, solver cancellation on unmount, `en-CA`/`CAD`. CompareCard: baseline-dot
selection, cap at 3, diff chips with better/worse colouring, `en-CA`/`CAD`. Both route
through `runStrategies` / `compareScenarios` which use the household verdict (E-MC-01
notwithstanding). No bugs.

**U-14 · LOW → ✅ FIXED 2026-08-29 · ScheduleTable detail-row `colSpan` was one short
when expandable.** (branch `fix/schedule-colspan`, commit `37add6f`). Base data columns
= 19, but when `anyDetail` is true the table renders an extra leading chevron column
that `colCount` never counted, so the expanded drill-down row spanned one column short
of the header. **Fix:** `colCount = 19 + (anyDetail?1:0) + (hasRm?1:0) + (hasRdsp?1:0)`
(and hoisted `anyDetail` above it). Purely cosmetic. ~~LOW~~ → resolved.

~~**U-15 · LOW · PrintSummary detailed table omits the RDSP column.**~~ ✅ **FIXED 2026-08-30** (`fix/u15-print-rdsp-column`) The on-screen
ScheduleTable adds an RDSP balance column when any person has an RDSP
(`hasRdsp`, ScheduleTable.tsx:194,226). The print `DetailedTablePrint` (PrintSummary.tsx:288-379)
has RM handling (`hasRm`, `colSpan = 17 + (hasRm?1:0)`) but **no RDSP branch** — no
RDSP `<th>`, no RDSP `<td>`. A user with an RDSP who prints the detailed table loses
that account's column (the balance still factors into End/Total, just isn't broken
out). Also note its base `colSpan = 17` vs the on-screen 19 — print drops the
Total Tax / Tax Burden columns (a deliberate space tradeoff, acceptable) — but RDSP
is an *omission*, not a tradeoff. **Needed:** add an RDSP column mirroring
ScheduleTable when `hasRdsp`.
**Fix:** `DetailedTablePrint` now computes `hasRdsp` (any person's row has
`rdspBalance !== undefined`), adds the guarded `<th>RDSP</th>`/`<td>` after Cash with
the same title text ScheduleTable uses, and bumps `colSpan` by `(hasRdsp ? 1 : 0)`.
785/785 tests, `tsc` clean.

**U-16 · INFO · EqPage + eqConstraints clean & household-first.** `deterministicOutcome`
(eqConstraints.ts:341-344) runs `calculateHousehold` → `householdOutcome`, so the EQ
readouts (Status / Money-lasts / Left-at-end) reflect the combined-couple verdict,
consistent with #33. RangeFader's three-layer slider (two native edge inputs + custom
value knob with pointer capture) correctly avoids the stacked-input hit-area bug;
XyPad bilinear GradientCanvas is correct (grid row 0 = lowest y, flipped at render).
EqPage embeds `TimelineChart`, so U-08/U-09/U-10 apply to the EQ projection too.
`consistentAges` / `reconcileControl` keep persisted crops sane. No bugs here.

### B.4 Historical backtest — `historicalReturns.ts` / `runBacktest` / `BacktestPanel`

**H-01 · INFO · `runBacktest` is sound; horizon is clamped to the series.** The
60/40 real-return series (1970–2024, 55 yrs) is documented as an equity-leg actual
+ a reconstructed bond leg (yield-driven, not an official total-return index) —
appropriate caveat in the header. `runBacktest` clamps `horizon` to `returns.length`
(historicalReturns.ts:99-102) so a young retiree with a >55-yr horizon can't produce
zero windows / a `worstWindow`/`bestWindow` null crash; `truncated` flags the clamp
to the UI. Spouse is deliberately stripped (single deterministic run per window,
documented future refinement). Return sequence maps `returns[w+y] − 1` per age —
correct, since engine rates are growth *factors* and the series holds real
*multipliers*. Median uses `sorted[floor(n/2)]` (upper median; fine). No bugs.

**H-02 · LOW · Backtest is primary-only by construction.** `runBacktest` drops the
spouse (historicalReturns.ts:116) so couple plans backtest only the primary silo —
the success rate can read *worse* than the household reality (no partner backstop)
or *different* where the spouse is the leaner side. Documented in the comment, but
the panel doesn't surface "primary-only" to the user. **Needed (optional):** either
label the panel "primary plan only" or extend to aligned-age couple windows.

### B.6 AI subsystem — `src/lib/ai/*`, `agentIngest`, `agentQA`, `memory/*`

**A-01 · INFO · Tool surface is well-defended; confirm-before-apply holds.** Re-read
`tools.ts` (1205 lines) in full. Every mutation tool (`set_scenario_value`,
`propose_patch`, `propose_spouse/pension/employment/cash_event/reverse_mortgage/
spending_bands/revert`, `manage_*`) returns a `mutation` proposal that the UI turns
into a user-confirm card — there is no path from model output to plan state that
bypasses confirmation (the header comment's invariant holds). All args are Zod
schemas (the same `schemas.ts` the data layer uses), so hallucinated fields /
out-of-range numbers are rejected before touching anything. Element tools re-validate
the whole merged element, never trusting the patch. `propose_revert` is diff-based so
manual edits since the change aren't silently clobbered. `remember` is a direct write
but explicitly non-plan (the assistant's notebook). No bug.

**A-02 · MEDIUM · `withdrawalOrder` agent boundary is internally inconsistent (E-01
adjacent). ✅ RESOLVED by the E-01 fix** — `agentIngest` now accepts `'rdsp'` in the
order (3–4 distinct accounts), matching the agent-tool path (Zod schema) and the
engine. The two agent entry points now agree. Original note: `withdrawalOrder` is in
`EDITABLE_FIELDS` (tools.ts:240) and is validated
by `retirementInputsSchema`, whose `withdrawalAccount` enum **includes `'rdsp'`**
(schemas.ts:25). So the *agent tool* path would accept an RDSP-containing order. But
`agentIngest.ts:42` (the paste-a-JSON-reply path) rejects anything that isn't a
3-account permutation of `["tfsa","taxable","rrsp"]`. Two agent entry points, two
different notions of a valid withdrawal order. This is the same root gap as **E-01**:
the engine fully supports `drawFrom('rdsp')` but the account is unreachable through
normal input. **Needed:** decide the RDSP drawdown UX (see E-01), then make the agent
ingest path, the agent tool path, and the sidebar widget agree on whether/when 'rdsp'
may appear in `withdrawalOrder`.

~~**A-03 · LOW · Agent tool outputs can show a stale per-person verdict.**~~ ✅ **FIXED 2026-08-30** (`fix/a03-agent-household-verdict`) `tools.ts`
`summarizeResults` (:559) reads `results.status` (primary) and `results.spouse.status`
(:572) directly rather than the household-first `householdOutcome()`. For a couple
where the primary silo depletes but the partner backstops, the agent is told
"SHORTFALL" while the on-screen verdict card (MetricCards/compareMetrics, which use
`householdOutcome`) reads "ON TRACK". Cosmetic — it only colours the agent's prose —
but the agent could recommend "fix" a plan that is actually household-funded. Related
to **E-09**. **Needed:** route the agent's verdict strings through `householdOutcome`
when a spouse is present (same as compareMetrics.ts:47-58).
**Fix:** `summarizeResults` now leads with `householdOutcome(results, inputs)` for the
headline ("Result: ON TRACK — household funded to age 90+"), demoting the per-person
verdicts to a labeled `per-person (detail):` line. `agentQA.ts` gained a
`householdVerdictLine` helper that leads both `buildPlanDigest` and `buildQAPrompt`
above the You/Spouse digests (which stay as per-person detail). Tests: a couple whose
primary silo depletes while the funded spouse covers the gap must read
"HOUSEHOLD VERDICT: ON TRACK" / "Result: ON TRACK — household funded" with the
per-person SHORTFALL demoted to detail; fixture sanity-asserts the primary's own
status really is SHORTFALL. 788/788 tests, `tsc` clean.

**A-04 · INFO · compareMetrics is household-first and correct.** `metricsFromResults`
(compareMetrics.ts:47-58) uses `householdOutcome(results, inputs)` for both
`depletionAge` and `status` when inputs are available, falling back to the raw
per-person fields otherwise. `depletionDiff` maps `null` ("never") to ±∞ correctly
for ordering. `computeScenarioMetrics` resolves a spouse linked to another saved
scenario before running. This is the model the *agent* path (A-03) should copy. No bug.

**A-05 · INFO · MemoryStore is clean and well-bounded.** `memory/store.ts` (335
lines): capped per-scope (50), recency-decayed rank (`importance × 0.5^(days/30)`),
duplicate-text refresh instead of pile-up, eviction only when the newcomer outranks
the weakest resident (refuses to churn otherwise), access-stamping on recall hits.
Keyword extraction drops stopwords, conservative stemming (`normalizeToken`),
prefix-match guard (`short >= 4`) so "age" won't hit "agent". Standalone (adapter
injected; no engine/scenario imports). No bug. `agentQA.ts` builds the paste-prompt
digest; like A-03 it reads per-person `results.status` (agentQA.ts:93) — acceptable
for a prompt builder, same consistency note.

### B.8 Cross-cutting / config / build

**X-01 · LOW → ✅ FIXED 2026-08-29 · Leftover probe test removed.** `src/test/tmp/bug2.test.ts`
was a throwaway two-way-transfer debugging probe that used `console.log` (which vitest
swallows — the exact anti-pattern CLAUDE.md's "Probe technique" rule warns against).
**Correction to the original finding:** it was *untracked*, not committed (`git ls-files
src/test/` shows only `helpers.ts`), so it never ran in CI — purely local dead weight.
**Fix:** deleted the file and the now-empty `src/test/tmp/` dir. Suite went 730 → 729
(the probe's single test); all green. Nothing to commit (untracked). ~~LOW~~ → resolved.

**X-02 · INFO · E-09 resolved: `.status` consumers are consistent.** Grepped every
non-test `.status` read. The verdict-card surfaces are all household-first:
MetricCards (:24-84, uses `ho.status`), compareMetrics (:57, `ho.status`), EqPage
(:449, `deterministicOutcome`→`householdOutcome`). `PrintSummary` (:447) and
`projectionExport` (:323) read the raw `results.status` — for the *primary* plan this
is correct (PrintSummary's Verdict block is labelled per the primary; the engine's
`calculateHousehold` already ORs spouse SHORTFALL into `finalPrimary.status` at
retirementEngine.ts:1745, so `results.status` is effectively household-aware for the
combined report). The only genuinely raw-per-person reads left are the agent paths
(**A-03**). No further action beyond A-03.

**X-03 · INFO · Tree is green after review.** `npx tsc --noEmit -p tsconfig.app.json`
→ 0 errors. `npx vitest run` → **730/730 passing (43 files)**. No production code was
changed during this review (only `REVIEW.md` added; two throwaway `__probe*.test.ts`
files were created to confirm E-02/E-03 and deleted). The committed probe in X-01 is
the only test-suite smell.

**X-04 · LOW · `Pension.endAge` / RM `startAge`/`durationYears` null-vs-omitted
convention is load-bearing and only documented in CLAUDE.md.** The schemas and engine
rely on `endAge` being explicit `null` (never omitted) for lifetime pensions, and RM
timing fields being `undefined` (never `null`). This is exactly the kind of invariant
a future contributor (or the agent, A-01/A-02) can violate silently. It's currently
held everywhere I checked (propose_pension strips `id`, manage_pension re-validates
the merged element). **Needed (optional):** a code comment at the schema definitions
pointing at the convention, so it isn't only in CLAUDE.md.

---

## Summary table

All findings, ranked by severity. **Actionable** = a real defect worth an issue/PR.
**Info** = verified-correct area or a deliberate tradeoff, recorded so it isn't
re-audited. (E-02 is listed under Medium as plausible-but-unconfirmed.)

| ID | Area | Severity | One-liner | Status |
|----|------|----------|-----------|--------|
| ~~E-01~~ | Engine | ~~BLOCKER~~ ✅ | RDSP never drawn down — **FIXED** (`fix/rdsp-drawdown`, engine auto-injects `'rdsp'`) | **Fixed** |
| ~~U-08~~ | UI (TimelineChart) | ~~HIGH~~ ✅ | Spending-band drag wrote `pctOfBase` against the wrong reference age — **FIXED** (`fix/timeline-band-drag`, analytic `nominalBaseAt`) | **Fixed** |
| ~~E-03~~ | Engine | ~~MEDIUM~~ ✅ | RRIF minimum computed on post-transfer balance — **FIXED** (`fix/rrif-min-jan1`, Jan-1 `rrifJan1`) | **Fixed** |
| E-06 | Engine | MEDIUM | Couple GIS counts own draws in-year, partner's never (== #26) | Actionable |
| ~~E-07~~ | Engine | ~~MEDIUM~~ ✅ | Pre-retirement registered transfer taxed from $0 — **FIXED** (`fix/preretirement-transfer-tax-floor`) | **Fixed** |
| ~~E-08~~ | Engine | ~~MEDIUM~~ ✅ | Re-homed past-dated transfer silently dropped — **FIXED** (`fix/rehome-pastdated-transfer`, clamps to fire now) | **Fixed** |
| E-04 | Engine | MEDIUM | RRIF-min excess redeposit / ACB-free handling — verify | Actionable (verify) |
| E-02 | Engine | MEDIUM (plausible) | Inter-spousal transfer re-run may be one oscillation stale | Verify |
| ~~S-01~~ | Strategies | ~~MEDIUM~~ ✅ | `runOne` scored household outcome vs `inputs`, not `merged` — **FIXED** (`fix/s01-strategy-scoring`) | **Fixed** |
| ~~D-01~~ | Data | ~~MEDIUM~~ ✅ | OPFS-write failure → one-session rollback (== #18) — **FIXED** (`issue/18-opfs-rollback`, mirror sequenced behind OPFS) | **Fixed** |
| D-04 | Data | MEDIUM | Legacy localStorage dual-source still live (== #21) | Actionable (refactor) |
| ~~U-01~~ | UI (App) | ~~MEDIUM~~ ✅ | Full export opened a 2nd SQLite connection, could snapshot stale bytes — **FIXED** (`fix/u01-stale-export`, seeds from live `store.exportBytes()`) | **Fixed** |
| ~~U-02~~ | UI (App) | ~~MEDIUM~~ ✅ | Persist effects fire-and-forget; no durability feedback — **FIXED** (`fix/u02-durability-feedback`, save-outcome channel + dismissible banner) | **Fixed** |
| ~~U-07~~ | UI (display) | ~~MEDIUM~~ ✅ | MetricCards + ScheduleTable formatted money as `en-US`/`USD` — **FIXED** (`fix/currency-cad`) | **Fixed** |
| ~~U-09~~ | UI (TimelineChart) | ~~MEDIUM~~ ✅ | Base-spending handle subtracted events on draw, ignored on write — **FIXED** (`fix/timeline-band-drag`) | **Fixed** |
| ~~A-02~~ | AI | ~~MEDIUM~~ ✅ | `withdrawalOrder` agent boundary inconsistent — **FIXED** with E-01 (ingest accepts `'rdsp'`) | **Fixed** |
| ~~E-05~~ | Engine | ~~LOW~~ ✅ | `grossTaxableWithdrawal` upper-bound loop unbounded — **FIXED** (`fix/grossup-loop-caps`) | **Fixed** |
| E-09 | Engine | LOW | `depletionAge` per-person vs household semantics — resolved (see X-02) | Info |
| ~~T-01~~ | Tax | ~~LOW~~ ✅ | `findGrossIncomeForTakeHome` upper-bound loop unbounded — **FIXED** (`fix/grossup-loop-caps`) | **Fixed** |
| T-02 | Tax | LOW | `taxOnTable` basic-exemption assumes lowest bracket rate | Actionable (verify) |
| T-03 | Tax | LOW | OAS `yearsInCanada` not re-pro-rated for partial residency | Actionable (verify) |
| T-04 | Tax | INFO | GIS single-vs-couple reduction base — documented, correct | Info |
| S-02 | Strategies | LOW | `sustainableSpending` hi-expansion edge | Actionable |
| S-03 | Strategies | LOW | Strategy orderings omit RDSP (== #40 family) | Actionable |
| S-04 | Strategies | INFO | Gap-targeted work stint uses flat 30% marginal — documented approx | Info |
| S-05 | Strategies | INFO | Extra `calculateHousehold` pass for gap — perf note only | Info |
| D-02 | Data | LOW | Silent config reset on corruption (== #19) | Actionable |
| D-03 | Data | LOW | UI-pref keys bypass the store (== #20) | Actionable |
| D-05 | Data | LOW | `revSeq` resets per session; revision-id collision theoretical | Actionable |
| D-06 | Data | INFO | Full DELETE+re-INSERT per persist — acceptable at this scale | Info |
| D-07 | Data | LOW | `toDoc()` returns null on invalid config, drops config silently | Actionable |
| U-03 | UI (App) | LOW | `getSyncSeed` reads legacy localStorage (== #21, known) | Info |
| U-04 | UI (App) | LOW | `revisionNonce` double-bump on rollback — fragile, correct today | Info |
| U-05 | UI (App) | INFO | Store-adoption effect guards unsaved edits correctly | Info |
| U-06 | UI (App) | INFO | EQ grid/readout split is sound | Info |
| ~~U-10~~ | UI (TimelineChart) | ~~LOW~~ ✅ | Event-diamond dragged through a spurious inflation factor — **FIXED** (`fix/timeline-band-drag`); saturation note stands as UX | **Fixed** |
| U-11 | UI (ScheduleTable) | INFO | Drill-down logic sound | Info |
| U-12 | UI (MonteCarloChart) | INFO | Clean | Info |
| U-13 | UI (Optimize/Compare) | INFO | Clean | Info |
| ~~U-14~~ | UI (ScheduleTable) | ~~LOW~~ ✅ | Detail-row `colSpan` one short when expandable — **FIXED** (`fix/schedule-colspan`) | **Fixed** |
| ~~U-15~~ | UI (PrintSummary) | ~~LOW~~ ✅ | Print detailed table omitted RDSP column — **FIXED** (`fix/u15-print-rdsp-column`) | **Fixed** |
| U-16 | UI (EqPage) | INFO | EqPage + eqConstraints clean, household-first | Info |
| H-01 | Backtest | INFO | `runBacktest` sound; horizon clamped | Info |
| H-02 | Backtest | LOW | Backtest is primary-only (spouse stripped) | Actionable (optional) |
| A-01 | AI | INFO | Tool surface well-defended; confirm-before-apply holds | Info |
| ~~A-03~~ | AI | ~~LOW~~ ✅ | Agent verdict strings used per-person status, not household — **FIXED** (`fix/a03-agent-household-verdict`) | **Fixed** |
| A-04 | AI | INFO | compareMetrics household-first, correct | Info |
| A-05 | AI | INFO | MemoryStore clean, well-bounded | Info |
| ~~X-01~~ | Cross-cutting | ~~LOW~~ ✅ | Leftover probe `src/test/tmp/bug2.test.ts` — **DELETED** (was untracked, not committed) | **Fixed** |
| X-02 | Cross-cutting | INFO | `.status` consumers consistent (E-09 resolved) | Info |
| X-03 | Cross-cutting | INFO | Tree green: tsc 0 errors, 735/735 tests post-merge | Info |
| X-04 | Cross-cutting | LOW | endAge/RM null-vs-omitted convention only in CLAUDE.md | Actionable (comment) |

---

## Still outstanding (as of 2026-08-30, post PR #56)

Everything not struck through above. These are the items that still need doing.
**Fixed & merged:** E-01, E-03, E-05, T-01, U-07, U-08, U-09, U-10, U-14, A-02, E-07
(#25 via PR #50), E-08 (#27 via PR #56) and X-01 housekeeping.
**Closed issues:** #25, #27, #28, #33.

### Engine — money correctness (highest value)
- **E-06 · MEDIUM · == #26** — Couple GIS counts the person's own discretionary draws
  in-year but never the partner's. Needs a household fixed-point for GIS, or a
  documented simplification.
- **E-04 · MEDIUM (verify)** — Confirm the RRIF-min excess redeposit isn't double-taxed
  (believed OK; needs a confirm pass, not a fix).
- **E-02 · MEDIUM (verify)** — Two-way inter-spousal transfer re-run may sit one
  oscillation stale; build a fixed-point oracle to confirm.

### Strategies / solvers
- ~~**S-01 · MEDIUM** — `runOne` scores household outcome against `inputs`, not `merged`.~~ ✅ FIXED (`fix/s01-strategy-scoring`)
- **S-02 · LOW** — `sustainableSpending` hi-expansion edge.
- **S-03 · LOW · == #40 family** — Strategy orderings omit RDSP.

### Data layer (== open issues #18–#21)
- **D-04 · MEDIUM · == #21** — Legacy localStorage dual-source still live (refactor).
- **D-02 · LOW · == #19** — Hand-corrupted config silently resets to defaults, no warning.
- **D-03 · LOW · == #20** — UI-preference keys bypass the store's kv table.
- **D-05 · LOW** — `revSeq` resets per session (revision-id collision, theoretical).
- **D-07 · LOW** — `toDoc()` returns null on invalid config, dropping config silently.

### UI
- ~~**U-01 · MEDIUM** — Full export opens a 2nd SQLite connection; can snapshot stale bytes.~~ ✅ FIXED (`fix/u01-stale-export`)
- ~~**U-02 · MEDIUM** — Persist effects are fire-and-forget; no durability feedback.~~ ✅ FIXED (`fix/u02-durability-feedback`)
- ~~**U-15 · LOW** — PrintSummary detailed table omits the RDSP column.~~ ✅ FIXED (`fix/u15-print-rdsp-column`)

### Tax (verify-before-fix)
- **T-02 · LOW** — `taxOnTable` basic-exemption assumes the lowest bracket rate.
- **T-03 · LOW** — OAS `yearsInCanada` not re-pro-rated for partial residency.

### AI / other
- ~~**A-03 · LOW** — Agent verdict strings use per-person status, not household.~~ ✅ FIXED (`fix/a03-agent-household-verdict`)
- **H-02 · LOW (optional)** — Backtest is primary-only (spouse stripped).
- **X-04 · LOW** — endAge/RM null-vs-omitted convention documented only in CLAUDE.md.

### Feature work (open issues, not bugs)
- **#24** — Track TFSA/RRSP contribution room; overflow deposits to taxable.
- **#40** — Strategy Explorer: optimize employer/DB pension start ages (see S-03).

---

## Work log

- **2026-08-29** — Full review written; PART A dispositions + PART B findings.
- **2026-08-29** — Critical bugs fixed on local `fix/*` branches (no issues per brief):
  E-01 (`fix/rdsp-drawdown`), U-08/09/10 (`fix/timeline-band-drag`), E-03
  (`fix/rrif-min-jan1`), U-07 (`fix/currency-cad`), E-05/T-01 (`fix/grossup-loop-caps`,
  closes #28), U-14 (`fix/schedule-colspan`). X-01 probe deleted (was untracked).
- **2026-08-30** — All six fixes merged to `main` via PRs **#44–#49** (squash); fix
  branches deleted. Issue **#28** auto-closed by PR #48. Post-merge tree: **735/735
  tests green, `tsc` clean**. Remaining open issues (#18–#21, #24–#27, #40) are all
  still-outstanding findings above — none resolved by these merges.
- **2026-08-30** — **E-07** (#25) fixed on `fix/preretirement-transfer-tax-floor`:
  accumulation-phase transfer tax now stacks on the year's employment/pension income.
  737/737 tests, `tsc` clean; golden master unaffected. **Merged same day** (PR #50,
  issue #25 auto-closed).
- **2026-08-30** — **E-08** (#27) fixed on `fix/rehome-pastdated-transfer`: re-homed
  transfers clamp to the receiver's current age instead of being silently dropped.
  739/739 tests, `tsc` clean; golden master unaffected. **Merged same day** (PR #56,
  issue #27 auto-closed). Also merged by the user independently: PRs #54/#55 (agent
  string coercion, #52), #57 (eqsolver CI timeouts), #58 (scenario revisions, #41),
  plus ancestry merges of stale feature/worktree branches.
- **2026-08-30** — **E-06** (#26) fixed on `issue/26-gis-couple-discretionary`: couple
  GIS now counts both partners' discretionary draws via fixed-point iteration.
  756/756 tests, `tsc` clean; golden master unaffected. **Merged** (PR #69, issue #26
  auto-closed).
- **2026-08-30** — **D-01** (#18) fixed on `issue/18-opfs-rollback`: `save()` now
  sequences the localStorage mirror behind the OPFS write, so a failed OPFS write
  can never leave localStorage newer than OPFS (the silent-rollback trigger).
  761/761 tests, `tsc` clean.
- **2026-08-30** — **U-01** fixed on `fix/u01-stale-export`: `handleExportFull` now
  seeds the throwaway export DB from `store.exportBytes()` (live in-memory state)
  instead of letting `AppDatabase.open()` read potentially-stale OPFS/localStorage.
  762/762 tests, `tsc` clean.
- **2026-08-30** — **U-02** fixed on `fix/u02-durability-feedback`: `AppDatabase.save()`
  reports durable-write outcomes through an `onSaveOutcome` channel; App.tsx shows a
  dismissible "Changes may not be saved" banner on failure that clears on the next
  durable write. 776/776 tests, `tsc` clean.
- **2026-08-30** — **S-01** fixed on `fix/s01-strategy-scoring`: `runOne` now scores the
  household verdict against `merged` (the inputs the engine ran on), closing the latent
  trap where a strategy patching `maxAge`/spouse fields would be judged on the wrong
  horizon. 778/778 tests, `tsc` clean.
- **2026-08-30** — **A-03** fixed on `fix/a03-agent-household-verdict`: the agent's
  `summarizeResults` headline and both agentQA digest builders now lead with the
  `householdOutcome` verdict; per-person statuses are demoted to labeled detail lines.
  788/788 tests, `tsc` clean.

---

## Where to start (suggested priority — remaining)

1. **Engine money-correctness MEDIUMs** — all fixed (E-06 #26, E-07 #25, E-08 #27).
2. **Data-durability MEDIUMs** — all fixed: D-01 (#18 OPFS rollback, PR #76),
   U-01 (stale export, PR #79), U-02 (durability feedback, `fix/u02-durability-feedback`).
3. **S-01** — fixed (`fix/s01-strategy-scoring`).
4. **Quick wins** — U-15 (`fix/u15-print-rdsp-column`) and A-03
   (`fix/a03-agent-household-verdict`) fixed. Remaining: D-02 (#19 warning), X-04 (comment).
5. **Verify-before-fix** — E-02 (fixed-point oracle), E-04, T-02, T-03.
6. **Features** — #24 (contribution room), #40 (pension start ages).

---

## Review coverage (stones turned)

- **Engine** `retirementEngine.ts` (2087 lines) — read in full → E-01…E-09
- **Tax** `canadianTax.ts` (221 lines) — read in full → T-01…T-04
- **Strategies/solvers** `strategies.ts`, `spendingSolver.ts`, `eqSolver.ts`, workers → S-01…S-05
- **Monte Carlo** `monteCarlo.ts`, `runMonteCarlo.ts` → verdict alignment confirmed (#33); E-MC-01 residual test gap
- **Backtest** `historicalReturns.ts`, `runBacktest` → H-01, H-02
- **Data** `db.ts`, `store.ts`, `opfs.ts`, `schemas.ts`, `scenarioStorage.ts`, `scenarioRevisions.ts`, `planTransfer.ts`, `shareLink.ts`, `appConfig.ts` → D-01…D-07
- **AI** `ai/tools.ts` (1205), `agentIngest.ts`, `agentQA.ts`, `memory/store.ts`, `eqConstraints.ts` → A-01…A-05
- **UI** `App.tsx` (1049), `MetricCards`, `ScheduleTable` (360), `TimelineChart` (314), `MonteCarloChart`, `OptimizeCard`, `CompareCard`, `EqPage` (477), `PrintSummary` (503), `SidebarForm` (withdrawal section) → U-01…U-16
- **Cross-cutting** — full `.status` consumer grep, `withdrawalOrder` provenance grep, typecheck + 730/730 test re-run → X-01…X-04

**Not exhaustively line-read** (lower-risk, partially reviewed): the rest of
`SidebarForm.tsx` (1645 lines — only the withdrawal-order section was read closely),
`AgentPage.tsx` (2045 lines — chat UI; its tool *surface* was reviewed via `tools.ts`),
`ConnectionsPage`, `DataPage` (except the withdrawalOrder default), `SettingsModal`,
`HelpModal`, `ScenarioManager`, `SetupWizard`, `SharingPage`, and the small presentational
components. The AI provider/transport files (`providers.ts`, `webLlm*.ts`, `agentLoop.ts`,
`chatStore.ts`, `checkpoints.ts`, `context.ts`) were reviewed at the boundary (tool
execution + memory) but not line-by-line. These are candidates if a follow-up pass is
wanted, but no money-path runs through them.
