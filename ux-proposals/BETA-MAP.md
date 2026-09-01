# Real Beta — the durable ledger

**Branch:** `issue/real-beta` · **Draft PR:** #137 · **Closes:** #136
**Source of truth:** `STYLEGUIDE.md` + `src/design/` + the winning mock `ux-proposals/finalists/f7-final*.html`.

This file is the contract. Per REQUIREMENTS §8.7 (the bolt-on test), every element
gets a named home: (a) visible by default, (b) one click away in a named place, or
(c) deliberately dropped with a reason. If a row has no home, we've deleted a feature.

**The user's taste rule:** the front door carries the verdict and the two biggest
levers. Everything else is one click away, not on the door. Verdict-first, plain
English, few controls, distinct concepts over reskins.

---

## 0. Status key

✅ shipped to PR #137 · 🚧 in progress · ⬜ not started.

---

## 1. What's DONE (kept terse to save context — details live in git + the files)

- ✅ **Design system** — `src/design/`: tokens.ts (every colour/size named once),
  primitives.tsx, StyleGuide.tsx (live page at `#/styleguide`), STYLEGUIDE.md prose.
  Primitives: VerdictHero, Panel (hint prop), Fader (help prop), Chip, Stat,
  AccountBars, Legend, Dropdown, **HelpHint**, Footnote, AppHeader,
  **Dot** (square status/legend dot), **Progress** (flat hairline fill),
  **Modal** (flat hairline dialog shell), **ProjectionTimeline** (the one
  money-over-age chart: series + overlays + pins + retirement marker, used by
  dashboard, steering, projection view, and Compare).
- ✅ **Contour lib** — `packages/engine-core/src/contour.ts`: f7 terrain math
  (bisection boundary, Catmull-Rom smoothing, hold-wash) on `calculateHousehold`, pure + tests.
- ✅ **Dashboard** (`BetaApp.tsx`) — verdict hero, Markets dial, contour map, two
  levers, down-market check, life timeline, evidence row; one engine run feeds all.
