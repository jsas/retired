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
  AccountBars, Legend, Dropdown, **HelpHint**, Footnote, AppHeader.
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
- ✅ **Insights / Plans / Data / Settings / Connections / Print / Export / Donate /
  Help** — full-featured panels wrapped in the beta chrome (`beta/pages.tsx`).
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

### A. Page-by-page style review → convert to styleguide components ⬜
**The problem:** pages fork raw elements (rounded corners, shadows, inline
`style={{}}`, one-off class soup) instead of composing `src/design/` primitives.
Per §8.10 that's a violation — a needed style gets *added to* the design system,
never forked inside a page.

**The task:** walk each page, list what forks the vocabulary, and convert it to a
proper component (or a new primitive added to `src/design/` + the Style Guide page).
- [ ] Dashboard (`BetaApp.tsx`)
- [ ] Landing (`LandingPage.tsx`)
- [ ] Details (`DetailsPage.tsx`)
- [ ] Schedule (`ScheduleTable.tsx`)
- [ ] Insights (`beta/pages.tsx` — Eq/Optimize/MC/Backtest wrappers)
- [ ] Plans / Data / Settings / Print / Export / Donate / Connections (`beta/pages.tsx` wrappers)
- [ ] For each: a written list of what to update, then the conversion.

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
compare+scenarios→Plans · sharing→Data · print+export→Print/Data pages ·
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

- [ ] Every page composes `src/design/` primitives — no forked styles (§8.10).
- [ ] Every sidebar section has a named home; nothing dropped silently (§8.7).
- [x] Details page can add events / income / debts / spouse inline.
- [x] Assistant: absent on landing, remembers open state, has a full-page view, slim chat picker.
- [ ] Flat/square/hairline rules hold everywhere (no cards, no shadows, one blue accent).
- [ ] Mobile: assistant sheet, finger-draggable map/faders, readable pages.
- [ ] Tests with every feature; `npx vitest run` green before merge.
