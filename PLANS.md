# PLANS.md — executable fix plans for the outstanding REVIEW.md items

This file is the hand-off for working through the remaining code-review findings.
Each plan is **self-contained**: goal, exact files/lines, a code sketch, a test
recipe, and acceptance criteria. They are written so they can be executed **one at
a time, in any order, by an engineer or a code model with no prior context**.

> **How to use:** pick ONE plan, follow it, keep `npx vitest run` and
> `npx tsc --noEmit -p tsconfig.app.json --pretty false` green, then mark the item
> done in `REVIEW.md` (strike it through and remove it from the "Still outstanding"
> section). Do not batch unrelated plans into one change.

> **⚠ Instructions for the executing model/agent:**
> - **Work exactly ONE plan per invocation.** Do not start a second plan in the same
>   session, and do not combine plans into one commit/branch/PR.
> - **Stop after each plan.** When the plan's acceptance criteria are met (code +
>   test committed, suite + typecheck green, REVIEW.md updated), commit on a
>   `fix/<slug>` branch, open the PR if it maps to an issue, update the plan's
>   checkbox below to `[x]`, and **end the turn**. Do not continue to the next plan.
> - **Plans marked "verify-first" (E-04, E-02, T-02, T-03)** may legitimately close
>   as *verified-OK / Info* with NO code change — that is a valid outcome, not a
>   failure. Only write code if the verification finds a real defect.
> - **Plans with an "Options (pick one)" section** name a recommended default but
>   flag a real tradeoff — surface the choice to the user before coding if it isn't
>   already decided.
> - If a plan's file/line references have drifted, re-locate the code by the symbol
>   names quoted in the plan rather than trusting the numbers blindly.

**Progress tracker:** the checkbox next to each plan title is the burn-down list.
`[ ]` = outstanding, `[x]` = done (merged). Keep it in sync with REVIEW.md.

---



## Global rules (apply to EVERY plan)

These come from `CLAUDE.md` and are non-negotiable:

1. **Tests with every `src/lib/**` change.** Any change under `src/lib/` ships with
   Vitest coverage **in the same commit**. Keep `npx vitest run` green.
2. **Golden master is intentional.** `src/lib/goldenMaster.test.ts` locks the engine's
   numeric output. If a fix *legitimately* changes results, regenerate the golden
   values **in the same commit** and say so in the message. Never let it fail
   silently. (Most plans below note whether the golden master is expected to move.)
3. **Branch per item.** Work on `fix/<slug>` off `main`. Do not push feature work to
   `main` directly. Open a PR titled `<summary> (closes #<n>)` when the item maps to
   an open issue.
4. **Commit messages** end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
5. **Conventions** (money/id/type pitfalls):
   - `Pension.endAge` is **required** — use explicit `null`, never omit.
   - Reverse-mortgage `startAge`/`durationYears` are `number | undefined` — **omit**
     them, never pass `null`.
   - Province code is `'ONT'`, never `'ON'`.
   - Match the file's comment density (engine is heavily commented; UI is sparser).
6. **Probe technique** — vitest swallows `console.log`; use `console.error` +
   `--reporter=verbose`, or `writeFileSync` to a scratch file, then **delete the
   probe**. Never leave a probe test in the suite.

## Commands

```bash
npm run dev            # dev server
npx vitest run         # run all tests once
npx vitest run src/lib/retirementEngine.test.ts -t "substring"   # focused
npx tsc --noEmit -p tsconfig.app.json --pretty false   # typecheck
```

## Test helpers (use these — `src/test/helpers.ts`)

- `baseInputs({...})` — a valid `RetirementInputs` you override per test.
- `testConfig()` — a valid `AppConfig`.
- `yearAt(breakdown, age)` — find the row for an age.
- `closeTo(a, b, tol)` — float compare.

---

# TIER 1 — Engine money-correctness (do these first)

---

## [x] PLAN E-07 · Pre-retirement registered transfer taxed from a $0 income floor
**Maps to:** open issue **#25** · REVIEW.md **E-07** · Severity MEDIUM
**File:** `src/lib/retirementEngine.ts`

### Problem
Pre-retirement, a registered→account transfer (an "RRSP meltdown" before
retirement) is taxed as if the year's other income were **$0**. The transfer-tax
estimate inside `applyTransferEvent` stacks the draw on `baseGross`, but the
accumulation phase passes `accumTransferBaseGross` — which starts at `0` each year
and only accumulates *prior transfers*, never the year's employment/pension/benefit
income. So a working 55-year-old who melts down $50k is taxed at the bottom
brackets instead of on top of their salary.

### Where
- `src/lib/retirementEngine.ts:961` — `let accumTransferBaseGross = 0;`
- `src/lib/retirementEngine.ts:998` — `applyTransferEvent(ev, accumTransferBaseGross, configAt(age), accumDeposit, age)`
- `src/lib/retirementEngine.ts:1002` — `accumTransferBaseGross += t.gross;`
- The tax math itself (correct, just fed a low base): `applyTransferEvent` at
  `src/lib/retirementEngine.ts:790-826` (`t0 = calculateTax(baseGross,…)`,
  `t1 = calculateTax(baseGross + gross,…)`, `tax = t1 - t0`).

### Root cause
The accumulation phase does not model employment/benefit income at all (comment at
engine:950-955: "Pre-retirement the engine models no employment income"). But the
inputs DO carry `employmentList` and `pensionList` with `startAge`/`endAge` windows
that can be active pre-retirement (see the decumulation employment block at
engine:1162-1168 for the shape). The fix must compute the year's pre-retirement
*earned/pension* gross and use it as the floor the transfer stacks on.

