// Domain-knowledge minter: teaches the model real Canadian retirement finance
// — tax brackets, CPP/OAS/GIS program rules, RRIF minimums, account types, and
// market history — sourced from the app's OWN shipped data so the facts can't
// drift from what the engine actually computes with.
//
// WHY THIS IS GROUNDED, NOT HAND-WRITTEN. A small model that memorizes "the
// OAS clawback threshold is $X" will be confidently wrong the year the table is
// edited (the app lets the user edit tax tables in Settings). So every fact
// here is read LIVE from DEFAULT_APP_CONFIG + HISTORICAL_REAL_RETURNS at mint
// time: the corpus always teaches the numbers the shipped engine uses, and the
// golden eval hash forces any change to be deliberate (rule-2 analogue).
//
// Two record shapes:
//   - fact recall:      a concept question → a plain-words answer that CITES the
//                       real figure, then offers to ground it in the user's plan
//   - applied reading:  a program rule stated against a scenario's real numbers
// The register is the same as every other kind: consequence-explaining, never
// advice ("here's how it works / here's what it does to YOUR numbers — your call").

import { DEFAULT_APP_CONFIG } from '../src/lib/appConfig';
import { HISTORICAL_REAL_RETURNS } from '../src/lib/historicalReturns';
import type { RetirementInputs } from '../src/lib/retirementEngine';
import type { CorpusRecord } from './buildCorpus';
import { SCENARIOS, type NamedScenario } from './scenarios';

const cfg = DEFAULT_APP_CONFIG;

// ---------------------------------------------------------------------------
// Fact-recall records. Each entry is one concept the model should be able to
// explain. `ask` is a natural question; `answer` is built by a function that
// interpolates the LIVE config figures so the prose is always correct.
// ---------------------------------------------------------------------------

interface FactSpec {
  id: string;
  /** The canonical phrasing (kept for backward-compat with the eval). */
  ask: string;
  /** Extra natural phrasings of the same question — teaches recall, not echo. */
  phrasings?: string[];
  /** Scenario ids this fact has an "applied" variant for (real household numbers). */
  appliedTo?: string[];
  /** Build the general answer from live config — never a hardcoded number. */
  answer: () => string;
  /** Build the applied answer against a specific scenario's real numbers. */
  appliedAnswer?: (inputs: RetirementInputs, s: NamedScenario) => string;
  /** Optional applied-variant question (defaults to the canonical ask). */
  appliedAsk?: (s: NamedScenario) => string;
  /** Phrases the answer must contain (graded by the eval gate). */
  mustContain: string[];
}

const money0 = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const OFFER = 'I can run this on your own plan so you see what it does to your numbers.';

// Register rotation: the SAME closing sentence every time teaches parroting, so
// the offer-to-ground is drawn from a varied set. All still route back to the
// tools ("your plan/numbers") and none advises — the register, varied.
const CLOSERS = [
  OFFER,
  'If you want, I can run this on your plan and show you the actual numbers.',
  'Want me to apply this to your situation? I can run the numbers.',
  'I can model this on your plan so you see the dollar effect.',
  'Happy to run this against your own figures so it\'s concrete.',
];

