# Roadmap

Where RE:tired is headed, roughly in order of likelihood. Nothing here is a
promise — it's a parking lot for good ideas so issues and chat threads don't
have to hold them.

## Near-term / polish

- **Real vs nominal display toggle** — the engine can run with spending growth
  and table indexation on or off, but the schedule table and charts always
  show the projection's native dollars. A post-hoc "show in today's dollars"
  lens (CPI-deflate the nominal view) would make the two modes comparable at
  a glance.
- **Household tax drill-down on the Math page** — split-transfer flows are
  shown per-person; a combined household worksheet (who transferred what to
  whom, and the net effect) would close the loop.
- **Scenario comparison** — save 2–3 named scenarios and diff their verdict
  cards side by side. Storage and JSON export already exist; this is UI.
- **Preset withdrawal strategies** — one-click orderings ("RRSP meltdown",
  "TFSA last", "proportional") instead of hand-arranging the list.

## Model depth

- **Provincial GIS variations** — GIS clawback is currently the federal
  simplification; some provinces top up or interact differently.
- **Fat-tailed / bootstrapped Monte Carlo** — returns are normal(μ, σ), which
  understates crash clustering. The historical series since 1970 is already
  in the app and could drive a bootstrap sampler.
- **OAS clawback × GIS same-year interaction** — the two are computed
  semi-independently; a joint pass would be more accurate at low incomes.
- **LIF / LRIF minimums and maximums** — distinct from RRIF rules for locked-
  in money; currently modelled as plain RRIF.
- **CPP2 / enhanced CPP accrual** — for users still contributing pre-
  retirement, the enhanced-tier benefit build-up isn't modelled.

## Bigger swings

- **Estate view** — after-tax value to heirs by account type (RRIF fully
  taxed as income at death, TFSA passes free, taxable with a deemed
  disposition). The tax model already has the pieces.
- **Solver mode** — invert the verdict: given a target Monte Carlo success
  rate, solve for the maximum sustainable spending level.
- **Bucket strategies** — cash/bond/equity buckets with rebalancing rules, as
  an alternative to the single blended return assumption.

## Non-goals

Worth stating explicitly so issues don't pile up:

- **US cross-border or non-resident tax** — Canadian residents only.
- **Live CRA table updates** — the app ships with the 2026 tables, all
  editable under Settings; it will never phone home for new ones.
- **Advice** — RE:tired is a calculator, not a planner. It will never
  recommend a course of action, only show consequences of the inputs.