### Fix sketch
1. In the accumulation loop (before the transfer `for` loop at engine:995), compute
   the year's pre-retirement income floor:
   ```ts
   // Pre-retirement income floor: wages + DB/bridge pensions active this year.
   // A registered meltdown stacks on TOP of this — taxing it from $0 would
   // under-state the tax (issue #25).
   let preRetIncome = 0;
   for (const e of employmentList) {
     if (age < e.startAge || age > e.endAge) continue;
     preRetIncome += e.annualAmount * (e.indexedToCpi && indexTables ? factorAt(age) : 1);
   }
   for (const p of pensionList) {
     if (age < p.startAge) continue;
     if (p.endAge != null && age > p.endAge) continue;
     preRetIncome += p.annualAmount * (p.indexedToCpi && indexTables ? factorAt(age) : 1);
   }
   ```
   (Reuse the exact window/indexation logic from the decumulation block so the two
   phases agree. Confirm the in-scope names: `employmentList`, `pensionList`,
   `indexTables`, `factorAt` — they exist in the decumulation phase; verify they're
   in scope in the accumulation loop or hoist equivalents.)
2. Initialise the per-year base with that floor instead of `0`:
   ```ts
   let accumTransferBaseGross = preRetIncome;
   ```
   (Keep `accumTransferBaseGross += t.gross` so successive transfers still stack.)
3. **Decide & document** whether the pre-retirement employment/pension income should
   also appear in the year's `detail` / tax figures, or is used ONLY as the
   transfer-tax floor. Minimal correct change: use it only as the floor (don't
   alter reported pre-retirement balances/contributions). Note the choice in a
   comment.

### Golden master
Check whether the canonical scenario has a pre-retirement registered transfer while
employment/pension is active. If yes, results change → regenerate golden master in
the same commit and say so. If no, golden master is unaffected.

### Test recipe (`src/lib/retirementEngine.test.ts`)
Add a `describe` near the existing `transfer events (RRSP meltdown)` block:
```ts
it('pre-retirement meltdown stacks on the year\'s employment income (E-07 / #25)', () => {
  // Working 55yo, $80k salary, melts down $50k RRSP → TFSA.
  // The transfer's tax must be HIGHER than the same transfer with no income,
  // because it stacks on the salary's brackets.
  const noIncome = calculateRetirement(baseInputs({
    currentAge: 55, retirementAge: 60, maxAge: 61,
    rrspBalance: 200000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 0,
    events: [{ id: 'm', age: 55, label: 'm', amount: 50000, direction: 'out',
      from: { kind: 'account', person: 'primary', account: 'rrsp' },
      to: { kind: 'account', person: 'primary', account: 'tfsa' } }],
  }), config);
  const withJob = calculateRetirement(baseInputs({
    currentAge: 55, retirementAge: 60, maxAge: 61,
    rrspBalance: 200000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 0,
    // employment active pre-retirement — confirm the exact EmploymentIncome shape
    employment: [{ id: 'j', startAge: 55, endAge: 59, annualAmount: 80000, indexedToCpi: false, topUpSpending: false }],
    events: [{ id: 'm', age: 55, label: 'm', amount: 50000, direction: 'out',
      from: { kind: 'account', person: 'primary', account: 'rrsp' },
      to: { kind: 'account', person: 'primary', account: 'tfsa' } }],
  }), config);
  const taxNo   = yearAt(noIncome.yearlyBreakdown, 55).detail?.calc?.transfers?.[0]?.tax ?? 0;
  const taxWith = yearAt(withJob.yearlyBreakdown, 55).detail?.calc?.transfers?.[0]?.tax ?? 0;
  expect(taxWith).toBeGreaterThan(taxNo);
});
```
**Verify the `EmploymentIncome` field names** against the type before writing the
test (grep `interface EmploymentIncome` in `src/lib/retirementEngine.ts`); the
decumulation block uses `e.startAge`, `e.endAge`, `e.annualAmount`, `e.indexedToCpi`,
`e.topUpSpending`. Adjust the object literal to match exactly.

### Acceptance
- New test passes; full suite green; `tsc` clean.
- A pre-retirement meltdown during working years is taxed materially higher than the
  same meltdown with no income.
- REVIEW.md: strike E-07, remove from "Still outstanding", note the branch/PR. PR
  body references `closes #25`.

---

## [ ] PLAN E-06 · Couple GIS counts own draws in-year, partner's never
**Maps to:** open issue **#26** · REVIEW.md **E-06** · Severity MEDIUM
**File:** `src/lib/retirementEngine.ts`

