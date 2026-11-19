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
      A **second** round of the same two audits, filed later the same night, was
      a different matter: it cited files that exist, and everything below passed
      line-by-line checking before promotion (`B9`–`B16`, `C2`–`C3`).

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
- [ ] `B9` **A storage failure is silent.** `App.tsx:221` swallows a rejected
      `AppStore.open()` into `console.warn('SQL store failed to open; running
      in-memory')`, so `store` stays `null`: the persist effect (`:233`) is
      `store?.persist(…) ?? false` — a no-op that looks like success — and the
      "Changes may not be saved" banner can never fire, because its subscription
      (`:241`) returns early when `store` is null. An hour of editing in a
      private window reads as saved and is not. Fix: an open failure is a visible
      state on the existing banner channel (with retry), never a steady state.
- [ ] `B10` **An edit during cold start can replace the user's plans.** The
      store's contents are adopted only `if (!dirty)` (`App.tsx:207-216`), so a
      lever moved while wasm/OPFS is still opening keeps the synchronous seed —
      which is `buildDefaultScenarios()` whenever the localStorage mirror is
      missing or undecodable (`readSeedScenariosFromMirror`, `db.ts:89`, returns
      `null` from a whole-body `catch`). The persist effect then writes that seed
      through `saveScenarios`, whose first statement is `DELETE FROM scenarios`
      (`db.ts:332`). The adopt also sits *inside* the `setHasUnsavedChanges`
      updater, which is meant to be pure. Fix: adopt into pending state and merge
      with the in-flight edit; move the `set*` calls out of the updater.
- [ ] `B11` **One unreadable row kills all persistence.** `loadScenarios`
      (`db.ts:315-323`) and `loadConfig` (`:367`) `JSON.parse` per row with no
      `try`, and `AppStore.open` calls them bare (`store.ts:80-83`): a truncated
      blob rejects the whole open, which lands in `B9`'s silent in-memory mode.
      A per-row guard degrades that to one lost plan instead of no saving at all.
- [ ] `B12` **Importing your own backup loses data.** `retirementInputsSchema`
      (`schemas.ts:168-203`) has no `marketPeriods` and `appConfigSchema`'s
      `general` (`:296-298`) carries only `showSetupCardOnLoad` — no `locale` —
      while the engine has both (`retirementEngine.ts:128`, `appConfig.ts:195`).
      zod strips unknown keys and the doc is validated through `appDbDocSchema`
      (`src/data/schemas.ts:21`, called at `db.ts:425`), so Data → Export then
      Import deletes the market-hypothesis anchors and resets the language.
- [ ] `B13` **Clearing a number box stores `null`.** `Num` (`primitives.tsx:190`)
      emits `NaN` when the field is emptied; autosave's
      `JSON.parse(JSON.stringify(inputs))` (`App.tsx:398`) turns `NaN` into
      `null`, and the engine's arithmetic reads `null` as 0. Clear an RDSP or
      TFSA balance, wait 1.2 s, reload: the balance is gone, with nothing on
      screen saying so. `DetailsPage.tsx:651` guards with `Number.isFinite`; the
      neighbouring call sites (`:630`, `:631`, `:633`, `:655`, `:656`) do not.
- [ ] `B14` **The assistant's money ignores the language.** `ToolContext.locale`
      is declared (`tools.ts:432`) and threaded from the app, and never read:
      `money()` hardcodes `new Intl.NumberFormat('en-CA', …)` (`:464`). In French
      the sentences are French and every figure is `$1,234` instead of `1 234 $`.
- [ ] `B15` `moveAnchor` (`ProjectionTimeline.tsx:321-326`) guards `if (!pt)` but
      not the `anchors.find()` result, unlike its sibling `moveEvent` (`:315`). If
      the anchor disappears mid-drag, every later pointermove emits
      `onAnchorsChange` with an unchanged array — dirtying the plan and recording
      no-op autosave revisions while the drag appears dead. One `|| !a`.
