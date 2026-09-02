# Plan — Universal Household model (issue #124)

Operate functions on a single, scalable household interface instead of the
legacy flat `RetirementInputs`. Pure refactor: golden master must stay
byte-identical, `RetirementInputs` stays the persisted source of truth.

## Constraint that shapes the design

`RetirementInputs` (primary-at-top-level + nested `spouse`) is the persisted
shape — storage, share links, zod schema, every saved plan, and the whole
write-path (assistant tools, Eq sliders, components) are keyed on it (~40
files). So `Household` is **derived, never stored**: an in-memory view built by
`toHousehold(inputs)` at the entry point, passed down to the engine and the
read-side analysis functions. Mutation sites keep working on `RetirementInputs`;
`fromHousehold` maps a derived household back when a write is needed.

## The model (householdTypes.ts)

```ts
interface Household {
  shared: SharedInputs;      // market, volatility, province, horizon — one per household
  people: Person[];          // 1..N — today [primary, spouse?], tomorrow N
}
interface Person extends PersonInputs {
  ref: PersonRef;            // 'primary' | 'spouse' — transfer endpoints + result keying
  enabled: boolean;          // a stored-but-disabled spouse is carried, not run
}
```

`Person` is `PersonInputs` + the two facts the engine needs that `PersonInputs`
doesn't carry: which household member it is (`ref`, for transfer endpoints and
result keying) and whether it's active (`enabled`, so a disabled spouse round-
trips through storage without being run).

## Tracks

- **T1 — Model + converters.** `Household`/`Person` types, `toHousehold`
  (legacyToPerson + legacyToShared + legacySpouseToPerson, assembled) and
  `fromHousehold` (household → `RetirementInputs`, for the write-path). Round-
  trip tests: `fromHousehold(toHousehold(x))` preserves every field incl. a
  disabled spouse, and `toHousehold` drops nothing.
- **T2 — Engine runs off Household.** `calculateHousehold(household, config,
  opts)`: generalize the primary/spouse pair into `people[]` — the coupling
  loop (GIS + inter-spousal transfers), `applyPensionSplitting`,
  `combineHouseholdBreakdown`, `householdOutcome`. Internally still 2-person
  semantics (GIS couple rates, pension split are 2-person CRA concepts), but
  driven by the array, not two loose variables. Single person = `people: [p]`.
- **T3 — Read-side conversion.** `compareMetrics`, `monteCarlo`, `strategies`,
  `projectionExport`, and the `householdOutcome`/`combineHouseholdBreakdown`
  helpers take `Household` (they currently re-derive it internally each call).
- **T4 — Entry points.** `App.tsx`, `AgentPage`, `ai/tools` derive `Household`
  once via `toHousehold(resolvedInputs)` and pass it down; the spouse-resolution
  adapter (`resolveSpouseSource`) still materializes a concrete spouse into
  `RetirementInputs` first, then derives.

## Out of scope (future PRs)

Migrating the write-path / storage / share-link formats off `RetirementInputs`;
running >2 people (the model allows it, the couple-specific math does not yet).

## Verification

`npx tsc -b` clean · `npx vitest run` green (847 baseline + new round-trip/
household tests) · golden master byte-identical · `npm run build` ok.
