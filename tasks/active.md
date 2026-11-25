# Active tasks

Working list. One file per initiative; this index points at what's in flight and
what's queued. When an initiative's acceptance criteria are met, move its plan
file to `tasks/completed/` and strike it here. GitHub issues remain the source
of truth for user-facing bugs/features (`gh issue list`); this file tracks the
execution plans.

## In flight

| Task | Record | State |
|------|--------|-------|
| Holistic site pass: no intro screen, Dashboard as home | `tasks/TASKS.md` | Running ledger (`S` simplify · `B` bugs · `C` consistency · `R` recommendations). Everything is closed except `C3`: the raw checkboxes/radios, the chart hexes, `NUM_CLASS`, the dead `TEXT`, `HelpModal`'s English fallback and the duplicated dot-and-label rows are gone, but the hand-typed button and field recipes (`cls.primaryBtn` / `cls.hairlineBtn` / `cls.input`) are unmoved and need a page-by-page pass against the StyleGuide. |
| ML fine-tune bake-off (#112, #135) | `training/SPIKE.md` §5 | Corpus/gate/bake-off machinery on main, and the `training/driver/cdp.mjs` `callFn` blocker (`Runtime.callFunctionOn` needs `executionContextId`) is fixed. Next: bake-off → full-SFT winner → MLC compile (own issue/PR). GPU-bound stages annotated in the issue. |

## Queued (from tasks/REVIEW.md "Still open")

Nothing queued. E-MC-01 (the `simulate()` couple regression) and H-02 (labelling
the backtest “primary plan only”) both landed 2026-11-24; the records stay in
`tasks/REVIEW.md` and `tasks/PLANS.md`.

## Closed records

- `tasks/PLANS.md` — all 22 plans burned down, H-02 included (2026-11-24).
- `tasks/REVIEW.md` — review ledger; "Still open" mirrors the Queued table here.
- `tasks/completed/PLAN-universal-household.md` — issue #124, closed.
- `tasks/completed/PLAN-income-contribution-tracking.md` — roadmap item closed
  2026-11-24: T1–T5, including the year-1 room hints and the over-contribution
  warning beside the contribution inputs.
