# RE:tired — UX Makeover Requirements

**Status:** proposal · **Branch:** `makeover-proposals` · **Date:** 2026-08-30
**Scope:** the app's core UX language — verdict, controls, and how the dashboard is organized.

---

## 1. Problem

RE:tired's engine is strong and the app is honest, but the interface buries the answer:

- "Am I OK?" is card #4 of 4 inside a collapsible panel, in 10–12px type.
- Finance jargon (withdrawal rate, depletion age, Monte Carlo) stands between the user and the verdict.
- The stress tests that justify the verdict (Monte Carlo, backtest) live in the header, disconnected from the answer.
- Controls state a value but not its consequence — the user has to know what to change and what it does.

## 2. Principles (from the user's taste, wave 1)

1. **Verdict first.** The page opens with the answer in plain English: *"Your money lasts until you're 96."* Everything else is evidence.
2. **Plain English only.** "Runs out at 89", "left over at 95", "stormy / ordinary / kind". No "depletion age", "withdrawal rate", "Monte Carlo" on the surface.
3. **Few controls, shown consequences.** At most three dials on the front door (stop working at · spend a year · saved so far) — each stating what moving it does.
4. **One primary action per page.**
5. **Live, not batch.** Dragging any control re-simulates immediately.
6. **Honesty.** The failing plan says so, with the one change that fixes it. The demo model intentionally defaults to a failing plan (runs out at 89) so this state is always visible.

## 3. The shared interaction model (all 40 designs use it)

- **Inputs:** current age, retire age, max age, savings, yearly contribution, yearly spending, CPP+OAS per year, benefit start age.
- **Weather** (market mood): `stormy / ordinary / kind` — the layperson's Monte Carlo.
- **Outputs:** the verdict sentence, "money lasts to", "left at 95", the balance-over-age curve, yearly rows (age / in / out / balance).
- Single source of truth: `model.js` — every design computes through `simulate()`. Nothing hardcoded. **At defaults the plan fails** (money out at 89) — this is intentional so the "runs short" state is exercised.
- Storm test = re-run with `sky: 'storm'`.

## 4. The collection

| # | Name | One-line concept |
|---|------|------------------|
| 01 | Verdict-first dashboard | The answer as hero, stress tests as cards |
| 02 | Dark editorial welcome | The question huge on a dark landing |
| 03 | Steering control room | Score pinned, pad dominant, faders explain |
| 04 | Range | Money as a fuel gauge |
| 05 | The Sentence | Plan as one editable first-person sentence |
| 06 | The River | Scroll your life downstream |
| 07 | Calm Focus | One enormous number, three steppers |
| 08 | Life Timeline | Age axis with draggable milestone pins |
| 09 | One Question at a Time | Typeform-calm card wizard |
| 10 | Split Answer | Controls left, sticky verdict right (Linear) |
| 11 | Bento Board | Plan as balanced grid of tiles |
| 12 | Plan Score | Honest 0–100 ring with 3 ingredients |
| 13 | The Printed Plan | Typeset private-bank letter |
| 14 | Terminal | `plan> retire 64` green-on-black |
| 15 | Glass Night | Indigo night, frosted glass |
| 16 | Contour Map | Success terrain as topo lines, drag the dot |
| 17 | Conversation | Four chat questions, verdict as message |
| 18 | Instrument Dials | Rotary knobs, amber VFD readout |
| 19 | The Year Strip | One bar per year, scrub across decades |
| 20 | One Breath | 90% empty: number, arrows, bottom sheet |
| 21 | The Statement | Bank statement: verdict box + yearly rows |
| 22 | Swiss Poster | Typographic grid, 140px verdict, one red |
| 23 | Morning Briefing | Email digest: TL;DR + what to watch |
| 24 | The Ledger | Ruled notebook, margin notes, ink stamp |
| 25 | The Spreadsheet | Live spreadsheet with formula-bar words |
| 26 | Big Canvas | Dense 12-col panel dashboard |
| 27 | The Forecast | Weather-report metaphor, 5-period chips |
| 28 | The Rings | Apple-Watch rings: Outlast / Cushion / Weatherproof |
| 29 | Road Trip | Age axis as road, stops & finish banner |
| 30 | The Checklist | Aviation preflight with inline fixes |
| 31 | Card Deck | One fact per card, keys + dots |
| 32 | The Comic | Three drawn panels with live captions |
| 33 | Blueprint | Plan as technical elevation drawing |
| 34 | Retro Broadcast | CRT TV, ticker, lower-third verdict |
| 35 | Crayon | Hand-drawn workbook for spreadsheet-fearers |
| 36 | Ambient | Full-viewport gradient, ghost controls |
| 37 | The Paystub | Inverse paystub for a chosen future age |
| 38 | Kitchen Table | Draggable paper cards on a wood table |
| 39 | Voice Briefing | 5 spoken lines that fade in sequence |
| 40 | Split Worlds | Draggable A/B split, winner pill |

**Second-wave additions:** `dashboard.html` — a full multi-section dashboard (verdict / numbers / milestones / year-by-year / risks) showing how the real home page could be restructured; it merges the wave-1 winners.

## 5. Implementation contract (what building "the winner" means)

1. **New components only, additive.** No changes to the engine or its tests; the engine stays authoritative for numbers.
2. **Verdict component** (`VerdictHero`): badge + sentence + sub-line + one-line fix; takes engine results, emits no edits.
3. **Three dials** (`PlanDials`): retire age, spending, savings; consequence line under each; writes through the normal `handleInputsChange` path (unsaved-edits flow unchanged).
4. **Plain-English mapping layer** (`plainEnglish.ts`): pure functions engine→words (verdict sentence, lasts-to, left-at-95, storm test, milestone list). Fully unit-testable; this is where jargon dies.
5. **Weather ↔ volatility mapping:** `stormy/ordinary/kind` maps to existing `returnVolatility` presets; no new engine knobs.
6. **Persistence:** any new view state uses the existing localStorage patterns (`wealthconsole_panel_state` style keys).
7. **Routing:** each new view is a hash-route page (`#/verdict` etc.) in `viewRoutes` — no changes to existing routes.
8. **Tests:** Vitest for the mapping layer + each new component's wiring, per repo convention. `npx vitest run` green before commit.
9. **Accessibility:** verdict is real text (not SVG), sliders are real `<input type=range>` with labels, color never the only signal (badge text always present).
10. **Rollout:** ship as an additional front-door view; existing dashboard unchanged behind it. The winner may later *replace* dashboard sections per section-4 table.

## 6. How to choose

- Browse `index.html` (gallery of 40) and `dashboard.html` (full-page dashboard).
- Pick one design (or a mashup) — the requirements above apply to whichever wins.
- The most buildable set: **01 (verdict hero) + 12 (honest score) + 08 (timeline)** merged — which is roughly what `dashboard.html` demonstrates.
