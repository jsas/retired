# Real Beta — element inventory & the map to f7

**Status:** plan of record · **Branch:** `issue/real-beta` · **Closes:** #136
**Source of truth:** `STYLEGUIDE.md` + `src/design/` + the winning mock `ux-proposals/finalists/f7-final*.html`.

This file is the contract for the rebuild. Per REQUIREMENTS §8.7 (the bolt-on
test), **every element of the current app gets a named home** — (a) visible by
default, (b) one click away in a named place, or (c) deliberately dropped with
a reason. If a row has no home, we haven't redesigned, we've deleted a feature.

The rule from the user's taste: the front door carries the verdict and the two
biggest levers. Everything else is **one click away, not on the door.** The
Details ▾ menu is that click. The test we hold ourselves to: walk the tables
below and find nothing homeless.

---

## 1. The new shell (f7 shape)

| Region | What it is | Carries |
|---|---|---|
| **Header** (sticky, h-12, hairline) | app chrome | Brand · Details ▾ · Plans ▾ · Assistant · Data · Print/Export · **persistent verdict chip** |
| **Verdict hero** | the answer, plain English | "Your money lasts until you're N" + market dial (down↔up) |
| **The map** | blue contour pad, draggable dot | retire-age × spending terrain, boundary line, you-are-here |
| **The two levers** | the biggest dials | Stop working at · Spend a year — single faders, fixed ranges (the old min/max limiter slider is gone) + live consequence lines |
| **Down-market check** | the stress test, demoted from header | one line + dot: holds/warns at the down-market return |
| **Life timeline** | the plan on one line | working/retired/run-out ticks, funded baseline |
| **Evidence row** | the receipts | per-account balances over time + key numbers |
| **Details ▾** | the rest of the plan, one click away | one page (`#/details`): the 3 levers + every input section, open in a single scroll → Details ▾ scrolls to the tapped section |
| **Plans ▾** | scenario management | list / new / compare / revision history |
| **Docked assistant** | the front door, right side (sheet on mobile) | chat that reads the plan, shows its work, proposes changes |

---

## 2. Sidebar sections → homes (the 16 CollapsibleSections in `SidebarForm.tsx`)

The old app puts all 16 in one long drawer. f7's answer: the two that decide the
verdict live on the door (as levers/map axes); Market Hypotheses becomes the
door's market dial; the other 13 all live on **one page — "The details"
(`#/details`)** — every section open in a single scroll. No 13 separate pages.

The **Details ▾** header menu doesn't open 13 routes — it opens `#/details` and
**scrolls to the tapped section** (deep-link: `#/details?section=profile`). So each
section still has a named, linkable home (§8.7) while staying one simple page.

**Layout:** desktop = two-column grid of sections; mobile = one column. Each
section is a `Panel` (hairline + uppercase label — an existing `src/design/`
primitive), not a card. Everything is editable in place; the verdict, map and
dock recompute off the same engine call.

**The whole profile in one place — levers included.** The details page also
carries the three top-level controls — **retirement age**, **desired spending**,
and the **market assumption** — so the entire plan is editable here, not just the
drawer sections. Same levers as the dashboard, just present on this page too.

The old steering page's triple-slider `RangeFader` (a value knob plus two
crop-edge thumbs that set an allowed min–max band) **goes away**. In its place,
each lever is a single fader over a **sensible fixed min–max range** — no user
"limiters":

| Lever | Fader range | Where it appears |
|---|---|---|
| Stop working at | 55 – 80 | door lever · map x-axis · details page |
| Spend a year | $20k – $200k | door lever · map y-axis · details page |
| Markets (avg return) | 1.2% – 4.5% | verdict-hero dial · details page |

**Groups = plain names** (no metaphors). Sections are grouped the way a person
actually looks for them, each under a one-word header, top-to-bottom:

| Group | Sections |
|---|---|
| **People** | Personal Profile · Spouse |
| **Accounts** | Account Balances · Contribution Rates · RDSP · FHSA |
| **Income** | Income (work/pension) · Government Benefits · Cash Events |
| **Spending** | Spending Phases · Withdrawal Strategy · Debts |
| **Property** | Home Equity |

Per-section homes (all on `#/details`, scrolled to):

| # | Section | Deep-link | Notes |
|---|---|---|---|
| 1 | Personal Profile | `#/details?section=profile` | current/max age, province |
| 2 | Spouse | `#/details?section=spouse` | partner plan / linked scenario |
| 3 | Account Balances | `#/details?section=accounts` | feeds Evidence row + "saved so far" |
| 4 | Contribution Rates | `#/details?section=contributions` | per-account savings rates |
| 5 | RDSP | `#/details?section=rdsp` | conditional — appears when enabled |
| 6 | FHSA | `#/details?section=fhsa` | accumulation-only → RRSP at retirement |
| 7 | Income | `#/details?section=income` | work/pension/self/rental sources |
| 8 | Government Benefits | `#/details?section=benefits` | CPP/OAS/GIS |
| 9 | Cash Events | `#/details?section=events` | one-time/recurring in- & out-flows |
| 10 | Spending Phases | `#/details?section=spending` | go-go/slow-go/no-go |
| 11 | Withdrawal Strategy | `#/details?section=withdrawal` | drawdown order; also an assistant lever |
| 12 | Debts | `#/details?section=debts` | payments raise withdrawals |
| 13 | Home Equity | `#/details?section=home` | reverse mortgage; conditional in Schedule |
| — | **Retirement age** | top of page (lever) | also door Lever 1 · map x-axis |
| — | **Desired spending** | top of page (lever) | also door Lever 2 · map y-axis |
| — | **Market assumption** | top of page (lever) | also verdict-hero dial |

