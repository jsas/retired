# Active tasks

Working list. One file per initiative; this index points at what's in flight and
what's queued. When an initiative's acceptance criteria are met, move its plan
file to `tasks/completed/` and strike it here. GitHub issues remain the source
of truth for user-facing bugs/features (`gh issue list`); this file tracks the
execution plans.

## In flight

| Task | Record | State |
|------|--------|-------|
| Income & contribution tracking | `tasks/PLAN-income-contribution-tracking.md` | T1–T4 shipped (verified in code); **T5 remainder**: over-contribution warning + remaining-room beside the contribution inputs (DetailsPage), ScheduleTable room section exists already. Issue #24 closed. |
| ML fine-tune bake-off (#112, #135) | `training/SPIKE.md` §5 | Corpus/gate/bake-off machinery on main. First task: fix `training/driver/cdp.mjs` `callFn` (`Runtime.callFunctionOn` needs `executionContextId`). Then bake-off → full-SFT winner → MLC compile (own issue/PR). GPU-bound stages annotated in the issue. |

## Queued (from tasks/REVIEW.md "Still open")

| ID | What | Next step |
|----|------|-----------|
| E-MC-01 | Test gap: `simulate()` (monteCarlo.ts) has no direct test; #33 asked for a couple regression where the primary silo depletes but the household survives, verdict agreeing with `runMonteCarlo()`. | Add the couple test in `packages/engine-core/src/monteCarlo.test.ts`. |
| H-02 | Backtest is primary-only by construction (spouse stripped in historicalReturns.ts); panel doesn't say so. | Cheapest: label BacktestPanel "primary plan only". Plan: `tasks/PLANS.md` H-02. |

## Closed records

- `tasks/PLANS.md` — all 22 plans burned down except H-02 (queued above).
- `tasks/REVIEW.md` — review ledger; "Still open" mirrors the Queued table here.
- `tasks/completed/PLAN-universal-household.md` — issue #124, closed.
- `tasks/PLAN-income-contribution-tracking.md` — moves to `completed/` when the
  T5 remainder lands.