### Problem
For a couple, GIS is assessed on **combined** non-OAS income. The engine's `gisAt()`
passes the person's *own* discretionary registered draws (`registeredGross +
capitalGains + rdspTaxable`) but only the partner's **fixed** income
(`sp.fixed` = CPP + pension + employment) — never the partner's *discretionary*
registered draws. When both partners draw RRIF/RRSP, each is shown **too much GIS**.

### Where
- `src/lib/retirementEngine.ts:1313-1325` — `gisAt()`:
  ```ts
  const gisAt = () => {
    if (oasGross <= 0) return 0;
    if (spouseCtx) {
      const sp = spouseFixedIncomeAt(age);
      return gisAnnualCouple(
        registeredGross + capitalGains + rdspTaxable,   // own draws
        cppGross + pensionGross + employmentGross + sp.fixed,  // own fixed + partner FIXED only
        sp.hasOas,
        yearConfig
      );
    }
    return gisAnnual(stackBase + registeredGross + capitalGains + rdspTaxable - oasGross, yearConfig);
  };
  ```
- `spouseFixedIncomeAt` at `src/lib/retirementEngine.ts:630-652` returns only
  `{ fixed, hasOas }` — it has no access to the partner's *discretionary* draws
  (those are computed inside the partner's own `calculatePerson` run).

### Why this is the hard one (read before touching code)
Each person's GIS depends on the partner's discretionary draws, and the partner's
discretionary draws depend on the partner's GIS (GIS reduces the after-tax need,
which changes how much is drawn). That's a **coupled fixed point across the two
runs**. `calculateHousehold` runs primary then spouse; a one-pass ordering leaves
whoever runs first using stale/zero partner draws.

### Options (pick one, document the choice)
- **Option A — fixed-point iteration (correct).** In `calculateHousehold`
  (`src/lib/retirementEngine.ts:1697+`), after running both people once, feed each
  person's *discretionary* registered draws to the partner's `spouseContext` as a
  new field (e.g. `discretionaryRegisteredAt(age)`), then re-run both and iterate
  until GIS converges (ΔGIS < $1, max ~5 iterations). This mirrors how the
  inter-spousal transfer re-run already works (see the existing re-run logic around
  engine:1725-1760). **Higher effort, correct.**
- **Option B — document the simplification (cheap).** Add a prominent comment at
  `gisAt()` stating the asymmetry is a deliberate, conservative approximation
  (over-pays GIS, never under-pays), and close #26 as "documented limitation."
  **Only do this if the user accepts it** — it is NOT a fix.

### Recommended path
Try **Option A**. If it proves to destabilise existing household tests, fall back to
Option B **with the user's sign-off** (it's a documented-tradeoff decision, not a
silent one).

### Fix sketch (Option A)
1. Extend the spouse-context type (near `spouseFixedIncomeAt`) to carry the
   partner's per-age discretionary registered draws:
   ```ts
   // In the spouse-context options type:
   partnerRegisteredDrawsAt?: (age: number) => number; // partner's own discretionary registered+capgain+rdsp draws
   ```
2. In `calculatePerson`, capture this run's own discretionary draws per age into an
   array as they're computed (the `registeredGross + capitalGains + rdspTaxable`
   value used at engine:1318/1324), expose it on the results (or via a ref) so the
   household pass can hand it to the partner.
3. In `gisAt()`, add the partner's draws to the couple base:
   ```ts
   const partnerDraws = spouseCtx.partnerRegisteredDrawsAt?.(spouseAge) ?? 0;
   // ...second arg becomes:
   cppGross + pensionGross + employmentGross + sp.fixed + partnerDraws,
   ```
   (Confirm the spouse-age translation — see `spouseFixedIncomeAt` engine:632 for
   `spouseAge = age - (currentAge - spouseCtx.currentAge)`.)
4. In `calculateHousehold`, loop: run primary → run spouse → if either GIS changed
   by > $1, swap in the latest draw arrays and re-run, up to 5×.

### Golden master
If the canonical scenario is a couple with both partners drawing registered funds
while GIS-eligible, results change → regenerate golden master in the same commit.
Verify with a probe before assuming.

### Test recipe
```ts
it('couple GIS is reduced by BOTH partners\' discretionary registered draws (E-06 / #26)', () => {
  // Both partners on OAS+GIS, both drawing RRIF. Household GIS must be <= the
  // single-partner-draw case (partner's draws now count).
  // Build a couple fixture where only primary draws, then both draw; assert the
  // combined GIS in the both-draw case is strictly lower.
});
```
Model it on the existing couple-GIS tests (grep `gisAnnualCouple` /
`employment reduces single-person GIS` / `household combiner` in
`src/lib/retirementEngine.test.ts` for fixtures).

### Acceptance
- Both partners' discretionary draws reduce couple GIS; no oscillation beyond the
  iteration cap; full suite green; `tsc` clean.
- REVIEW.md: strike E-06, remove from list, note PR. PR body `closes #26`.
- If Option B was taken instead, mark E-06 as "documented limitation", keep #26 open
  but re-labelled, and get the user's explicit OK in the PR description.

---

## [ ] PLAN E-08 · Re-homed past-dated transfer silently dropped
**Maps to:** open issue **#27** · REVIEW.md **E-08** · Severity MEDIUM
**File:** `src/lib/retirementEngine.ts`

### Problem
A transfer event authored on person A but sourced from person B's account is
"re-homed" to B's run, with its age shifted by the current-age gap
(`rehome`, engine:1682-1695). If A and B have different current ages, the re-stamped
age can land **before B's current age** — and the events filter
`e.age >= currentAge` (engine:599) then **silently drops it**. The transfer never
fires and no warning is surfaced.

### Where
- `src/lib/retirementEngine.ts:599` — the drop:
  ```ts
  const events = (Array.isArray(person.events) ? person.events : []).filter(e => e.age >= currentAge);
  ```
- `src/lib/retirementEngine.ts:1682-1695` — `rehome()` shifts `age`/`endAge` by
  `(ownerCurrentAge - selfCurrentAge)`; a younger receiver can get a negative shift
  that pushes the event into the past.
- Callers: engine:1698 (primary gets spouse-authored), engine:1713 (spouse gets
  primary-authored).

### Root cause
The age translation assumes the authored age is a *calendar* intent shared by both
people. When the source person is younger, the same calendar year is a *lower* age
for them — possibly below their current age (already in the past). Dropping past
events is correct for the person's *own* list, but a re-homed transfer that lands in
the past is a data-entry / modelling conflict the user should hear about, not a
silent no-op.

### Fix options (pick one, document)
- **Option A — clamp + fire at current age (chosen default).** When a re-homed
  transfer's computed age is below the receiver's `currentAge`, clamp it to
  `currentAge` (fire it immediately, this year) rather than dropping it. Add a
  comment that a past-dated cross-age transfer is taken to fire "as soon as
  possible." Implement inside `rehome()`:
  ```ts
  .map(e => {
    const shift = ownerCurrentAge - selfCurrentAge;
    const age = e.age - shift;
    // A re-homed transfer that lands before the receiver's present would be
    // dropped by the e.age >= currentAge filter — clamp it to fire now instead
    // of vanishing silently (issue #27).
    const clampedAge = Math.max(age, selfCurrentAge);
    return {
      ...e,
      age: clampedAge,
      ...(e.endAge != null ? { endAge: Math.max(e.endAge - shift, clampedAge) } : {}),
    };
  });
  ```
  Note: clamping `endAge` to `>= clampedAge` keeps a recurring event's window valid.
