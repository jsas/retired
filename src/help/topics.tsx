// ---------------------------------------------------------------------------
// The help data source — the ONE place help text lives (HELP-MAP.md §2).
//
// Every topic is a unique-id + title + body + keywords + section. Two things
// render from this and nothing else holds the text:
//   - the Help page (searchable, linkable — #/help?topic=<id>)
//   - the ? hint popups (HelpHint reads the SAME body)
// So an explanation is never duplicated and never drifts. Ids are URLs — pick
// them once, kebab-case, and don't rename (every ? pointing at one breaks).
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { DEFAULT_APP_CONFIG } from '@retired/engine-core/appConfig';

export interface HelpTopic {
  id: string;
  title: string;
  /** The teaching text — rendered identically on the page and in the popup. */
  body: ReactNode;
  /** Extra search terms (synonyms, acronyms) beyond title + body. */
  keywords: string[];
  /** Grouping on the page. */
  section: string;
}

const money = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

const P_STYLE = 'text-xs text-slate-600 leading-relaxed mb-1.5';
const LI_STYLE = 'text-xs text-slate-600 leading-relaxed';
const P = ({ children }: { children: ReactNode }) => <p className={P_STYLE}>{children}</p>;
function ul(items: ReactNode[], ordered = false) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1 mb-2`}>
      {items.map((it, i) => <li key={i} className={LI_STYLE}>{it}</li>)}
    </Tag>
  );
}

const MIT_TEXT = `MIT License

Copyright (c) 2026 RE: tired contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** Section order on the page. */
export const HELP_SECTIONS = [
  'People', 'Accounts', 'Income', 'Spending', 'Property', 'Levers',
  'Reading the answer', 'Analysis', 'Schedule', 'Plans', 'Assistant', 'Data',
  'Assumptions', 'Glossary', 'Legal',
] as const;

