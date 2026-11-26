# Plain-register copy sweep + help verified against the app

Issue: #203 · Branch: `issue/203-copy-register-help-sweep` · Opened 2026-11-26

## Goal

Two things, one PR:

1. **Register.** Every heading, subtitle, tagline, section label and empty state
   in the app says what the surface shows. No aphorisms, no em-dash punchlines,
   no marketing verbs. Example to kill: `pages.json` `lifeLine`
   "Your life on one line — this exact plan".
2. **Help truth.** Every `HelpModal` section's factual claims — page names,
   control names, defaults, limits, steps — match the code and the running UI.

## Why it matters here

CLAUDE.md's guardrail is "calculator, not a planner": show consequences, never
advise. Copywriting drifts the wrong way on both counts — it promises
("this exact plan") and it editorialises ("your money, finally honest"). The
earlier pass #182 ("Replace colloquial UI copy with plain professional
register") set the target voice; this closes what it missed.

## Acceptance criteria

- [ ] No heading, subtitle, tagline or empty state in the built UI reads as
      copywriting. Enumerated per page, not sampled.
- [ ] Every `HelpModal` section re-read against the code; stale page/control
      names, numbers and steps corrected.
- [ ] Both locales' keys stay in parity (i18n test green), `npx vitest run`
      green, `tsc --noEmit -p tsconfig.app.json` clean, `npm run build` green.
- [ ] Two documented iterations: iteration 1 = sweep + verify against the
      rendered UI; iteration 2 = fresh re-read of the same strings, with the
      leftovers recorded below.
- [ ] PR titled `<summary> (closes #203)`, squash-merged only after sign-off.

## Method

1. **Inventory.** Page catalog → route list; every heading-level string with
   `file:line`, i18n key and current text; every help section → list of factual
   claims. (`CopyInventory` pass; results appended below.)
2. **Iteration 1 — headings.** Rewrite by surface (dashboard → plan pages →
   settings → assistant → data/connections → help). Locale key + component
   strings in the same commit so neither drifts.
3. **Iteration 1 — help.** Claim-by-claim verification against source; fix in
   place, noting which claims were already true.
4. **Verify.** Production build, then walk every route in the browser reading
   each heading (numeric capture, not screenshots).
5. **Iteration 2.** Re-read the whole string set with fresh eyes against the
   rule "would a CFO write this in a report?"; re-check help against the same
   routes. Record what changed in this second pass.
6. **Ship.** Commit per surface, push, open the PR.

## Rules for the rewrite

- Say what is on the surface: `Balance projection by age`, not `Your money's
  story`.
- Kill: em-dash aphorisms, rhetorical questions, second-person promises
  ("see how you'd feel"), intensifiers (`truly`, `finally`, `effortlessly`,
  `powerful`, `smart`), `-ble` claims (`unmissable`), and anything that reads
  as advice rather than output.
- Keep: plain domain nouns the user already knows (`GIS`, `RRIF`, `TFSA`,
  `contribution room`). Do not flatten precise words into vague ones.
- Numbers and units stay as-is; this is a voice change, never a factual one —
  except in help, where the facts themselves get corrected.

## Iteration 1 — findings

(being filled in)

## Iteration 2 — leftovers

(filled after the second read)
