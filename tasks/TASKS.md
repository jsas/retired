# TASKS.md — holistic site pass (2026-11-18)

Running ledger for the whole-site review: simplification, bug fixes, UI
consistency. `tasks/active.md` indexes this file; GitHub issues stay the source
of truth for user-facing bugs. Baseline before any edit: `npx vitest run`
→ 109 files / 1482 tests green; `npx tsc --noEmit -p tsconfig.app.json` clean.

Legend: `[x]` done + verified · `[~]` in progress · `[ ]` queued · `[!]` recommendation,
needs a product decision (not started).

## 1. Simplify: no intro screen, Dashboard is home

- [x] `S1` Delete the landing wizard as a *screen*: `#/welcome` folds to
      `dashboard` (legacy-route pattern, same as `details`/`export`), so old
      bookmarks, the RE: mark and the sitemap stay alive.
- [x] `S2` First paint is the Dashboard for everyone: remove
      `welcomeLandingGate` from `App.tsx`; the header wordmark links to
      `#/dashboard`, not `#/welcome`.
- [x] `S3` Replace the wizard's value with an inline **Set-up card** on the
      Dashboard (`src/components/console/QuickStart.tsx`): four fields — age,
      retire at, savings, spending — that compute the verdict in place. No
      wizard state, no second screen, nothing to "finish".
- [x] `S4` The card shows only while the plan is not the user's own: the active
      plan is a stock `Example - …` or still looks unset
      (`looksLikeUnsetPlan`). Editing an example never overwrites it — the card
      forks a personal plan ("My plan") on first change.
- [x] `S5` The dead Settings toggle `showWelcomeOnLoad` now means "always show
      the set-up card" instead of describing a card that no longer exists.
