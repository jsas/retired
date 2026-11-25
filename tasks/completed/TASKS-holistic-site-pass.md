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
- [x] `S8` **Recommendation**: seed a first-run visitor with ONE example plan.
      Today the seeds are FIVE — "Example - Early Couple" (plus its linked spouse
      row, which shows as a separate row in Plans), "Example - Partner",
      "Example - Single at 60", "Example - Semi-retirement", "Example - RDSP
      Starting Out". Five "Example - …" rows read as five of the user's own
      plans. Decision (2026-11-19): keep all five — each one teaches a different
      register (couple + linked spouse, partner, single at 60, semi-retirement,
      RDSP). The real fix is `R4`: example-ness becomes plan state instead of an
      English name prefix, so a seed can be badged and never mistaken for the
      user's own plan.
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
- [x] `B8` `ProjectionTimeline`'s spend/market strip labels measure **8px** on
      the live Dashboard (measured 2026-11-19: the strip svg renders 993×312 from
      a `0 0 1000 314` viewBox) — the one hard readability floor found on the
      page. Not touched by the B5 fix, which only moves pin labels.
      Fixed: the strips have a 10px readability floor and their lane titles read
      11px; the spend strip's childless `<text>` node is gone and the market
      strip's `0%` sits below the curve instead of under it.
- [x] `B9` **A storage failure is silent.** `App.tsx:221` swallows a rejected
      `AppStore.open()` into `console.warn('SQL store failed to open; running
      in-memory')`, so `store` stays `null`: the persist effect (`:233`) is
      `store?.persist(…) ?? false` — a no-op that looks like success — and the
      "Changes may not be saved" banner can never fire, because its subscription
      (`:241`) returns early when `store` is null. An hour of editing in a
      private window reads as saved and is not. Fix: an open failure is a visible
      state on the existing banner channel (with retry), never a steady state.
      Fixed: a rejected open sets `storeUnavailable`, bannered with a Retry that
      re-runs the boot effect (`bootNonce`).
- [x] `B10` **An edit during cold start can replace the user's plans.** The
      store's contents are adopted only `if (!dirty)` (`App.tsx:207-216`), so a
      lever moved while wasm/OPFS is still opening keeps the synchronous seed —
      which is `buildDefaultScenarios()` whenever the localStorage mirror is
      missing or undecodable (`readSeedScenariosFromMirror`, `db.ts:89`, returns
      `null` from a whole-body `catch`). The persist effect then writes that seed
      through `saveScenarios`, whose first statement is `DELETE FROM scenarios`
      (`db.ts:332`). The adopt also sits *inside* the `setHasUnsavedChanges`
      updater, which is meant to be pure. Fix: adopt into pending state and merge
      with the in-flight edit; move the `set*` calls out of the updater.
      Fixed: `mergeOnOpen` (`src/lib/storeMerge.ts`, 6 tests) — adopting is
      unconditional, a dirty edit wins only for its own plan, and both persist
      effects are gated on `settled`, so a seed list can never reach disk.
- [x] `B11` **One unreadable row kills all persistence.** `loadScenarios`
      (`db.ts:315-323`) and `loadConfig` (`:367`) `JSON.parse` per row with no
      `try`, and `AppStore.open` calls them bare (`store.ts:80-83`): a truncated
      blob rejects the whole open, which lands in `B9`'s silent in-memory mode.
      A per-row guard degrades that to one lost plan instead of no saving at all.
      Fixed: per-row guards in `loadScenarios`, `loadConfig` and
      `SqliteRevisionStore.loadAll` skip the row, name it in the console and count
      it into `AppState.unreadableRows`, which banners; `configLoadWarning` is now
      the code `config-reset` so the copy translates.
- [x] `B12` **Importing your own backup loses data.** `retirementInputsSchema`
      (`schemas.ts:168-203`) has no `marketPeriods` and `appConfigSchema`'s
      `general` (`:296-298`) carries only `showSetupCardOnLoad` — no `locale` —
      while the engine has both (`retirementEngine.ts:128`, `appConfig.ts:195`).
      zod strips unknown keys and the doc is validated through `appDbDocSchema`
      (`src/data/schemas.ts:21`, called at `db.ts:425`), so Data → Export then
      Import deletes the market-hypothesis anchors and resets the language.
      Fixed: `marketPeriodSchema` and `general.locale` added to the portable
      schemas; both round-trip through `parseAppDbDoc` (`schemas.test.ts`).