- [ ] `B16` **Money is printed outside the shared formatter**, so French gets
      English currency placement: `Dashboard.tsx:227` and `EvidenceRow.tsx:24`
      build `'$' + …toLocaleString(locale)` (→ `$1 234`, not `1 234 $`),
      `ContourMap.tsx:113` builds `'$' + … + 'k'` with no locale at all,
      `SettingsModal.tsx:268,271` pass `.toLocaleString()` with no locale into
      the lever hints, `ScheduleTable.tsx:34`'s `locale = 'en-CA'` *default
      argument* hides exactly this at the next call site, and `primitives.tsx:302`
      does it inside a design primitive with `'en-CA'` written in.

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
- [ ] `C2` **Chrome that was never put through i18n**, verified by reading each
      site: `primitives.tsx:321` — `AccountBars`, a design primitive, renders the
      English sentence "Shares of … at that age. The mix shifts as the plan
      moves.", so the Dashboard's account block is English in French;
      `App.tsx:951-959` — the "Changes may not be saved" banner body is raw
      English JSX and its dismiss button hardcodes `title="Dismiss this warning"`
      (`:943`, `:960`) while translated `common:dismissWarning` /
      `common:dismissSettingsWarning` already exist in both trees;
      `AgentPage.tsx:1112` — the compaction tool row (`'context compacted'`,
      "Older messages were summarized to fit the context window.") and
      `:2405`/`:2484`'s `window.prompt('Copy this prompt:')` are English-only.
      The banner pair is duplicated markup too (`:937` and `:951` are the same
      amber row, with off-token `bg-amber-50 border-amber-300` and a `rounded`
      control, against the flat rule asserted in `PrintOptionsCard.test.tsx:41`).
- [ ] `C3` **The token layer exists and is half-used**, measured this pass: 44
      `bg-slate-900` literals against 8 `cls.primaryBtn`, 42
      `border border-slate-200` against 7 `cls.hairlineBtn`, 67
      `border border-slate-300` against 6 `cls.input` — the hand-typed copies are
      where the padding and sizes drift. Also: no `Radio` primitive, and two raw
      `<input type="radio">` (`SettingsModal.tsx:199`, `:746`) beside the seven raw
      checkboxes in `C1(a)`; `AppHeader`, `Modal` and `Chip` are referenced from
      nothing but `StyleGuide` and their own tests, while destructive flows go
      through `window.confirm` (`SettingsModal.tsx` ×4) and `window.prompt`
      (`AgentPage.tsx` ×2) — so the styled dialog shell is dead code and native
      chrome carries the destructive confirmations; `PageChrome.tsx:154`
      re-implements `Chip`'s tone→colour map with a literal `#94a3b8`;
      `DownMarketCheck.tsx:31-39` re-implements the same dot-and-label row a third
      time; `ProjectionTimeline.tsx:506` writes `stroke="#f59e0b"` with `AMBER_DOT`
      imported at `:23` and identical literals repeated per legend swatch, so a
      legend can silently mislabel its series; `tokens.ts:36` `TEXT` is referenced
      by no component and has drifted from the sizes actually used, and
      `BLUE_WASH_FROM/_TO` (`:17-18`) plus `NUM_CLASS` (`:45`) survive only in
      tokens and one assertion; `HelpModal.tsx:30` highlights search hits with
      `bg-yellow-200`, a colour in no palette, and `:56`'s
      `{ defaultValue: section }` reintroduces the silent English fallback that
      `i18n.ts:53-63` removed; `common:apply` is a key nothing asks for.

## 4. Recommended updates (not started — needs sign-off)

- [!] `R1` The `#/assistant` route renders a page whose only content is "the
      assistant is docked beside this page" — a page that is a pointer at
      chrome. Fold it: `agent` → open the dock on the Dashboard.
- [x] `R2` `nav.json`'s `home` label now reads "Home — the Dashboard" (fr:
      "Accueil — le tableau de bord").
- [x] `R3` The verdict chip was computed twice: `App.tsx` and `Dashboard.tsx`
      wrote the same borderline rule separately, and the Dashboard copy picked its
      label from holds/short only — so a borderline plan showed an amber dot
      reading "runs short" on the home page while the header on every other page
      said "borderline". Now one `verdictChip(pot, maxAge, labels)` in
      `src/lib/planDisplay.ts` (with the margin named `BORDERLINE_YEARS`), called
      by both; `planDisplay.test.ts` pins holds, the exact borderline boundary,
      and a real shortfall.
- [!] `R4` `EXAMPLE_PLAN_PREFIX` is English-only and locale-independent, but
      plan names are user-visible; the prefix is how "is this mine?" is
      decided. A `Scenario.isExample` flag would stop name-matching being
      load-bearing.
