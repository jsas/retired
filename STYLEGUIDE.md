# RE:tired — Style Guide

The source of truth for the beta skin's visual language, distilled from the
winning f7 finalist. Two halves, kept in lock-step:

- **This file** — the principles and rules, in prose. The "why".
- **`src/design/`** — the same rules as live code. The "what".
  - `tokens.ts` — every colour, size, and shared class, named once.
  - `primitives.tsx` — the reusable components (`Fader`, `Chip`, `VerdictHero`, `Panel`).
  - `StyleGuide.tsx` — a page that renders all of it, reachable in dev at
    `http://localhost:5175/retired/?beta#/styleguide`. If this page and the app
    disagree, the code in `src/design/` is wrong — fix it there, not here.

If you change a colour, a size, or a rule, change it in `tokens.ts` /
`primitives.tsx` first, then let the style-guide page reflect it. Never fork a
one-off style inside a page.

---

## The three-word version

**Flat. Hairline. One accent.**

The design gets out of the way of the number. Structure comes from thin rules
and type weight, not boxes. Colour is reserved for the verdict — everything
else is slate.

## Principles

1. **Verdict first.** Every screen answers the question before it asks
   anything. One sentence, plain English, the largest text on the page. The
   controls come *after* the answer, not before.

2. **Flat.** No shadows, no rounded corners. Depth is a lie the data doesn't
   need; leave the browser's default corner radius alone. If two regions need
   separating, use a 1px border or whitespace — never a lifted surface.

3. **Hairlines, not cards.** Group content with a bottom border and an
   uppercase label (the `Panel` primitive). Never wrap a block in a filled or
   bordered box to make it feel "contained" — the border *is* the container.

4. **One accent, used semantically.** Blue means the plan holds; red means it
   runs out early; amber appears only for the borderline case. Never use the
   three as decoration — this is a verdict, not a traffic light. The UI's one
   job is to make that distinction instantly readable.

5. **Numbers are tabular and right-sized.** Any figure the user compares
   across states gets the `num` class (`font-variant-numeric: tabular-nums`)
   so it doesn't jitter as it changes. Money and ages are always aligned.

6. **Touch is first-class.** Sliders get a 24px hit strip; draggable surfaces
   use pointer events with capture and `touch-action: none`. If a finger can't
   hit it, it ships broken. The phone is not a smaller desktop.

## The vocabulary

| Token | Value | Used for |
|---|---|---|
| `BLUE` | `#1d4ed8` | the plan holds — verdict, boundary line, dot |
| `BLUE_DEEP` | `#1e3a8a` | the deep end of the contour wash |
| `RED_TEXT` / `RED_DOT` | `#be123c` / `#f43f5e` | runs out early — text / dot, chip |
| `AMBER_TEXT` / `AMBER_DOT` | `#b45309` / `#f59e0b` | borderline only |
| `INK` | `#0f172a` | headings, primary buttons |
| `BODY` | `#1e293b` | body text |
| `MUTED` | `#64748b` | secondary text |
| `FAINT` | `#94a3b8` | captions, axis labels |
| `HAIRLINE` | `#e2e8f0` | the 1px structural border |
| `HAIRLINE_STRONG` | `#cbd5e1` | input borders |

**Type scale** (px): verdict 28 · body 13.5 · label 13 · section 11 (uppercase,
tracking 0.16em) · caption 11. Small and tight — the number, not the chrome.

## The components

- **`VerdictHero`** — the answer. Uppercase eyebrow, one sentence, one
  supporting line. Nothing else on the page competes with it.
- **`Fader`** — the one slider. 24px hit strip, 4px hairline track, flat
  square thumb. No fill to the left; position is the signal.
- **`Chip`** — a stateless status pill: square dot + plain words. Colour
  carries the verdict.
- **`Panel`** — the only container: hairline rule + uppercase label.

## What we never do

- Cards, boxes, or panels with fills/shadows to group content.
- Rounded corners or `border-radius` on any element.
- Gradients or colour used decoratively (the contour wash is data, not decor).
- A third state shown as prominently as holds/short — borderline stays quiet.
- Tiny tap targets, hover-only affordances, or drag handles that need a mouse.

## The contour map

The map (retire age × yearly spending) is the skin's signature. Its ground is
computed live from the real engine: for each column, bisection finds the
spending where the plan stops holding, and the chain of points is smoothed
into a Catmull-Rom → cubic-bezier curve — a topographic line, not stepped
cells. Below the line a white→blue wash says the money lasts; the line itself
is a single crisp blue stroke; a fainter inner contour marks "comfortably past
the plan". Above the line the page is just paper. One draggable dot; the same
two levers appear as `Fader`s for hands that don't drag.