- ✅ **Landing** (`LandingPage.tsx`) — the f7 front door: minimal wordmark header
  (NO app nav / verdict chip / assistant — it's the front door, not the app),
  5-question chat with the chips + composer inline under each question, then the
  verdict and the doors. About / Help / Legal / privacy footnotes at the very
  bottom (§8.8), always visible.
- ✅ **Details** (`DetailsPage.tsx`) — 3 levers + 13 sections, one scroll, plain-name
  groups (People/Accounts/Income/Spending/Property), Details ▾ deep-links
  (`#/details?section=…`), two-col desktop / one-col mobile. Income / Events / Debts /
  Spouse edit inline (add + remove) via shared `Num`/`Txt`/`Sel` flat-hairline helpers
  — nothing defers to the old app.
- ✅ **Schedule** (`ScheduleTable.tsx` + `scheduleColumns.ts`) — year-by-year + §8.9
  column picker, prefKV-persisted (`wealthconsole_schedule_cols`); RDSP/FHSA/Home
  Equity/Debts columns auto-gated.
- ✅ **Insights / Plans / Data / Settings / Connections / Print / Donate /
  Help** — full-featured panels wrapped in the beta chrome (`beta/pages.tsx`).
  Data is ONE page: share (link/code) + the full backup/restore/projection-export
  surface stacked (`BetaDataPage`); the old `#/export` route aliases to it.
- ✅ **Lever-range prefs** — `lib/rangePrefs.ts`; spending max, savings max, return
  min/max, volatility max user-settable (Settings → Lever Ranges), `wealthconsole_ranges`
  prefKV key; retirement/plan-to/CPP/OAS stay fixed.
- ✅ **Assistant dock** — `BetaPage` assistant slot + `AgentPage docked`: 340px right
  rail desktop, full-screen sheet mobile, one conversation across pages.
- ✅ **Help system** (`src/help/topics.tsx` + `HELP-MAP.md`) — one data source owns
  every topic (id/title/body/keywords/section); Help page renders from it (searchable,
  `#/help?topic=<id>` deep-links + flash); `HelpHint` shows the same body in a flat
  popup — single source, no drift. Hints placed on every surface via
  `Panel hint=` / `Fader help=` / `BetaPage hint=`.
- ✅ **Suite:** 1002/1002 tests green · `tsc -b` clean · build ok.

---

## 2. TO-DO — the open work (from the user's review)

### A. Page-by-page style review → convert to styleguide components ✅
**The problem:** pages fork raw elements (rounded corners, shadows, inline
`style={{}}`, one-off class soup) instead of composing `src/design/` primitives.
Per §8.10 that's a violation — a needed style gets *added to* the design system,
never forked inside a page.

**Review (written list, by file) — ✅ done, 🚧 partial, ⬜ pending:**

- [x] **Wrapped-card redesign batch** (commit `249edfc`): the stable app's cards
  mounted inside BetaPage chrome all showed a double header (BetaPage's section
  label + the card's own `text-lg font-bold` h2) and kept the old skin's colors.
  Redesigned, logic untouched: **PrintOptionsCard, ScenarioManager, DonateCard,
  SharingPage, DataPage, AgentPage, ConnectionsPage, HelpModal, SettingsModal** —
  inner headings removed (BetaPage owns the page title), `bg-blue-600`/violet/
  emerald decoration → `cls.primaryBtn` (bg-slate-900) / hairline / rose-700
  destructive, every `rounded`/`ring-1` stripped, toggles ink-selected squares,
  warnings left-rule notes. Guard tests: `PrintOptionsCard.test.tsx` +
  `ScenarioManager.test.tsx`.
- [x] **`src/components/AgentPage.tsx`** (assistant) — bubbles/pills/panels flattened
  (rounded-lg/full gone); both progress bars → `<Progress>`; shadows killed. Plus
  the 2026-08 deep pass above: violet user bubble → ink, violet reasoning/tool
  chips/ChangeCard → slate system, offline copy/paste tabs → underline style.
- [x] **`src/components/EqPage.tsx`** — range-thumb + map dot squared, shadows off.
- [x] **`src/components/ScheduleTable.tsx`** — column-picker popover + container
  flattened (no rounded/shadow); draggable retirement marker on the grip cell.
- [x] **`src/components/MonteCarloChart.tsx`** — legend swatches square + token BLUE
  (no raw hex); histogram bars squared.
- [x] **`src/components/BacktestPanel.tsx`** — histogram bars squared.
- [x] **`src/components/ConnectionsPage.tsx`** — status dot squared; download bar → `<Progress>`.
- [x] **`src/components/SetupWizard.tsx`** — flat tokens throughout (Progress bar,
  square hairline boxes, primary button from `cls.primaryBtn`, no focus ring).
- [x] **`src/components/SavePromptModal.tsx`** — rebuilt on the flat `<Modal>` primitive.
- [x] **`src/components/HelpModal.tsx`** — `<mark>` squared.
- [x] **`src/components/MathPage.tsx`** — numbered-badge squared.
- [x] **`src/components/TimelineChart.tsx`** — legend swatch squared.
- [x] **`src/components/TopHeader.tsx`** — dirty-dot squared, mobile menu flattened.
- [x] **`src/components/WelcomeCard.tsx`** — hero CTA square, slate-900.
- [x] **`src/components/CompareCard.tsx`** (Plans) — rebuilt as a timeline + numbers
  table (task D ✅, ProjectionTimeline); the f7 sweep flattened its table/legend
  (commit `0f23de5`). No one-off dot fix needed.
- [x] **`src/components/PrintSummary.tsx`** — all 44 inline `style={{}}` blocks →
  Tailwind classes; raw hex → design tokens (blue-600 → token BLUE, red-600 →
  rose-700, monospace cells → `.num` tabular, rounded RE: block → square ink).
  First tests for the sheet (commit `c5ebbd0`).
- [x] **`src/components/beta/LandingPage.tsx`** — verified: the verdict / RE: mark
  inline `style={{ color }}` reads the `tokens.ts` constants (BLUE / RED_TEXT / INK),
  not forked hex. No raw hex literals in the file — nothing to convert.

**2026-08-30 final sweep — the beta-visible surface is done.** Every component
mounted inside BetaPage chrome now follows the flat spec (commits `951f5b4`,
`0f23de5`, `1617b12`, `a047924`, `28c2970`): **DataPage, EqPage, OptimizeCard,
MonteCarloChart, BacktestPanel, CompareCard, MathPage, ScheduleTable,
MetricCards, Markdown** (assistant replies: violet links → blue-700, square code
blocks), plus AgentPage's double header fixed (`hideTitle` on the beta mount —
BetaPage's "Assistant" is the only title; controls/badge stay). Remaining old-skin
files — **SetupWizard, SidebarForm** — mount only in the legacy app path below the
beta switch, not beta-visible; **PrintSummary** stays deferred (print-only sheet,
task D-adjacent). Sweep verified by grep for `rounded|violet|emerald|bg-blue-6|
ring-1|neutral-` across beta-mounted components: only intentional hits remain
(EqPage's square value-knob/pad-dot use the one blue accent for meaning).

**Shared primitives ADDED to `src/design/` (now consumed by the conversions below):**
- [x] `<Progress>` — a thin hairline track + a fill of `width: pct%` (replaces the
  inline-style bars in AgentPage / Connections / SetupWizard).
- [x] `<Modal>` — a flat hairline overlay shell (replaces SavePromptModal's shadow shell).
- [x] square `Dot` (the system has square dots; several pages fork round ones).

**Then:** do the conversions page-by-page, leaving each above checkbox ticked.

### B. Details page — no way to ADD things ✅
The Details sections that hold lists now edit inline, in-styleguide (flat hairline
cards, `×` remove, `+ add` buttons, shared `Num`/`Txt`/`Sel` helpers):
- [x] **Cash Events** — add an event (in/out, one-time or recurring to an end age)
- [x] **Income** — add a source (work / pension / self / rental), name, $/yr, from/to age
- [x] **Debts** — add a debt (kind, balance, rate, monthly payment)
- [x] **Spouse** — enable toggle + partner age / balances / CPP / OAS fields inline
(All four write to `inputs.events` / `inputs.income` / `inputs.debts` / `inputs.spouse`
via the existing `set` helper; tests in `DetailsPage.test.tsx` cover add/remove rows.)

### C. Assistant — fix the chrome ✅
- [x] **Never appear on the first page** — the landing renders no assistant; the dock
  only mounts once there's a plan to talk about.
- [x] **Remember its open state** — dock open/closed persists via prefKV
  (`wealthconsole_dock_open`, new PREF_KEYS entry), not `useState(true)` fresh each load.
- [x] **Open fully on its own page** — `#/assistant` is back as a full beta page
  (undocked AgentPage: chat list + thread + model picker); the dock header has a ⤢
  link to it.
- [x] **Slim the chat picker** — the rail's permanent mini list is gone; a slim strip
  with a clickable chat icon drops down to select / start / delete a chat
  (`DockChatPicker`), so the rail keeps its width for the conversation.

### D. Compare page — rebuild as a real comparison tool ✅
Rebuilt on a new shared **`src/design/ProjectionTimeline.tsx`** (see below):
- [x] **One projection timeline**: a line per scenario — ALL scenarios on by default,
  no 3-cap — with a legend that toggles lines on/off.
- [x] **A simple table of numbers underneath**: one row per visible scenario —
  wealth at retirement, depletion age, withdrawal rate, lifetime tax, ending
  balance. No baseline dot, no diff chips.
- [x] Killed `MAX_COMPARE`, the baseline dot, and the diff-chip callouts.

**ProjectionTimeline (the shared line-chart primitive)** — money-over-age in the f7
style (soft balance area-fill, clean axis + hairline year ticks, token colours,
labelled pins). Props: `series[]` (one line each), `overlays[]` (spend / market /
home-equity lines, legend-toggleable), `pins[]` (you / work ends / money runs out),
`marker` (retirement as a `line` or `dot`). Now used by:
- [x] **Dashboard** (BetaApp) — "Your life on one line" (replaced `LifeTimeline`, deleted).
- [x] **Steering** (EqPage) — the live projection under the controls (read-only now).
- [x] **Dashboard projection view** (App `view==='projection'`) — replaces `TimelineChart`'s
  balance line. ⚠️ the drag-to-edit handles were dropped there; steering (EqPage) is
  the edit surface. `TimelineChart` is now unused.
- [x] **Compare** (CompareCard) — the multi-scenario timeline above.

---

## 3. The mapping (reference — kept for the bolt-on test)

### 3a. Sidebar sections → homes (16 in `SidebarForm.tsx`)
The two verdict-deciders + the market assumption are the door's levers/map axes; the
other 13 live on one `#/details` page, deep-linked. Groups = plain names:
People (Personal Profile · Spouse) · Accounts (Balances · Contribution Rates · RDSP ·
FHSA) · Income (Income · Government Benefits · Cash Events) · Spending (Spending
Phases · Withdrawal Strategy · Debts) · Property (Home Equity).

### 3b. Old views → homes (18 in `viewRoutes.ts`)
projection→dashboard · math→Schedule · eq+optimize+montecarlo+backtest→Insights ·
compare+scenarios→Plans · sharing+export→Data (one page) · print→Print ·
donate→footer · agent→assistant dock (+ own page, see §2C) · connections→Settings ·
welcome→Landing · help→Help · settings→Settings · styleguide→dev surface.

### 3c. Assistant tools → surfaces (27 in `packages/mcp-tools`)
Read / analyze / propose (confirm cards) / manage / memory / scenarios — all execute
through the dock. Nothing dropped.

### 3d. Lever ranges (the faders' min/max)
Runaway-able → user-settable in Settings: spending max, savings max, return min/max,
volatility max. Fixed by law/lifespan: retirement 40–75, plan-to 70–105, CPP 60–70,
OAS 65–70. All faders read the same range object.

---

## 4. Acceptance (the no-regression gates)

- [x] Every page composes `src/design/` primitives — no forked styles (§8.10).
  (2026-08-30 final sweep, commit `e2c4bc0`: grep for old-skin markers across
  beta-mounted components returns only intentional hits.)
- [x] Every sidebar section has a named home; nothing dropped silently (§8.7).
  (§3a/§3b mapping + BetaPage nav test proves the homes render.)
- [x] Details page can add events / income / debts / spouse inline.
- [x] Assistant: absent on landing, remembers open state, has a full-page view, slim chat picker.
- [x] Flat/square/hairline rules hold everywhere (no cards, no shadows, one blue accent).
- [x] Mobile (2026-08-30 pass, commit `7a22e32`): phone **Menu ▾** carries all nine
  named homes under `md` (row = logo · Menu · Assistant · verdict chip fits 375px);
  Details dropdown goes one-column under `sm` and Dropdown panels cap at viewport
  width; assistant = full-screen sheet; contour map is `touch-none` pointer-drag +
  `w-full` viewBox; faders are native range inputs (touch-native); Schedule table
  scrolls (`overflow-x-auto`); dashboard/levers collapse below `lg`/`md`; viewport
  meta present; Landing doors stack under `sm`. Guard: BetaPage mobile-menu test.
- [ ] Tests with every feature; `npx vitest run` green before merge.
  (Held on every commit — 1021/1021 as of this pass; stays open until merge.)
