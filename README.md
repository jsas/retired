# RE: tired

A Canadian retirement drawdown planner in a GCP-console-style React UI.
Model your RRSP / RRIF / TFSA / taxable / cash accounts, CPP / OAS / GIS, and
defined-benefit & bridge pensions — then stress-test the plan with a Monte Carlo
simulation and a historical backtest.

Everything runs **locally in your browser**. Your scenarios are stored in
`localStorage` only — nothing is sent to a server.

**Live app:** https://jsas.github.io/retired/

## What it does

- **Deterministic projection** — year-by-year balances, withdrawals, income tax,
  cumulative tax burden, CPP / OAS / GIS / pension income, from today to your max age.
- **Accounts** — RRSP, RRIF (with mandatory minimums + forced conversion age),
  TFSA, taxable (with ACB and capital-gains inclusion), and a cash cushion.
- **Government benefits** — CPP (early/deferral adjustments applied automatically),
  OAS (deferral, age-75 bump, clawback), and GIS (income-tested, tax-free).
- **Pensions** — defined-benefit and bridge/temporary pensions, per-pension CPI
  indexing, spouse-aware. Pension income is taxed and claws back GIS/OAS.
- **Spending** — desired spending in today's dollars, optional go-go / slow-go /
  no-go phases, one-time inflows (house sale) and outflows (big purchase).
- **Spouse plan** — a second, independent projection combined into a household verdict.
- **Monte Carlo** — randomized return/volatility futures with success-rate bands.
- **Historical backtest** — replays the plan against real Canadian return series
  since 1970.
- **Tax model** — 2026 federal + provincial brackets, Ontario surtax, Quebec
  abatement; optional indexation of brackets/benefits to CPI.
- **Share** — export/import scenarios as JSON or a shareable link; print a
  one-page summary.

## Getting started

```bash
npm install
npm run dev
```

Visit http://localhost:5173

### A quick first plan

1. **Personal Profile** — your current age, retirement age, max age, province.
2. **Account Balances** — what you have today in each account.
3. **Contribution Rates** — what you'll add per year until retirement.
4. **Government Benefits** — CPP monthly amount at 65 + start age; OAS start age
   and years in Canada.
5. **Pensions** (optional) — add a DB or bridge pension.
6. **Spending Phases** — desired after-tax spending (today's dollars), with
   optional later-life reductions.

The verdict cards update live: wealth at retirement, depletion age, withdrawal
rate, and an ON TRACK / SHORTFALL status. Run **Monte Carlo** for the success
probability, or the **backtest** to see how the plan would have fared historically.

## Build

```bash
npm run build          # multi-file site -> dist/        (GitHub Pages, base /retired/)
npm run build:single   # ONE self-contained HTML -> dist-single/  (works from file://)
npm run build:all      # both
```

The single-file build inlines every asset (JS, CSS, favicon) into one HTML file
you can open directly from disk or pass around as an attachment.

## Tests

The projection engine and tax/GIS logic are covered by [Vitest](https://vitest.dev):

```bash
npm test           # run the engine/library test suites once
npm run test:watch # re-run on change
```

Tests live beside the code as `src/**/*.test.ts` and run in Node — they gate the
CI deploy, so a failing test blocks the site from publishing.

## Releasing

Releases are built by GitHub Actions. Push a version tag and the workflow deploys
the site to Pages and attaches both build flavours to a GitHub Release:

```bash
git tag -a v0.1.0 -m "..."
git push origin main
git push origin v0.1.0
```

## Project structure

```
├── src/
│   ├── components/      # TopHeader, SidebarForm, MetricCards, ScheduleTable,
│   │                    # MonteCarloChart, BacktestPanel, PrintSummary, Help/Settings…
│   ├── lib/
│   │   ├── retirementEngine.ts   # the drawdown engine
│   │   ├── canadianTax.ts        # 2026 federal + provincial tax, CPP/OAS/GIS/RRIF
│   │   ├── monteCarlo.ts         # Monte Carlo simulation
│   │   ├── historicalReturns.ts  # backtest return series
│   │   ├── appConfig.ts          # tax tables + engine config (editable in Settings)
│   │   └── …                     # scenario storage, share links, agent ingest
│   ├── lib/*.test.ts             # Vitest suites for the engine, tax/GIS, strategies, storage
│   ├── test/helpers.ts           # shared fixtures (base inputs, test config)
│   ├── App.tsx
│   └── main.tsx
├── .github/workflows/deploy.yml  # tests + Pages deploy + tagged releases
└── vite.config.ts                # multi-file (/retired/) vs single-file builds
```

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

The drawdown engine was originally built on
[retirement_drawdown_simulator_canada](https://github.com/danielabar/retirement_drawdown_simulator_canada)
by **danielabar** — a Canadian retirement stress-tester modelling RRSP / taxable / TFSA
withdrawals with Canadian taxes, CPP/OAS, and RRIF rules. (The upstream repository carried
no LICENSE file at the time it was incorporated, checked 2026-08-23.)

Built with React 19, Vite, TypeScript, Tailwind CSS, and Lucide icons — largely
pair-programmed with an AI assistant.

## Disclaimer

For education and exploration only — estimates only, not financial, tax, or
investment advice. Consult a qualified professional before acting on any projection.
