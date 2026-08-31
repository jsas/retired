# Income & contribution tracking — the full roadmap item in one PR

Roadmap item (quoted): a full income register per person (multiple jobs,
self-employment, rental, pensions, semi-/post-retirement work) with per-source
start/end ages, indexation, and tax character — plus CRA-style RRSP/TFSA/FHSA
room tracking with over-contribution warnings and remaining-room surfaced.

Already shipped: the income register (`income[]`, Phase 1) and RRSP/TFSA room
tracking with accrual + caps + overflow (Phase 2). This PR finishes the item.
Work is five tracks; each is independently testable and lands as its own commit(s).

## T1 — Pre-retirement income (the reported bug)

Income active **before `retirementAge`** currently vanishes: the accumulation loop
computes `preRetIncome` only as the meltdown transfer-tax base — never taxed,
deposited, or reported (`pensionIncome: 0` hardcoded, no `employmentGross/Tax/Net`).

Fix: process employment+pension in the accumulation loop, mirroring decumulation:
- Gross (same window/indexation), marginal tax, `net = gross − tax`.
- Deposit **`savingsRate × net`** into `destAccount ?? 'taxable'` (room-capped);
  pension net → taxable. The rest is assumed consumed.
- New field **`savingsRate?: number`** (0–1) on `IncomeSource`; unset = 100% so
  existing scenarios keep numbers → **golden master byte-identical**.
- Report `employmentGross/Tax/Net` + `pensionIncome` on accumulation rows; earnings
  tax into `incomeTax`/`cumulativeTax`. Table renders these phase-agnostically (no
  display change needed). No double-tax with meltdown transfers (year tax =
  `tax(emp+pen+transfers) − tax(0)`).

## T2 — Full income register (selfEmployment + rental + dead fields)

`selfEmployment` currently only feeds RRSP-room accrual; `rental` is fully dead;
`pensionAdjustment`/`rrspEligible` are engine fields with no UI.
- Derive `employmentList` to include `selfEmployment`; process rental as ordinary
  income in both loops (net, no CCA). Earned kinds deposit to `destAccount`;
  rental/pension net → taxable. Include all in spouse GIS context.
- Sidebar IncomeList: add Self-employment + Rental kinds; add pension-card
  `pensionAdjustment` + eligible inputs.
- tools `propose_income`/`manage_income` descriptions: enumerate all four kinds +
  PA/eligible (schema already accepts them). Help: document all kinds.

## T3 — Tax character (bounded)

`calculateTax` taxes every stream identically as ordinary income. Bounded version:
- **Self-employed CPP both-sides** payroll deduction (config: employee rate,
  self-employed pays 2×, YMPE cap) applied as a pre-tax deduction on earned income.
- **Eligible pension splitting** — per-source eligible flag + **age-65 gating** for
  RRIF/RRSP draws (CRA: split-eligible only from 65); DB pensions stay eligible.
- **Deferred** (note in Help): $2k pension-amount credit, EI premiums, dividend
  gross-up, CCA. These are a separate credit/payroll layer.

## T4 — FHSA (accumulation-only account, RDSP template)

First Home Savings Account. $8k/yr, $40k lifetime, deductible-in (like RRSP),
tax-free-out for a qualifying first home, else taxable transfer to RRSP/RRIF (no
room needed), 15-year lifespan. **Never enters withdrawalOrder** — drained by a
home-purchase event or transferred to RRSP, so no strategies permutation growth.
~35 touchpoints using the RDSP checklist (engine, schema, appConfig, sidebar +
spouse + settings, ScheduleTable/PrintSummary/MathPage, tools `propose_fhsa`,
agentIngest, projectionExport, Help, example scenario, tests). Opt-in, defaults
off → golden master unchanged.

## T5 — Room surfacing (visible UI)

Today overflow/roomRemaining reach only the AI agent's text stream.
- ScheduleTable detail: new "Contribution room" section (overflow + roomRemaining).
- Sidebar contribution section: predicted over-contribution warning + remaining
  room beside the inputs (thread year-1 roomRemaining from the projection).
- Fix the stale "app doesn't track contribution room yet" amber text (room shipped).

## Cross-cutting

- Every engine/lib change ships with Vitest (rule 1); keep `npx vitest run` green.
- Golden master: T1/T2/T4 are opt-in or unset-default → byte-identical; T3's
  self-emp CPP and split gating touch existing decumulation math only when a
  selfEmployment/eligible-flagged source exists (none in fixtures) → byte-identical.
  If any legitimately moves, regenerate in the same commit and say so.
- Each track touches the surfaces that apply (engine/tests/help/tools/sidebar/
  spouse/strategies/interop); stated reason where a surface is skipped.

## Deliberately NOT in this PR (future issues)

- Auto RRSP *starting* room from pre-plan work history (engine already accrues forward).
- Auto CPP entitlement from income history (YMPE accrual model).
- Smart fill-order suggestions (RRSP/TFSA/RDSP/taxable waterfall by tax rate).
- Income-vs-Pension two-section UI restructure + reframing the retirement-age
  slider as drawdown-start.
- $2k pension-amount credit, EI, dividend/CCA (deferred part of tax character).

## Workflow

Update issue #24 (or open a fresh issue referencing it) → this branch → one PR.
Verify: `npx tsc -b` clean, `npx vitest run` green, golden master byte-identical,
`npm run build` succeeds.