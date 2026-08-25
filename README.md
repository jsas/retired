# RE:tired

Plan your Canadian retirement in minutes. Model CPP, OAS, GIS, pensions, and tax — then run Monte Carlo simulations and historical backtests — all in your browser, privately.

Everything runs **locally in your browser**. Your scenarios are stored in `localStorage` only — nothing is sent to a server.

**[Launch the app](https://jsas.github.io/retired/)** | [GitHub](https://github.com/jsas/retired)

## Why RE:tired?

Most Canadian retirement planners live in Excel spreadsheets or cost hundreds. RE:tired is **free, open-source, and runs entirely on your computer** — no servers, no fees, no data harvesting. Whether you're a couple with DB pensions or self-employed with a TFSA, you can stress-test your plan in minutes.

## What it does

### Input your situation
- **Accounts**: RRSP, RRIF, TFSA, taxable (with ACB), cash cushion
- **Government benefits**: CPP, OAS, GIS (income-tested and tax-aware)
- **Pensions**: defined-benefit and bridge/temporary pensions, per-pension CPI indexing
- **Spending phases**: desired after-tax spending (today's dollars), with optional go-go / slow-go / no-go reductions
- **Spouse**: model a second, independent projection combined into a household verdict

### Get instant feedback
- **Deterministic projection** — year-by-year balances, withdrawals, income tax, CPP / OAS / GIS / pension income from today to your max age
- **Verdict cards** — wealth at retirement, depletion age, withdrawal rate, and **ON TRACK** / **SHORTFALL** status, updated live as you change inputs
- **Tax model** — 2026 federal + provincial brackets, Ontario surtax, Quebec abatement; optional indexation to CPI

### Stress-test your plan
- **Monte Carlo** — randomized return/volatility futures with success-rate bands
- **Historical backtest** — replay your plan against real Canadian return series since 1970
- **One-time flows** — house sale (inflow) or major purchase (outflow)

### Share & save
- Export/import scenarios as JSON
- Shareable links (no server)
- Print a one-page summary

## Quick start

### Installation & development
```bash
npm install
npm run dev
```
Visit http://localhost:5173

### Your first plan (< 2 minutes)
1. **Personal Profile** — age, retirement age, max age, province
2. **Account Balances** — current balances in each account
3. **Contribution Rates** — annual additions until retirement
4. **Government Benefits** — CPP start age & monthly amount; OAS start age & years in Canada
5. **Pensions** (optional) — add a DB or bridge pension
6. **Spending Phases** — desired after-tax spending, with optional later-life reductions

See the verdict cards update live. Run **Monte Carlo** for success probability, or **Backtest** to see how the plan would have fared historically.

## Build

```bash
npm run build          # multi-file site -> dist/        (GitHub Pages, base /retired/)
npm run build:single   # ONE self-contained HTML -> dist-single/  (works from file://)
npm run build:all      # both
```

The single-file build inlines every asset (JS, CSS, favicon) into one HTML file you can open directly from disk or pass around as an attachment.

## Tests

The projection engine and tax/GIS logic are covered by [Vitest](https://vitest.dev):

```bash
npm test           # run the engine/library test suites once
npm run test:watch # re-run on change
```

Tests live beside the code as `src/**/*.test.ts` and run in Node — they gate the CI deploy, so a failing test blocks the site from publishing.

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

## Releasing

Releases are built by GitHub Actions. Push a version tag and the workflow deploys the site to Pages and attaches both build flavours to a GitHub Release:

```bash
git tag -a v0.1.0 -m "..."
git push origin main
git push origin v0.1.0
```

## Limitations & known issues

- Monte Carlo assumes normal distribution of returns; real markets exhibit fat tails
- GIS clawback is simplified to federal rules; provincial variations not yet modeled
- Inflation indexation is approximate for all benefits and tax brackets
- No support for US cross-border or non-resident scenarios

## Acknowledgements

The drawdown engine was originally built on
[retirement_drawdown_simulator_canada](https://github.com/danielabar/retirement_drawdown_simulator_canada)
by **danielabar** — a Canadian retirement stress-tester modelling RRSP / taxable / TFSA
withdrawals with Canadian taxes, CPP/OAS, and RRIF rules. (The upstream repository carried
no LICENSE file at the time it was incorporated, checked 2026-08-23.)

Built with React 19, Vite, TypeScript, Tailwind CSS, and Lucide icons — largely
pair-programmed with an AI assistant.

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

For education and exploration only — estimates only, not financial, tax, or
investment advice. Consult a qualified professional before acting on any projection.
