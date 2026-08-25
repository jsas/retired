# CLAUDE.md

Guidance for AI assistants (Claude Code and others) working in this repo.

## What this is

**RE:tired** — a Canadian retirement drawdown planner. React 19 + Vite 8 +
TypeScript + Tailwind v4 + Lucide. Everything runs client-side; scenarios live
in `localStorage`. Deployed to GitHub Pages from `main`.

- Repo: `jsas/retired` · Pages: https://jsas.github.io/retired/
- Engine: `src/lib/retirementEngine.ts` · tax/GIS/CPP/OAS: `src/lib/canadianTax.ts`

## Commands

```bash
npm run dev            # dev server (http://localhost:5173)
npx vitest run         # run the test suites once  (npm test)
npx tsc --noEmit -p tsconfig.app.json --pretty false   # typecheck
npm run build          # production build -> dist/
```

## Non-negotiable rules

1. **Tests with every engine/lib feature.** Any change to `src/lib/**` ships
   with Vitest coverage in the same PR. Keep `npx vitest run` green before
   committing — CI (`npm test` in `deploy.yml`) blocks the Pages deploy on a
   failing test.
2. **Update the golden master intentionally.** `src/lib/goldenMaster.test.ts`
   locks the engine's numeric output. If a fix legitimately changes results,
   regenerate the golden values in the same commit and say so in the message —
   never let it fail silently.

## Workflow — track every change

This project tracks work as **GitHub Issues + pull requests**, not loose
commits to `main`. Follow this for every non-trivial change:

1. **Issue first.** Each piece of work gets a GitHub Issue describing the
   problem/request. Note the issue number — it anchors the branch, PR and
   cost log.
2. **Branch per issue.** Work on a short-lived branch named
   `issue/<n>-<slug>` (e.g. `issue/42-rm-ltv-clamp`). Never push feature work
   straight to `main`.
3. **PR per branch.** Open a PR titled `<summary> (closes #<n>)` with the
   issue linked so it auto-closes on merge. Squash-merge to keep `main`
   linear.
4. **Log cost.** After merge, record the ticket's token usage and spend in
   `COSTS.md` (see below).

Trivial fixes (typos, one-line tweaks) may commit directly to `main` — but
they still get a line in the log if they consumed a session.

> Note: `gh` CLI is **not installed** in this environment. Create issues and
> PRs via the GitHub web UI or the API (see COSTS.md for what's tracked), and
> paste links/numbers back so they can be recorded.

## Cost tracking

Token usage and dollar spend are tracked **per ticket** in `COSTS.md` at the
repo root. One row per issue/PR:

| Date | Issue/PR | Summary | Session tokens | Est. cost | Model |

- Session token totals come from the Claude Code session stats (`/cost` or
  the session-usage readout) at the end of the ticket's work.
- Record input + output tokens and the estimated dollar cost for the model
  used. Approximate is fine — the goal is per-ticket visibility, not audit
  precision.
- Group multi-session tickets under the same issue number and sum them.

`COSTS.md` is committed to the repo so the spend history travels with the code.

## Conventions

- **Money/ids/types pitfalls** — `Pension.endAge` is a required field (use
  explicit `null`, never omit); RM `startAge`/`durationYears` are
  `number | undefined` (omit them, never pass `null`); province code is
  `'ONT'`, never `'ON'`.
- **Comments match the file's density.** The engine is heavily commented
  (every non-obvious rule gets a why); UI components are sparser. Match the
  surrounding style.
- **Probe technique** — vitest swallows `console.log`; use `console.error` +
  `--reporter=verbose`, or `writeFileSync` to a scratch file, then delete the
  probe. Don't leave probe tests in the suite.
- Commit messages end with `Co-Authored-By: Claude <noreply@anthropic.com>`.
- CRLF line-ending warnings on Windows are normal; don't fight them.

## Repo layout

```
├── src/
│   ├── components/      # SidebarForm, MetricCards, ScheduleTable, TimelineChart,
│   │                    # MonteCarloChart, BacktestPanel, PrintSummary, OptimizeCard…
│   ├── lib/             # retirementEngine, canadianTax, monteCarlo, strategies,
│   │                    # historicalReturns, appConfig, agentIngest, storage…
│   ├── lib/*.test.ts    # Vitest suites (engine, tax, strategies, golden master…)
│   └── test/helpers.ts  # baseInputs(), testConfig(), yearAt(), closeTo()
├── .github/workflows/   # deploy.yml — tests + Pages deploy + tagged releases
├── CLAUDE.md            # this file
├── COSTS.md             # per-ticket token / spend log
├── ROADMAP.md           # planned work + non-goals
└── README.md
```

## Product guardrails

- **Calculator, not a planner** — show consequences of inputs, never advise a
  course of action (see ROADMAP.md non-goals).
- Canadian residents only; no US cross-border or non-resident tax.
- Tax tables ship with the app (2026) and are user-editable in Settings —
  never fetch them live.