- [x] `S6` `promptToSaveOnSwitch` removed: autosave (#165) made the
      save-before-switch prompt obsolete, and nothing read the flag.
- [x] `S7` Landing copy that carried real weight (`About / Not advice /
      Private by design`) is not lost: it lives in Help under Legal
      (`not-financial-advice`, `data-responsibility`); verified nothing else
      pointed at `landing.json`.
- [!] `S8` **Recommendation**: seed a first-run visitor with ONE example plan.
      Today the seeds are FIVE — "Example - Early Couple" (plus its linked spouse
      row, which shows as a separate row in Plans), "Example - Partner",
      "Example - Single at 60", "Example - Semi-retirement", "Example - RDSP
      Starting Out". Five "Example - …" rows read as five of the user's own
      plans. Needs a product call: fewer seeds vs. an explicit "Example" badge
      in `ScenarioManager`.
- [x] `S9` The way from the Dashboard to the rest of the plan: one hairline row
      under the verdict naming what this plan has never been told
      (`unsetDetailGroups`, `src/lib/planDisplay.ts`: account balances, partner,
      debts, one-off events, other income, spending phases) and one button to
      Plans. Prominence from position + one dark button, not a banner. Goes
      quiet-but-present ("Review every detail") once every register holds data,
      and is hidden while the set-up card is up — one CTA per screen. A linked
      spouse plan counts as having a partner; province and the CPP/OAS
      placeholder are deliberately NOT counted, because a real answer and the
      default look identical and a wrong nudge is a nudge the user stops reading.
      Verified live in en-CA and fr-CA.
- [x] `S10` Giving default: a new charitable-giving stream now starts at **10%
      of after-tax income** (was 5% of gross). `DEFAULT_GIVING_PREFS` drives the
      Plans editor, `givingStreamSchema.basis` drives the assistant. Streams
      saved earlier keep the basis they stored — nothing back-fills them, so no
      existing plan's numbers move. Settings → Giving still edits both.

## 2. Bugs

- [x] `B1` Dead Settings controls: `showWelcomeOnLoad` and
      `promptToSaveOnSwitch` were written by Settings and read by nobody
      (`grep` over `src` + `packages` found no consumer). Fixed via S5/S6.
- [x] `B2` `#/welcome` deep link used to trap a returning user on the wizard
      with no visible way back to the app nav (the landing renders its own
      header). Folding removes the trap.
- [x] `B3` `scenarios.find(s => s.id === activeScenarioId)!` — a stale active
      id (import/delete race) blanked the whole app with a Type Error. Now
      falls back to the first plan.
- [x] `B4` Two audits (bug hunt + consistency) were run on this pass and
      **rejected on evidence**: each finding was checked before promotion and
      none survived. They cited files that do not exist
      (`src/lib/ai/engine.ts`, `src/lib/ai/tools/`, `src/lib/ai/localToolFilter.ts`,
      `src/design/projectionCharts.tsx`, `src/hooks/useLocalModelRuntime.ts`,
      `src/hooks/useSpeakAloud.ts`, `src/lib/{isFreeZone,planBudget,openRouterApiKeys}.ts`),
      called `CompareCard.tsx` dead while `pages.tsx:228,236` renders it as the
      compare page's body, said `store.test.ts:284` and the i18n language-switch
      test fail (both green), claimed `MathPage.tsx:78` labels its print button
      `t('dash.print')` (that call appears nowhere, and no such key exists), and
      said 52 of 77 French help bodies are copies of the English (measured: 1 —
      `mit-license`, a licence text). Three claims are worth keeping as
      *not bugs*: the language toggle does persist (`App.tsx:84` reads
      `config.general.locale`, `:89` writes it, so a reload keeps the choice —
      `i18nLng` is simply not a key this app uses); every `t('…')` key in the
      app resolves against the locale files (script scan, default-ns and
      `ns:key` aware — the three initial misses were i18next plural suffixes);
      and all 66 `pages.json` `dash.*` leaves are referenced, so there is no
      dead-copy pile. Suite after this pass: 110 files / 1494 tests green,
      `tsc --noEmit` clean.

- [x] `B5` **Reported by the user (screenshot, 2026-11-19):** "the height of the
      two are the same and it is unreadable" — clarified by the user to mean the
      timeline's two labels: "start drawing at" printing straight through "money
      runs out · XX". Root cause: `ProjectionTimeline` pinned every `above`
      label to ONE baseline (`AREA_TOP - 4`), so two labels that overlap
      horizontally set on top of each other, and the viewBox never grew, so
      stacking wasn't available. Fix: `pinLanes()` — greedy, per side, width
      estimated from the label string — gives a colliding label its own lane, and
      the viewBox grows upward by `labelHead`; `svgY()` undoes that shift for the
      three pointer-mapping sites (hover point, double-click anchor, spend-strip
      drag). Pins that are far apart — the shipped example, retire 55 / deplete
      84 — keep the single baseline they always had. Test pins both cases.
- [x] `B6` Every timeline pin shipped `<title>{dash.startDrawingDrag}</title>`,
      so hovering "money runs out" promised a drag it cannot do. Now emitted only
      for a pin that carries `onDragAge`.
- [x] `B7` **Reported by the user (assistant screenshot, 2026-11-19):** told
      "I want to give 10% of my after-tax income to my church every year", the
      assistant replied that RE:tired "doesn't have a direct field for ongoing
      percentage-of-income spending" and offered workarounds. `manage_giving` has
      taken `mode:'pct'` with a `gross`/`net` `basis` since #164. The tool
      description led with fixed mode and named `gross` first, so the
      on-computer model never found the capability; it now opens with the pledge
      example and `basis` defaults to `net` (see `S10`).
- [ ] `B8` `ProjectionTimeline`'s spend/market strip labels measure **8px** on
      the live Dashboard (measured 2026-11-19: the strip svg renders 993×312 from
      a `0 0 1000 314` viewBox) — the one hard readability floor found on the
      page. Not touched by the B5 fix, which only moves pin labels.

## 3. UI consistency

- [ ] `C1` Two consistency breaks, both found and verified by direct grep on
      this pass, both open:
      (a) **seven raw `<input type="checkbox">`** — `ConnectionsPage.tsx:356`
      and `:776`, `OptimizeCard.tsx:87`, `SettingsModal.tsx:222`, `:575`,
      `:589`, `:696` — while `StyleGuide.tsx:160` states that a raw checkbox in
      the app *is a bug* and `Check` (`primitives.tsx:205`) is the control that
      draws the box. Low-risk migration: `Check` itself renders
      `type="checkbox"` on an `sr-only` input inside a `<label>`, so
      `OptimizeCard.test.tsx:29`'s `toMatch(/type="checkbox"/)` still passes
      afterwards. `SettingsModal` is left alone here — it carries uncommitted
      work-in-progress.
      (b) **hardcoded hexes in the SVG charts** while `tokens.ts:15-33` exports
      the same palette: `MonteCarloChart.tsx:159-192` draws `#e2e8f0`,
      `#64748b`, `#94a3b8`, `#1d4ed8`, `#3b82f6`, `#334155` — four of them are
      literally `HAIRLINE`, `MUTED`, `FAINT` and `BLUE`, and the file already
      imports `BLUE` and then ignores it — `ContourMap.tsx:163-197` hardcodes
      `#475569` and `#fff`, and `Dashboard.tsx:174` hands the retire pin a
      literal `#475569`. Fix: import the tokens; keep a literal only where no
      token exists (the two band fills are alpha steps of `BLUE`, so they are
      legitimately local).

## 4. Recommended updates (not started — needs sign-off)

- [!] `R1` The `#/assistant` route renders a page whose only content is "the
      assistant is docked beside this page" — a page that is a pointer at
      chrome. Fold it: `agent` → open the dock on the Dashboard.
- [x] `R2` `nav.json`'s `home` label now reads "Home — the Dashboard" (fr:
      "Accueil — le tableau de bord").
- [!] `R3` The verdict chip is computed in two places (`App.tsx` and
      `Dashboard.tsx`) with the same rules written twice; the Dashboard copy
      has no `borderline` label while the header does. One shared helper.
- [!] `R4` `EXAMPLE_PLAN_PREFIX` is English-only and locale-independent, but
      plan names are user-visible; the prefix is how "is this mine?" is
      decided. A `Scenario.isExample` flag would stop name-matching being
      load-bearing.