- **Option B — surface a warning.** Keep the drop but push a warning onto the
  results (e.g. a `warnings: string[]` on `RetirementResults`) and show it in the
  UI. Higher touch (new plumbing); only if the user wants visibility over
  auto-firing.

### Recommended
Option A (clamp-to-now) — it's local, conserves household money, and turns a silent
loss into a sensible default. Mention the chosen behaviour in the PR.

### Golden master
Only moves if the canonical scenario has a cross-age transfer that re-homes into the
past (unlikely). Verify; regenerate only if it shifts.

### Test recipe (there's already a `re-homed transfer events` describe — engine test)
```ts
it('a re-homed transfer dated before the receiver\'s current age fires now, not never (E-08 / #27)', () => {
  // Older primary authors a transfer FROM the younger spouse's account, dated so
  // that on the spouse's age axis it's in the spouse's past. Expect: it fires at
  // the spouse's current age (clamped), and the spouse's balance reflects it.
  // Assert spouse row at spouse.currentAge shows the transfer in
  // detail.calc.transfers and the source balance dropped.
});
```
Look at the existing `describe('re-homed transfer events (authored on the wrong
person)')` block (around engine test:597) and the age-translation test
(`age translation: a transfer from an older primary lands in the right spouse
year`, ~engine test:428) for the exact couple-fixture shape.

### Acceptance
- A past-dated re-homed transfer fires (clamped) instead of disappearing; household
  money conserved; full suite green; `tsc` clean.
- REVIEW.md: strike E-08, remove from list, note PR. PR body `closes #27`.

---

# TIER 2 — Data durability & correctness

---

## [ ] PLAN D-01 · OPFS-write failure → one-session rollback of the last save
**Maps to:** open issue **#18** · REVIEW.md **D-01** · Severity MEDIUM
**File:** `src/data/db.ts`

### Problem
`save()` (db.ts:150-161) writes OPFS (the durable home) **and** the localStorage
mirror. If the OPFS write fails but localStorage succeeds, the two diverge: next
load, `open()` (db.ts:100-121) prefers OPFS (stale) over localStorage (newer), so
the user silently rolls back to the previous session's state — the most recent save
is lost.

### Where
- `src/data/db.ts:150-161` — `save()`:
  ```ts
  save(): void {
    const bytes = this.db.export();
    if (this.backend) {
      this.backend.write(bytes).catch(err =>
        console.warn('Failed to persist the database to OPFS:', err));
    }
    try {
      localStorage.setItem(STORAGE_KEY, bytesToBase64(bytes));
    } catch (err) { console.warn('Failed to persist the database to localStorage:', err); }
  }
  ```
- `src/data/db.ts:100-121` — `open()` byte-source priority: seed → OPFS →
  localStorage. OPFS wins even when it's the stale copy.

### Root cause
Two writable mirrors with no freshness reconciliation: OPFS is always preferred on
read, but a failed OPFS write leaves it older than localStorage.

### Fix options (pick one, document)
- **Option A — write-ahead sequencing (minimal).** Make `save()` write OPFS first
  and only mirror to localStorage on success; on OPFS failure, **skip the
  localStorage write** so localStorage never gets ahead of OPFS. Downside: a
  persistent OPFS outage means nothing is mirrored at all (in-memory only for that
  session) — but no silent rollback. This is the smallest change that removes the
  divergence.
- **Option B — freshness token.** Stamp each save with a monotonically increasing
  sequence (or timestamp) in BOTH mirrors; on `open()`, read both headers and pick
  the newer. More code (need a sidecar key for the OPFS sequence) but never loses a
  save. Higher effort.

### Recommended
Option A for the bug fix (removes the silent-rollback data loss). Optionally also
surface a one-time UI warning when OPFS write fails (ties into U-02). If you want
full durability, open a follow-up for Option B.

### Fix sketch (Option A)
```ts
save(): void {
  const bytes = this.db.export();
  if (this.backend) {
    // OPFS is the durable home; only mirror to localStorage once OPFS has the
    // bytes. If OPFS fails we SKIP the mirror so localStorage can never be newer
    // than OPFS (which would cause a silent one-session rollback on next load —
    // issue #18).
    this.backend.write(bytes)
      .then(() => {
        try { localStorage.setItem(STORAGE_KEY, bytesToBase64(bytes)); }
        catch (err) { console.warn('Failed to persist the database to localStorage:', err); }
      })
      .catch(err => console.warn('Failed to persist the database to OPFS:', err));
    return;
  }
  // No OPFS backend: localStorage is the only mirror.
  try { localStorage.setItem(STORAGE_KEY, bytesToBase64(bytes)); }
  catch (err) { console.warn('Failed to persist the database to localStorage:', err); }
}
```
**Check `this.backend.write` returns a real Promise** (see `src/data/opfs.ts`
`AsyncOpfsBackend.write`). If it's fire-and-forget internally, adjust accordingly.

### Test recipe (`src/data/db.test.ts` or `src/data/opfs.test.ts`)
- Force `backend.write` to reject; call `save()`; assert localStorage was NOT
  updated (no newer mirror left behind). The test files already have an OPFS-less
  localStorage shim — see `src/lib/scenarioRevisions.test.ts:11` for the pattern.

### Acceptance
- A failed OPFS write never leaves localStorage newer than OPFS; full suite green;
  `tsc` clean.
- REVIEW.md: strike D-01, remove from list, note PR. PR body `closes #18`.

---

## [ ] PLAN U-01 · Full export opens a 2nd SQLite connection (stale-bytes risk)
**Maps to:** REVIEW.md **U-01** · Severity MEDIUM
**File:** `src/App.tsx`