export const HELP_TOPICS: HelpTopic[] = [
  // ── People ─────────────────────────────────────────────────────────────
  {
    id: 'current-retirement-max-age',
    title: 'Current / retirement / max age',
    section: 'People',
    keywords: ['ages', 'horizon', 'planning horizon', 'how long'],
    body: <P>Accumulation runs from current age until the year before retirement age. Drawdown runs from retirement age through max age. Max age is your planning horizon — the plan must stay funded through it.</P>,
  },
  {
    id: 'province',
    title: 'Province',
    section: 'People',
    keywords: ['tax table', 'provincial', 'ontario', 'quebec'],
    body: <P>Sets which provincial tax table is stacked on top of the federal one. Tables are editable under Settings.</P>,
  },
  {
    id: 'include-spouse',
    title: 'Include spouse',
    section: 'People',
    keywords: ['partner', 'couple', 'household'],
    body: <P>Runs a second, independent projection for your partner using their own ages, balances, contributions, CPP/OAS and spending. The two plans are combined into a household verdict: the household is SHORTFALL if either plan runs out, and the metric cards show household wealth at retirement with per-person detail.</P>,
  },
  {
    id: 'built-in-vs-linked-spouse',
    title: 'Built-in vs linked spouse',
    section: 'People',
    keywords: ['link a plan', 'shared spouse', 'one source of truth'],
    body: (
      <>
        <P>The spouse can live two places, switched by the <strong>Built-in / Link a plan</strong> toggle at the top of the Spouse section:</P>
        {ul([
          <><strong>Built-in</strong> — the spouse's numbers are stored inside this scenario and edited inline. <em>Save spouse as its own plan…</em> promotes them to a standalone scenario.</>,
          <><strong>Link a plan</strong> — the spouse <em>is</em> another saved scenario, fetched live. One source of truth — editing the linked plan updates every household that links to it.</>,
        ])}
        <P>A household shares one province, one market assumption and one planning horizon, so a linked spouse's own values for those are overridden by this plan.</P>
      </>
    ),
  },
  {
    id: 'spouse-approximation',
    title: 'Spouse approximation',
    section: 'People',
    keywords: ['pension splitting', 'income splitting', 'gis couple'],
    body: <P>Each spouse is drawn down independently; pension income splitting <em>is</em> modelled — up to 50% of eligible pension income (DB pensions, plus RRIF/RRSP draws <strong>from age 65</strong> — not CPP/OAS) is reallocated to the lower-taxed spouse each year (affects reported tax only). Spousal RRSPs are not modelled. Couple-based GIS <em>is</em> modelled (combined non-OAS income, couple rate when both receive OAS).</P>,
  },

  // ── Accounts ───────────────────────────────────────────────────────────
  {
    id: 'rrsp',
    title: 'RRSP',
    section: 'Accounts',
    keywords: ['registered', 'rrif', 'pre-tax'],
    body: <P>Pre-tax registered savings. Every dollar withdrawn is taxed as income.</P>,
  },
  {
    id: 'tfsa',
    title: 'TFSA',
    section: 'Accounts',
    keywords: ['tax-free', 'after-tax savings'],
    body: <P>After-tax savings. Withdrawals are completely tax-free.</P>,
  },
  {
    id: 'taxable',
    title: 'Taxable (non-registered)',
    section: 'Accounts',
    keywords: ['non-registered', 'acb', 'capital gains', 'embedded gain'],
    body: <P>Non-registered investments. The principal comes out tax-free; the embedded-gain fraction of each withdrawal is taxed at the capital-gains inclusion rate (Settings → Capital Gains sets the starting ACB share).</P>,
  },
  {
    id: 'cash-cushion',
    title: 'Cash cushion',
    section: 'Accounts',
    keywords: ['reserve', 'emergency fund', 'low yield'],
    body: <P>A low-yield reserve (rate set in Settings → Engine, default 0.5%). Always drawn last, as the final backstop before the plan runs dry.</P>,
  },
  {
    id: 'contributions',
    title: 'Contributions ($/yr)',
    section: 'Accounts',
    keywords: ['annual savings', 'deposit', 'rrsp tfsa contribution'],
    body: <P>Added to each account every year during accumulation, after that year's growth. The engine does not model RRSP tax refunds on contributions. Set TFSA/RRSP room to cap each year's registered deposits at the room you have left, spilling any excess into the non-registered account; leave room blank to skip enforcement.</P>,
  },
  {
    id: 'contribution-room',
    title: 'Contribution room',
    section: 'Accounts',
    keywords: ['tfsa room', 'rrsp room', 'notice of assessment', 'over-contribute', 'meltdown'],
    body: <P>Your available room from your CRA notice of assessment. Blank means "no limit". Enter a number and room is tracked: each year TFSA room grows by the annual limit ({money(DEFAULT_APP_CONFIG.engine.tfsaAnnualLimit)}/yr) and RRSP room by 18% of employment income up to the maximum, minus any pension adjustment. A TFSA withdrawal re-adds room the <em>following</em> year; an RRSP withdrawal never does. Deposits beyond your remaining room overflow into non-registered, so an RRSP→TFSA meltdown is capped at your TFSA room. The schedule's expandable <strong>Contribution room</strong> panel shows room left and any overflow per year.</P>,
  },
  {
    id: 'rdsp',
    title: 'RDSP (disability savings)',
    section: 'Accounts',
    keywords: ['disability', 'dtc', 'grant', 'bond'],
    body: <P>A Registered Disability Savings Plan for a DTC-eligible person. Contributions are <strong>not deductible</strong>, grow tax-sheltered, and attract Canada Disability Savings <strong>Grants</strong> and <strong>Bonds</strong> (paid to age 49, contributions to age 59, lifetime caps). On withdrawal, the contribution portion is <strong>tax-free</strong> while the grant/bond/growth portion is <strong>taxable income</strong>; the app tracks your contribution basis and splits every draw. Thresholds and caps are editable under Settings → RDSP. <strong>Not modelled:</strong> the 10-year assistance holdback clawback and grant/bond carry-forward — check canada.ca for your exact amounts.</P>,
  },
  {
    id: 'fhsa',
    title: 'FHSA (first home savings)',
    section: 'Accounts',
    keywords: ['first home', 'house down payment', 'deductible'],
    body: <P>A First Home Savings Account. Contributions are <strong>deductible</strong> (like an RRSP), grow <strong>tax-sheltered</strong>, capped at <strong>$8,000/yr</strong> and a <strong>$40,000 lifetime</strong> total; the plan can stay open 15 years. Because this app models retirement, the FHSA is <strong>accumulation-only</strong>: at retirement the balance <strong>transfers to your RRSP</strong> (no RRSP room needed) and draws down like any other RRSP money. Limits editable under Settings → FHSA. <strong>Not modelled:</strong> a qualifying first-home <strong>withdrawal</strong> (which would be tax-free).</P>,
  },

  // ── Income ─────────────────────────────────────────────────────────────
  {
    id: 'income',
    title: 'Income (pensions & work)',
    section: 'Income',
    keywords: ['pension', 'employment', 'self-employment', 'rental', 'bridge', 'db', 't4'],
    body: (
      <>
        <P>The Income section is one register of everything you earn besides CPP/OAS. Each source has a <strong>kind</strong>, a gross $/yr, a start age, and an <em>indexed</em> flag. Four kinds are modelled:</P>
        {ul([
          <><strong>Pension (DB / bridge)</strong> — a fixed $/yr from the start age, taxed as ordinary income. Leave the end age blank for lifetime, or set one for a <strong>bridge</strong> benefit. Counts toward GIS/OAS clawbacks and is pension-split-eligible.</>,
          <><strong>Employment</strong> — wages, earned income: taxed at your marginal rate, builds RRSP room. Before retirement the after-tax pay is saved into the destination account; the <strong>saves …% of net</strong> field sets how much.</>,
          <><strong>Self-employment</strong> — net income, earned like a job but pays <strong>both halves of CPP</strong> (deducted), and is not pension-split-eligible.</>,
          <><strong>Rental</strong> — net rental income: taxable investment income, builds no RRSP room, not split-eligible. The after-tax net lands in Taxable.</>,
        ])}
        <P>Registered destinations default to Taxable; with contribution room set, TFSA/RRSP deposits cap at remaining room and spill to Taxable. A pension can carry a <strong>pension adjustment</strong> that reduces the RRSP room you accrue.</P>
      </>
    ),
  },
  {
    id: 'cpp-start-age',
    title: 'CPP start age & amount',
    section: 'Income',
    keywords: ['cpp', 'canada pension plan', 'defer', 'take early', '60 65 70'],
    body: <P>Your expected CPP pension at the standard age of 65. The engine applies the early/deferral adjustment itself: −0.6% per month before 65 (−36% at 60), +0.7% per month after 65 (+42% at 70). If the checkbox is ticked, the amount you entered is used verbatim (already adjusted). CPP is taxable income.</P>,
  },
  {
    id: 'oas-start-age',
    title: 'OAS start age',
    section: 'Income',
    keywords: ['oas', 'old age security', 'clawback', 'defer'],
    body: <P>OAS normally starts at 65; deferring to 70 adds 0.6% per month (+36% at 70) — the engine applies this automatically. At 75 the benefit steps up 10%. OAS is taxable and subject to the clawback (see the Assumptions section).</P>,
  },
  {
    id: 'years-in-canada',
    title: 'Years in Canada (OAS)',
    section: 'Income',
    keywords: ['residency', 'oas eligibility', '40 years'],
    body: <P>Post-age-18 residency. Full OAS needs 40 years; fewer years scale the pension proportionally. Under 10 years pays nothing.</P>,
  },
  {
    id: 'gis',
    title: 'GIS (Guaranteed Income Supplement)',
    section: 'Income',
    keywords: ['guaranteed income supplement', 'low income', 'supplement'],
    body: <P>The Guaranteed Income Supplement — tax-free, reduced 50¢ per dollar of income excluding OAS (CPP, registered draws, taxable gains). It lowers the portfolio's share of the spending target. With a spouse, CRA's couple rules apply: each entitlement is assessed on <em>combined</em> non-OAS income, at the lower couple rate when both receive OAS. Approximated annually; Service Canada recalculates quarterly.</P>,
  },
  {
    id: 'cash-events',
    title: 'Cash events (inflow / outflow)',
    section: 'Income',
    keywords: ['inheritance', 'house sale', 'gift', 'big purchase', 'lump sum', 'one-time', 'money in', 'money out'],
    body: (
      <>
        <P><strong>Inflow</strong> — a lump sum landing in the chosen account at the chosen age; it appears in that year's balances and grows thereafter. <strong>Outflow</strong> — an extra expense at the chosen age, on top of that year's spending target; the portfolio must fund both.</P>
        <P>Switch an event to <em>Yearly</em> with a start–end age range to repeat the same amount every year (rental income for a few years, or a recurring cost).</P>
      </>
    ),
  },

  // ── Spending ───────────────────────────────────────────────────────────
  {
    id: 'desired-spending',
    title: 'Desired spending',
    section: 'Spending',
    keywords: ['spending', 'income goal', 'how much a year', 'lifestyle'],
    body: <P>The after-tax income you want each retirement year, in today's dollars — the base the phases scale. When Settings → Engine → "Grow spending with inflation" is on, the engine inflates it by CPI each year from your current age, so the schedule's Spending Target column shows nominal dollars; when off, the target stays flat. The engine grosses up registered withdrawals so benefits + portfolio income, after tax, equal that target.</P>,
  },
  {
    id: 'spending-phases',
    title: 'Go-go / slow-go / no-go (spending phases)',
    section: 'Spending',
    keywords: ['phases', 'bands', 'slow down', 'spend less later'],
    body: <P>From each "from age", spending drops to the given share of desired spending (still inflation-adjusted). E.g. 100% to 74, 85% from 75, 70% from 85.</P>,
  },
  {
    id: 'withdrawal-order',
    title: 'Withdrawal order',
    section: 'Spending',
    keywords: ['which account first', 'tfsa first', 'rrsp meltdown', 'drawdown order'],
    body: <P>Spending TFSA first preserves taxed-later RRSP room but lets the RRIF minimum problem grow; spending RRSP first prepays tax at today's (possibly lower) brackets and shrinks future forced minimums. Try both orders and compare the Tax Burden column and the ending balance. Each retirement year runs: CPP/OAS paid, then the RRIF minimum (if past conversion age), then the remaining need drawn in your configured order, the cash cushion last; whatever remains grows at the expected return.</P>,
  },
  {
    id: 'rrif-conversion',
    title: 'RRIF conversion',
    section: 'Spending',
    keywords: ['rrif', 'minimum withdrawal', '71', 'prescribed factors'],
    body: <P>At the conversion age (default 71) the entire RRSP becomes a RRIF. Minimum withdrawals follow the CRA prescribed factors — 5.28% at 71 rising to 20% at 95 — applied to the start-of-year balance, and come out first even if you don't need them (after-tax excess is redeposited to the taxable account). Rates are editable in Settings → RRIF Rates.</P>,
  },
  {
    id: 'negative-balance-mid-year',
    title: 'When the balance goes negative mid-year',
    section: 'Spending',
    keywords: ['depletion', 'runs out', 'negative balance'],
    body: <P>Growth is applied after withdrawals to whatever remains. In the year the last account is drained, nothing remains to grow — so the balance can dip slightly negative at year-end when the growth rate is high. Depletion is recorded at that age and the display floors the balance at $0.</P>,
  },
  {
    id: 'debts',
    title: 'Debts (mortgage & consumer)',
    section: 'Spending',
    keywords: ['mortgage', 'credit card', 'loan', 'line of credit', 'payment'],
    body: (
      <>
        <P>The Debts section tracks money you <strong>owe</strong>. Each debt has a balance, an annual interest rate, and a monthly payment. Each year the balance first grows by that year's interest, then the payment (12 × monthly) is applied, capped so you never overpay. The payment is <strong>funded from your spending</strong> and drawn from your accounts like any other expense, before or after retirement, with after-tax money.</P>
        <P>While a debt is outstanding the portfolio must fund both living spending <em>and</em> the payments — carrying debt into retirement raises withdrawals and can flip a plan from <strong>on track</strong> to <strong>shortfall</strong>. The payoff age is shown next to each debt. <strong>Not modelled:</strong> any payoff <em>strategy</em> — the app shows the consequence of the payments you enter.</P>
      </>
    ),
  },

  // ── Property ───────────────────────────────────────────────────────────
  {
    id: 'home-equity',
    title: 'Home equity & reverse mortgage',
    section: 'Property',
    keywords: ['house', 'reverse mortgage', 'equity', 'net equity', 'loan-to-value'],
    body: <P>Borrowing against home equity — proceeds are tax-free, so they don't count as income and don't touch GIS or the OAS clawback. Two ways to draw, alone or together: <strong>scheduled draws</strong> (a set $/yr from an age, CPI-indexed) and <strong>top-up</strong> (once every account is drained, borrow just enough to cover spending — the true last resort). The loan compounds against the home, so net equity (home value − loan) erodes over time; borrowing stops at the <strong>max loan-to-value</strong> ceiling (lenders typically cap near 55%), and the plan is "depleted" once accounts <em>and</em> that headroom are both exhausted.</P>,
  },
  {
    id: 'heloc',
    title: 'HELOC (interest-only)',
    section: 'Property',
    keywords: ['home equity line of credit', 'interest only', 'line of credit'],
    body: <P>Choose <strong>Product type → HELOC</strong> in the Home Equity section to model a home-equity line of credit instead of a compounding reverse mortgage. A HELOC services its interest <em>out of cash flow</em> (added to that year's spending) rather than rolling it into the balance, so the loan only grows when you actually draw; lenders typically allow a higher ceiling (~65% LTV). Reverse-mortgage mode instead compounds the interest and enforces the ~55% no-negative-equity guarantee. Draws are tax-free in both modes.</P>,
  },

  // ── Levers ─────────────────────────────────────────────────────────────
  {
    id: 'expected-return',
    title: 'Expected return',
    section: 'Levers',
    keywords: ['return', 'growth rate', 'market', 'assumption', '%'],
    body: <P>Constant annual return applied to RRSP, TFSA and taxable balances (growth lands after withdrawals each year). The deterministic table uses exactly this rate every year. Move the Markets dial to stress it — the map's terrain reshapes live because the ground depends on it.</P>,
  },
  {
    id: 'volatility',
    title: 'Volatility',
    section: 'Levers',
    keywords: ['standard deviation', 'risk', 'monte carlo', 'swing'],
    body: <P>Standard deviation of annual returns, used only by Monte Carlo. 0% means "every year equals the expected return" (the simulation collapses to the deterministic answer); 15–20% is a typical equity-heavy portfolio. Returns are not mean-reverting and sequence risk is real: a crash early in retirement hurts far more than one late.</P>,
  },
  {
    id: 'lever-ranges',
    title: 'Lever ranges (Settings pref)',
    section: 'Levers',
    keywords: ['slider range', 'min max', 'limits', 'spending max', 'return max'],
    body: <P>The sliders for spending, savings, expected return and volatility only span a range — widen one if your plan lives past the default edge. Set under Settings → Lever Ranges; they're preferences (not engine settings), saved the moment you change them. Retirement age, plan-to age, CPP and OAS start ages keep fixed spans; a fixed span is part of their meaning.</P>,
  },

  // ── Reading the answer ─────────────────────────────────────────────────
  {
    id: 'verdict',
    title: 'The ON TRACK / SHORTFALL verdict',
    section: 'Reading the answer',
    keywords: ['on track', 'shortfall', 'depletion', 'answer', 'will it last'],
    body: (
      <>
        <P>The verdict comes straight from the simulation: the plan is <strong>SHORTFALL</strong> if the money runs out (every account, including the cash cushion, reaches $0) before your max age, and <strong>ON TRACK</strong> if it lasts. The age shown is the year it runs out, or the horizon if it never does.</P>
        <P>For a couple, the household verdict is the worst of the two plans.</P>
      </>
    ),
  },
  {
    id: 'contour-map',
    title: 'The contour map',
    section: 'Reading the answer',
    keywords: ['map', 'boundary', 'terrain', 'dot', 'holds region'],
    body: <P>The map is retirement age (x) × spending (y). The blue line is the boundary — the spending where the plan stops holding at each age. Below it (blue wash) the money lasts; above it (rose) it runs out early. The dot is your plan: drag it, or use the faders, and the verdict, map and assistant recompute together. The boundary re-runs the real engine at each point, so it always agrees with the table.</P>,
  },
  {
    id: 'down-market-check',
    title: 'The down-market check',
    section: 'Reading the answer',
    keywords: ['stress test', 'pessimistic', 'low return', 'bear market'],
    body: <P>Re-runs your whole plan at a single pessimistic return (1.2%) to show how it holds up if markets disappoint. Blue means it survives even then; rose names the age it runs out. It's the quick, one-number cousin of the full Monte Carlo on the Insights page.</P>,
  },
  {
    id: 'life-timeline',
    title: 'The life timeline',
    section: 'Reading the answer',
    keywords: ['timeline', 'balance over time', 'work ends', 'money runs out'],
    body: <P>Your balance across the whole plan, age by age. The solid line is the funded region; past the depletion age it turns dotted red. Pins mark you today, when work ends, and when the money runs out (or that it outlasts the plan).</P>,
  },
  {
    id: 'evidence-row',
    title: 'The evidence row',
    section: 'Reading the answer',
    keywords: ['account bars', 'money lasts to', 'left at', 'stats', 'proof'],
    body: <P>The numbers behind the verdict: the account mix at any age you pick (RRSP+RRIF, TFSA, Taxable+cash), plus how long the money lasts, what's left at max age, the pot at work's end, and when CPP+OAS start.</P>,
  },
  {
    id: 'stress-test',
    title: 'How to stress-test the plan',
    section: 'Reading the answer',
    keywords: ['robust', 'what could go wrong', 'sensitivity'],
    body: (
      <>
        <P>The verdict uses your expected return every year. To see how robust the plan really is:</P>
        {ul([
          <><strong>Lower the expected return</strong> (the Markets dial) for a pessimistic case.</>,
          <><strong>Run Monte Carlo</strong> — it randomizes returns around your assumption and reports the share of runs that never deplete; that success rate is the most honest single number.</>,
          <><strong>Run a Backtest</strong> — replays your plan through actual historical market sequences.</>,
        ])}
      </>
    ),
  },

  // ── Analysis ───────────────────────────────────────────────────────────
  {
    id: 'monte-carlo',
    title: 'Monte Carlo',
    section: 'Analysis',
    keywords: ['simulation', 'random', 'success rate', 'fan chart', 'probability'],
    body: (
      <>
        <P>Runs the full projection 500 times, each with a randomized sequence of annual returns (geometric Brownian motion around your expected return, with Student-t shocks so crashes are more common than a normal distribution predicts).</P>
        {ul([
          <>The dark band is the middle 50% of outcomes (p25–p75); the light band is p10–p90. The blue line is the median.</>,
          <><strong>Success rate</strong> — the share of runs that stayed funded through max age. 90%+ is conventionally comfortable; below 75% the plan is fragile.</>,
          <>The width of the fan is driven by Volatility. A crash early in retirement hurts far more than one late.</>,
        ])}
      </>
    ),
  },
  {
    id: 'backtest',
    title: 'Backtest',
    section: 'Analysis',
    keywords: ['historical', 'sequence risk', '1970', 'real returns', 'crash'],
    body: (
      <>
        <P>Monte Carlo invents random futures; the backtest replays real pasts. It runs the plan against every rolling window of a Canadian real (after-inflation) balanced-portfolio series from 1970 to today, each window as long as your horizon, and reports how often the plan survived.</P>
        <P>Sequence-of-returns risk is the biggest threat to a drawdown plan: retiring into the 1973–74 crash, 2000–02 or 2008 is far worse than the same average return with the crash at the end. A high backtest success rate has historically withstood every bad sequence on record.</P>
      </>
    ),
  },
  {
    id: 'levers-ranked',
    title: 'Levers, ranked (the equalizer)',
    section: 'Analysis',
    keywords: ['eq', 'equalizer', 'sliders', 'drag pad', 'strategy ranking', 'crops'],
    body: (
      <>
        <P>The equalizer is a goals-level surface over your whole plan: push sliders and drag a pad while status, money-lasts-to and success rate update live. The square is retirement age × spending; the green→red shading is the plan's success rate at every combination, computed by binary-searching the boundary row by row so it streams in fast.</P>
        <P>The Strategy Explorer re-runs your plan under a menu of alternatives — CPP/OAS timing, pension start ages, withdrawal orders, reverse-mortgage timing — each scored on the sustainable after-tax spending it supports, with a one-click Apply.</P>
      </>
    ),
  },
  {
    id: 'optimize-spending',
    title: 'Sustainable spending solve',
    section: 'Analysis',
    keywords: ['how much can i spend', 'solve', 'maximum spending', 'safe withdrawal'],
    body: <P>Answers "how much could I spend?" instead of "will my spending last?" — binary-searches the after-tax spending that keeps the plan funded through max age, at the success target you pick, using Monte Carlo futures.</P>,
  },

  // ── Schedule ───────────────────────────────────────────────────────────
  {
    id: 'schedule-columns',
    title: 'The schedule columns',
    section: 'Schedule',
    keywords: ['year by year', 'table', 'column picker', 'show all', 'balances'],
    body: <P>The year-by-year table walks every year from now to max age: starting balance, contributions, market gains, withdrawals, tax, CPP/OAS/GIS/pension, and ending balance, plus per-account balances. The <strong>Columns</strong> button picks which are shown — the starter set keeps the money-flow story on screen and everything else is one "show all" away; your choice is remembered. RDSP / FHSA / Home Equity / Debts columns appear automatically only when those features produce data. Tap a year to expand its full detail.</P>,
  },

  // ── Plans ──────────────────────────────────────────────────────────────
  {
    id: 'scenarios',
    title: 'Scenarios',
    section: 'Plans',
    keywords: ['what-if', 'save', 'switch', 'new plan', 'duplicate'],
    body: <P>A scenario is one complete set of inputs. The top bar switches between them; Save writes your edits into the active scenario; the Plans page creates, renames, duplicates and deletes. Switching away with unsaved edits asks whether to save first. Make several — "retire at 60" vs "65" — and flip or compare them.</P>,
  },
  {
    id: 'compare',
    title: 'Comparing plans',
    section: 'Plans',
    keywords: ['side by side', 'compare scenarios', 'which is better'],
    body: <P>The Compare card puts 2–3 saved scenarios side by side — verdict, money-lasts-to, spending, tax and ending wealth — so you can see which version of a plan holds up best. Each is scored with its own resolved spouse: a plan whose spouse is a linked scenario is compared as the full household.</P>,
  },

  // ── Assistant ──────────────────────────────────────────────────────────
  {
    id: 'assistant',
    title: 'The assistant',
    section: 'Assistant',
    keywords: ['chat', 'ai', 'ask', 'what can it do'],
    body: (
      <>
        <P>The assistant is a chat that can read your plan and run the projection engine itself — so it answers with your real numbers, not generic advice. Ask "when does my RRSP run out?", "what if I retire at 62?", or "compare CPP at 60 vs 65".</P>
        {ul([
          <><strong>Read</strong> — ages, balances, benefits, spending, the year-by-year projection.</>,
          <><strong>What-if</strong> — it re-runs the engine with changed inputs and quotes the result.</>,
          <><strong>Propose changes</strong> — shown as a review card; nothing is applied until you confirm.</>,
        ])}
      </>
    ),
  },
  {
    id: 'assistant-local-vs-online',
    title: 'Local vs online models',
    section: 'Assistant',
    keywords: ['model', 'local', 'online', 'download', 'api key', 'provider'],
    body: <P>The assistant can run a model <strong>entirely on this computer</strong> (free, private, works offline — download once on the Connections page) or use an <strong>online provider</strong> like Google or Anthropic (generally smarter, but your plan details travel to that provider). Local models are smaller, so keep questions focused. Pick and download on Connections, from the assistant's header.</P>,
  },
  {
    id: 'assistant-privacy',
    title: 'AI privacy',
    section: 'Assistant',
    keywords: ['privacy', 'read by the ai', 'data sent', 'local model'],
    body: <P>A local model never sends anything anywhere — inference happens on your machine. An online connection sends your question (and the plan details in it) to that provider under its privacy policy; your API key is stored only in this browser and sent only to that provider. Chats are saved on this computer only, and the Data page's backup includes them only if you opt in.</P>,
  },

  // ── Data ───────────────────────────────────────────────────────────────
  {
    id: 'data-backup-restore',
    title: 'Backup / restore',
    section: 'Data',
    keywords: ['export', 'import', 'sqlite', 'download', 'where data lives', 'opfs'],
    body: <P>Your plans live in a real SQLite database (running as WebAssembly) in this browser's origin-private file system, mirrored to localStorage — nothing leaves your machine, but clearing site data can still erase it. The Data page's Export downloads the chosen scenarios (+ optionally engine settings) as a .sqlite file (openable by any SQLite tool; older JSON backups still import); Import reads it back and lets you pick which scenarios to apply. Keep backups — there's no server-side copy.</P>,
  },
  {
    id: 'share-link',
    title: 'Share link',
    section: 'Data',
    keywords: ['share', 'link', 'send plan', 'url'],
    body: <P>Opens a card with a link that encodes the active plan's inputs in the URL itself (base64 in the fragment, after the #). Send it to someone — opening it imports a copy as a new "Shared plan" scenario. Nothing is uploaded to a server, and the fragment never travels with the HTTP request.</P>,
  },
  {
    id: 'print-export',
    title: 'Print / export',
    section: 'Data',
    keywords: ['print', 'pdf', 'csv', 'download table'],
    body: <P>The Print page chooses what the printout includes — the one-page summary (profile, savings, verdict) plus any of: the timeline chart, a fresh Monte Carlo fan, and a table of major milestones. Print then opens the browser dialog; choose "Save as PDF" to file or email it. The CSV link downloads the year-by-year projection table for a spreadsheet.</P>,
  },

  // ── Assumptions ────────────────────────────────────────────────────────
  {
    id: 'inflation',
    title: 'Inflation',
    section: 'Assumptions',
    keywords: ['cpi', 'indexation', "today's dollars", 'nominal'],
    body: <P>Settings → Engine has an inflation (CPI) rate, default 2%, driving two independent switches. <strong>Grow spending with inflation</strong> (on by default) inflates your today's-dollars spending by CPI each year. <strong>Index tax tables, OAS and CPP to inflation</strong> inflates brackets, basic amounts, the OAS clawback threshold and benefit amounts, mirroring CRA indexation. With both on, results are effectively in today's purchasing power.</P>,
  },
  {
    id: 'approximations',
    title: 'Approximations to know',
    section: 'Assumptions',
    keywords: ['limits', 'accuracy', 'not modelled', 'tax model', 'surtax', 'credits'],
    body: (
      <>
        <P>The model is a careful simplification. Capital gains use an adjusted cost base (only the embedded-gain fraction of each withdrawal is taxed, at 50% inclusion); dividend gross-up/credits and deemed disposition at death are not modelled. Beyond Ontario's surtax, other provinces' low-income reductions and credits are not included. The $2,000 pension-amount credit and the age amount are not modelled. No RRSP contribution refunds. Quebec's federal abatement is modelled.</P>
        <P>The tax tables default to 2026 figures and go stale — update them in Settings when CRA publishes new indexation.</P>
      </>
    ),
  },

  // ── Glossary ───────────────────────────────────────────────────────────
  {
    id: 'glossary-scenario', title: 'Scenario', section: 'Glossary',
    keywords: ['what-if', 'plan'],
    body: <P>One complete "what-if" plan: ages, balances, benefits, spending goal and strategy choices, saved under a name. Make several and flip or compare them.</P>,
  },
  {
    id: 'glossary-sqlite', title: 'SQLite / .sqlite file', section: 'Glossary',
    keywords: ['database', 'file', 'db browser'],
    body: <P>A database kept in a single ordinary file. Your plans live in one inside the browser, and Export downloads a copy of that very file. Free tools like "DB Browser for SQLite" can look inside — it's the app's filing cabinet.</P>,
  },
  {
    id: 'glossary-opfs', title: 'OPFS / origin-private file system', section: 'Glossary',
    keywords: ['storage', 'site data', 'private folder'],
    body: <P>A private folder your browser gives each website, invisible to other sites. That's where the database file lives, which is why plans survive closing the browser — and why clearing "site data" erases them.</P>,
  },
  {
    id: 'glossary-localstorage', title: 'localStorage', section: 'Glossary',
    keywords: ['storage', 'backup copy'],
    body: <P>The browser's older, smaller storage cubby (~5 MB). The app keeps a backup copy of the database there in case the newer OPFS storage isn't available (some private-browsing modes).</P>,
  },
  {
    id: 'glossary-csv', title: 'CSV', section: 'Glossary',
    keywords: ['spreadsheet', 'excel', 'comma separated'],
    body: <P>"Comma-separated values" — the simplest spreadsheet format. The projection export and the import template use it so numbers move freely between this app and Excel or Google Sheets.</P>,
  },
  {
    id: 'glossary-json', title: 'JSON', section: 'Glossary',
    keywords: ['format', 'structured data'],
    body: <P>A text format for structured data. Some exports use it because it preserves detail a spreadsheet can't. You don't need to read it — just know it's one of ours and imports back.</P>,
  },
  {
    id: 'glossary-one-tab', title: 'One tab at a time', section: 'Glossary',
    keywords: ['browser tab', 'multi-tab', 'overwrite'],
    body: <P>Use the app in a single browser tab. Two tabs each keep their own in-memory copy, and whichever saves last silently overwrites the other's work. If a second opens by accident, close it without saving.</P>,
  },
  {
    id: 'glossary-wasm', title: 'WebAssembly / wasm', section: 'Glossary',
    keywords: ['wasm', 'database engine'],
    body: <P>The technology that lets a real database engine run inside your browser tab. It's on your machine doing the work; nothing is sent anywhere.</P>,
  },
  {
    id: 'glossary-tokens', title: 'Tokens & context window', section: 'Glossary',
    keywords: ['tokens', 'context', 'how much the model reads'],
    body: <P>Tokens are how AI models measure text (~¾ of a word each). The context window is how many the model can hold at once — your plan, the conversation and its answer all have to fit; long chats with a small window lose earlier details.</P>,
  },
  {
    id: 'glossary-api-key', title: 'API key', section: 'Glossary',
    keywords: ['password', 'online provider', 'key'],
    body: <P>A password from an online AI provider to use their models. Paste it on the Connections page — it's stored only in this browser and sent only to that provider. Local models never need one.</P>,
  },

  // ── Legal ──────────────────────────────────────────────────────────────
  {
    id: 'not-financial-advice',
    title: 'Not financial advice',
    section: 'Legal',
    keywords: ['disclaimer', 'advice', 'estimate'],
    body: (
      <>
        <P>RE: tired is an educational and exploratory tool. It produces <strong>estimates</strong> from a simplified model of Canadian tax and benefit rules — it is <strong>not</strong> financial, investment, tax, or legal advice, and it does not consider your complete circumstances. Before making retirement, withdrawal, or benefit-timing decisions, verify the numbers and consult a qualified financial planner or tax professional.</P>
      </>
    ),
  },
  {
    id: 'data-responsibility',
    title: 'Your data, your backups',
    section: 'Legal',
    keywords: ['responsibility', 'lost data', 'backup'],
    body: <P>Your plans live only in this browser's local storage — there is no server-side copy, no account, no way for anyone to recover them for you. Keeping a backup is entirely your responsibility: use the Data page's Export regularly. The authors accept no liability for lost, corrupted, or inaccessible data.</P>,
  },
  {
    id: 'ai-may-be-wrong',
    title: 'AI output may be wrong',
    section: 'Legal',
    keywords: ['ai wrong', 'hallucinate', 'not advice'],
    body: <P>The Assistant and the copy-a-prompt AI are powered by large language models, which can misread numbers, miscalculate, and state false things confidently. AI replies are general educational commentary, never personalized advice. Always check an AI answer against the app's own computed tables (which are deterministic); when the two disagree, trust the tables.</P>,
  },
  {
    id: 'no-warranty',
    title: 'No warranty — use at your own risk',
    section: 'Legal',
    keywords: ['warranty', 'as is', 'liability'],
    body: <P>This software is provided "as is", free of charge, without warranty of any kind. The authors are not liable for any loss or damage arising from its use. Using it means accepting these terms in full — if you don't agree, don't use it.</P>,
  },
  {
    id: 'credits',
    title: 'Credits',
    section: 'Legal',
    keywords: ['danielabar', 'original', 'thanks'],
    body: (
      <P>
        The drawdown engine was originally built on{' '}
        <a href="https://github.com/danielabar/retirement_drawdown_simulator_canada" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
          retirement_drawdown_simulator_canada
        </a>{' '}
        by <strong>danielabar</strong> — thank you to the original author for publishing it. The upstream repository did not carry a LICENSE file when incorporated (checked 2026-08-23); RE: tired's own code is MIT-licensed below.
      </P>
    ),
  },
  {
    id: 'mit-license',
    title: 'MIT License (full text)',
    section: 'Legal',
    keywords: ['license', 'mit', 'open source'],
    body: <pre className="text-[11px] leading-relaxed text-slate-600 bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap font-mono">{MIT_TEXT}</pre>,
  },
];

// ---------------------------------------------------------------------------
// Lookup + search.
// ---------------------------------------------------------------------------

const BY_ID = new Map(HELP_TOPICS.map((t) => [t.id, t]));

export function helpTopic(id: string): HelpTopic | undefined {
  return BY_ID.get(id);
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

/** Full-text search over title + body + keywords, in page order. */
export function searchHelpTopics(query: string): HelpTopic[] {
  const q = query.trim().toLowerCase();
  if (!q) return HELP_TOPICS;
  return HELP_TOPICS.filter((t) =>
    t.title.toLowerCase().includes(q) ||
    t.section.toLowerCase().includes(q) ||
    t.keywords.some((k) => k.toLowerCase().includes(q)) ||
    textOf(t.body).toLowerCase().includes(q),
  );
}