const FACTS: FactSpec[] = [
  // ---- CPP timing -------------------------------------------------------
  {
    id: 'cpp-timing',
    ask: 'How does CPP timing work? What changes if I take it early or late?',
    phrasings: [
      'When should I start my CPP?',
      'What\'s the penalty for taking CPP early?',
      'Explain how the age I take CPP affects the amount.',
    ],
    answer: () => {
      const c = cfg.cpp;
      const earlyTotal = (c.standardAge - c.earliestAge) * 12 * c.earlyPenaltyPerMonth;
      const lateTotal = (c.maxDeferralAge - c.standardAge) * 12 * c.deferralBonusPerMonth;
      return `CPP is based on a standard age of ${c.standardAge}. Taking it early (as soon as ${c.earliestAge}) cuts it ${pct(c.earlyPenaltyPerMonth)} per month — that's ${pct(earlyTotal)} less if you start at ${c.earliestAge}. Delaying past ${c.standardAge} adds ${pct(c.deferralBonusPerMonth)} per month, up to ${pct(lateTotal)} more at ${c.maxDeferralAge} — and it's indexed for life. ${OFFER}`;
    },
    mustContain: ['CPP', 'month', 'indexed'],
  },
  {
    id: 'cpp-early',
    ask: 'Is it ever worth taking CPP at 60?',
    phrasings: [
      'Should I take CPP as soon as I can at 60?',
      'What do I lose by taking CPP at 60?',
    ],
    answer: () => {
      const c = cfg.cpp;
      const cut = (c.standardAge - c.earliestAge) * 12 * c.earlyPenaltyPerMonth;
      return `Taking CPP at ${c.earliestAge} locks in a permanent ${pct(cut)} reduction versus waiting to ${c.standardAge} — for life, though it is indexed. The trade-off is getting income sooner (and drawing less from your savings early) against a smaller guaranteed amount later. Whether that helps depends on your other income, your health/longevity, and whether you need the cash now — I can compare both timings on your plan to show the difference.`;
    },
    mustContain: ['CPP', '60', 'reduction'],
  },
  {
    id: 'cpp-defer-70',
    ask: 'What do I gain by delaying CPP to 70?',
    phrasings: [
      'How much bigger is CPP if I wait until 70?',
      'Why do people say to delay CPP to 70?',
    ],
    answer: () => {
      const c = cfg.cpp;
      const bonus = (c.maxDeferralAge - c.standardAge) * 12 * c.deferralBonusPerMonth;
      return `Delaying CPP from ${c.standardAge} to ${c.maxDeferralAge} adds ${pct(c.deferralBonusPerMonth)} per month — a ${pct(bonus)} larger benefit, indexed for life. That's a bigger inflation-protected income floor later, at the cost of drawing more from savings in your 60s. It's one of the most powerful levers for plans that might run short late in life. I can run the comparison on your numbers.`;
    },
    mustContain: ['CPP', '70', 'indexed'],
  },
  // ---- OAS + deferral ---------------------------------------------------
  {
    id: 'oas-basics',
    ask: 'How much is OAS, and what does delaying it do?',
    phrasings: [
      'When can I start OAS and how much is it?',
      'Is it worth delaying OAS past 65?',
    ],
    answer: () => {
      const o = cfg.oas;
      const maxBonus = (o.maxDeferralAge - o.eligibleAge) * 12 * o.deferralBonusPerMonth;
      return `OAS starts at ${o.eligibleAge} and pays about ${money0(o.baseMonthly65to74)}/month for ages 65–74, rising to ${money0(o.baseMonthly75plus)}/month at 75 (2026 figures). You need ${o.minResidencyYears} years in Canada after 18 for any OAS, and ${o.fullPensionResidencyYears} for the full amount. You can defer to ${o.maxDeferralAge} for +${pct(o.deferralBonusPerMonth)} a month — up to ${pct(maxBonus)} more. ${OFFER}`;
    },
    mustContain: ['OAS', '65', 'defer'],
  },
  // ---- OAS clawback -----------------------------------------------------
  {
    id: 'oas-clawback',
    ask: 'What is the OAS clawback?',
    phrasings: [
      'Will my OAS be clawed back?',
      'At what income does OAS start getting reduced?',
    ],
    appliedTo: ['ab-high-earner'],
    appliedAsk: () => 'I earn a lot — is my OAS at risk of clawback?',
    answer: () => {
      const o = cfg.oas;
      return `If your net income goes over ${money0(o.clawbackThreshold)} (2026), OAS is recovered at ${pct(o.clawbackRate)} of the excess — the "clawback." Big RRSP/RRIF withdrawals or a large taxable gain in one year can push you over it, which is why the timing and order of withdrawals matters. ${OFFER}`;
    },
    appliedAnswer: (inputs) => {
      const o = cfg.oas;
      return `With ${money0(inputs.rrspBalance ?? 0)} in RRSP and a target spend of ${money0(inputs.desiredSpending ?? 0)}/yr, your taxable income in retirement could approach or exceed the ${money0(o.clawbackThreshold)} OAS clawback threshold (2026) — especially once RRIF minimums start. Above that line OAS is recovered at ${pct(o.clawbackRate)} of the excess, so a large RRSP withdrawal doesn't just get taxed, it also erodes your OAS. Spreading withdrawals or leaning on your TFSA (${money0(inputs.tfsaBalance ?? 0)}) can keep you under the threshold in more years. ${OFFER}`;
    },
    mustContain: ['clawback', 'income', 'OAS'],
  },
  // ---- GIS --------------------------------------------------------------
  {
    id: 'gis',
    ask: 'What is GIS and how is it reduced?',
    phrasings: [
      'Do I qualify for the Guaranteed Income Supplement?',
      'How does extra income affect my GIS?',
    ],
    appliedTo: ['gis-sensitive'],
    appliedAsk: () => 'My income is low — will I get GIS, and what reduces it?',
    answer: () => {
      const o = cfg.oas;
      return `The Guaranteed Income Supplement (GIS) tops up low-income OAS pensioners — up to about ${money0(o.gisMaxAnnualSingle)}/yr for a single person (2026). It's reduced by roughly ${pct(o.gisReductionRate)} per dollar of income *excluding* OAS itself, so extra RRSP/RRIF withdrawals can wipe it out dollar-for-dollar. ${OFFER}`;
    },
    appliedAnswer: (inputs) => {
      const o = cfg.oas;
      const cpp = (inputs.cppMonthlyAmount ?? 0) * 12;
      return `With your savings (${money0(inputs.rrspBalance ?? 0)} RRSP, ${money0(inputs.tfsaBalance ?? 0)} TFSA) and CPP of about ${money0(cpp)}/yr, GIS is very relevant to you: it can add up to about ${money0(o.gisMaxAnnualSingle)}/yr for a single OAS pensioner (2026). The catch is it's reduced by about ${pct(o.gisReductionRate)} per dollar of income *excluding* OAS — so your CPP and any RRSP withdrawal cut it, while a TFSA withdrawal does not. For someone in your position the drawdown order directly changes how much GIS you keep. ${OFFER}`;
    },
    mustContain: ['GIS', 'OAS', 'reduced'],
  },
  // ---- RRIF minimums ----------------------------------------------------
  {
    id: 'rrif',
    ask: 'When do I have to convert my RRSP to a RRIF, and what are the minimum withdrawals?',
    phrasings: [
      'What are RRIF minimum withdrawals?',
      'Do I have to take money out of my RRIF every year?',
    ],
    answer: () => {
      const age = cfg.engine.rrifConversionAge;
      const r71 = cfg.rrifRates['71'] ?? 0;
      const r95 = cfg.rrifRates['95'] ?? 0;
      return `An RRSP must be converted to a RRIF by the end of the year you turn ${age}. From then on you must withdraw a rising minimum each year — about ${pct(r71)} of the balance at 71, climbing to ${pct(r95)} by 95 — whether you need it or not, and it's fully taxable. ${OFFER}`;
    },
    mustContain: ['RRIF', 'minimum', 'taxable'],
  },
  // ---- Account types ----------------------------------------------------
  {
    id: 'accounts',
    ask: 'What\'s the difference between an RRSP, a TFSA, and a taxable account?',
    phrasings: [
      'Should I save in an RRSP or a TFSA?',
      'How is a taxable account different from registered accounts?',
      'What accounts can I hold retirement savings in?',
    ],
    answer: () =>
      `An RRSP defers tax: contributions are deductible, growth is sheltered, and withdrawals are fully taxed as income (that's why the drawdown order matters). A TFSA is the reverse: after-tax in, but growth and withdrawals are tax-free. A taxable (non-registered) account has no shelter — interest, dividends, and realized gains are taxed each year, with only ${pct(cfg.engine.capitalGainsInclusion)} of a capital gain counted as income. ${OFFER}`,
    mustContain: ['RRSP', 'TFSA', 'tax'],
  },
  // ---- TFSA / RRSP room -------------------------------------------------
  {
    id: 'contribution-room',
    ask: 'How much can I put in a TFSA or RRSP each year?',
    answer: () =>
      `The 2026 TFSA dollar limit is ${money0(cfg.engine.tfsaAnnualLimit)}/yr (unused room carries forward). RRSP room is 18% of prior-year earned income up to a ${money0(cfg.engine.rrspAnnualMax)} max. In retirement you're usually drawing down rather than contributing, but the order you draw from each account changes the tax you pay. ${OFFER}`,
    mustContain: ['TFSA', 'RRSP', 'room'],
  },
  // ---- FHSA (First Home Savings Account) --------------------------------
  {
    id: 'fhsa',
    ask: 'What is an FHSA and how does it work?',
    phrasings: [
      'Should I use an FHSA to save for a home?',
      'How much can I put in a First Home Savings Account?',
    ],
    answer: () => {
      const f = cfg.fhsa;
      return `A First Home Savings Account (FHSA) is the best of an RRSP and a TFSA for a first home: contributions are tax-deductible (like an RRSP) and qualifying withdrawals to buy a first home are tax-free (like a TFSA). You can put in up to ${money0(f.annualLimit)}/yr, to a ${money0(f.lifetimeLimit)} lifetime max, and the account can stay open ${f.maxYears} years. If you don't buy, it can transfer to your RRSP with no contribution room needed — so it's not wasted. It's accumulation-only (for pre-retirement saving), not a drawdown account. ${OFFER}`;
    },
    mustContain: ['FHSA', 'deductible', 'home'],
  },
  // ---- Contribution-room tracking (issue #24) ---------------------------
  {
    id: 'room-tracking',
    ask: 'What happens if I contribute more than my TFSA or RRSP room?',
    phrasings: [
      'Can I over-contribute to my TFSA?',
      'How does contribution room affect my deposits?',
    ],
    answer: () =>
      `Each registered account has a legal limit: TFSA room accrues ${money0(cfg.engine.tfsaAnnualLimit)}/yr (unused carries forward), and RRSP room is 18% of prior-year earned income up to ${money0(cfg.engine.rrspAnnualMax)}. If you turn room-tracking on in Settings, the engine caps each year's deposits at your remaining room and spills any excess into a non-registered (taxable) account — so an over-limit contribution doesn't just vanish, it lands somewhere taxable. That changes the long-run tax on the overflow. ${OFFER}`,
    mustContain: ['room', 'TFSA', 'RRSP'],
  },
  // ---- Debt (the unified debt register) ----------------------------------
  // Behavior-only feature: no config numbers to cite, so the fact grounds in
  // the engine's documented mechanics (see the Debt interface comment in
  // retirementEngine.ts). Honest about what the model does, never advice.
  {
    id: 'debt-drag',
    ask: 'How does carrying debt into retirement affect my plan?',
    phrasings: [
      'Should I still have a mortgage when I retire?',
      'What does my credit-card balance do to my retirement?',
      'How is a loan treated in the drawdown?',
    ],
    appliedTo: ['debt-carrying'],
    appliedAsk: () => 'I still have a mortgage and a card balance — what do they do to my plan?',
    answer: () =>
      `The plan treats a debt as a drag, not just a number you owe. You enter the annual interest rate as a decimal — 0.051 means 5.1% — and each year the balance grows by that rate while the year's payments are added to that year's spending need, funded from your accounts like any other expense. So the debt pulls money out of the plan until it's paid off. A mortgage is modelled the same way, just with a much bigger payment that stops at payoff and frees up the cash flow. Because the payments are after-tax money, they never add to taxable income, so they don't trigger GIS or OAS clawback. The payment each year is capped at the remaining balance, so the final year pays less and the debt then stops. ${OFFER}`,
    appliedAnswer: (inputs) => {
      const debts = inputs.debts ?? [];
      const mortgage = debts.find((d) => d.kind === 'mortgage');
      const cards = debts.filter((d) => d.kind !== 'mortgage');
      const totalBalance = debts.reduce((sum, d) => sum + d.balance, 0);
      const totalPayment = debts.reduce((sum, d) => sum + d.monthlyPayment, 0);
      return `You're carrying ${money0(totalBalance)} of debt in the plan — ${mortgage ? `a ${money0(mortgage.balance)} mortgage at ${pct(mortgage.interestRate)}` : 'a mortgage'}${cards.length ? ` plus ${cards.map((c) => `${money0(c.balance)} on the ${c.label.toLowerCase()} at ${pct(c.interestRate)}`).join(' and ')}` : ''}. Together that's ${money0(totalPayment)}/month serviced out of your spending each year, so the balances drag on the plan until they're paid off. The card's ${cards.length ? pct(cards[0].interestRate) : ''} rate makes its interest a real cost relative to the mortgage. The payments are after-tax, so they don't raise your taxable income or touch GIS/OAS — but they do reduce what's left to live on until each debt is gone. I can run the projection with and without them so you see the dollar effect.`;
    },
    mustContain: ['debt', 'spending', 'interest'],
  },
  // ---- Federal brackets -------------------------------------------------
  {
    id: 'federal-brackets',
    ask: 'What are the federal tax brackets?',
    answer: () => {
      const f = cfg.federal;
      const b = f.brackets.map(money0);
      return `For 2026 the federal brackets are ${pct(f.rates[0])} up to ${b[0]}, ${pct(f.rates[1])} to ${b[1]}, ${pct(f.rates[2])} to ${b[2]}, ${pct(f.rates[3])} to ${b[3]}, and ${pct(f.rates[4])} above that — with a basic personal amount of ${money0(f.exemption)}. Provincial tax stacks on top. ${OFFER}`;
    },
    mustContain: ['federal', 'bracket', 'basic personal'],
  },
  // ---- Quebec abatement + Ontario surtax (province wrinkles) -------------
  {
    id: 'province-wrinkles',
    ask: 'Does my province change how much tax I pay?',
    answer: () =>
      `Yes — each province has its own brackets on top of federal. Two wrinkles worth knowing: Quebec residents get a ${pct(cfg.qcFederalAbatement)} abatement on federal tax, and Ontario adds a surtax on provincial tax above two thresholds. So the same withdrawal is taxed differently depending on where you live — the engine uses your province for every calculation. ${OFFER}`,
    mustContain: ['province', 'Quebec', 'Ontario'],
  },
  // ---- Market history (the data behind Monte Carlo / backtest) -----------
  {
    id: 'market-history',
    ask: 'What returns does the backtest assume? Has a balanced portfolio always recovered?',
    answer: () => {
      const { startYear, returns } = HISTORICAL_REAL_RETURNS;
      const endYear = startYear + returns.length - 1;
      const min = Math.min(...returns);
      const minYear = startYear + returns.indexOf(min);
      const max = Math.max(...returns);
      const maxYear = startYear + returns.indexOf(max);
      const down = ((min - 1) * 100).toFixed(0);
      const up = ((max - 1) * 100).toFixed(0);
      return `The backtest uses a Canadian 60/40 portfolio's real (after-inflation) returns from ${startYear}–${endYear}. Over that span the worst single year was ${minYear} (${down}% real) and the best was ${maxYear} (+${up}%). The point of running every historical window is to show how your plan would have survived — or strained — through the bad stretches, not to predict the future. ${OFFER}`;
    },
    mustContain: ['backtest', 'real', '60/40'],
  },
  // ---- Pension splitting (couples) --------------------------------------
  {
    id: 'pension-splitting',
    ask: 'Can pension income be split between spouses?',
    phrasings: [
      'How does income splitting work for retirees?',
      'Can my spouse and I share pension income to save tax?',
    ],
    appliedTo: ['couple-ont'],
    appliedAsk: () => 'We\'re a couple — can we split our pension income?',
    answer: () =>
      `Yes — up to ${pct(cfg.engine.pensionSplitMaxRate)} of eligible pension income can be split with a spouse, which can lower the household's total tax by moving income into the lower-earner's brackets. For couples the engine models both people's CPP/OAS and pensions together, so it can show the household effect. ${OFFER}`,
    appliedAnswer: (inputs) => {
      const sp = inputs.spouse;
      const yourCpp = (inputs.cppMonthlyAmount ?? 0) * 12;
      const spCpp = (sp?.cppMonthlyAmount ?? 0) * 12;
      return `Yes. Since you're planning as a couple, up to ${pct(cfg.engine.pensionSplitMaxRate)} of eligible pension income can be shifted to the lower-income spouse. Between your CPP (about ${money0(yourCpp)}/yr) and your spouse's (${money0(spCpp)}/yr), plus your larger RRSP (${money0(inputs.rrspBalance ?? 0)} vs ${money0(sp?.rrspBalance ?? 0)}), the higher earner's RRIF withdrawals are the natural thing to split — moving income into the lower bracket can cut the household's combined tax. The engine models both of you together, so it can show that effect directly. ${OFFER}`;
    },
    mustContain: ['split', 'spouse', 'tax'],
  },
  // ---- Pre-retirement & part-time income (the income register) ----------
  {
    id: 'income-register',
    ask: 'Does income I earn before or during retirement actually help my plan?',
    phrasings: [
      'I plan to work part-time in retirement — does that count?',
      'How is rental or consulting income treated?',
    ],
    appliedTo: ['on-employment'],
    appliedAsk: () => 'I\'ll keep consulting part-time — how does that feed my plan?',
    answer: () =>
      `Yes — the plan models income beyond CPP/OAS. Each source has a kind: a pension (DB/bridge, taxable, split-eligible), employment (a T4 job), self-employment (consulting/business — earned income that builds RRSP room), or rental (net rental income, taxed as investment income, not split-eligible). Earned kinds are taxed at your marginal rate and the after-tax net (times a savings rate) is saved into an account — so a job before or during retirement genuinely funds the plan rather than just adding taxable income. ${OFFER}`,
    appliedAnswer: (inputs) => {
      const job = inputs.income?.[0];
      const amt = job?.annualAmount ?? 0;
      return `Your part-time consulting (${money0(amt)}/yr${job?.endAge ? ` from ${job.startAge} to ${job.endAge}` : ''}) is treated as self-employment/employment income: it's taxed at your marginal rate, and the after-tax net is saved into your accounts — so during those years it directly reduces how much you draw from savings. That's real money into the plan, not just extra taxable income. Once it stops, the plan goes back to drawing down your balances. I can run the projection with and without it so you see the difference.`;
    },
    mustContain: ['income', 'tax', 'savings'],
  },
  // ---- RDSP --------------------------------------------------------------
  {
    id: 'rdsp',
    ask: 'How does an RDSP work?',
    phrasings: [
      'What grants and bonds come with an RDSP?',
      'Is an RDSP worth it for my family member with a disability?',
    ],
    appliedTo: ['rdsp-family'],
    appliedAsk: () => 'We have an RDSP for a family member — how do the grants work for us?',
    answer: () => {
      const r = cfg.rdsp;
      return `A Registered Disability Savings Plan (RDSP) is tax-sheltered and boosted by federal grants and bonds. The Canada Disability Savings Grant can add up to ${money0(r.grantAnnualMax)}/yr (lifetime ${money0(r.grantLifetimeMax)}) depending on family income, and lower-income beneficiaries can get a bond of up to ${money0(r.bondAnnualMax)}/yr with no contribution needed. Grants and bonds stop at age ${r.grantEndAge}, contributions at ${r.contributionEndAge}. Only the contribution principal comes back tax-free — grant, bond, and growth are taxable on withdrawal. ${OFFER}`;
    },
    appliedAnswer: (inputs) => {
      const r = cfg.rdsp;
      const d = inputs.rdsp;
      return `With your RDSP (balance ${money0(d?.balance ?? 0)}, contributing ${money0(d?.contribution ?? 0)}/yr, family income ${money0(d?.familyIncome ?? 0)}), the federal top-ups are the key lever: the grant can add up to ${money0(r.grantAnnualMax)}/yr depending on income, and at your income level a bond of up to ${money0(r.bondAnnualMax)}/yr may apply even without contributions. Grants and bonds stop at age ${r.grantEndAge}, so the contributing years matter. On withdrawal, only your contribution principal is tax-free — grant, bond, and growth are taxable. ${OFFER}`;
    },
    mustContain: ['RDSP', 'grant', 'bond'],
  },
  // ---- Withdrawal order (the tax lever most people miss) ------------------
  {
    id: 'withdrawal-order',
    ask: 'Does it matter which account I draw from first?',
    phrasings: [
      'What\'s the best order to withdraw from my accounts?',
      'RRSP or TFSA first in retirement — does it matter?',
    ],
    appliedTo: ['rrsp-heavy'],
    appliedAsk: () => 'Most of my money is in my RRSP — what order should I draw down?',
    answer: () =>
      `A lot. RRSP/RRIF withdrawals are fully taxed as income (100% counts), TFSA withdrawals are tax-free (0% counts), and taxable-account capital gains are only ${pct(cfg.engine.capitalGainsInclusion)} taxed. So drawing RRSP first can spike your marginal rate and trigger OAS/GIS clawback, while drawing TFSA or taxable first can keep taxable income low early. There's no single right order — it depends on your balances and benefits — but the order alone can change lifetime tax by thousands. I can run your plan under different withdrawal orders to show the difference.`,
    appliedAnswer: (inputs) => {
      const total = (inputs.rrspBalance ?? 0) + (inputs.tfsaBalance ?? 0) + (inputs.taxableBalance ?? 0);
      const rrspShare = total > 0 ? (inputs.rrspBalance ?? 0) / total : 0;
      return `With ${money0(inputs.rrspBalance ?? 0)} in RRSP against only ${money0((inputs.tfsaBalance ?? 0) + (inputs.taxableBalance ?? 0))} outside it (${pct(rrspShare)} of your savings in the fully-taxed bucket), the drawdown order is a real lever for you. RRSP/RRIF withdrawals are 100% taxable, TFSA is 0%, and taxable gains are only ${pct(cfg.engine.capitalGainsInclusion)} counted — so a big RRSP draw can spike your marginal rate and trigger OAS/GIS clawback, while drawing the other accounts first can keep taxable income low early. There's no single right order, but I can run your plan under different orders to show the lifetime-tax difference.`;
    },
    mustContain: ['RRSP', 'TFSA', 'tax'],
  },
  // ---- GIS for couples ----------------------------------------------------
  {
    id: 'gis-couple',
    ask: 'How does GIS work for a couple?',
    answer: () =>
      `For couples, GIS is assessed on your *combined* income excluding OAS — up to about ${money0(cfg.oas.gisMaxAnnualCouple)}/yr each when both are on OAS (2026), reduced at ${pct(cfg.oas.gisReductionRate)} per dollar of combined non-OAS income. Because it's the household total that counts, one spouse's large RRSP withdrawal reduces both partners' GIS. That's why couples' drawdown timing is a household decision, and why the engine models both people together.`,
    mustContain: ['couple', 'GIS', 'combined'],
  },
  // ---- Sequence of returns (why average return isn't enough) --------------
  {
    id: 'sequence-risk',
    ask: 'Why does the order of good and bad market years matter?',
    phrasings: [
      'What is sequence-of-returns risk?',
      'Why is a market crash early in retirement so damaging?',
    ],
    answer: () => {
      const { returns, startYear } = HISTORICAL_REAL_RETURNS;
      const min = Math.min(...returns);
      const minYear = startYear + returns.indexOf(min);
      return `Two plans with the same average return can end very differently depending on *when* the bad years hit. Losses early in retirement — while you're withdrawing — hurt far more than the same losses later, because you're selling into a falling market. That's "sequence-of-returns risk." It's why the backtest runs your plan through every historical window (${startYear}–${startYear + returns.length - 1}), including years like ${minYear} (${((min - 1) * 100).toFixed(0)}% real), instead of just assuming an average. The Monte Carlo simulates the same idea across random futures.`;
    },
    mustContain: ['sequence', 'withdraw', 'early'],
  },
  // ---- Inflation / indexation ---------------------------------------------
  {
    id: 'inflation',
    ask: 'Does the plan account for inflation?',
    answer: () =>
      `Yes. CPP and OAS are indexed to inflation, and the plan assumes a ${pct(cfg.engine.inflationRate)} inflation rate. Spending is ${cfg.engine.indexSpending ? 'indexed so your purchasing power stays constant' : 'held in nominal dollars'}, and tax tables ${cfg.engine.indexTaxTables ? 'rise with CPI (bracket creep avoided)' : 'can be held fixed — which quietly raises your real tax over time (bracket creep)'}. The backtest works in *real* (after-inflation) terms so a dollar late in the plan is comparable to a dollar today.`,
    mustContain: ['inflation', 'indexed', 'real'],
  },
  // ---- Cash cushion --------------------------------------------------------
  {
    id: 'cash-cushion',
    ask: 'What is the cash cushion for?',
    answer: () =>
      `A cash cushion is money held out of the market earning a low, safe return (about ${pct(cfg.engine.cashCushionRate)} here). Its job isn't growth — it's to fund spending during a market downturn so you're not forced to sell investments at a loss. That directly addresses sequence-of-returns risk. The trade-off is lower long-run growth on that money. Whether a cushion helps depends on your plan; I can model it on your numbers.`,
    mustContain: ['cash', 'cushion', 'downturn'],
  },
  // ---- Provincial tax variation --------------------------------------------
  {
    id: 'province-varies',
    ask: 'How different is tax between provinces?',
    answer: () => {
      const ab = cfg.provinces.AB.rates[0];
      const qc = cfg.provinces.QC.rates[0];
      return `Quite different. Each province stacks its own brackets on federal — for example Alberta's lowest provincial rate is ${pct(ab)} while Quebec's starts at ${pct(qc)}. Quebec residents also get a ${pct(cfg.qcFederalAbatement)} federal abatement, and Ontario adds a surtax on higher provincial tax. So two retirees with identical savings can keep very different amounts depending on where they live. The engine uses your province for every tax calculation.`;
    },
    mustContain: ['province', 'Alberta', 'Quebec'],
  },
  // ---- Capital gains --------------------------------------------------------
  {
    id: 'capital-gains',
    ask: 'How are capital gains taxed in a taxable account?',
    answer: () =>
      `Only ${pct(cfg.engine.capitalGainsInclusion)} of a realized capital gain counts as taxable income — so gains are taxed more lightly than RRSP withdrawals (fully taxed) or interest (fully taxed). That's why the taxable account is often drawn strategically: realizing gains gradually can produce income at a lower effective rate than a big RRSP withdrawal. I can show how the drawdown order affects your lifetime tax.`,
    mustContain: ['capital gain', 'taxable', 'income'],
  },
  // ---- Reverse mortgage ------------------------------------------------------
  {
    id: 'reverse-mortgage',
    ask: 'How does a reverse mortgage fit into a retirement plan?',
    phrasings: [
      'Can I use my home equity to fund retirement without selling?',
      'What are the downsides of a reverse mortgage?',
    ],
    appliedTo: ['reverse-mortgage'],
    appliedAsk: () => 'I\'m house-rich but cash-poor — would a reverse mortgage help me?',
    answer: () =>
      `A reverse mortgage lets a homeowner (55+) borrow against home equity without selling — no required payments, with interest compounding into the loan, and the balance capped (typically at 55% loan-to-value) so you can't owe more than the home is worth (the no-negative-equity guarantee). It can fund spending for someone house-rich but cash-poor, at the cost of reducing the estate. It's a real lever but a significant one — I can model what it would do to your plan before you consider it.`,
    appliedAnswer: (inputs) => {
      const rm = inputs.reverseMortgage;
      return `In your situation — a home worth ${money0(rm?.homeValue ?? 0)} but modest savings (${money0((inputs.rrspBalance ?? 0) + (inputs.tfsaBalance ?? 0) + (inputs.taxableBalance ?? 0))}) — a reverse mortgage is exactly the lever designed for this: drawing ${money0(rm?.drawAmount ?? 0)}/yr from age ${rm?.startAge ?? 0} against the equity, with no required payments while interest compounds at ${pct(rm?.interestRate ?? 0)}. The balance is capped so you can't owe more than the home is worth, but it does reduce what's left in the estate. I can model the actual draw and the remaining equity on your plan. ${OFFER}`;
    },
    mustContain: ['reverse mortgage', 'home', 'equity'],
  },
];