### Problem
`handleExportFull` (App.tsx:251-271) calls `AppDatabase.open()` to build the backup
file. `open()` reads bytes from **OPFS/localStorage** (db.ts:100-121), which may lag
the live in-memory store (persist is fire-and-forget — see U-02). The exported
backup can therefore snapshot **stale** bytes, missing the user's most recent edits.

### Where
- `src/App.tsx:254` — `const db = await AppDatabase.open();`
- Live store's in-memory DB is held elsewhere (the `store` from the persist effect).

### Fix
Export from the **live** store's database, not a freshly opened one.
1. Find how the live `AppDatabase`/`AppStore` instance is exposed in `App.tsx`
   (the `store` used at App.tsx:202/208). If the underlying `AppDatabase` is
   reachable (e.g. `store.db` or a getter), use it directly.
2. Serialize the live DB: the live store has unsaved in-memory state, so call the
   live DB's `export()` (same as db.ts:151) to get current bytes **after** flushing
   the working set into it (the existing code already calls
   `db.saveScenarios/saveActiveScenarioId/saveConfig` before export — replicate that
   against the live DB, or better, force a `store.persist({...})` flush first, then
   read the live bytes).
3. Do NOT call `db.close()` on the live store's connection (that's only right for
   the throwaway export connection). Guard the close to the throwaway case.

**Concrete minimal change:** replace `await AppDatabase.open()` with access to the
already-open store's DB, flush, export its bytes, and skip the close. If the live DB
isn't currently exposed, add a read-only accessor on the store (e.g.
`store.exportBytes(): Uint8Array`) that flushes + exports the live connection.

### Test recipe
- If you add `store.exportBytes()`, test it returns bytes that round-trip through
  `AppDatabase.open(seed)` and reflect the most recent `persist`ed scenario.
- Otherwise this is a wiring fix — verify by hand in `npm run dev`: make an edit,
  immediately export, re-import, confirm the edit is present.

### Acceptance
- An export taken immediately after an edit contains that edit; no second
  connection opened; full suite green; `tsc` clean.
- REVIEW.md: strike U-01, remove from list.

---

## [ ] PLAN U-02 · Persist effects are fire-and-forget (no durability feedback)
**Maps to:** REVIEW.md **U-02** · Severity MEDIUM
**File:** `src/App.tsx` (+ possibly `src/data/store.ts`)

### Problem
The persist effects (App.tsx:201-209) call `store?.persist({...})` and ignore any
failure. `persist` ultimately hits `db.save()`, whose OPFS/localStorage writes can
fail (only a `console.warn`). The user gets **no signal** when their data isn't
being saved — combined with D-01, a silent durability hole.

### Where
- `src/App.tsx:201-204` — scenarios persist effect.
- `src/App.tsx:207-209` — config persist effect.
- `src/data/store.ts` — `persist(...)` (the method these call).
- `src/data/db.ts:150-161` — `save()` swallows/logs errors.

### Fix (minimal, UX-surfacing)
1. Make the failure observable: have `save()`/`persist` report success/failure
   (e.g. return a `boolean` or a `Promise<boolean>`, or accept an `onError`
   callback). Smallest: `persist` already returns "wrote a revision" — extend the
   store to also expose the last save error.
