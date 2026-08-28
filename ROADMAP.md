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
- **Preset withdrawal strategies** — one-click orderings ("RRSP meltdown",
  "TFSA last", "proportional") instead of hand-arranging the list.

## Income & contribution tracking

- **Full income model per profile** — today's employment income is a single
  pre-retirement stream; expand it into a full-featured register of income
  sources per person (multiple jobs, self-employment, rental, pensions,
  semi-/post-retirement work) with per-source start/end ages, indexation,
  and tax character (T4, self-employed, eligible vs other income).
- **RRSP / TFSA room tracking** — per profile, carry forward CRA-style
  contribution room: RRSP limit accrual (18% of earned income, pension
  adjustments, unused carry-forward), TFSA annual accrual from eligibility
  year with re-contribution of withdrawals landing next year, and FHSA.
  Warn on over-contribution; surface remaining room beside the contribution
  inputs so the projection's savings flows respect real limits. Needs the
  income model above to compute RRSP accrual honestly.

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
- **Bucket strategies** — cash/bond/equity buckets with rebalancing rules, as
  an alternative to the single blended return assumption.

## Architecture

- **Monorepo split: engine package + UI package.** Everything under `src/lib`
  that is pure TypeScript with no DOM/React dependency (the projection
  engine, tax tables, Monte Carlo, backtest, EQ/spending solvers, household
  types, scenario/config schema) graduates into a standalone Node.js library
  package — e.g. `@retired/engine` — with its own test suite, published or
  linked into the app. The React UI becomes its own package in the same
  monorepo (pnpm/npm workspaces) and consumes the engine only through its
  public API. This is what makes the engine usable from a CLI, a server, or
  a future self-contained desktop build, and it forces the data layer
  (scenarios, config, migrations) to be platform-neutral: the storage
  interface the UI backs with localStorage today is the same interface a
  Node consumer backs with SQLite/a file later.
- **Embedded AI agent (savvy users)** — graduate the paste-based agent
  prompts (`agentIngest.ts`, `agentQA.ts`) into an in-app chat that talks
  to the user's own model provider: a provider array (Anthropic, OpenAI,
  Gemini, OpenRouter, Ollama/local, OpenAI-compatible endpoints) with
  per-provider API keys and model choices stored in the local DB
  (OPFS/sql.js, keyed, never synced anywhere). Ship a starter prompt
  library built on the existing QA presets, user-editable and saved per
  scenario. Headline flow: **scenario onboarding** — a blank plan starts
  with "tell me about your situation," the agent interviews the user in
  plain language (ages, accounts, income, target retirement age) and
  drafts a complete scenario for review, so new users never face an empty
  form.
- **Local agent API with tool calling** — expose the app to the agent
  through a typed tool surface instead of pasted JSON: Zod schemas define
  every callable (`getScenario`, `setScenarioValue`, `runProjection`,
  `runMonteCarlo`, `explainYear`, `compareScenarios`, …), so the model can
  read the current scenario, ask the engine questions, and propose changes
  that validate against the same schemas the data layer already uses —
  with a confirm-before-apply step so nothing mutates the plan silently.
  For onboarding, a `createScenario` tool assembles a full inputs object
  from the interview and renders it as a reviewable diff — the user sees
  every proposed value before it's saved, and can correct the agent
  conversationally ("no, the RRSP is in my spouse's name") until it's
  right.
  Keys and tool definitions live client-side; the app stays serverless and
  the feature is fully optional (no key, no AI). The engine-package split
  above is what makes this honest — the tools call the same public engine
  API the UI does.
- **Data layer hardening (underway)** — Zod schemas now define every
  persisted shape (`src/data/schemas.ts`), and all plan state lives in a
  real SQLite database via sql.js (`src/data/db.ts`), persisted to OPFS
  (origin-private file system — no 5 MB ceiling, mirrored to localStorage
  for compatibility) and exportable as a .sqlite file. The app is
  single-tab by design (see Non-goals). Remaining: a Node SQLite backend
  behind the same store interface for the engine package, moving the DB
  onto a worker with the synchronous OPFS VFS for incremental (not
  whole-file) writes, and folding UI-preference keys (print options,
  panel collapse state, …) into the store's `kv` table.

## Non-goals

Worth stating explicitly so issues don't pile up:

- **US cross-border or non-resident tax** — Canadian residents only.
- **Live CRA table updates** — the app ships with the 2026 tables, all
  editable under Settings; it will never phone home for new ones.
- **Advice** — RE:tired is a calculator, not a planner. It will never
  recommend a course of action, only show consequences of the inputs. This
  also governs the AI features: the app supplies data and tools, and any
  third-party model the user connects speaks for itself — RE:tired presents
  agent output as the model's words, never as the app's recommendation.
- **Bundled AI / first-party inference** — the app will never ship its own
  model, host inference, or proxy keys. AI is strictly bring-your-own-key,
  off by default, and degrades to nothing when unconfigured.
- **Multi-tab / multi-window use** — one tab at a time. Two open tabs
  each hold their own in-memory copy and the last Save silently wins;
  coordinating them (merging, locking, live sync) is more complexity
  than a local-first calculator is worth. A storage-event sync was
  tried and reverted for exactly that reason.