- [x] `B13` **Clearing a number box stores `null`.** `Num` (`primitives.tsx:190`)
      emits `NaN` when the field is emptied; autosave's
      `JSON.parse(JSON.stringify(inputs))` (`App.tsx:398`) turns `NaN` into
      `null`, and the engine's arithmetic reads `null` as 0. Clear an RDSP or
      TFSA balance, wait 1.2 s, reload: the balance is gone, with nothing on
      screen saying so. `DetailsPage.tsx:651` guards with `Number.isFinite`; the
      neighbouring call sites (`:630`, `:631`, `:633`, `:655`, `:656`) do not.
      Fixed: `Num` keeps the draft of what is being typed and hands the plan only
      a finite number, so an emptied or half-typed box can no longer reach the
      engine, and blur restores the plan's value instead of leaving the box blank
      over a number. A field for which blank *is* the value passes the new
      `onClear` — band amount, band share, the volatility override, the FHSA
      opening age — which replaces the per-call-site `Number.isFinite` guards.
      `primitives.num.test.tsx` drives real input and focusout events, which the
      static-markup suite in `primitives.test.tsx` cannot.
- [x] `B14` **The assistant's money ignores the language.** `ToolContext.locale`
      is declared (`tools.ts:432`) and threaded from the app, and never read:
      `money()` hardcodes `new Intl.NumberFormat('en-CA', …)` (`:464`). In French
      the sentences are French and every figure is `$1,234` instead of `1 234 $`.
      Fixed: `money()` became `moneyFor(locale)` and is built from `ctx.locale`
      at every call; `summarizeResults`, `delta` and the `proposeRevert`
      checkpoint dates take the locale too, so a French session reads `1 234 $`
      throughout instead of `$1,234`.
- [x] `B15` `moveAnchor` (`ProjectionTimeline.tsx:321-326`) guards `if (!pt)` but
      not the `anchors.find()` result, unlike its sibling `moveEvent` (`:315`). If
      the anchor disappears mid-drag, every later pointermove emits
      `onAnchorsChange` with an unchanged array — dirtying the plan and recording
      no-op autosave revisions while the drag appears dead. One `|| !a`.
      Fixed: `|| !a`, and the optional chains on the comparison below it are
      dropped now that the anchor cannot be undefined there.
- [x] `B16` **Money is printed outside the shared formatter**, so French gets
      English currency placement: `Dashboard.tsx:227` and `EvidenceRow.tsx:24`
      build `'$' + …toLocaleString(locale)` (→ `$1 234`, not `1 234 $`),
      `ContourMap.tsx:113` builds `'$' + … + 'k'` with no locale at all,
      `SettingsModal.tsx:268,271` pass `.toLocaleString()` with no locale into
      the lever hints, `ScheduleTable.tsx:34`'s `locale = 'en-CA'` *default
      argument* hides exactly this at the next call site, and `primitives.tsx:302`
      does it inside a design primitive with `'en-CA'` written in.
      Fixed: `formatCurrency(value, locale)` from `src/lib/locale.ts` is the only
      money formatter left in the chrome — `EvidenceRow`, `ScheduleTable` (whose
      `'en-CA'` default argument is deleted), `OptimizeCard`, `MonteCarloChart`,
      `AccountBars`, the lever hints and the Dashboard all call it. Left short on
      purpose: `ContourMap`'s `$600k` axis labels and `MonteCarloChart`'s compact
      money, neither of which the shared formatter can emit, and
      `ConnectionsPage.tsx:477`'s token count, which is a window size rather than
      money and so follows the browser's locale.

## 3. UI consistency

- [x] `C1` Two consistency breaks, both found and verified by direct grep on
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
      Fixed: (a) every raw checkbox and radio outside `primitives.tsx` is now
      `Check`, `Radio` or `RadioGroup` — the group hands its members the shared
      `name`, so a list of radios cannot forget to group — and `SettingsModal`
      turned out to carry no uncommitted work after all, so its controls went too;
      `OptimizeCard.test.tsx:29`'s pin still passes. (b) the charts read
      `tokens.ts`: `toneColor` replaces the per-component dot ternaries and each
      chart names its own colours once, so a legend swatch and the thing it
      explains cannot drift apart. Literals survive only where no token exists —
      the two `BLUE` alpha band washes and the axis-title greys. `Dashboard.tsx`
      no longer hands the retire pin its own `#475569`; it takes
      `ProjectionTimeline`'s `PIN_INK` default like every uncoloured pin.
