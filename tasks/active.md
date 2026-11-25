# Active tasks

Working list. One file per initiative; this index points at what's in flight and
what's queued. When an initiative's acceptance criteria are met, move its plan
file to `tasks/completed/` and strike it here. GitHub issues remain the source
of truth for user-facing bugs/features (`gh issue list`); this file tracks the
execution plans.

## In flight

Nothing in flight. The holistic site pass closed 2026-11-25 with `C3` (the
hand-typed button, field, panel and badge recipes routed through `cls`); its
burn-down is the last record below. The next initiative opens its own file here.
| ML fine-tune bake-off (#112, #135) | `training/SPIKE.md` §5 | Corpus/gate/bake-off machinery on main, and the `training/driver/cdp.mjs` `callFn` blocker (`Runtime.callFunctionOn` needs `executionContextId`) is fixed. Next: bake-off → full-SFT winner → MLC compile (own issue/PR). GPU-bound stages annotated in the issue. |

## Queued (from tasks/REVIEW.md "Still open")

Nothing queued. E-MC-01 (the `simulate()` couple regression) and H-02 (labelling
the backtest “primary plan only”) both landed 2026-11-24; the records stay in
`tasks/REVIEW.md` and `tasks/PLANS.md`.

## Closed records

- `tasks/completed/TASKS-holistic-site-pass.md` — the holistic site pass
  (2026-11-18 → 2026-11-25): `S` simplify, `B` bugs, `C` consistency and `R`
  recommendations, 34 items, all closed. `C3` was the last: 114 hand-typed
  button / field / panel / badge call-sites across 14 files now read from the
  `cls` tokens, and the sites that stay literal are listed there with reasons.
- `tasks/PLANS.md` — all 22 plans burned down, H-02 included (2026-11-24).
- `tasks/REVIEW.md` — review ledger; "Still open" mirrors the Queued table here.
- `tasks/completed/PLAN-universal-household.md` — issue #124, closed.
- `tasks/completed/PLAN-income-contribution-tracking.md` — roadmap item closed
  2026-11-24: T1–T5, including the year-1 room hints and the over-contribution
  warning beside the contribution inputs.