**The mapping answer to "where do the old sidebar sections go":** the three
top-level levers (retire age, spending, market) live on the door AND on the
details page — plain single faders over fixed ranges, the old min/max limiter
triple-slider dropped. The thirteen drawer sections all live on **one Details
page, open in a single scroll** under plain-name groups, reachable in one click
via the Details ▾ menu (which scrolls to the tapped section).

---

## 3. Old views → the new shell (the 18 `View`s in `viewRoutes.ts`)

| View | Route today | Home in beta |
|---|---|---|
| projection | `#/projection` | **The dashboard itself** (map + levers + life + evidence) |
| math | `#/year-math` | **Schedule page** (year-by-year) — one click from the numbers it explains; gets the §8.9 column picker |
| eq | `#/steering` | **Insights page** (levers ranked) + assistant `run_strategies`. The steering page's min/max limiter triple-slider is dropped — levers become plain single faders over fixed ranges |
| optimize | `#/optimize` | **Insights page** (spending solve) + assistant `solve_spending` |
| compare | `#/compare` | **Plans ▾ → Compare** |
| montecarlo | `#/monte-carlo` | **Down-market check** (door) + **Insights page** (full MC) |
| backtest | `#/backtest` | **Insights page** (historical futures) |
| print | `#/print` | Header **Print/Export** → print view |
| export | `#/export` | Header **Print/Export** → CSV/PDF |
| scenarios | `#/scenarios` | **Plans ▾** |
| sharing | `#/sharing` | Header **Data** page |
| donate | `#/donate` | Footer / About footnote (demoted — not a nav peer) |
| agent | `#/assistant` | **The docked assistant** (right panel; full sheet on mobile) |
| connections | `#/connections` | **Settings page** (AI provider/model) |
| welcome | `#/welcome` | **The landing** (`f7-final.html` shape: 5-question chat → verdict → two doors) |
| help | `#/help` | Header/footer **Help** → HelpModal content |
| settings | `#/settings` | Header **Settings** (app config: tax tables, engine assumptions) |
| styleguide | `#/styleguide` | stays (beta-only dev surface) |

---

## 4. Assistant tools → surfaces (27 tools in `packages/mcp-tools`)

The assistant is a **first-class surface**, not a chat box (§8.6): it reads the
plan, shows its work inline, and proposes changes as reviewable confirm cards.
Nothing is dropped — each tool keeps working through the dock.

| Capability | Tools | How it surfaces in beta |
|---|---|---|
| **Read plan** | `get_scenario`, `get_schedule` | grounds every answer; schedule renders as a chat card |
| **Run analysis** | `run_projection`, `run_monte_carlo`, `compare_scenarios`, `run_strategies`, `solve_spending` | rich **answer cards** in chat (verdict, MC rate, ranked levers, sustainable spend) — the same numbers the map shows |
| **Propose change** | `set_scenario_value`, `propose_patch`, `propose_spouse`, `propose_income`, `propose_spending_bands`, `propose_cash_event`, `propose_reverse_mortgage`, `propose_rdsp`, `propose_fhsa`, `propose_debt`, `propose_revert` | **confirm cards** — user approves before anything lands |
| **Manage items** | `manage_cash_event`, `manage_income`, `manage_debt` | confirm cards for update/remove |
| **Memory** | `remember`, `recall` | quiet; grounds the assistant across sessions |
| **Scenarios** | `open_scenario`, `save_scenario_as`, `list_scenarios` | mirror of Plans ▾, drivable by chat |

---

## 5. The pages to build (each a `src/components/beta/*` surface)

Every page composes `src/design/` primitives — no one-off styles (§8.10).

- [ ] **Landing** — the 5-question chat → verdict → two doors (port of `f7-final.html`)
- [ ] **Dashboard** (home) — verdict hero · market dial · **contour map** · two levers · down-market check · life timeline · evidence row
- [ ] **Contour lib** — `src/lib/contour.ts`: port the f7 terrain math (bisection boundary, Catmull-Rom smoothing, hold-wash) onto `calculateHousehold` — **pure + Vitest-tested** before any SVG
- [ ] **Schedule** — year-by-year table + **§8.9 column picker** (prefKV-persisted)
- [ ] **Insights** — levers ranked (eq/optimize) + Monte Carlo + backtest, one level down
- [ ] **The details page** (`#/details`) — the 3 levers + all 13 sections, one scroll, plain-name groups; Details ▾ scrolls to the tapped section; two-col on desktop, one-col on mobile
- [ ] **Plans** — list / new / compare / revision history
- [ ] **Data** — backup / restore / import / share
- [ ] **Settings** — app config + AI provider/connection
- [ ] **Assistant dock** — chat + answer cards + confirm cards (shared message components with the landing)

---

## 6. The bolt-on checklist (walk this before calling any slice done)

- [ ] Every sidebar section in table §2 has a named home on `#/details` (deep-linked) — none dropped silently
- [ ] The 3 levers (retire age, spending, market) are editable on the door AND the details page; single faders over fixed ranges, no min/max limiter slider
- [ ] Every old view in table §3 routes somewhere real
- [ ] Every assistant tool in table §4 still executes through the dock
- [ ] Conditional sections (RDSP, Home Equity, FHSA) auto-appear in Schedule when enabled (§8.9)
- [ ] Schedule column picker persists via prefKV, starter set per §8.9
- [ ] Verdict chip + hero + map + down-market check all recompute together off one engine call
- [ ] Flat/square/hairline rules hold (no cards, no shadows, one blue accent, tabular nums)
- [ ] Mobile: assistant becomes a sheet; map/faders stay finger-draggable
- [ ] Tests with every feature; `npx vitest run` green before merge
