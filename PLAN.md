# WealthConsole — Roadmap to Fully Featured

Living document. **Update this file every time a task is completed** (check the box, note the date and anything notable) and whenever scope changes.

Legend: ⬜ pending · 🔶 in progress · ✅ done

---

## Status board

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 25 | Inflation indexing (CPI on spending + optional bracket indexing) | ✅ | done 2026-08-23 — engine.inflationRate (default 2%) + indexTaxTables toggle; spending in today's $, per-year Spending Target column; verdict/withdrawal-rate use retirement-year $; 16/16 smoke |
| 26 | CPP early/deferral calculator (0.6% / 0.7% per month) | ✅ | done 2026-08-23 — cppMonthlyAmount is now the age-65 amount; engine applies adjustment (config.cpp); cppAdjustedAmount flag preserves legacy scenarios; Settings → CPP tab |
| 27 | Taxable-account capital gains (ACB tracking, 50% inclusion) | ✅ | done 2026-08-23 — ACB tracked (contributions/redeposits raise it, growth doesn't); engine.taxableAcbRatio + capitalGainsInclusion; Settings → Capital Gains tab; found+fixed takeHome-vs-totalTax gross-up bug; 15/15 smoke |
| 28 | Quebec abatement + Ontario surtax | ✅ | done 2026-08-23 — qcFederalAbatement 16.5%, ON surtax 20%/56% above 2026 thresholds 5925/7577 (2025×1.02); both editable in Settings → Provincial Tax; 7/7 smoke |
| 29 | Spousal scenarios + pension income splitting | ✅ | done 2026-08-23 — phase 1: independent spouse engine run (own ages/balances/CPP/OAS/spending) combined into household verdict (SHORTFALL if either fails); MetricCards show household + per-person detail; sidebar Spouse section; Help docs. ALSO fixed verdict 25× rule to net out OAS+CPP (was adding OAS to the requirement). Income splitting not yet modelled (documented). 12/12 + 4/4 smoke |
| 30 | GIS modeling for low-income plans | ✅ | done 2026-08-23 — gisAnnual (single pensioner, 50¢/$ on non-OAS income, tax-free, reduces need); oas.gisMaxAnnualSingle/gisReductionRate in config+Settings; GIS column in table+CSV; 8/8 smoke |
| 31 | One-time cash events (house sale, inheritance, big purchase) | ✅ | done 2026-08-23 — inputs.events {age,label,amount,direction,account}; sidebar editor; inflow lands at start of year, outflow adds to spending target |
| 32 | Spending phases (go-go / slow-go / no-go) | ✅ | done 2026-08-23 — inputs.spendingBands {fromAge,pctOfBase}; sidebar editor; verdict uses retirement-year spending |
| 33 | Historical-sequence backtesting | ✅ | done 2026-08-23 — historicalReturns.ts: embedded Canadian real-return series 1970–2024 (55 yrs); runBacktest rolls every window of plan horizon via engine returnSequence (inflation off); BacktestPanel with success rate / worst / median / best + per-window bar chart; Backtest button in top bar; Help → Backtest tab; 15/15 smoke |
| 34 | PDF / shareable-link plan export | ✅ | done 2026-08-23 — shareLink.ts base64url #plan= codec (no server, fragment stays local); App imports hash as a "Shared plan" scenario once; PrintSummary one-page print view + @media print stylesheet (app shell hidden); Share link + Print summary buttons in breadcrumb; Help → Data docs; 5/5 smoke |
| 35 | Graphical timeline — drag-adjust inputs on projection chart | ✅ | done 2026-08-23 — TimelineChart above the table: drag retirement marker (age), spending handles (desiredSpending / band pct), event diamonds (age+amount); writes through onChange → live re-sim, unsaved until Save |
| 36 | Fix CPP monthly input cap (max=1500 blocks deferred CPP > $1,500) | ✅ | done 2026-08-23 — removed `max` attr; superseded by #26 |
| 37 | Collapsible sidebar sections (Personal Profile, Accounts, etc.) | ✅ | done 2026-08-23 — CollapsibleSection component (chevron rotates, hover row, GCP look); all 9 sidebar sections collapsible; Personal Profile + Account Balances open by default; state in component |
| 38 | Real total-return historical series (replace stylized data) | ✅ | done 2026-08-23 — historicalReturns.ts now uses actual S&P/TSX price returns + 3.0% avg dividend (60%) and a GoC long-bond series reconstructed from StatCan V122515 yields (40%), deflated by StatCan CPI, 1970–2024; build.historical.mjs regenerates the block; Help + panel caption updated; 11/11 smoke |
| 39 | Fix hidden spending target / 0% phase misleading UI | ✅ | done 2026-08-23 — Spending Phases base row now shows the desired-spending $/yr (was hidden behind "100%"); each band shows its computed $ amount ("53 + 0% = $0") so a zeroed phase is visible instead of silently zeroing spending/withdrawals |
| 40 | Independently collapsible projection graph + projection number | ✅ | done 2026-08-23 — CollapsiblePanel component (light theme, rotating chevron, GCP look) wrapping Projection Summary (MetricCards), Projection Timeline (TimelineChart) and Year-by-Year table (ScheduleTable) independently; open/closed persisted per-panel to localStorage `wealthconsole_panel_state` |
| 41 | Rename app to "RE: tired" + set page title | ✅ | done 2026-08-23 — display name "RE: tired" (TopHeader logo "RE:", PrintSummary, appDb import error); index.html title "RE: tired — Canadian Retirement Planner". localStorage keys + export filenames left as `wealthconsole_*` to preserve existing user data |
| 42 | Help & Settings as full pages; clickable Dashboard home | ✅ | done 2026-08-23 — App view router ('projection' | 'settings' | 'help'); SettingsModal/HelpModal converted from fixed overlay to inline pages (onClose removed, Settings saves in place); sidebar + projection panels render only on projection view; "Dashboard" breadcrumb is a button returning to projection |
| 43 | Move Desired Spending into Spending Phases | ✅ | done 2026-08-23 — removed from Contribution Rates; now the top input of Spending Phases driving the base row + band $ amounts; Help Inputs tab updated |
| 44 | Share link as closable card on main page | ✅ | done 2026-08-23 — ShareCard component (selectable link field + Copy button + localhost warning); replaces the window.alert placeholder; Help → Share link rewritten to explain the no-server caveat |
| 45 | Keep sidebar visible on Help & Settings pages | ✅ | done 2026-08-23 — removed the view==='projection' gate around SidebarForm so it renders across all three views |
| 46 | Deterministic Strategy Explorer + suggested actions | ✅ | done 2026-08-23 — lib/strategies.ts: CPP 60/65/70, OAS 65/70, 6 withdrawal orders + combined defer-to-70 vs baseline; binary-search sustainable spending per strategy; OptimizeCard Strategy Explorer tab (table + suggested actions + per-row Apply); Optimize button in breadcrumb |
| 47 | AI agent prompt + structured paste-back ingest | ✅ | done 2026-08-23 — lib/agentIngest.ts: buildAgentPrompt (plan JSON + lever/range docs + strict JSON schema) and parseAgentResult (field whitelist, range checks, code-fence stripping, per-field applied/warnings/error); OptimizeCard "Ask an AI" tab (copy prompt + paste-back Validate/Apply). 26/26 combined smoke |
| 48 | Getting-started welcome section + General settings tab | ✅ | done 2026-08-23 — WelcomeCard (3-step workflow + local-only data notice, dismiss persists to panel-state store); App.tsx shows it until dismissed or when the toggle is on; new config.general.showWelcomeOnLoad (back-filled in validateAppConfig); SettingsModal "General" tab with help blurb + "show welcome on load" checkbox. 5/5 smoke |
| 49 | Print-options card with optional summary sections | ✅ | done 2026-08-23 — lib/printOptions.ts (persisted toggles in panel-state store); PrintOptionsCard (timeline/MC/milestones checkboxes + Print button, blocks until MC worker finishes); PrintSummary rewritten: optional static-SVG timeline chart (household balance + retire marker), Monte Carlo fan chart (500-run worker in App.tsx, bands + success rate), milestones table (retirement, CPP/OAS start, RRIF conversion, spending-phase changes, one-time events, age-sorted). 11/11 smoke |
| 50 | Legal: disclaimer + MIT license + upstream credit | ✅ | done 2026-08-23 — LICENSE (MIT) at repo root + package.json license field + README license/credits/disclaimer; WelcomeCard disclaimer footer ("estimates only — not financial advice… consult a qualified professional"); HelpModal new "License & Legal" tab: full disclaimer (model omissions, stale tables, no warranty, at-your-own-risk), MIT summary linking to LICENSE, credit to danielabar/retirement_drawdown_simulator_canada noting upstream has no LICENSE file (checked 2026-08-23) |
| 51 | Help page: single scroll, TOC, search + full MIT text | ✅ | done 2026-08-23 — HelpModal rewritten: content as data (8 sections × {term, body} entries), tabs removed; TOC with anchor links + per-section match counts; search box filters entries by heading/body text (case-insensitive substring via textOf) and wraps matches in <mark>; "no matches" empty state; License & Legal ends with full MIT text in a <pre>; 13/13 smoke (LICENSE file shape, MIT fragments in help, TOC/search wiring, unique section ids) |
| 52 | Share link: drop localhost warning, use current host | ✅ | done 2026-08-23 — removed isLocal regex + amber warning box from ShareCard; explainer now states the link uses the current host:port/path and works for anyone who can reach the same address (hosted deployment, LAN IP, or this machine); Help share-link entry reworded the same way. buildShareUrl already used location.origin+pathname — no logic change needed |
| 53 | Branding fixes + welcome-card dismiss bug | ✅ | done 2026-08-23 — TopHeader brand lockup = blue "RE:" chip + "tired" (no double RE:); public/favicon.svg replaced (purple Vite lightning bolt → blue rounded-square "RE:" mark, matching PrintSummary logo); welcome-card fix: render on showWelcome only, the config toggle seeds initial state only — card now closes on dismiss even with the toggle on; Settings General toggle description updated to match ("dismissing still hides it for the rest of the current session") |
| 54 | Sensible default scenarios | ✅ | done 2026-08-23 — replaced the three placeholders with "Early retirement — couple" (45/43, retire 55, spouse enabled, spending bands, $1.6M at retirement), "Retire at 60 — single" (55, CPP deferred to 70, downsize inflow + car outflow events, survives to 95), "Semi-retirement glide path" (52, retire 60, modest balances, phases to 75%, funded to 90). Each exercises different engine features; all verified via engine smoke (14/14: row counts, spouse present, event/band application, depletion ages sane). Existing localStorage scenarios untouched |
| 55 | Settings danger zone: full app reset | ✅ | done 2026-08-23 — red "Danger zone" block in Settings → General with "Erase everything and reset": double window.confirm, removes all 3 wealthconsole_* keys (verified by smoke that every key used in lib/components is covered), then location.reload() to factory defaults |
| 56 | Scroll to Monte Carlo on run | ✅ | done 2026-08-23 — mcPanelRef wrapper div + useEffect on mcRequest scrolls the panel into view (smooth, block:start) as soon as a run starts |
| 57 | Donate button + closable panel | ✅ | done 2026-08-23 — Heart "Donate" button in TopHeader between Settings and Help (order verified by smoke); DonateCard (closable, ShareCard pattern) with lighthearted honest blurb (donations pay for AI dev tokens to keep features coming, domain/hosting, tax-table upkeep — and leftovers go into the very RRSP this app optimizes, to retire a few days earlier) and external-safe donate link; DONATE_URL placeholder marked TODO for the real link |
| 58 | GitHub Sponsors link + GitHub Pages hosting | ✅ | done 2026-08-23 — DONATE_URL → github.com/sponsors/jsas, button relabelled "Sponsor on GitHub"; .github/FUNDING.yml (github: [jsas]); vite base '/retirement-web-app/' (verified in dist/index.html asset paths); .github/workflows/deploy.yml (npm ci → build → upload-pages-artifact → deploy-pages on push to main). Manual steps left for user: git init/push, repo Settings → Pages → Source = GitHub Actions, enable GitHub Sponsors profile |
| 59 | Single-file HTML build (dist-single/) | ✅ | done 2026-08-23 — vite-plugin-singlefile + `--mode singlefile` config branch (base './', outDir dist-single, inline all assets, inlineDynamicImports); `npm run build:single` / `build:all` scripts; favicon inlined as data-URI so the HTML has zero external refs (verified by grep); lib/runMonteCarlo.ts — worker with automatic main-thread fallback (file:// can't construct module workers), both call sites (MonteCarloChart, print-MC) switched to it. NOTE: the worker chunk still emits beside the single HTML (plugin limitation) but is never needed at runtime thanks to the fallback |
| 60 | Literal single-file output | ✅ | done 2026-08-23 — vite.config singlefile branch: publicDir=false (favicon.svg superseded by the data-URI; icons.svg is unreferenced dead weight) + a prune-to-single-html plugin whose closeBundle deletes everything but index.html from dist-single (drops the unused worker chunk). Verified: dist-single/ contains only index.html (388 kB); multi-file dist/ unchanged |
| 61 | Investigate CSV Tax Burden / Withdrawals looking wrong | 🔄 | investigated 2026-08-24 — cannot reproduce from current build; numbers are internally inconsistent (see detail). Awaiting user re-export / scenario JSON |
| 62 | Separate "inflate spending with CPI" toggle | ✅ | done 2026-08-24 — new `engine.indexSpending` (default true, back-filled for legacy configs) decouples spending inflation from `indexTaxTables`. Engine uses `spendingFactorAt` (CPI when on, 1 when off) for the spending target / verdict / withdrawal rate; benefits+tables still keyed off `indexTaxTables`. Settings → Engine gets a "Grow spending with inflation" checkbox above the tax-tables one + a footnote explaining the two toggles are independent and the CPI rate drives both. SidebarForm Spending Phases footnote + Help "Inflation"/"Desired spending" entries updated. 7/7 smoke green, tsc clean, build green |
| 63 | Pensions feature (DB / bridge, spouse-aware) | ✅ | done 2026-08-24 — `Pension{id,label,annualAmount,startAge,endAge(null=lifetime),indexedToCpi}` on RetirementInputs + SpouseInputs. Engine sums active pensions into `otherGross` (taxed with CPP/OAS, cuts portfolio draw), indexed ones grow with CPI when indexTables on; pension counts toward GIS clawback + OAS clawback; `pensionIncome` added to YearlyBreakdown. Spouse plan computes its own. Migration back-fills `pensions:[]` (incl. spouse). New Pensions sidebar section (reusable PensionList editor) + spouse pension sub-list; Pension column in ScheduleTable + CSV export; Help "Pensions (defined-benefit / bridge)" entry (notes DC/LIRA = RRSP/RRIF). 14/14 smoke + GIS-clawback check green, tsc clean, build green |

---

## Suggested order

0. **#36 CPP cap fix** — one-line UI bug; do immediately.
1. **#25 Inflation** — touches every projection; everything after builds on real-dollar math.
2. **#26 CPP calculator** — small, self-contained, removes a user foot-gun.
3. **#27 Capital gains** — changes taxable-account withdrawals; do before #29 so couples inherit it.
4. **#28 QC abatement + ON surtax** — localized tax-formula additions.
5. **#31 One-time events** — small, high user value, prerequisite for rich timeline chart.
6. **#32 Spending phases** — same; also updates Success Factor (uses first-year spending).
7. **#35 Drag-adjust timeline** — once events + phases exist, the chart has things worth dragging.
8. **#30 GIS** — niche; only matters near poverty-line plans.
9. **#29 Spousal** — biggest single feature; needs decisions on data model (per-spouse inputs, combined verdict).
10. **#33 Historical backtesting** — needs dataset curation.
11. **#34 PDF/share export** — polish; do once the feature set stabilizes.

---

## Task details

### #25 — Inflation indexing
- Add `inflationRate` (percent field) to sidebar + config; default ~2%.
- Inflate `desiredSpending` annually (decide: from `currentAge` vs from `retirementAge` — recommend from currentAge so "spending" means today's dollars; document the choice).
- Optional toggle: inflate tax brackets / BPA / OAS clawback threshold / OAS & CPP benefit amounts (they are indexed in reality).
- Engine: per-year inflated spending feeds withdrawal need, verdict, MC, CSV export.
- Update Help modal → Tax Model tab (remove "no inflation indexing" from approximations) and Inputs tab.

### #26 — CPP early/deferral calculator
- Sidebar: `cppAmountAt65` + `cppStartAge` (60–70); engine applies −0.6%/mo before 65 (floor −36% at 60), +0.7%/mo after (cap +42% at 70).
- Show computed adjusted amount read-only next to the inputs.
- Replaces current "enter your already-adjusted amount" caveat — update Help Inputs + Tax Model tabs.

### #27 — Taxable capital gains
- Track ACB alongside taxable balance: contributions raise ACB; withdrawals reduce ACB pro-rata (`acb × withdrawn/balance`); growth raises balance only.
- Withdrawal taxable portion = `withdrawal × (1 − acb/balance)`; 50% inclusion into taxable income.
- Gross-up loop must treat taxable withdrawals as partially taxable (currently fully tax-free).
- Keep 50% inclusion flat — the >$250k two-tier inclusion was cancelled before taking effect.

### #28 — QC abatement + ON surtax
- QC: federal tax × (1 − 0.165).
- ON: surtax = 20% × max(0, ONtax − T1) + 56% × max(0, ONtax − T2); add T1/T2 to config with 2026 values (verify; ≈2025 values ×1.02).
- Both live behind province selection; update Help Tax Model tab.

### #29 — Spousal scenarios + splitting
- Data model: `spouse` sub-object of inputs (own ages, balances, CPP/OAS) behind a "include spouse" toggle.
- Phase 1: two independent engine runs, combined display + combined verdict.
- Phase 2: pension-splitting optimizer (shift RRIF income ≥65 up to 50% to minimize household tax).

### #30 — GIS
- GIS entitlement by marital status; clawback 50¢/$ (single) of income excluding OAS.
- Only show in results when OAS active and income below cutoff.
- 2026 max amounts in config; document quarterly-recalc approximation in Help.

### #31 — One-time cash events
- `events: Array<{ id, age, label, amount, direction: 'in'|'out', account? }>` on inputs.
- Sidebar: editable event list. Engine: inflow lands in chosen account (default taxable) at that age; outflow adds to that year's spending need.
- Chart: diamond markers on projection line at event ages.

### #32 — Spending phases
- `spendingBands: Array<{ fromAge, pctOfBase }>` (default single band 100%).
- Engine: per-age spending = base × band pct (then inflation-adjusted once #25 lands).
- Verdict uses retirement-year spending; Help documents the interaction.

### #33 — Historical backtesting
- Embed annual real-return series (TSX composite, e.g. 1970–present) as a small data module.
- Run every rolling window of plan length; report success rate, worst window, and overlay worst/best/median sequences on the chart.

### #34 — PDF / share export
- Print stylesheet + "Print summary" button (key inputs, verdict, depletion age, MC success rate, compact chart).
- Optional: encode scenario JSON in URL hash for sharing (base64; no server).

### #37 — Collapsible sidebar sections
- Wrap each SidebarForm section (Personal Profile, Accounts/Balances, Contributions, Market Hypotheses, Government Benefits, Withdrawal Strategy, …) in a collapsible header: chevron + section title, click to expand/collapse.
- Default state: Personal Profile + Accounts open, the rest collapsed (reduces scroll on first load).
- Persist open/closed in component state (localStorage persistence optional).
- Match the GCP-console look: subtle full-width header row, chevron rotates, no card borders.

### #36 — CPP monthly input cap fix
- `SidebarForm.tsx` CPP Monthly field has `max="1500"`; a CPP deferred to 70 legitimately exceeds that (2026 max at 65 ≈ $1,507/mo → ≈ $2,140/mo at 70 with the +42% deferral bonus).
- Remove the `max` attribute (keep `min="0"`).
- Stopgap only — #26 replaces the raw amount with `cppAmountAt65` + start age and computes the adjustment, after which this field disappears. Until #26 lands, users must be able to type an already-adjusted amount above $1,500.

### #38 — Real total-return historical series
- Replace the stylized series with actual data: S&P/TSX Composite price returns + 3.0% avg dividend (equity leg, 60%), GoC long-bond total return reconstructed from the StatCan V122515 yield series via R ≈ y_prev − D·Δy + ½C·(Δy)² (bond leg, 40%), both deflated by StatCan CPI.
- Keep a deterministic generator (`build.historical.mjs`) so the block can be regenerated/extended.
- Update Help → Backtest + panel caption (no longer "stylized").

### #39 — Fix hidden spending target / misleading 0% phase
- Symptom: Spending Phases showed only percentages; the base desired-spending $ was hidden, and a band at 0% silently zeroed spending/withdrawals from that age (balance compounds untouched).
- Fix: base row shows `$X/yr · 100%`; each band shows its computed `$` amount so a 0% phase reads as `= $0`.
- Engine unchanged (it correctly honors a 0% band); the bug was presentation.

### #40 — Independently collapsible projection graph + number
- Wrap the TimelineChart (projection timeline graph) and the MetricCards + ScheduleTable (projection numbers) in separate collapsible panels, each with its own chevron header.
- Persist each panel's open/closed state independently (localStorage).
- Match the GCP-console collapsible look used in the sidebar (#37).

### #44 — Share link as a closable card
- Replace the `window.alert` placeholder with a closable card on the projection page: selectable link field, Copy button (with fallback to select), and a localhost warning explaining the no-server caveat.

### #45 — Sidebar visible on Help & Settings
- Remove the `view === 'projection'` gate around `SidebarForm` so the input sidebar stays open across projection / settings / help views.

### #46 — Deterministic Strategy Explorer
- `lib/strategies.ts`: define named strategy variants (CPP at 60/65/70, OAS at 65/70, all 6 withdrawal orders, combined defer-CPP-and-OAS-to-70). For each, run the full engine and binary-search the highest flat `desiredSpending` that survives to max age; also record lifetime tax and ending balance.
- Rank best-first by sustainable spending; compare each to the baseline and produce a "suggested course of action" list. Pure/deterministic — no randomness, no AI.
- `OptimizeCard.tsx`: strategy table (name, sustainable spending, Δ vs current, lifetime tax, ending balance, per-row Apply) + suggestions. Opened from an "Optimize" button in the breadcrumb row.

### #47 — AI agent prompt + structured paste-back
- `lib/agentIngest.ts`:
  - `buildAgentPrompt(inputs)` — self-contained text: the current plan JSON, the editable levers, ranges, and a strict JSON-only reply schema.
  - `parseAgentResult(text, current)` — strip code fences/prose, `JSON.parse`, then field-by-field validation against a whitelist with range checks; unknown fields ignored with a warning, out-of-range rejected with a reason. Returns a safe `Partial<RetirementInputs>` + applied/warnings/error.
- `OptimizeCard` "Ask an AI" tab: copy-prompt textarea + copy button; paste-back textarea with Validate (shows accepted/rejected per field) and Apply (writes patch into inputs, marks unsaved).

### #48 — Getting-started welcome section + General settings tab
- `WelcomeCard.tsx`: closable card at the top of the projection view. Explains the workflow (sidebar inputs → live projection; collapsible panels; Optimize / Backtest / Monte Carlo; Help & Settings pages) and states clearly that all data lives only in the browser's localStorage — nothing is sent to a server.
- Dismiss button ("Don't show again") persists dismissal to the panel-state store (`wealthconsole_panel_state`, key `welcome_dismissed`) so it survives reloads.
- Shown on load when: not dismissed **or** the config toggle is on.
- `appConfig.ts`: new `general: { showWelcomeOnLoad: boolean }` key (default `false`), back-filled in `validateAppConfig` for previously saved configs.
- `SettingsModal.tsx`: new "General" section — help blurb (what the app does, where data lives, pointer to the Help page) + the "Show the welcome section when the site loads" checkbox wired to `config.general.showWelcomeOnLoad`.

### #49 — Print-options card with optional summary sections
- `PrintOptionsCard.tsx`: closable card (like ShareCard) opened from the "Print summary" button instead of calling `window.print()` directly. Checkboxes: include projection timeline chart, include Monte Carlo fan chart, include major spending milestones. "Print" button triggers `window.print()`; choices persist to the panel-state store (`print_opts`).
- `PrintSummary.tsx` gains optional sections driven by those choices:
  - **Timeline chart** — static (non-interactive) SVG of total balance by age with a retirement-age marker, drawn from `results.yearlyBreakdown`.
  - **Monte Carlo chart** — static SVG fan chart (p10–p90 / p25–p75 bands + median) plus success-rate line. Requires running the simulation at print time: reuse the Monte Carlo worker with a modest run count (e.g. 500), show a "running…" placeholder in the print card until results arrive.
  - **Milestones table** — derived from inputs: spending-phase changes (`spendingBands`), one-time cash events (`events`), CPP start age, OAS start age, RRIF conversion age, retirement age; each with age + description + annual $ impact where applicable.
- Print CSS: optional sections are also `.print-only`; page breaks kept sensible (`break-inside: avoid` on sections).

### #50 — Legal: disclaimer + MIT license + upstream credit
- WelcomeCard: one-line "estimates only, not financial advice — consult a qualified advisor" notice under the local-data footer.
- HelpModal: new "Disclaimer" section (educational estimates, simplified tax model, no guarantee of accuracy, not financial/tax/investment advice, consult a professional) and a "License & credits" section (MIT license summary + credit to danielabar/retirement_drawdown_simulator_canada as the engine's origin, noting it carries no LICENSE file as of 2026-08-23).
- `LICENSE`: MIT license text at repo root; `package.json` `"license": "MIT"`; README license/credit lines.

### #51 — Help page: single scroll, TOC, search + full MIT text
- HelpModal: drop the tab bar; render all sections sequentially under heading anchors (`#help-inputs`, …). A table of contents with anchor links sits at the top.
- Search box above the TOC: typing filters the page to sections/entries containing the query (case-insensitive, matches headings and body text) and highlights matches; clearing restores everything. Pure client-side substring matching — no indexing library.
- License & Legal section gains the full MIT license text in a `<pre>` block.

### #52 — Share link: drop localhost warning, use current host
- `ShareCard.tsx`: remove the `isLocal` detection and the amber localhost warning box. The URL is built from `window.location.origin + window.location.pathname` (current host:port/path), so it works wherever the app is served — reword the explainer to say exactly that.
- `HelpModal.tsx` share-link entry: drop the localhost paragraph; explain the link carries the plan for anyone who can reach the same URL (e.g. a hosted deployment, a LAN IP, or a tunnel).

### #53 — Branding fixes + welcome-card dismiss bug
- TopHeader: single brand lockup — blue chip "RE:" + plain text "tired" (was chip "RE:" + "RE: tired", reading "RE: RE: tired").
- `public/favicon.svg`: replace the purple lightning bolt (Vite template leftover) with the blue "RE:" chip as an SVG favicon.
- App.tsx welcome bug: render condition `(showWelcome || config.general.showWelcomeOnLoad)` means the card stays mounted after dismissal whenever the "show on load" toggle is on — the toggle must only seed the initial state. Fix: render on `showWelcome` alone; initial state already incorporates the toggle.

### #54 — Sensible default scenarios
- Replace `buildDefaultScenarios` in App.tsx with three realistic, mutually distinct starting points that each showcase different engine features:
  - **"Early retirement — couple"**: mid-40s couple targeting retirement at 55, spouse enabled, strong savings rate, go-go/slow-go/no-go spending bands, CPP at 65 / OAS at 65.
  - **"Retire at 60 — single"**: mid-50s single, RRSP-heavy balances, CPP deferred to 70, one-time events (downsize inflow, car purchase outflow), TFSA-first withdrawal order.
  - **"Semi-retirement glide path"**: early-50s, modest balances, phases spending down, part-retire at 58, conservative return.
- Smoke-check each default runs the engine without depleting absurdly early or producing nonsense verdicts.
- NOTE: only affects first-run users (or cleared storage) — existing localStorage scenarios are preserved.

### #55 — Settings danger zone: full app reset
- SettingsModal General tab: red-bordered "Danger zone" block with an "Erase everything and reset" button. Two-step confirm (`window.confirm` then a typed/hard confirm via second dialog), then `localStorage.removeItem` for `wealthconsole_scenarios`, `wealthconsole_config`, `wealthconsole_panel_state` and `location.reload()` — app boots to first-run defaults (welcome card returns, new default scenarios).

### #56 — Scroll to Monte Carlo on run
- App.tsx: `mcRef = useRef<HTMLDivElement>(null)` wrapping the MonteCarloChart; `useEffect` on `mcRequest` scrolls it into view (`scrollIntoView({behavior:'smooth', block:'start'})`) when a new request is set.

### #57 — Donate button + closable panel
- TopHeader: Heart-icon "Donate" button between Settings and Help (`onOpenDonate` prop).
- `DonateCard.tsx`: closable card (ShareCard pattern) on the projection page — 2–3 sentence blurb (solo side project, free + local-only, donations fund hosting/domain and evening/weekend development) + a prominent donate-link button. URL is a placeholder `https://www.buymeacoffee.com/` — user replaces with their real link later.

### #58 — GitHub Sponsors link + GitHub Pages hosting
- `DonateCard.tsx`: `DONATE_URL` → `https://github.com/sponsors/jsas` (drop the TODO).
- `.github/FUNDING.yml`: `github: [jsas]` so the repo gets a Sponsor button.
- `vite.config.ts`: `base: '/retirement-web-app/'` so built assets resolve under the project Pages path.
- `.github/workflows/deploy.yml`: on push to main → npm ci, build, upload `dist/`, deploy to GitHub Pages (actions/deploy-pages). Requires repo Settings → Pages → Source: "GitHub Actions" (manual one-time step; not a git repo yet — user must `git init`, create the GitHub repo, and push).

### #59 — Single-file HTML build
- `vite-plugin-singlefile` + `vite build --mode singlefile` config branch: `base: './'`, `outDir: dist-single`, all assets inlined, `inlineDynamicImports`.
- Scripts: `npm run build:single` (dist-single/) and `npm run build:all` (both flavours). Output verified: `dist-single/index.html` has zero external src/href refs (favicon switched to an inline data-URI in index.html).
- Worker caveat resolved with `lib/runMonteCarlo.ts`: tries the module worker (multi-file build), falls back to a synchronous main-thread run when construction fails (file://). Both Monte Carlo call sites use it, so the single file is fully functional even though the plugin still emits the (unused) worker chunk beside it.

### #61 — Investigate CSV Tax Burden / Withdrawals
- User exported `retirement-projection-retire-at-51-2026-08-24 (2).csv`; reports Income Tax/Tax Burden and Withdrawals columns "do not look right".
- From the CSV: RRSP drains exactly at 65 (not 71) → conversion age 65; CPP starts 65; OAS+GIS start 66. At 65 Income Tax shows 71604 with withdrawals 212478; at 66–69 Income Tax shows **0** despite 132k–142k withdrawals; resumes at 70.
- Verify whether (a) the zero-tax years are a genuine bug (e.g. RRIF-minimum/stacking edge at conversion) or correct; (b) `incomeTax` excluding tax-on-benefits (retirementEngine.ts:444-446) explains "tax burden too low"; (c) RRIF-minimum redeposits inflating Withdrawals is by-design-but-mislabeled.
- **Findings 2026-08-24:** Reproduced the exact scenario (solved age-50 balances from the accumulation rows: rrsp 1,151,990 / tfsa 184,340 / taxable 724,481 / cash 93,371; 80k→rrsp/yr; 6%; retire 51; conv 65; CPP 1500/mo@65; OAS@66) across all 3 withdrawal orders. In EVERY case the current engine produces large tax at 65–70 (e.g. tfsa>taxable>rrsp: 65→290,934, 66→253,803) and a huge RRIF minimum at 65 (wd 588,336). The CSV instead shows wd 212k/tax 71,604 at 65, and tax **0** at 66–69 with wd only ~132–142k and NO RRIF minimum. Conclusion: the CSV is NOT reproducible by the current build — it is internally inconsistent (a 132k registered draw must bear ~37–50k tax in every province; verified via canadianTax.calculateTax sweep). Most likely the file was exported from an older/different build or mid-edit state, OR the on-screen scenario was changed after export. The two by-design quirks (incomeTax excludes tax-on-benefits; RRIF minimums counted in Withdrawals then redeposited) are real and worth relabeling, but they do NOT explain the $0-tax years. NEED: user to re-open the scenario, confirm the table on screen matches, re-export, and/or share the scenario JSON (Manage → share) so I can run the exact inputs.

### #62 — Separate "inflate spending with CPI" toggle
- `appConfig.ts`: `EngineConfig.indexSpending: boolean`; default `true`; `validateAppConfig` back-fills `true` for pre-toggle configs so existing plans are unchanged.
- `retirementEngine.ts`: `indexSpending = config.engine.indexSpending !== false`; new `spendingFactorAt(age) = indexSpending ? factorAt(age) : 1`. Applied at the spending target (yearSpending), the 25× verdict need, and the withdrawal-rate calc. `factorAt` (CPI) still drives benefits/CPP when `indexTaxTables` is on — the two are now independent.
- `SettingsModal.tsx` (Engine): new "Grow spending with inflation" checkbox above the existing tax-tables toggle, each with a sub-note, plus a footnote explaining the toggles are independent and the CPI rate drives both (off = flat real-terms target).
- `SidebarForm.tsx` Spending Phases footnote: now reflects the live config — tells the user the Spending Target grows at the CPI rate (and how to turn it off) or that it's held flat when the toggle is off.
- `HelpModal.tsx`: "Inflation" entry rewritten to describe the two independent switches; "Desired spending" entry points at the new toggle.
- Verified: 7/7 smoke (default grows, off=flat, off+tables-on spending still flat, validation back-fill/preserve), tsc clean, build green.

### #63 — Pensions feature
- `retirementEngine.ts`: `Pension` interface; `pensions?: Pension[]` on `RetirementInputs` + `SpouseInputs`; `pensionIncome` on `YearlyBreakdown`. Per retirement year, active pensions (`startAge ≤ age ≤ endAge`, `endAge null` = lifetime) sum into `otherGross` — so they are taxed exactly like CPP/OAS and reduce the portfolio draw with no changes to the withdrawal math. Indexed pensions scale by `factorAt(age)` when `indexTaxTables` is on; non-indexed stay flat. Pension counts toward the GIS clawback (`gisAnnual(cpp + pension + registered)`) and the OAS-clawback `totalNetIncome`. Spouse projection receives `pensions: sp.pensions` and computes independently.
- `scenarioStorage.ts`: `migrateInputs` back-fills `pensions: []` for the primary and spouse (array-absence detect; no version bump).
- `SidebarForm.tsx`: reusable `PensionList` editor (label, $/yr, start, end-blank=lifetime, indexed checkbox, add/remove); new **Pensions** `CollapsibleSection` after Government Benefits + a spouse pension sub-list; footnote notes DC/LIRA is modelled by RRSP/RRIF, not here.
- `ScheduleTable.tsx` + `App.tsx` CSV: new **Pension** column after GIS.
- `HelpModal.tsx`: "Pensions (defined-benefit / bridge)" entry — DB vs bridge, how it's taxed, GIS/OAS-clawback interaction, DC/LIRA pointer.
- Verified: 14/14 smoke (no-pension unchanged, start/end ages, indexed vs non-indexed × indexTables, pension cuts draw + raises balance, large pension funds spending, spouse independence) + GIS clawback ($10,260→$5,260 with a $10k pension = clean 50¢/$), tsc clean, build green.

### #35 — Graphical drag-adjust timeline
- Overlay interactive layer on the existing SVG projection chart (no new chart lib):
  - Vertical retirement-age marker — drag horizontally to change `retirementAge`.
  - Per-year spending points (from #32 bands / #31 events) — drag vertically to adjust that band/event.
  - Contribution segment (pre-retirement) — drag to change contribution levels.
- Drag end → write value back to inputs → re-simulate (debounced ~150 ms during drag for live feedback).
- Read-only in "compare" mode; needs clear affordances (cursor change, hover tooltip with current value).

---

## Maintenance notes

- **Typecheck:** `npx tsc --noEmit -p tsconfig.app.json --pretty false` (root tsconfig checks nothing — always pass `-p tsconfig.app.json`).
- **Smoke tests:** temp files inside `src/` with relative imports, run `npx tsx src/<file>.test.mjs`, delete after green. `/tmp` scripts fail module resolution.
- After any engine change: re-run a smoke suite (tax tables, gross-up, RRIF, clawback, verdict, MC zero-vol == deterministic) before committing.
- Keep Help modal in sync with behavior changes — it documents the approximations list.