- [x] `C2` **Chrome that was never put through i18n**, verified by reading each
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
      Fixed: `AccountBars` takes a translated `note` — the primitive renders no
      words of its own — and the Dashboard supplies `dash.accountSharesNote`; the
      banner pair and its dismiss titles went with `B9`; the compaction row reads
      `assistant.compactedName` / `compactedSummary`, and the two
      `window.prompt('Copy this prompt:')` fallbacks are gone. Still hardcoded:
      `AgentPage.tsx`'s "context window too small" paragraph, which needs a
      `{{tokens}}` key before it can move.
- [x] `C3` **The token layer exists and is half-used**, measured this pass: 44
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
      Partly fixed. The widgets and colours landed: every raw checkbox and radio
      is behind `Check` / `Radio` / `RadioGroup` (`C1(a)`), `DownMarketCheck`'s
      third dot-and-label row is a `Chip`, `PageChrome`'s verdict dot reads
      `toneColor` instead of a literal `#94a3b8`, `ProjectionTimeline` names its
      ramp once instead of repeating literals per legend swatch, `NUM_CLASS` is
      live (`className="num` 53 → 46, none left inside `primitives.tsx`), `TEXT`
      is deleted, `BLUE_WASH_*` is what `ContourMap` actually paints with, and
      `HelpModal` neither highlights in off-palette yellow nor falls back to raw
      key names.
      The recipes moved in this pass. The survey found 203 hand-typed button /
      field / panel / badge recipes; 114 call-sites across 14 files now read from
      `cls`, and the rest stay literal on purpose (each one named below).
      Measured the same way on both sides (`src/`, tests, `tokens.ts` and
      `StyleGuide` excluded): `bg-slate-900` 38 → 16, `border border-slate-200`
      42 → 6, `border border-slate-300` 67 → 11, and the field recipe is
      hand-typed in 6 files instead of 11. `cls` gained only sizes the pages
      already repeat, each measured off existing controls — `primaryBtnSm`,
      `primaryBtnXs`, `disabledBtn` (a disabled CTA keeps the primary's box and
      loses its fill), `hairlineBtnSm`, `inputSm`, `numField` (carries `num`, not
      `font-mono`: mono is the assistant-rail and Connections taste, not law),
      `panel` / `panelBare` / `panelTinted`, `badgeDark` / `badgeHairline` and
      `mark` — and every one is shown in `StyleGuide`. Uses after: `numField` 18,
      `inputSm` 16, `panelBare` 15, `hairlineBtnSm` 14, `primaryBtnSm` 14,
      `panel` 11, `hairlineBtn` 13, `primaryBtn` 6, `input` 5, `panelTinted` 5,
      `primaryBtnXs` 3, `badgeDark` 3, `badgeHairline` 3, `disabledBtn` 2,
      `mark` 2. Each token is complete for the properties it sets, and the doc
      block over `cls` says why: Tailwind settles same-specificity utilities by
      stylesheet order, not by the order they are written, so stacking a stray
      `px-3` or `text-xs` beside one is a coin-flip, not an override.
      The swap is pixels, not names. 932 of the 969 class attributes the sweep
      touched carry an identical utility set once the tokens are expanded and the
      sites are compared pairwise; the other 37 differ only inside a whitelist
      (font size ≤2px, slate→slate steps, one 2px padding step, hover-only
      colour). Confirmed in the running app: computed styles over 769 controls on
      16 routes moved only by those steps — 11.5→12px on the 9 Details/plan
      hairline buttons (their sections follow by 1.25px), 12→13px on the
      `inputSm` fields (assistant-rail model select, `OptimizeCard.tsx:167`,
      `ConnectionsPage.tsx:1043/1102`, the Settings basis select, RRIF rate and
      prompt textareas), 6→8px padding on the 9 Settings tax-table fields,
      10→8px at `DataPage.tsx:280/791` and `OptimizeCard.tsx:167`, slate-700/800
      →slate-900 on fields, slate-700→600 on hairline buttons, and nothing else:
      no radius, box size, font family, disabled state or
      `text-white`/`bg-slate-900` pair moved.
      Left hand-typed, deliberately: the ~40 one-sided dividers
      (`border-t|b|l|y border-slate-200`) are structure, not a card;
      `MonteCarloChart.tsx:93` is a hairline button with a white fill and
      `font-medium`, which is neither hairline token; the selected halves of
      segmented controls and the `Check`/`Radio` fills (`MathPage.tsx:313`,
      `PageChrome.tsx:287`, `DataPage.tsx:172/188`, `AgentPage.tsx:670/1986/2306`,
      `primitives.tsx:242/325`) are state colours, not call-to-action;
      `AgentPage.tsx`'s chat bubble (`:1483`), the conditional-padding CTA
      (`:2349`), its `px-4 py-2 text-xs` one-off (`:2276`), the borderless model
      select (`:2115`) and the three mono JSON `<textarea>`s
      (`:2458`/`:2515`/`:2535`) are chat and code surfaces where 13px sans would
      be a redesign; `HelpModal.tsx:109` is an icon-padded search box
      (`pl-8 pr-8`); `MathPage.tsx:325`'s choice-row select carries
      `cursor-pointer`; `ConnectionsPage.tsx:1092` is a 10px uppercase tag; the
      print sheet keeps its own geometry (`PrintSummary.tsx`,
      `PrintOptionsCard.tsx`, including the `h-[22px]` monogram at
      `PrintSummary.tsx:486`) as does `PageChrome.tsx:403`'s `h-5 w-5
      text-[8px]` one; `primitives.tsx:104`'s `h-4 w-4` help badge, `:510`'s
      progress track and the `Modal` scrim (`:539`) are single-source components;
      `Markdown.tsx:17`'s `[&_pre]`/`[&_code]` washes and `helpMarkdown.tsx:92`'s
      `<pre>` are descendant selectors, not controls; `ScheduleTable.tsx:560-595`
      is table-cell geometry; and the 15 bare text-buttons
      (`DataPage.tsx:264/724/767/799`, `SettingsModal.tsx:816/990`,
      `AgentPage.tsx:340/352/607/648/1912/2030/2046/2141/2163`) have no box to
      name. Left open by choice: the four
      `window.confirm` calls and the provinces `window.prompt` in `SettingsModal`
      are translated and the prompt takes real input, so a styled shell buys
      nothing there — which is why `Modal` stays exercised only by `StyleGuide`
      and `AppHeader` only by its own test. The dead `common:apply` the finding
      named is already gone; the live `optimizer:apply` stays.
- [x] `C4` **Scenario ids were minted two ways.** `App.tsx:568`/`:588` mint
      `scenario-${Date.now().toString(36)}`, while `App.tsx:634` (the minted
      partner plan) and `ScenarioManager.tsx:60`/`:71` (New plan, Duplicate)
      minted `scenario-${Date.now()}` — decimal, a dozen-odd characters, against
      the base-36 ids everything else in the app uses (`rev-`, `conn-`, `chat-`,
      `mem-`, `cp-`). Nothing parses the format, so this was drift, not a bug —
      but the id is a stored key: the scenarios table, the exported `.sqlite`, the
      backup document and the revision rows all carry it.
      Fixed: the three stragglers take `.toString(36)`; one format everywhere.

## 4. Recommended updates (not started — needs sign-off)

- [x] `R1` The `#/assistant` route renders a page whose only content is "the
      assistant is docked beside this page" — a page that is a pointer at
      chrome. Fold it: `agent` → open the dock on the Dashboard.
      Fixed: `agent` carries the catalog's `foldedInto` (like `#/welcome` and
      `#/steering`), so the route parses, the Dashboard renders, and the dock
      opens on the route; the page's copy (`agentPage.*`) is gone in both
      locales, the folded view leaves `searchablePages()` and `sitemap.json`, and
      the chrome opens the rail from a route signal (`PageRouteContext`, provided
      by `App`). What that replaces: the page subtree was keyed on `view ===
      'agent'`, so typing `#/assistant` while already on the Dashboard reopened
      the rail by *remounting the page* — scroll, open cards and half-typed
      inputs gone. Now the same mount opens it. Verified in the browser from a
      closed dock both from the Dashboard (where `<main>` keeps its node identity
      across the navigation, and the pref stays `0` so a close still sticks) and
      from `#/print`; `PageChromeDock.test.tsx` pins the live open.
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
- [x] `R4` `EXAMPLE_PLAN_PREFIX` is English-only and locale-independent, but
      plan names are user-visible; the prefix is how "is this mine?" is
      decided. A `Scenario.isExample` flag would stop name-matching being
      load-bearing.
      Fixed: `Scenario.isExample`, set on all five seeds in
      `buildDefaultScenarios`; stored as `scenarios.is_example` (schema v2) so it
      travels in the exported `.sqlite` and the backup document, and read by the
      set-up card, the plan-list badge, and `list_scenarios`.
      `migrateScenario` still honours the old prefix for rows that predate the
      column, then never rewrites the flag from a name again.