2. Surface it once in the UI: a small non-blocking banner/toast ("Changes may not be
   saved — storage unavailable") driven by a React state set from the persist
   effect when a failure is reported. Debounce so it doesn't flash on every
   keystroke; show once per session (or until a save succeeds again).

This is intentionally a **visibility** fix, not a retry/queue system. Coordinate
with D-01 (which changes the write ordering) so the two don't conflict — do D-01
first.

### Test recipe
- Store-level: simulate a `save()` failure (mock the backend write to reject) and
  assert the store surfaces an error flag/lastError.
- UI: manual verification of the banner.

### Acceptance
- A storage failure produces a visible, non-blocking indication; full suite green;
  `tsc` clean.
- REVIEW.md: strike U-02, remove from list.

---

## [ ] PLAN D-02 · Hand-corrupted config silently resets to defaults
**Maps to:** open issue **#19** · REVIEW.md **D-02** · Severity LOW
**Files:** `src/data/store.ts`, `src/lib/appConfig.ts`

### Problem
If the stored config is hand-corrupted so `validateAppConfig` returns `null`, the
store loads `config: null` (store.ts:83) and the app falls back to defaults —
**with no warning**. The user's custom tax tables silently vanish.

### Where
- `src/data/store.ts:83` — `const config = configRaw ? validateAppConfig(configRaw) : null;`
- `src/lib/appConfig.ts:227` — `validateAppConfig(raw): AppConfig | null`.

### Fix
When `configRaw` is present but `validateAppConfig` returns `null`, log a
**prominent** `console.error` (distinguishable from routine back-fill) AND surface
the raw payload length/keys so a user/support can see *what* failed. Optionally
expose a `configLoadWarning` on the returned state for the UI to banner.
Minimal change:
```ts
let config: AppConfig | null = null;
if (configRaw) {
  config = validateAppConfig(configRaw);
  if (!config) {
    // Corrupted/invalid stored config: we fall back to defaults. Make it loud —
    // silently resetting the user's tax tables would lose real edits (issue #19).
    console.error(
      'Stored config failed validation and was reset to defaults. Raw keys:',
      configRaw && typeof configRaw === 'object' ? Object.keys(configRaw as object) : typeof configRaw,
    );
  }
}
```
(Do NOT change the back-fill behaviour for *missing-newer-fields* — that's intended;
only the wholesale `null` case is the bug.)

### Test recipe (`src/data/store.test.ts`)
- Seed a store with an invalid config blob; load; assert `console.error` was called
  (spy) and config fell back to defaults.

### Acceptance
- Corrupted config produces a loud error, not a silent reset; suite green; `tsc`
  clean.
- REVIEW.md: strike D-02, remove from list, PR `closes #19`.

---

# TIER 3 — Strategies / solvers

---

## [ ] PLAN S-01 · `runOne` scores household outcome against `inputs`, not `merged`
**Maps to:** REVIEW.md **S-01** · Severity MEDIUM
**File:** `src/lib/strategies.ts`

### Problem
`runOne` (strategies.ts:256-279) applies the strategy patch to get `merged`, runs
the engine on `merged` — but then scores the verdict with
`householdOutcome(r, inputs)` (line 264), passing the **unpatched** `inputs`.
`householdOutcome` uses `inputs.maxAge` (engine:1899) and, via
`combineHouseholdBreakdown(results, inputs)`, may use input fields the patch
changed. If a strategy alters `maxAge` (or any field the verdict reads), the score
is computed against the wrong inputs.

### Where
- `src/lib/strategies.ts:264` — `const ho = householdOutcome(r, inputs);`
- `householdOutcome` signature: `src/lib/retirementEngine.ts:1892` —
  `(results: RetirementResults, inputs: RetirementInputs)`.

### Fix
Pass `merged` (the inputs the engine actually ran on):
```ts
const ho = householdOutcome(r, merged);
```
**Audit first:** confirm no *intended* reason to score against `inputs` (e.g. a
deliberate "compare to original horizon"). The comment at strategies.ts:262-263
says the goal is to match the Monte Carlo screen and dashboard — those score the
run's own inputs, so `merged` is correct. Also check the other `householdOutcome`
call sites (`monteCarlo.ts`, `strategies.ts:80`, `eqSolver.ts`) pass the inputs the
engine ran on; align any that don't.

### Test recipe (`src/lib/strategies.test.ts`)
- Construct a strategy whose patch changes a verdict-relevant field (e.g. extends
  `maxAge`), and assert the reported `depletionAge`/`survived` reflects `merged`,
  not the base inputs. If no existing strategy patches `maxAge`, add a synthetic
  spec in the test to expose the bug (this test should FAIL before the fix, PASS
  after).

### Acceptance
- Verdicts reflect the patched inputs; full suite green; `tsc` clean.
- REVIEW.md: strike S-01, remove from list.

---

## [ ] PLAN S-02 · `sustainableSpending` hi-expansion edge
**Maps to:** REVIEW.md **S-02** · Severity LOW
**File:** `src/lib/strategies.ts`

### Problem
`sustainableSpending` (strategies.ts:80 area) binary-searches the highest spending
that survives. Its upper-bound expansion can, at the edge, fail to bracket (similar
shape to the #28 loop caps already fixed). Confirm and cap the expansion.

### Fix
- Read `sustainableSpending` fully. If it has an uncapped `while (…survives…) hi *= x`
  expansion, cap it at a fixed iteration count (match the `MAX_TAX_ITERATIONS` idiom
  used in engine) so a degenerate config can't hang. If it's already capped, mark
  S-02 verified-OK and move on.

### Test recipe
- A config/inputs that drives sustainable spending to an extreme (e.g. huge
  portfolio, tiny spending) terminates and returns a finite value.

### Acceptance
- No unbounded loop; suite green. REVIEW.md: strike S-02 (or mark verified-OK).

---

## [ ] PLAN S-03 · Strategy orderings omit RDSP
**Maps to:** REVIEW.md **S-03** · Severity LOW (== #40 family)
**File:** `src/lib/strategies.ts`

### Problem
The withdrawal-order strategies enumerate orderings of `['rrsp','tfsa','taxable']`
but not `'rdsp'`. With E-01 fixed (RDSP now auto-injects), the explorer should
consider RDSP in its permutations when the plan has one.

### Fix
- Find where the order permutations are built in `strategies.ts`. When the inputs
  have an active RDSP (enabled + DTC-eligible + balance > 0 — same predicate as the
  engine's auto-inject), include `'rdsp'` in the candidate orderings.
- Coordinate with **#40** (feature): if #40 is being worked, fold S-03 into it;
  otherwise land the orderings inclusion as its own small change.

### Test recipe
- A plan with an active RDSP produces strategy variants whose `patch.withdrawalOrder`
  includes `'rdsp'`.

### Acceptance
- RDSP appears in generated orderings when active; suite green. REVIEW.md: strike
  S-03.

---

# TIER 4 — UI / Tax / AI / misc (quick wins & verify-first)

---

## [ ] PLAN U-15 · PrintSummary detailed table omits the RDSP column
**Maps to:** REVIEW.md **U-15** · Severity LOW
**File:** `src/components/PrintSummary.tsx`

### Problem
The print detailed year-by-year table (PrintSummary.tsx:309-359) has RRSP/RRIF/
TFSA/Taxable/Cash columns and a conditional Home-equity column, but **no RDSP
column** — so a plan with an RDSP prints without it. (`ScheduleTable` already has
one; this brings print to parity.)

### Fix (mirror ScheduleTable's RDSP handling)
1. Add a `hasRdsp` flag: `const hasRdsp = people.some(p => p.rows.some(r => r.rdspBalance !== undefined));`
   (Confirm the row field is `rdspBalance` — it is in ScheduleTable / the engine
   breakdown; verify it's present on the `rows` PrintSummary receives.)
2. Bump the `colSpan` (currently `17 + (hasRm ? 1 : 0)` at line 300) by
   `(hasRdsp ? 1 : 0)`.
3. Add `<th style={HEAD_CELL}>RDSP</th>` after the Cash `<th>` (line 328), guarded by
   `{hasRdsp && …}`, with the same title text ScheduleTable uses.
4. Add the matching `<td style={CELL}>{money(row.rdspBalance)}</td>` after the Cash
   `<td>` (line 353), guarded by `{hasRdsp && …}`.

### Acceptance
- Print table shows an RDSP column when (and only when) a person has an RDSP;
  column count stays consistent (no mis-aligned cells); `tsc` clean; suite green.
- REVIEW.md: strike U-15, remove from list.

---

## [ ] PLAN A-03 · Agent verdict strings use per-person status, not household
**Maps to:** REVIEW.md **A-03** · Severity LOW
**File:** `src/lib/ai/tools.ts`

### Problem
`summarizeResults` (tools.ts:553+) and `agentQA.ts` (~:93) read `results.status` /
`results.depletionAge` — the **primary person's** verdict. For a couple this can
report "SHORTFALL" when the *household* is fine (or vice-versa). The dashboard/MC
screen already use `householdOutcome()` (#33); the agent should match.

### Fix
- In `summarizeResults`, replace the per-person verdict with the household one:
  compute `const ho = householdOutcome(results, inputs);` and use
  `ho.status`/`ho.depletionAge` for the headline. Keep the per-person spouse line
  (tools.ts:570-574) as *secondary* detail.
- `householdOutcome` is already imported in strategies; import it in `tools.ts` from
  `./retirementEngine` (check the existing import path).
- Apply the same change in `src/lib/agentQA.ts` where it reads per-person status.

### Test recipe
- A couple where the primary's silo depletes but the household survives: the
  agent's summary string must say ON TRACK (matching `householdOutcome`), not
  SHORTFALL. (Reuse the #33 / E-MC-01 couple fixture concept.)

### Acceptance
- Agent headline verdict == household verdict; suite green; `tsc` clean.
- REVIEW.md: strike A-03, remove from list.

---

## [ ] PLAN T-02 · `taxOnTable` basic-exemption assumes lowest bracket rate (VERIFY)
**Maps to:** REVIEW.md **T-02** · Severity LOW
**File:** `src/lib/canadianTax.ts`

### Problem
`canadianTax.ts:38` computes the basic exemption credit as `raw − table.exemption *
table.rates[0]` — i.e. it credits the exemption at the **lowest** bracket rate.
That's the standard "non-refundable credit at the lowest rate" model and is usually
correct, but **verify** it matches CRA intent for every shipped province (some
credits use different rates).

### Task
- This is a **verify-first** item. Confirm the lowest-rate credit is correct for all
  provinces in `config.provinces` and the federal table. If correct, mark T-02
  verified-OK in REVIEW.md (Info) with a one-line justification. If a province needs
  a different rate, that's a real (small) bug — open a focused fix.

### Acceptance
- Documented verdict (correct-as-is → Info, or a fix + test). REVIEW.md updated.

---

## [ ] PLAN T-03 · OAS `yearsInCanada` not re-pro-rated for partial residency (VERIFY)
**Maps to:** REVIEW.md **T-03** · Severity LOW
**File:** `src/lib/canadianTax.ts`

### Problem
OAS is pro-rated by `yearsInCanada / 40`. Verify the pro-rating is applied
consistently (start-age and annual-gross paths) and matches the partial-residency
rules; confirm no path uses the full amount when residency < 40 years.

### Task
- **Verify-first.** Read `oasAnnualGross` (canadianTax.ts:127+) and its callers.
  If pro-rating is correct everywhere, mark T-03 verified-OK (Info). If a path
  misses it, fix + test.

### Acceptance
- Documented verdict. REVIEW.md updated.

---

## [ ] PLAN H-02 · Backtest is primary-only (spouse stripped) — OPTIONAL
**Maps to:** REVIEW.md **H-02** · Severity LOW (optional)
**File:** `src/lib/historicalReturns.ts`

### Problem
`runBacktest` strips the spouse and backtests only the primary's plan. For a couple
this understates/overstates the historical outcome. Optional enhancement, not a bug.

### Task (optional)
- If pursued: run the backtest on the household (both people) using
  `calculateHousehold`, or clearly label the backtest UI as "primary only."
  Cheapest acceptable outcome: a UI label making the limitation explicit.

### Acceptance
- Either household backtest or an explicit "primary only" label. REVIEW.md updated.

---

## [ ] PLAN X-04 · endAge / RM null-vs-omitted convention only in CLAUDE.md
**Maps to:** REVIEW.md **X-04** · Severity LOW
**Files:** `src/lib/retirementEngine.ts` (types) / `CLAUDE.md`

### Problem
The rule "`Pension.endAge` is required (explicit `null`); RM `startAge`/
`durationYears` are `number | undefined` (omit, never `null`)" lives only in
`CLAUDE.md`. It should be a code comment at the type definitions so it can't be
missed by someone not reading CLAUDE.md.

### Fix
- Add a short doc comment on the `Pension` interface's `endAge` field and on the
  reverse-mortgage type's `startAge`/`durationYears` fields stating the
  null-vs-omitted contract. Pure comment; no behaviour change.

### Acceptance
- Contract documented at the types; `tsc` clean. REVIEW.md: strike X-04.

---

## [ ] PLAN D-03 · UI-preference keys bypass the store's kv table
**Maps to:** open issue **#20** · REVIEW.md **D-03** · Severity LOW
**Files:** `src/lib/eqStorage.ts`, `src/lib/projectionExport.ts` (and any other
direct-`localStorage` UI-pref writers)

### Problem
Five UI-preference keys are written straight to `localStorage` instead of the
store's `kv` table, so they (a) aren't captured in full backups and (b) keep the
legacy localStorage path alive (blocks #21).

### Task
- Enumerate the direct writers (grep `localStorage.setItem` outside `src/data`).
  Route each through the store's `kv` (`db.setKv`/`getKv`) with a one-time migration
  from the legacy key. **Coordinate with #21** — this is really a sub-task of the
  single-source refactor; consider folding D-03 into a #21 PR rather than landing
  it alone.

### Acceptance
- UI prefs live in the kv table and survive backup/restore. REVIEW.md updated; PR
  references #20 (and #21 if combined).

---

## [ ] PLAN D-04 · Remove legacy localStorage dual-source (== #21, refactor)
**Maps to:** open issue **#21** · REVIEW.md **D-04** · Severity MEDIUM (refactor)
**Files:** `src/App.tsx` (`getSyncSeed`), `src/data/store.ts` (`importLegacyKeys`),
`src/lib/scenarioStorage.ts`, `src/lib/appConfig.ts`

### Problem
The app still reads/writes legacy localStorage keys as a fallback dual-source
(`getSyncSeed` App.tsx:61-68, `importLegacyKeys` store.ts:200). This is the
intended migration bridge, but it's still live; #21 wants a single source of truth
in the SQL store.

### Task (larger — plan carefully, possibly its own PR series)
1. Confirm the migration bridge has had long enough (check git history / release
   notes) that dropping it won't strand users.
2. Remove the legacy reads (`importLegacyKeys`, the localStorage branch of
   `getSyncSeed`) and the localStorage mirror in `db.save()` (after D-01 lands so
   ordering is safe), keeping OPFS as the single durable home.
3. Keep a one-way import for first-run users coming from very old builds, behind a
   clearly-marked legacy path, OR drop it entirely per the release decision.
4. Fold in D-03 (kv migration) so UI prefs move too.

### Acceptance
- SQL store (OPFS) is the single source of truth; no silent dual-source reads;
  suite green. REVIEW.md updated; PR `closes #21` (and #20 if combined).

---

## [ ] PLAN D-05 · `revSeq` resets per session (revision-id collision, theoretical)
**Maps to:** REVIEW.md **D-05** · Severity LOW
**File:** `src/lib/scenarioRevisions.ts`

### Problem
The revision sequence counter resets each session, so a revision id could
theoretically collide across sessions. Low risk; confirm and, if trivial, derive the
next id from the max existing id instead of a session counter.

### Task
- Read `scenarioRevisions.ts`. If the id is `revSeq++` from 0 each load, change it
  to `max(existingIds) + 1`. Add a test that two sessions don't collide.

### Acceptance
- No cross-session id collision; suite green. REVIEW.md: strike D-05.

---

## [ ] PLAN D-07 · `toDoc()` returns null on invalid config (drops config silently)
**Maps to:** REVIEW.md **D-07** · Severity LOW
**File:** `src/lib/projectionExport.ts` (or wherever `toDoc` lives)

### Problem
`toDoc()` returns `null` when the config is invalid, silently dropping the config
from the projection export. Surface the omission (a `warnings` field on the export
doc, or a console.error) so a silent partial export can't happen.

### Task
- Locate `toDoc`. On invalid config, either include a `configWarning` in the doc or
  log loudly; do not silently omit. Test: exporting with an invalid config flags it.

### Acceptance
- Export never silently drops config; suite green. REVIEW.md: strike D-07.

---

## [ ] PLAN E-04 · RRIF-min excess redeposit — VERIFY double-tax
**Maps to:** REVIEW.md **E-04** · Severity MEDIUM (verify)
**File:** `src/lib/retirementEngine.ts`

### Problem / task (verify-only, believed OK)
The RRIF-minimum excess over the spending need is redeposited into taxable and
added to ACB (engine:~1260-1263). Confirm the redeposit is **not** double-taxed
(it was already taxed as registered income when withdrawn; only its *future* growth
should be taxed in the taxable account). Write a probe/test asserting the year-end
unified tax equals benefits-tax + tax on (RRIF-min + other registered + gains)
exactly once, with no second tax on the redeposited principal. If correct, mark
E-04 verified-OK (Info). If double-taxed, that's a real bug — fix + golden-master
regen.

### Acceptance
- Documented verdict; test added. REVIEW.md updated.

---

## [ ] PLAN E-02 · Two-way inter-spousal transfer re-run may sit one oscillation stale (VERIFY)
**Maps to:** REVIEW.md **E-02** · Severity MEDIUM (verify)
**File:** `src/lib/retirementEngine.ts`

### Problem / task (verify-only)
When both partners transfer to each other, each run depends on the partner's
cross-deposits, which depend on the partner's marginal tax, which depends on the
partner's draws — a coupled pair. `calculateHousehold` re-runs to converge, but it
may stop one oscillation early (off-by-one in the convergence check). Build a
**fixed-point oracle**: a two-way-transfer fixture, run the re-run loop manually to
true convergence, and assert the engine's result matches within a small tolerance.
If it converges correctly, mark E-02 verified-OK. If it's one stale, fix the
loop-termination condition.

### Acceptance
- Documented verdict; oracle test added. REVIEW.md updated.

---

# Feature work (open issues, larger — NOT quick fixes)

- [ ] **#24 — Track TFSA/RRSP contribution room; overflow deposits to taxable.**
  Needs a contribution-room model (annual limits already in config:
  `engine.tfsaAnnualLimit`, `engine.rrspAnnualMax`). Plan as its own feature PR.
- [ ] **#40 — Strategy Explorer: optimize employer/DB pension start ages.** Add a
  pension-start-age lever to the strategy specs (fold in S-03 RDSP orderings).
  Plan as its own feature PR.

---

## Suggested execution order

1. **E-07** (#25) → **E-08** (#27) → **E-06** (#26) — engine money correctness.
2. **D-01** (#18) → **U-02** → **U-01** — durability (do D-01 before U-02).
3. **S-01** → **S-03** / **S-02** — strategies.
4. **Quick wins:** U-15, A-03, D-02 (#19), X-04, D-05, D-07.
5. **Verify-first:** E-04, E-02, T-02, T-03 (may close as Info).
6. **Refactor:** D-03 + D-04 (#20/#21) together.
7. **Features:** #24, #40.
