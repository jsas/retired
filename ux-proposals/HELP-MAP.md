# HELP-MAP.md — the help system, as a teaching tool

The plan of record for turning Help into a single-source, searchable, linkable
knowledge base with small `?` hints scattered across the app. Sibling to
`BETA-MAP.md`. Same acceptance rule: **nothing is dropped, nothing is
duplicated.**

## 0. The problem

Today `HelpModal.tsx` is 928 lines of hand-written JSX. Its entries are real
and good — but they only have *section*-level anchors (`#help-inputs`), so
nothing outside the page can link to a single concept. There is no way for a
control on the dashboard to say "what's this?" and land the user on the exact
paragraph that explains it. And because the text lives inside one component,
any `?` hint we add elsewhere would **re-type the explanation** — a second
source of truth that drifts the first time we edit one and not the other.

## 1. The design in one paragraph

There is **one data source** (`src/help/topics.ts`) that owns every help
topic: a unique id, a title, the body (the teaching text), and search
keywords. Two things render from it and nothing else holds the text:

- the **Help page** renders the whole list, searchable, each topic a
  linkable anchor (`#/help?topic=<id>`);
- a **`?` hint component** (`HelpHint`, in `src/design/primitives.tsx`) shows
  a small popup whose body is *the same topic's body*, plus a "more in Help →"
  link to that topic's anchor.

The popup never re-states the explanation — it reads the topic. One source of
truth. Edit the topic, the page and every popup that references it change
together.

## 2. The data source (`src/help/topics.ts`)

```ts
interface HelpTopic {
  id: string;        // unique kebab-case — the anchor + the popup's reference
  title: string;     // the popup's heading and the page's entry title
  body: ReactNode;   // the teaching text — rendered identically in both places
  keywords: string[]; // extra search terms (synonyms, acronyms, "rrsp", "clawback")
  section: string;   // grouping on the page (People / Accounts / Levers / …)
}
```

- `HELP_TOPICS: HelpTopic[]` — the flat list, in page order.
- `helpTopic(id)` — lookup; the popup and the anchor resolver both use it.
- `searchHelpTopics(query)` — the page's search (matches title, body text,
  and keywords). Returns topics in page order.
- Ids are **stable** — they are URLs. Renaming one is a breaking change to
  every `?` that points at it, so they're chosen once, kebab-case, no spaces.

Because the body is `ReactNode`, topics keep the rich formatting the current
HelpModal already has (bold terms, short lists). The data source is a `.tsx`
so bodies can be JSX.

## 3. The `?` hint component (`HelpHint`)

A design-system primitive, so it obeys the flat/hairline/square rules and is
documented in the Style Guide next to Chip and Footnote.

```
[ label text  (?)]            <- a small square ? button, hairline border,
                                 sits inline at the end of a label
        │
        ▼ (click / tap — not hover: touch is first-class, rule §6)
   ┌───────────────────────────┐
   │ Title                     │  <- the topic title
   │ The teaching body, the    │  <- the SAME topic body the page renders
   │ same words as the page.   │
   │ More in Help →            │  <- links to #/help?topic=<id>
   └───────────────────────────┘
```

- Flat, hairline border, no shadow, no radius — a bordered box, not a bubble.
- Opens on click/tap, closes on outside-tap, `Esc`, or tapping the `?` again.
- Positioned so it never clips off-screen (flips below/above, hugs the edge).
- Small: a `w-72` (18rem) popup, body text at caption size, right-sized numbers.

## 4. The Help page — searchable + linkable

Rewrite `HelpModal` to render **from the data source**:

- **Search box** filters topics by `searchHelpTopics`.
- **Table of contents** groups surviving topics by section.
- **Each topic** is an `<section id="topic-<id>">` anchor. A URL like
  `#/help?topic=cpp-start` opens the page scrolled to that topic (and flashes
  it). This is the target every `HelpHint`'s "More in Help →" points at.
- Topic ids are shown nowhere in the UI — they're machinery, not content.

## 5. The topic table — id → teaching text → where the `?` lands

