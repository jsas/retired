import { useMemo, useState, type ReactNode } from 'react';
import { Search, X, Sparkles } from 'lucide-react';

// ---------------------------------------------------------------------------
// Help content model: every entry is a small tree of {id, title, body} so the
// search can match on plain text and the page renders as one scrollable doc.
// ---------------------------------------------------------------------------

interface HelpEntry {
  /** heading inside a section (null = intro paragraph) */
  term: string | null;
  body: ReactNode;
}

interface HelpSection {
  id: string;
  title: string;
  entries: HelpEntry[];
}

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

const SECTIONS: HelpSection[] = [
  {
    id: 'help-inputs',
    title: 'Inputs',
    entries: [
      {
        term: null,
        body: (
          <P>
            Everything in the left sidebar feeds one deterministic projection: from your current age
            to your retirement age the accounts grow and receive contributions; from retirement to
            max age the engine draws them down to fund your desired spending.
          </P>
        )
      },
      {
        term: 'Current / Retirement / Max Age',
        body: <P>Accumulation runs from current age until the year before retirement age. Drawdown runs from retirement age through max age. Max age is your planning horizon — the plan must stay funded through it.</P>
      },
      {
        term: 'Province',
        body: <P>Sets which provincial tax table is stacked on top of the federal one. Tables are editable under Settings.</P>
      },
      { term: 'RRSP', body: <P>Pre-tax registered savings. Every dollar withdrawn is taxed as income.</P> },
      { term: 'TFSA', body: <P>After-tax savings. Withdrawals are completely tax-free.</P> },
      {
        term: 'Taxable',
        body: <P>Non-registered investments. The principal comes out tax-free; the embedded-gain fraction of each withdrawal is taxed at the capital-gains inclusion rate (Settings → Capital Gains sets the starting ACB share).</P>
      },
      {
        term: 'Cash Cushion',
        body: <P>A low-yield reserve (rate set in Settings → Engine, default 0.5%). Always drawn last, as the final backstop before the plan runs dry.</P>
      },
      {
        term: 'RRSP / TFSA / Non-Registered Contribution ($/yr)',
        body: <P>Added to each account every year during accumulation, after that year's growth. The engine does not model RRSP tax refunds on contributions or contribution-room limits.</P>
      },
      {
        term: 'Desired Spending ($)',
        body: <P>The after-tax income you want each retirement year, in today's dollars — the base the phases scale. When Settings → Engine → "Grow spending with inflation" is on, the engine inflates it by CPI each year from your current age, so the table's Spending Target column shows the nominal dollars needed that year; when off, the target stays flat in today's dollars. The engine grosses up registered withdrawals so that benefits + portfolio income, after tax, equal that target.</P>
      },
      {
        term: 'Go-go / slow-go / no-go (spending phases)',
        body: <P>From each "from age", spending drops to the given share of desired spending (still inflation-adjusted). E.g. 100% to 74, 85% from 75, 70% from 85.</P>
      },
      {
        term: 'CPP Start Age / Monthly at 65 ($)',
        body: <P>Your expected CPP pension at the standard age of 65. The engine applies the early/deferral adjustment itself: −0.6% per month before 65 (−36% at 60), +0.7% per month after 65 (+42% at 70), shown live next to the field. If the checkbox is ticked, the amount you entered is used verbatim (already adjusted — e.g. from a Service Canada estimate). CPP is taxable income. Scenarios saved before this calculator existed keep the "already adjusted" behaviour.</P>
      },
      {
        term: 'OAS Start Age',
        body: <P>OAS normally starts at 65; deferring to 70 adds 0.6% per month (+36% at 70) — the engine applies this automatically. At 75 the benefit steps up 10%. OAS is taxable and subject to the clawback (see Tax Model).</P>
      },
      {
        term: 'Years in Canada',
        body: <P>Post-age-18 residency. Full OAS needs 40 years; fewer years scale the pension proportionally. Under 10 years pays nothing.</P>
      },
      {
        term: 'Pensions (defined-benefit / bridge)',
        body: (
          <>
            <P>The Pensions section models employer <strong>defined-benefit</strong> income: a fixed $/yr starting at the age you choose, taxed as ordinary income and stacked with CPP/OAS — so it directly shrinks how much the portfolio must supply. Tick <em>indexed</em> if the pension grows with CPI (many DB plans do, fully or partially); leave it unticked for a flat nominal pension.</P>
            <P>Set an <strong>end age</strong> for a <strong>bridge / temporary</strong> benefit (e.g. $12k/yr from 60–65 that stops when CPP begins); leave it blank for a lifetime pension. Pension income counts toward the GIS and OAS clawbacks, exactly like CPP does. The spouse plan has its own pension list.</P>
            <P>A <strong>DC / LIRA</strong> lump sum is not entered here — it's already modelled by your RRSP/RRIF balance (it converts to a RRIF and is drawn down like registered savings).</P>
          </>
        )
      },
      {
        term: 'Employment income (semi- / post-retirement work)',
        body: (
          <>
            <P>The Employment Income section models <strong>earned income</strong> — a part-time job or consulting gig in the early retirement years. Unlike a pension this is wages: it stacks on top of CPP/OAS/pension for tax (taxed at your marginal rate), counts toward the OAS clawback, and reduces GIS. Set a gross $/yr and a start–end age window (inclusive).</P>
            <P>Two modes per job. With <strong>tops up spending</strong> on, the after-tax pay covers spending first — so portfolio withdrawals shrink dollar-for-dollar and the savings keep compounding; any excess over the year's need is saved. With it off, the whole after-tax pay is saved. Either way the net lands in the account you pick (TFSA / RRSP / Taxable / Cash). Tick <em>indexed</em> if the pay grows with CPI.</P>
            <P>The Optimize tab's Strategy Explorer suggests work stints automatically: fixed rows (e.g. "$10k/yr to 70") and, when the plan runs a shortfall, a gap-targeted stint sized to the first depleted window. The spouse plan has its own employment list, and a spouse's earnings count toward the couple's GIS.</P>
          </>
        )
      },
      {
        term: 'Cash inflow (house sale, inheritance…)',
        body: <P>A lump sum landing in the chosen account at the chosen age — taxable, TFSA, RRSP or cash cushion. It appears in that year's balances and grows thereafter. Switch the event to <em>Yearly</em> and give a start–end age range to repeat the same amount every year (e.g. rental income for a few years).</P>
      },
      {
        term: 'Cash outflow (big purchase, gift…)',
        body: <P>An extra expense at the chosen age, added on top of that year's spending target (after inflation). The portfolio must fund both. Set it to <em>Yearly</em> with an age range to model a recurring cost (e.g. a gift or a car every few years is better as separate one-time events, but a multi-year commitment fits a schedule).</P>
      },
      {
        term: 'Reverse mortgage',
        body: <P>Borrows against your home equity — proceeds are tax-free, so they don't count as income and don't touch GIS or the OAS clawback. Two ways to draw, alone or together: <strong>scheduled draws</strong> (a set $/yr from an age, CPI-indexed, for a fixed number of years) and <strong>top-up</strong> (once every account is drained, borrow just enough each year to cover spending — the true last resort). The loan compounds at the interest rate against the home, so net equity (home value − loan) erodes over time; it's shown per-year in the table and CSV. Borrowing stops once the loan hits the <strong>max loan-to-value</strong> ceiling (lenders typically cap near 55%), and the plan is "depleted" once the accounts <em>and</em> that remaining headroom are both exhausted.</P>
      },
      {
        term: 'Include spouse',
        body: <P>Runs a second, independent projection for your partner using their own ages, balances, contributions, CPP/OAS and spending. The two plans are combined into a household verdict: the household is SHORTFALL if either plan runs out, and the metric cards show household wealth at retirement with per-person detail.</P>
      },
      {
        term: 'Built-in vs linked spouse',
        body: (
          <>
            <P>The spouse can live two places, switched by the <strong>Built-in / Link a plan</strong> toggle at the top of the Spouse section:</P>
            {ul([
              <><strong>Built-in</strong> — the spouse's numbers are stored inside this scenario and edited inline. <em>Save spouse as its own plan…</em> (bottom of the section) promotes them to a standalone scenario named "this plan - Spouse".</>,
              <><strong>Link a plan</strong> — the spouse <em>is</em> another saved scenario. Their basic numbers show in the sidebar fetched live from that plan; edits stay a local draft until <em>Save to "plan name"</em> writes them back. One source of truth — editing the linked plan updates every household that links to it.</>,
            ])}
            <P>A household shares one province, one market assumption and one planning horizon, so a linked spouse's own values for those are overridden by this plan (each override is listed in the amber warning box).</P>
          </>
        )
      },
      {
        term: 'Spouse approximation',
        body: <P>Each spouse is drawn down independently; pension income splitting <em>is</em> modelled — up to 50% of eligible pension income (RRIF/RRSP draws and DB pensions, not CPP/OAS) is reallocated to the lower-taxed spouse each year to minimize household tax (affects reported tax only, not GIS or withdrawals). Spousal RRSPs are not modelled. Couple-based GIS <em>is</em> modelled (combined non-OAS income, couple rate when both receive OAS).</P>
      },
      {
        term: 'Expected Return (%)',
        body: <P>Constant annual return applied to RRSP, TFSA and taxable balances (growth lands after withdrawals each year). The deterministic table uses exactly this rate every year.</P>
      },
      {
        term: 'Volatility (%/yr)',
        body: <P>Standard deviation of annual returns, used only by Monte Carlo. 0% means "every year equals the expected return" — the Monte Carlo button will ask you to set a value above zero. Equity-heavy portfolios are typically 15–20%.</P>
      }
    ]
  },
  {
    id: 'help-verdict',
    title: 'Verdict',
    entries: [
      {
        term: 'The ON TRACK / SHORTFALL verdict',
        body: (
          <>
            <P>The verdict comes straight from the simulation: the plan is <strong>SHORTFALL</strong> if the money runs out (every account, including the cash cushion, reaches $0) before your max age, and <strong>ON TRACK</strong> if it lasts. The Age of Depletion card shows the year it runs out, or "Never".</P>
            <P>For a couple, the household verdict is the worst of the two plans.</P>
          </>
        )
      },
      {
        term: 'How to stress-test it',
        body: (
          <>
            <P>The verdict uses your expected return every year. To see how robust the plan really is:</P>
            {ul([
              <><strong>Lower the expected return</strong> (Market Hypotheses) for a pessimistic case.</>,
              <><strong>Run Monte Carlo</strong> — it randomizes returns around your assumption and reports the share of runs that never deplete; that success rate is the most honest single number.</>,
              <><strong>Run a Backtest</strong> — replays your plan through actual historical market sequences.</>
            ])}
          </>
        )
      }
    ]
  },
  {
    id: 'help-withdrawals',
    title: 'Withdrawal Mechanics',
    entries: [
      {
        term: 'Each retirement year, in order',
        body: ul([
          <>CPP and OAS are paid (taxable income).</>,
          <>If you are past the RRIF conversion age (default 71), the mandatory RRIF minimum comes out first — it is forced by law, even if you don't need it. After-tax cash beyond your spending need is redeposited into the taxable account.</>,
          <>The remaining spending need is drawn from accounts in your configured order (TFSA / Taxable / RRSP, draggable in the sidebar).</>,
          <>The cash cushion is the last resort.</>,
          <>Whatever remains in each account grows at the expected return.</>
        ], true)
      },
      {
        term: 'How each account is taxed on withdrawal',
        body: ul([
          <><strong>TFSA</strong> — tax-free. $1 withdrawn = $1 of spending.</>,
          <><strong>Taxable</strong> — the principal (ACB) portion is tax-free; the embedded-gain portion is taxed at the capital-gains inclusion rate. The engine grosses the withdrawal up so the after-tax proceeds cover the need.</>,
          <><strong>RRSP / RRIF</strong> — fully taxable. The engine grosses the withdrawal up via binary search so that, stacked on top of CPP/OAS and any RRIF minimum, the after-tax proceeds exactly cover the remaining need.</>
        ])
      },
      {
        term: 'RRIF conversion',
        body: <P>At the conversion age the entire RRSP becomes a RRIF (if you retire past that age, it converts immediately at retirement). Minimum withdrawals follow the CRA prescribed factors — 5.28% at 71 rising to 20% at 95 — applied to the start-of-year balance. Rates are editable in Settings → RRIF Rates.</P>
      },
      {
        term: 'When the balance goes negative mid-year',
        body: <P>Growth is applied after withdrawals to whatever remains. In the year the last account is drained, nothing remains to grow — so the balance can dip slightly negative at year-end when the growth rate is high (that year's growth was only ever credited on money that actually stayed invested). Depletion is recorded at that age and the display floors the balance at $0.</P>
      },
      {
        term: 'Withdrawal order matters',
        body: <P>Spending TFSA first preserves taxed-later RRSP room but lets the RRIF minimum problem grow; spending RRSP first prepays tax at today's (possibly lower) brackets and shrinks future forced minimums. Try both orders and compare the Tax Burden column and the ending balance.</P>
      },
      {
        term: 'See every step (the Math page)',
        body: <P>Want to see exactly how a year arrives at its numbers? Open <strong>Math</strong> from the breadcrumb row (or the calculator icon). Pick any year and it walks the engine's own calculation through step by step — spending target, benefits, the RRIF minimum, GIS, each withdrawal in your order, tax, and the ending balance — using the actual values the engine used, so it always matches the table. For a couple you can view You and Spouse side by side at the same calendar year.</P>
      }
    ]
  },
  {
    id: 'help-taxes',
    title: 'Tax Model',
    entries: [
      {
        term: "What's modelled",
        body: ul([
          <>Progressive federal + provincial brackets with each jurisdiction's basic personal amount applied at its lowest rate.</>,
          <>CPP and OAS as taxable income.</>,
          <>RRSP/RRIF withdrawals as taxable income, grossed up so after-tax income meets the target.</>,
          <><strong>OAS clawback:</strong> when total net income (benefits + registered withdrawals) exceeds the threshold (default $95,323), 15% of the excess is recovered, capped at the full OAS. It appears in the Income Tax column.</>,
          <>RRIF mandatory minimums with after-tax excess redeposited to the taxable account.</>,
          <><strong>Quebec abatement:</strong> 16.5% of federal tax is refunded to Quebec taxpayers (editable in Settings → Provincial Tax with QC selected).</>,
          <><strong>Ontario surtax:</strong> 20% on Ontario tax above the first threshold and 56% above the second (2026 thresholds $5,925 / $7,577; editable the same way with ONT selected).</>,
          <><strong>GIS:</strong> the Guaranteed Income Supplement — tax-free, reduced 50¢ per dollar of income excluding OAS (CPP, registered draws, taxable gains). It lowers the portfolio's share of the spending target. With a spouse enabled, CRA's couple rules apply: each spouse's entitlement is assessed on <em>combined</em> non-OAS income, at the lower couple rate when both receive OAS (single rate when only one does). Approximated annually; Service Canada recalculates quarterly.</>
        ])
      },
      {
        term: 'Approximations to be aware of',
        body: ul([
          <><strong>Taxable account:</strong> capital gains are modelled with an adjusted cost base (Settings → Capital Gains) — only the embedded-gain fraction of each withdrawal is taxed, at the 50% inclusion rate. The fraction is computed once per withdrawal (it drifts slightly within a year as ACB leaves pro-rata). Dividend gross-up/credits and deemed disposition at death are not modelled.</>,
          <><strong>Other provinces' surtaxes and credits</strong> (beyond Ontario's, which is modelled) are not included — e.g. BC/NS low-income reductions, dividend credits.</>,
          <>No RRSP contribution refunds and no contribution-room limits. Pension-income splitting is modelled for couples (reported tax only; the transfer direction is chosen per year and the maximum is applied — a partial transfer near a bracket boundary could in theory do slightly better). GIS is modelled for singles and couples (combined-income assessment); the quarterly Service Canada recalculation is approximated annually.</>
        ])
      },
      {
        term: 'Inflation',
        body: (
          <>
            <P>Settings → Engine has an inflation (CPI) rate, default 2%, plus two independent switches it drives:</P>
            <P><strong>Grow spending with inflation</strong> (on by default): your spending is entered in today's dollars and inflated by CPI each year from your current age — a $60k lifestyle needs ~$89k of nominal income 20 years from now at 2%. Turn it <em>off</em> for a level, real-terms plan where the Spending Target column stays flat in today's dollars.</P>
            <P><strong>Index tax tables, OAS and CPP to inflation</strong>: also inflates tax brackets, basic personal amounts, the OAS clawback threshold and benefit amounts each year, mirroring CRA's real-world indexation. With this <em>on</em> (and spending growth on), results are effectively in today's purchasing power. With it <em>off</em>, you see nominal dollars taxed against today's frozen tables — a more conservative projection, since real bracket creep works in the retiree's favour.</P>
            <P>The two switches are separate so you can, for example, hold spending flat while still indexing the tax system, or grow nominal spending against frozen tax tables.</P>
          </>
        )
      },
      {
        term: 'The tables',
        body: <P>Defaults are 2026 figures (federal 14% bottom rate, brackets indexed 2.0%, Alberta's new 8% bottom bracket). Everything is editable in Settings — update the tables each year when CRA publishes new indexation.</P>
      }
    ]
  },
  {
    id: 'help-montecarlo',
    title: 'Monte Carlo',
    entries: [
      {
        term: 'What it does',
        body: <P>Runs the full projection 500 times, each with a different randomized sequence of annual returns. Returns follow geometric Brownian motion around your expected return with Student-t shocks (10 degrees of freedom) so crash years are more common than a normal distribution would predict.</P>
      },
      {
        term: 'Reading the chart',
        body: ul([
          <>The dark band is the middle 50% of outcomes (p25–p75); the light band is p10–p90.</>,
          <>The blue line is the median portfolio value at each age.</>,
          <>Red bars along the bottom show when failed runs ran out of money.</>
        ])
      },
      {
        term: 'Success rate',
        body: <P>The share of runs that stayed funded through max age. 90%+ is conventionally "comfortable"; below 75% the plan is fragile. Median final balance tells you the typical legacy; the earliest depletion age tells you how bad the bad cases get.</P>
      },
      {
        term: 'Volatility',
        body: <P>The width of the fan is driven by Volatility in the sidebar. 0% collapses the simulation to the deterministic answer; 15–20% is a typical equity-heavy portfolio. Returns are not mean-reverting and sequence risk is real: a crash early in retirement hurts far more than one late.</P>
      }
    ]
  },
  {
    id: 'help-steering',
    title: 'Steering (the equalizer)',
    entries: [
      {
        term: null,
        body: (
          <P>
            The <strong>Steering</strong> page (gold link in the toolbar) is a goals-level equalizer over your
            whole plan. Instead of editing fields one at a time, you push sliders and drag a pad while the
            readouts — status, money-lasts-to, success rate — update live. It writes the same underlying
            inputs, so everything you do here is reflected in the projection and Monte Carlo views.
          </P>
        )
      },
      {
        term: 'The sliders',
        body: (
          <>
            <P>Each slider is a major lever: annual spending, retirement age, expected return, annual savings, plan-to age, return volatility, CPP start age, and OAS start age.</P>
            {ul([
              <>Drag the two edge handles to crop a range (<em>at least / at most</em>); the middle knob moves the value inside it. A range with both edges together is a hard pin — the control won't move.</>,
              <><strong>Annual savings</strong> only moves the taxable account on top of your locked RRSP+TFSA — so it never runs into a contribution limit. Its floor is your current RRSP+TFSA total.</>,
              <>Ranges adapt to the plan: retirement age starts at your current age, and an axis grows if you set a value past its end.</>,
            ])}
          </>
        )
      },
      {
        term: 'The drag pad',
        body: (
          <>
            <P>The square is retirement age (x) × spending (y). Drag the dot to move both at once. The red→green gradient shows the plan's success rate at every combination — green means that combination is likely to succeed, red means likely to run short.</P>
            {ul([
              <>When a slider is cropped, its allowed range shows as a rectangle on the pad. <strong>Drag a corner</strong> to resize the range in both axes at once.</>,
              <>The shading re-computes as you change anything — return, volatility, savings, horizon — streaming in from the region around your current point outward.</>,
            ])}
          </>
        )
      },
      {
        term: 'Crops',
        body: (
          <P>
            Each slider is a <strong>crop</strong>: drag the two edge handles to fence in the range you
            consider acceptable, and the middle knob to move the plan's actual value within that range.
            The value knob can never leave the crop, so the plan always stays inside your limits. Crops
            are remembered between visits, stored as fractions of each range so they survive any future
            range changes.
          </P>
        )
      },
      {
        term: 'How the shading is computed',
        body: <P>The pad runs Monte Carlo against one seeded batch of futures so the shading is stable while you drag. Because each lever moves the success rate in a known direction, the solver binary-searches the boundary row-by-row instead of scoring every cell — so it stays fast and can stream partial results to the screen as they finish.</P>
      }
    ]
  },
  {
    id: 'help-optimize',
    title: 'Optimize',
    entries: [
      {
        term: null,
        body: (
          <P>
            The <strong>Optimize</strong> page has three tabs: ranked strategies the app computes
            itself, a spending target solver, and an AI helper you drive manually.
          </P>
        )
      },
      {
        term: 'Strategy ranking',
        body: <P>Re-runs your plan under a menu of alternatives — CPP/OAS timing (take at 60, 65, or defer to 70), withdrawal orders (TFSA-first, RRSP meltdown, and more), and, when a home value is recorded in the Reverse Mortgage section, reverse-mortgage start ages and draw sizes. Each is scored on the sustainable after-tax spending it supports; the best rises to the top with a one-click Apply that writes the changes into your inputs (unsaved until you Save).</P>
      },
      {
        term: 'Sustainable spending',
        body: <P>Answers "how much could I spend?" instead of "will my spending last?" — binary-searches the after-tax spending that keeps the plan funded through max age, at the success target you pick, using Monte Carlo futures.</P>
      },
      {
        term: 'AI helper (paste-at-your-own-discretion)',
        body: (
          <>
            <P>The <strong>Agent</strong> and <strong>Ask</strong> tabs build a self-contained prompt embedding your plan (Ask also embeds the computed results) for you to copy into any AI — ChatGPT, Claude, whatever you trust. Agent replies can be pasted back and applied field-by-field after validation; Ask is read-only Q&amp;A.</P>
            <P><strong>Privacy:</strong> this app never sends anything anywhere — the copy button is the only thing that moves data, and it moves it into <em>your</em> clipboard. But once you paste the prompt into an AI service, your ages, balances, benefits and spending <strong>are read by that provider</strong>, under its terms and privacy policy. If that gives you pause, redact the numbers that identify you, or skip the feature — everything else in Optimize runs entirely on your machine.</P>
          </>
        )
      }
    ]
  },
  {
    id: 'help-backtest',
    title: 'Backtest',
    entries: [
      {
        term: 'What it does',
        body: <P>Monte Carlo invents random futures; the backtest replays real pasts. It runs the plan against every rolling window of a Canadian real (after-inflation) balanced-portfolio return series from 1970 to today, each window as long as your plan horizon (current age → max age), and reports how often the plan survived.</P>
      },
      {
        term: 'Reading the panel',
        body: ul([
          <><strong>Success rate</strong> — share of historical windows that never ran out of money.</>,
          <><strong>Worst / Best window</strong> — the start year with the smallest / largest ending balance.</>,
          <>Each bar is one window's ending balance; red bars depleted before max age.</>
        ])
      },
      {
        term: 'Why it matters',
        body: <P>Sequence-of-returns risk is the biggest threat to a drawdown plan: retiring into the 1973–74 crash, the 2000–02 dot-com bust or 2008 is far worse than the same average return with the crash at the end. A plan with a high backtest success rate has historically withstood every bad sequence on record.</P>
      },
      {
        term: 'Method & approximations',
        body: <P>Returns are in real terms, so each window runs with inflation off (spending stays in today's dollars, tax tables frozen). The series is 60% S&P/TSX Composite total return (price + a 3.0% average dividend yield) and 40% Government of Canada long-bond return, both deflated by CPI. Equity and CPI are actual published data (StatCan, S&P/TSX); the bond leg is reconstructed from the benchmark yield series. Spouse plans are tested on the primary's sequence only.</P>
      }
    ]
  },
  {
    id: 'help-compare',
    title: 'Compare',
    entries: [
      {
        term: null,
        body: (
          <P>
            The <strong>Compare</strong> page puts 2–3 saved scenarios side by side — verdict, money-lasts-to,
            spending, tax and ending wealth — so you can see which version of a plan holds up best. Each
            scenario is scored with its own resolved spouse: a plan whose spouse is a linked scenario is
            compared as the full household, not the primary alone.
          </P>
        )
      }
    ]
  },
  {
    id: 'help-data',
    title: 'Scenarios & Data',
    entries: [
      {
        term: 'Scenarios',
        body: <P>A scenario is one complete set of inputs. The top bar switches between them; Save writes your edits into the active scenario; Scenarios opens the manager to create, rename, duplicate and delete. Reset discards your unsaved edits and reverts the sidebar to the active scenario's last-saved inputs. Switching away with unsaved edits asks whether to save first — the prompt's "don't ask again" box (or Settings → General) turns that check off.</P>
      },
      {
        term: 'New Scenario wizard',
        body: <P>Creating a scenario opens the guided setup: ages, savings, contributions, CPP/OAS and a spending goal, then a review step where you name the plan, answer the own-your-home question (saved into the Reverse Mortgage section so Optimize can weigh the equity), and optionally tick <strong>Add a spouse or partner</strong> — which runs a short second wizard for the partner's own numbers.</P>
      },
      {
        term: 'Where data lives',
        body: <P>Your plans live in a real <strong>SQLite database</strong> (running as WebAssembly) whose bytes are stored in this browser's <strong>origin-private file system</strong> — a durable per-site store with no 5&nbsp;MB ceiling, mirrored to localStorage for compatibility. Nothing leaves your machine. Clearing the browser's site data can still erase it, so use Export to keep backups. One exception, and it's your hands on the keyboard: the Optimize tab's <strong>AI helper</strong> builds a prompt containing your plan (and results) for you to paste into an AI of your choice — once pasted, that provider reads the data under its own privacy policy.</P>
      },
      {
        term: 'One tab at a time',
        body: <P>Use the app in a <strong>single browser tab</strong>. Multi-tab is deliberately unsupported: two tabs each keep their own in-memory copy, and whichever one saves last silently overwrites the other's work. If a second tab gets opened by accident, close it without saving (or refresh it) before continuing in the other.</P>
      },
      {
        term: 'The Data page (export / import)',
        body: <P>Everything that moves plan data in or out lives on the <strong>Data</strong> page (the database icon in the header menu). Export downloads the chosen scenarios (+ optionally the engine settings) as a <strong>.sqlite file</strong> — the very same database format the app stores locally, openable by any SQLite tool (DB Browser, the sqlite3 CLI). Import reads that file back (and still accepts the older JSON backups), letting you pick which scenarios to apply. Older payloads are migrated automatically (e.g. a legacy single "annual contribution" becomes a TFSA contribution).</P>
      },
      {
        term: 'Import from a spreadsheet (CSV template)',
        body: <P>The Data page's Import section offers a downloadable <strong>CSV import template</strong>: one row per plan field (ages, balances, contributions, CPP/OAS, spending goal), with <code>spouse.*</code> rows for a partner. Fill in the value column in Excel or Google Sheets — leave a value blank to use the default, leave every spouse row blank for a single plan — save as CSV, and choose the file. It becomes a new scenario. Strategy structures (spending bands, one-time events, pensions, reverse mortgage) aren't part of the flat template; set those in the app afterward.</P>
      },
      {
        term: 'Export CSV',
        body: <P>The link in the breadcrumb row downloads the year-by-year projection table (balances, contributions, gains, withdrawals, tax, benefits) for the active scenario.</P>
      },
      {
        term: 'Share link',
        body: (
          <>
            <P>Opens a card with a link that encodes the active plan's inputs in the URL itself (base64 in the fragment, after the #). Copy it and send it to someone — opening it imports a copy as a new "Shared plan" scenario. Nothing is uploaded to a server, and the fragment never travels with the HTTP request.</P>
            <P>The link is built from the current host, port and path, so it works for anyone who can reach the same address — a hosted deployment, a LAN IP, or this machine if you're both on it.</P>
          </>
        )
      },
      {
        term: 'Print summary / PDF',
        body: <P>Opens a card where you choose what the printout includes — the base one-page summary (profile, savings, verdict) plus any of: the projection timeline chart, a fresh Monte Carlo fan chart, and a table of major spending milestones (retirement, CPP/OAS start, RRIF conversion, phase changes, one-time events). The Print button then opens the browser's print dialog; choose "Save as PDF" to file or email it. The interactive tables and charts are hidden when printing.</P>
      }
    ]
  },
  {
    id: 'help-glossary',
    title: 'Glossary',
    entries: [
      {
        term: 'SQLite / .sqlite file',
        body: <P>A database kept in a single ordinary file. Your plans live in one inside the browser, and Export downloads a copy of that very file. You never need to open it — but if you're curious, free tools like "DB Browser for SQLite" can look inside. Think of it as the app's filing cabinet.</P>
      },
      {
        term: 'Database',
        body: <P>An organized place to keep data so it can be found and updated later — here, the list of your saved scenarios and settings. Not a website, not "the cloud": yours sits inside your browser on your own machine.</P>
      },
      {
        term: 'OPFS / "origin-private file system"',
        body: <P>A private folder your browser gives each website, invisible to other sites and (mostly) to you. That's where this app keeps its database file, which is why your plans survive closing the browser — and why clearing the browser's "site data" erases them. Mentioned in "Where data lives"; you don't need to remember the acronym.</P>
      },
      {
        term: 'localStorage',
        body: <P>The browser's older, smaller storage cubby (about 5&nbsp;MB). The app keeps a backup copy of the database there in case the newer OPFS storage isn't available (e.g. some private-browsing modes). If you ever see it mentioned, that's all it is.</P>
      },
      {
        term: 'Backup / Export',
        body: <P>A copy of your plans saved out to a file you choose, kept somewhere you control (Downloads folder, a USB stick, email to yourself). The app keeps everything on this one computer in this one browser — a backup is the only copy that exists anywhere else. The Data page makes one in one click.</P>
      },
      {
        term: 'Import',
        body: <P>The reverse of a backup: loading a file back in. On the Data page you can load a backup file (yours, or one from another computer), a projection JSON, or the fill-in spreadsheet template — each becomes scenarios in the app.</P>
      },
      {
        term: 'CSV',
        body: <P>"Comma-separated values" — the simplest spreadsheet format there is. Excel, Google Sheets, and Numbers all open and save it. The projection export and the import template use it so your numbers move freely between this app and a spreadsheet.</P>
      },
      {
        term: 'JSON',
        body: <P>A text format for structured data — readable by programs (and, squinting, by people). Some exports use it because it preserves detail a spreadsheet can't. You don't need to read it; you just need to know it's one of ours and can be imported back.</P>
      },
      {
        term: 'YAML',
        body: <P>JSON's more human-readable cousin — same structured data, written as indented lists instead of brackets and braces. The projection export offers it as an alternative to JSON for anyone who wants to read (or hand-edit) the numbers outside the app. Like JSON, you don't need to touch it to use the app.</P>
      },
      {
        term: 'Browser tab (and the one-tab rule)',
        body: <P>Each tab you open this app in keeps its own working copy, and saving in one doesn't update the other — the last Save wins, silently. Use one tab at a time; if a second opens by accident, close it without saving.</P>
      },
      {
        term: 'Scenario',
        body: <P>One complete "what-if" plan: your ages, balances, benefits, spending goal, and strategy choices, saved under a name. Make several — "retire at 60" vs "65", "with the cottage sale" vs without — and flip between them from the dropdown up top or compare them side by side on the Compare page.</P>
      },
      {
        term: 'WebAssembly / wasm',
        body: <P>The technology that lets a real database engine run inside your browser tab. Only mentioned because you might glimpse "wasm" in a downloaded file or an error message. It's on your machine doing the work; nothing is sent anywhere.</P>
      },
      {
        term: 'AI helper disclaimer (what "read by the AI" means)',
        body: <P>The Optimize tab can draft a question for an AI chatbot (ChatGPT, Claude, …). The app itself never contacts them — but the moment <em>you</em> paste that text into their site, the plan details in it (ages, balances, benefits, spending) are being read by that company, under its privacy policy, not ours. Don't paste anything you wouldn't hand to that company.</P>
      },
    ]
  },
  {
    id: 'help-legal',
    title: 'License & Legal',
    entries: [
      {
        term: 'Disclaimer — not financial advice',
        body: (
          <>
            <P>
              RE: tired is an educational and exploratory tool. It produces <strong>estimates</strong> from
              a simplified model of Canadian tax and benefit rules — it is <strong>not</strong> financial,
              investment, tax, or legal advice, and it does not consider your complete circumstances.
            </P>
            {ul([
              <>The tax model omits real-world details (dividend credits, most provincial credits, deemed disposition at death, contribution-room limits — see the Tax Model section).</>,
              <>Tax figures are 2026 defaults that go stale; benefit rules change by legislation.</>,
              <>Projections assume constant average returns or stylized randomness; actual markets will not cooperate.</>,
              <>No warranty is given that any calculation is correct, complete, or suitable for any purpose. Use of this tool is entirely at your own risk.</>
            ])}
            <P>Before making retirement, withdrawal, or benefit-timing decisions, verify the numbers and consult a qualified financial planner or tax professional.</P>
          </>
        )
      },
      {
        term: 'Credits',
        body: (
          <>
            <P>
              The drawdown engine at the heart of this app was originally built on{' '}
              <a
                href="https://github.com/danielabar/retirement_drawdown_simulator_canada"
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
              >
                retirement_drawdown_simulator_canada
              </a>
              {' '}by <strong>danielabar</strong> — a Canadian retirement stress-tester modelling RRSP /
              taxable / TFSA withdrawals with Canadian taxes, CPP/OAS, and RRIF rules. Thank you to the
              original author for publishing it.
            </P>
            <P>
              Note: the upstream repository did not carry a LICENSE file at the time it was incorporated
              (checked 2026-08-23). RE: tired's own code is MIT-licensed as described below.
            </P>
          </>
        )
      },
      {
        term: 'MIT License (full text)',
        body: (
          <pre className="text-[11px] leading-relaxed text-slate-600 bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap font-mono">
            {MIT_TEXT}
          </pre>
        )
      }
    ]
  }
];

// ---------------------------------------------------------------------------
// Plain-text extraction for search matching.
// ---------------------------------------------------------------------------

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return '';
}

// Highlight every occurrence of `query` inside string children of `node`.
function highlight(node: ReactNode, query: string): ReactNode {
  if (!query) return node;
  if (typeof node === 'string') {
    const lower = node.toLowerCase();
    const q = query.toLowerCase();
    if (!lower.includes(q)) return node;
    const parts: ReactNode[] = [];
    let i = 0;
    let k = 0;
    while (i < node.length) {
      const hit = lower.indexOf(q, i);
      if (hit === -1) { parts.push(node.slice(i)); break; }
      if (hit > i) parts.push(node.slice(i, hit));
      parts.push(
        <mark key={k++} className="bg-yellow-200 text-inherit rounded-sm px-px">
          {node.slice(hit, hit + q.length)}
        </mark>
      );
      i = hit + q.length;
    }
    return <>{parts}</>;
  }
  if (Array.isArray(node)) return node.map((n, i) => <span key={i}>{highlight(n, query)}</span>);
  if (typeof node === 'object' && node != null && 'props' in node) {
    const el = node as React.ReactElement<{ children?: ReactNode }>;
    return { ...el, props: { ...el.props, children: highlight(el.props.children, query) } };
  }
  return node;
}

// ---------------------------------------------------------------------------
// Page: TOC + search + all sections in one scroll.
// ---------------------------------------------------------------------------

export function HelpModal() {
  const [query, setQuery] = useState('');
  const q = query.trim();

  const filtered = useMemo(() => {
    if (!q) return SECTIONS.map(s => ({ ...s, entries: s.entries }));
    const lower = q.toLowerCase();
    return SECTIONS
      .map(s => ({
        ...s,
        entries: s.entries.filter(e =>
          s.title.toLowerCase().includes(lower) ||
          (e.term?.toLowerCase().includes(lower) ?? false) ||
          textOf(e.body).toLowerCase().includes(lower)
        )
      }))
      .filter(s => s.entries.length > 0);
  }, [q]);

  const matchCount = q ? filtered.reduce((n, s) => n + s.entries.length, 0) : null;

  return (
    <div>
      {/* Re-run the guided first-scenario setup (the welcome wizard). */}
      <a
        href="#/welcome"
        className="mb-3 flex items-center gap-3 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 group"
      >
        <Sparkles size={16} className="shrink-0 text-blue-600" />
        <span className="flex-1 text-xs text-slate-700">
          <span className="font-semibold text-slate-900">Walk through your first scenario</span>
          {' '}— a 5-step guided setup (ages, savings, benefits, spending).
        </span>
        <span className="text-[11px] font-medium text-blue-600 group-hover:underline">Open →</span>
      </a>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search help — try “clawback”, “TFSA”, “share link”…"
          className="w-full pl-8 pr-8 py-1.5 text-xs border border-neutral-300 rounded focus:outline-none focus:border-blue-500"
        />
        {q && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700 rounded"
            title="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Table of contents */}
      <nav className="mb-5 pb-4 border-b border-neutral-200">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Contents
          {matchCount != null && (
            <span className="ml-2 normal-case font-normal text-slate-400">
              {matchCount} {matchCount === 1 ? 'topic' : 'topics'} match{matchCount === 1 ? 'es' : ''}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {filtered.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="text-xs text-blue-600 hover:underline"
            >
              {s.title}
            </a>
          ))}
          {filtered.length === 0 && (
            <span className="text-xs text-slate-500">No matches — try a shorter or different term.</span>
          )}
        </div>
      </nav>

      {/* All sections in one scroll */}
      <div className="pb-8">
        {filtered.map(s => (
          <section key={s.id} id={s.id} className="mb-6 scroll-mt-4">
            <h2 className="text-sm font-bold text-slate-900 border-b border-neutral-200 pb-1 mb-2">
              {highlight(s.title, q)}
            </h2>
            {s.entries.map((e, i) =>
              e.term == null ? (
                <div key={i}>{highlight(e.body, q)}</div>
              ) : (
                <div key={i} className="py-1.5 border-b border-neutral-100 last:border-0">
                  <div className="text-xs font-medium text-slate-800">{highlight(e.term, q)}</div>
                  <div className="mt-0.5">{highlight(e.body, q)}</div>
                </div>
              )
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
