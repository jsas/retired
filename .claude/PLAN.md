# Plan: friend-feedback fixes + RDSP support

**Worktree:** `.claude/worktrees/friend-feedback-rdsp` (branched off `origin/main` tip, isolated from active work on other branches)
**Baseline:** 672 tests / 42 files green before any change.

## Scope (4 items from friend's feedback + RDSP feature)

1. **"Tax stops at a certain age" — investigate + regression test**
2. **Total-tax visibility** (so the perception in #1 can't recur)
3. **HELOC mode** for the home-equity feature (interest as an annual expense)
4. **RDSP account** (Registered Disability Savings Plan) with grants/bonds/DTC rules

---

## Item 1 — Tax continuity regression test

The engine never actually stops charging tax (verified by reading the decumulation loop: `incomeTax` is computed every year to `maxAge`; `calculateTax` is age-blind). The friend's perception almost certainly comes from the **"Income Tax" column showing incremental tax on withdrawals only**, which legitimately hits $0 once the portfolio is drained or benefits fall below the basic personal amount.

**Change:** add a `describe('tax continuity through maxAge')` block to `retirementEngine.test.ts` asserting:
- CPP+OAS alone (no portfolio) → `taxOnBenefits > 0` every year through `maxAge`.
- A funded RRIF → `withdraw.rrifMin > 0` and `incomeTax > 0` each year from 71 while the RRIF has money.
- The `maxAge` year itself computes a real tax number (year isn't skipped).

**Files:** `src/lib/retirementEngine.test.ts` (test-only).

## Item 2 — Total-tax visibility (UX)

`YearlyBreakdown.incomeTax` is *incremental tax on withdrawals* (`tax(total) − tax(benefits) + clawback`). When it reads $0 late in life it looks like taxation ended. Expose the full-year tax burden.

**Change:**
- Compute `totalTaxYear = calculateTax(totalNetIncome).totalTax + oasClawback` and store on each decumulation row as `YearlyBreakdown.totalTaxPaid` (optional field; pension-split post-pass already recomputes from `totalNetIncome`, so it picks it up via the same path).
- Household combiner: `totalTaxPaid` sums like `incomeTax`.
- `ScheduleTable`: add a "Total Tax" column next to "Income Tax" (title explains the difference), plus a line in the drill-down's Tax section.
- `MathPage` step 8: add a line showing total tax on all income (benefits + withdrawals + clawback) alongside the existing incremental figure.

**Files:** `retirementEngine.ts`, `ScheduleTable.tsx`, `MathPage.tsx`, `projectionExport.ts` (add to `tax` column group), `retirementEngine.test.ts`.

## Item 3 — HELOC mode

Today `ReverseMortgage` compounds interest into the loan and hard-clamps the balance at `maxLtv × homeValue` (the RM "no negative equity guarantee"). A HELOC instead requires **interest to be paid annually** (cash-flow requirement) and has **no negative-equity guarantee**.

**Change:**
- Add `mode?: 'reverse' | 'heloc'` to `ReverseMortgage` (default `'reverse'` → existing behaviour, back-compat).
- In the engine (`rmAccrue` / decumulation + accumulation RM blocks): in `heloc` mode
  - the year's interest (`loan × interestRate`) is added to `yearSpending` (an annual cash-flow expense, alongside event outflows) instead of compounding into the loan;
  - the balance is **not** clamped at the LTV ceiling (no negative-equity guarantee) — net equity may go negative; draws are still gated by headroom.
- Sidebar (`rmortgage` section): a mode selector (Reverse mortgage / HELOC). Help text: RM "interest compounds into the loan, typically capped ~55%"; HELOC "interest is paid annually (added to your expenses), typically up to ~65%". When mode=heloc and maxLtv untouched (still the 0.55 default), set 0.65.
- Schema: `mode` optional enum on `reverseMortgageSchema`.
- HelpModal: extend the Reverse Mortgage glossary entry to cover HELOC mode.
- Tests: heloc interest shows up in `spendingTarget`, loan doesn't grow from interest, equity can go negative; reverse mode unchanged.

**Files:** `retirementEngine.ts`, `householdTypes.ts` (type passthrough only), `schemas.ts`, `SidebarForm.tsx`, `HelpModal.tsx`, `retirementEngine.test.ts`, `schemas.test.ts`.

## Item 4 — RDSP account

New registered account per the canada.ca page you provided ("Put money into an RDSP", dated 2023-05-11) plus standard CDSG/CDSB rules. All indexed parameters go in the user-editable config (source-date noted) rather than hardcoded.

**Model (per person, off by default):**
- `rdsp?: RdspInputs` on `PersonInputs`/`SpouseInputs`/`RetirementInputs`: `{ enabled, dtcEligible, rdspBalance, contribution (annual $/yr), familyIncome (for grant/bond banding), grantsBondsBalance (tracking) }`.
- **Accumulation:** annual contribution (≤59, DTC, ≤$200k lifetime) + **CDSG** (300% on first $500 + 200% on next $1,000 = up to $3,500/yr if income ≤ threshold; else 100% on first $1,000 = $1,000; capped $70k lifetime, paid ≤49) + **CDSB** ($1,000/yr if income ≤ lower threshold, phasing to $0 at upper; ≤49, no contribution needed). Growth tax-sheltered.
- **Decumulation:** withdrawals fund spending in the withdrawal order; the taxable portion = grant/bond/growth fraction (contributions tax-free), stacked for marginal tax like registered draws. (AHA 10-yr clawback is noted in help text but not modelled — out of scope for a projection.)
- New withdrawal-order id `'rdsp'`; UI places it in the order list.

**Config (`RdspConfig` on `AppConfig`, new Settings tab "RDSP")** — 2026 values from canada.ca "How much you could get in grants and bonds" (dated 2026-07-10, provided by user):
- `grantThreshold` = 117045 (≤ → 300% on first $500 + 200% on next $1,000 = $3,500 max; > → 100% on first $1,000 = $1,000 max)
- `bondThresholdLower` = 38237 (≤ → full $1,000), `bondThresholdUpper` = 58523 (≥ → $0; linear phase-out between)
- `grantAnnualMax` 3500, `grantLifetimeMax` 70000, `bondAnnualMax` 1000, `bondLifetimeMax` 20000, `contributionLifetimeMax` 200000, `grantEndAge` 49, `contributionEndAge` 59
- Family income = beneficiary's own + spouse's income (19+ rule); we use current-year income as the simplification (real rule: the tax return from 2 years prior). Carry-forward ($10,500/yr grant, $11,000 bond at open) is **not modelled** — noted in help text.
- `validateAppConfig` back-fills these defaults for old configs.

**UI:**
- `SidebarForm`: new "RDSP" collapsible section (enable/DTC checkbox, balance, contribution/yr, family income) — the "section for RDSP in contributions" the user asked for; mirrored in the spouse section via parity.
- `SettingsModal`: new 'rdsp' section (tab) editing the config numbers above.
- `ScheduleTable`: RDSP balance column + drill-down lines (grant, bond, taxable portion).
- `MathPage`: RDSP grant/bond and withdrawal-tax steps.
- `projectionExport`: RDSP balance + grant/bond in `balances`/`benefits` groups; taxable portion in `tax`.
- `HelpModal`: new RDSP glossary entry (what it is, DTC requirement, grant/bond, contribution/age limits, withdrawal tax); note that AHA clawback and carry-forward are not modelled.

**Schema/migrations:** `rdspSchema` on `retirementInputsSchema` + `spouseSchema`; `migrateInputs` back-fills `rdsp` absent (feature off). `householdTypes` converters pass it through (parity with reverseMortgage).

**Tests (`retirementEngine.test.ts` + `canadianTax.test.ts`/`schemas.test.ts` as fits):** grant matching at both income bands; bond at/below/above thresholds; lifetime caps; age cutoffs (49 grants, 59 contributions); contributions tax-free on withdrawal while grant/bond/growth portion is taxed; withdrawal-order integration; household summing.

**Files:** `retirementEngine.ts`, `householdTypes.ts`, `canadianTax.ts` (RDSP grant/bond calc helpers), `appConfig.ts` (+`RdspConfig`, defaults, validate), `schemas.ts`, `scenarioStorage.ts` (migrate), `SidebarForm.tsx`, `SettingsModal.tsx`, `ScheduleTable.tsx`, `MathPage.tsx`, `projectionExport.ts`, `HelpModal.tsx`, test files.

---

## Execution order

1. Item 1 (test-only) → run vitest.
2. Item 2 (total tax) → run vitest.
3. Item 3 (HELOC) → run vitest.
4. Item 4 (RDSP) → run vitest.
5. `npx vitest run` fully green, then `tsc`/build check, then commit on the worktree branch.

Each item is a separable commit on `worktree-friend-feedback-rdsp`. Tests added alongside every feature per project convention.

## Verification

- `npx vitest run` green after each item (672 baseline + new tests).
- `npx tsc --noEmit` (or `npm run build`) for type errors across the touched files.
- RDSP grant/bond numbers hand-checked against the canada.ca figures (noted source date in config comments; indexed values are user-editable).

## Golden-master & existing-test impact

`goldenMaster.test.ts` locks a per-year tuple `[age, starting, ending, withdrawals, incomeTax, cpp, oas, gis, pension]` + `lifetimeTax` over a rich fixture that uses a **reverse mortgage with no `mode`** (→ defaults to `'reverse'`) and **no RDSP**. So:
- Item 1 (test-only), Item 2 (new optional field, not in the locked tuple), Item 3 (reverse mode = unchanged behaviour), Item 4 (RDSP off in fixture) → **golden master should stay green with no regeneration.** I'll assert this after each item rather than assume it; if Item 2's new field or any RDSP plumbing perturbs the fixture's numbers, I'll investigate rather than blindly regenerate.
- Existing test files needing additive updates: `schemas.test.ts`, `scenarioStorage.test.ts`, `householdTypes.test.ts`, `projectionExport.test.ts` (new optional fields); `engineMath.test.ts`/`canadianTax.test.ts` (RDSP grant/bond helpers); `retirementEngine.test.ts` (new describe blocks). None should require changing existing assertions.

## Notes / assumptions (resolved)

- **Thresholds:** exact 2026 figures pulled from the user-supplied canada.ca "How much you could get" page (dated 2026-07-10). Seeded in config, user-editable.
- **AHA clawback** ($3 per $1 within 10 yrs) — user chose to **leave it out** and note it in help text.
- **Carry-forward** of unused grant/bond (10-yr window) — also left out, noted in help text.