The full list. `? placements` names the surface + control the hint attaches
to. (The legal/glossary tail of the old HelpModal becomes topics too, so
nothing is dropped; they just don't need a `?` anywhere.)

| id | Title | Section | `?` placements |
|---|---|---|---|
| `current-retirement-max-age` | Current / retirement / max age | People | Details ▸ Personal Profile |
| `province` | Province | People | Details ▸ Personal Profile |
| `include-spouse` | Include spouse | People | Details ▸ Spouse |
| `built-in-vs-linked-spouse` | Built-in vs linked spouse | People | Details ▸ Spouse |
| `spouse-approximation` | Spouse approximation | People | Details ▸ Spouse |
| `rrsp` | RRSP | Accounts | Details ▸ Account Balances |
| `tfsa` | TFSA | Accounts | Details ▸ Account Balances |
| `taxable` | Taxable (non-registered) | Accounts | Details ▸ Account Balances |
| `cash-cushion` | Cash cushion | Accounts | Details ▸ Account Balances |
| `contributions` | Contributions ($/yr) | Accounts | Details ▸ Contribution Rates |
| `contribution-room` | Contribution room | Accounts | Details ▸ Contribution Rates |
| `rdsp` | RDSP | Accounts | Details ▸ RDSP |
| `fhsa` | FHSA | Accounts | Details ▸ FHSA |
| `income` | Income (pensions & work) | Income | Details ▸ Income |
| `cpp-start-age` | CPP start age & amount | Income | Details ▸ Government Benefits |
| `oas-start-age` | OAS start age | Income | Details ▸ Government Benefits |
| `years-in-canada` | Years in Canada (OAS) | Income | Details ▸ Government Benefits |
| `gis` | GIS | Income | Help page (cross-linked from `oas-start-age`) |
| `cash-events` | Cash events (in / out) | Income | Details ▸ Cash Events |
| `desired-spending` | Desired spending | Spending | Dashboard fader · Details lever |
| `spending-phases` | Go-go / slow-go / no-go | Spending | Details ▸ Spending Phases |
| `withdrawal-order` | Withdrawal order | Spending | Details ▸ Withdrawal Strategy |
| `rrif-conversion` | RRIF conversion | Spending | Help page (cross-linked from `withdrawal-order`) |
| `negative-balance-mid-year` | When the balance goes negative | Spending | Schedule column hint |
| `debts` | Debts (mortgage & consumer) | Spending | Details ▸ Debts |
| `home-equity` | Home equity & reverse mortgage | Property | Details ▸ Home Equity |
| `heloc` | HELOC (interest-only) | Property | Details ▸ Home Equity |
| `expected-return` | Expected return | Levers | MarketDial · Details lever |
| `volatility` | Volatility | Levers | Details ▸ (returns) |
| `lever-ranges` | Lever ranges (Settings pref) | Levers | Settings ▸ Lever Ranges |
| `verdict` | The ON TRACK / SHORTFALL verdict | Reading the answer | Dashboard verdict hero |
| `contour-map` | The contour map | Reading the answer | Dashboard map panel |
| `down-market-check` | The down-market check | Reading the answer | Dashboard down-market |
| `life-timeline` | The life timeline | Reading the answer | Dashboard timeline |
| `evidence-row` | The evidence row | Reading the answer | Dashboard evidence |
| `stress-test` | How to stress-test | Reading the answer | Dashboard footnote |
| `monte-carlo` | Monte Carlo | Analysis | Insights ▸ MC |
| `backtest` | Backtest | Analysis | Insights ▸ backtest |
| `levers-ranked` | Levers, ranked (EQ) | Analysis | Insights ▸ EQ |
| `optimize-spending` | Sustainable spending solve | Analysis | Insights ▸ optimize |
| `schedule-columns` | The schedule columns | Schedule | Schedule ▸ column picker |
| `scenarios` | Scenarios | Plans | Plans page |
| `compare` | Comparing plans | Plans | Plans ▸ compare |
| `assistant` | The assistant | Assistant | The dock header |
| `assistant-local-vs-online` | Local vs online models | Assistant | Settings ▸ connection |
| `assistant-privacy` | AI privacy | Assistant | The dock header |
| `data-backup-restore` | Backup / restore | Data | Data page |
| `share-link` | Share link | Data | Data page |
| `print-export` | Print / export | Data | Print page |
| `inflation` | Inflation | Assumptions | Help page |
| `approximations` | Approximations to know | Assumptions | Help page |
| `not-financial-advice` | Not financial advice | Legal | Help page |
| `data-responsibility` | Your data, your backups | Legal | Help page |
| `ai-may-be-wrong` | AI output may be wrong | Legal | Help page |
| `mit-license` | MIT License | Legal | Help page |

~50 topics. The remaining old-HelpModal entries fold into these (e.g. "The
tables", "JSON/YAML/wasm/one-tab" glossary terms become keywords or short
glossary topics on the page — they need no `?`).

## 6. Build order

- [ ] `src/help/topics.tsx` — the data source (all topics, ids stable) + tests
- [ ] `HelpHint` in `src/design/primitives.tsx` + Style Guide entry + tests
- [ ] Help page renders from the source: search + `#/help?topic=` anchors + tests
- [ ] Place the `?` hints per the table (each just `<HelpHint topic="…">`)
- [ ] `npx vitest run` green · `tsc -b` clean · build ok · commit

## 7. Acceptance (the no-drift test)

- [ ] Every topic's body appears in **exactly one** place in the source: `topics.tsx`. The page and every popup render it from there.
- [ ] Every `HelpHint topic="x"` resolves to a real topic id (a test walks all of them).
- [ ] Every topic id is unique (a test asserts it).
- [ ] `#/help?topic=x` scrolls to topic `x` for every id.
- [ ] Search matches title, body, and keywords.
- [ ] No `?` popup re-types an explanation (code review + the single-source rule).