/** Mint domain-knowledge records in THREE shapes so the model learns the
 *  *concept*, not one phrasing:
 *    - fact recall:    the canonical question → grounded general answer
 *    - paraphrase:     the same fact asked differently (teaches recall, not echo)
 *    - applied:        the fact stated against a scenario's REAL numbers (teaches
 *                      the model to read a person, not just recite a rule)
 *  All close by offering to ground the rule in the user's own numbers — the
 *  offer is rotated across CLOSERS so the model doesn't parrot one sentence. */
export function mintDomainKnowledgeRecords(): CorpusRecord[] {
  const records: CorpusRecord[] = [];
  let i = 0;

  const push = (fact: FactSpec, variant: string, ask: string, answer: string, scenarioId: string) => {
    records.push({
      id: `domain-knowledge:${fact.id}:${variant}:${i}`,
      split: (i % 5 === 4 ? 'eval' : 'train') as 'eval' | 'train',
      kind: 'domain-knowledge' as const,
      scenarioId,
      messages: [
        { role: 'user' as const, content: ask },
        { role: 'assistant' as const, content: answer },
      ],
      expect: {
        mustContain: fact.mustContain,
        mustNotContain: ['you should', 'i recommend', 'the best choice is', 'you ought to', 'TOOL_CALL'],
      },
    });
    i++;
  };

  const scenarioById = new Map(SCENARIOS.map((s) => [s.id, s]));

  for (const fact of FACTS) {
    const closer = CLOSERS[i % CLOSERS.length];
    // 1. Canonical fact recall.
    push(fact, 'recall', fact.ask, `${fact.answer()}`, 'any');
    // 2. Paraphrases — same answer, different ask (the closer rotates so even a
    //    repeated answer ends differently).
    for (const phrasing of fact.phrasings ?? []) {
      const rotated = CLOSERS[i % CLOSERS.length];
      const base = fact.answer().replace(OFFER, rotated);
      push(fact, 'paraphrase', phrasing, base.includes(rotated) ? base : `${base} ${rotated}`, 'any');
    }
    // 3. Applied — the fact against a scenario's real numbers.
    for (const scenarioId of fact.appliedTo ?? []) {
      const scenario = scenarioById.get(scenarioId);
      if (!scenario || !fact.appliedAnswer) continue;
      const appliedCloser = CLOSERS[i % CLOSERS.length];
      push(fact, 'applied', fact.appliedAsk?.(scenario) ?? fact.ask, fact.appliedAnswer(scenario.inputs, scenario), scenario.id);
      void appliedCloser;
    }
  }
  return records;
}
