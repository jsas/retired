import type { AppConfig } from './appConfig';
import {
  calculateTax,
  findGrossIncomeForTakeHome,
  calculateRrifMinimum,
  isRrifMandatory,
  oasAnnualGross,
  gisAnnual,
  gisAnnualCouple,
  indexConfig
} from './canadianTax';

export type WithdrawalAccount = 'rrsp' | 'tfsa' | 'taxable';

export interface RetirementInputs {
  currentAge: number;
  retirementAge: number;
  maxAge: number;
  rrspBalance: number;
  tfsaBalance: number;
  taxableBalance: number;
  cashCushionBalance: number;
  rrspContribution: number;
  tfsaContribution: number;
  taxableContribution: number;
  annualWithdrawal: number;
  investmentReturn: number;
  // Annual volatility of returns (standard deviation) — used by Monte Carlo.
  returnVolatility: number;
  provinceCode: string;
  cppStartAge: number | null;
  cppMonthlyAmount: number; // monthly CPP at age 65 — early/deferral adjustments applied by the engine
  cppAdjustedAmount: boolean; // true = amount is already adjusted for the start age (legacy behaviour)
  oasStartAge: number | null;
  oasYearsInCanada: number;
  desiredSpending: number;
  // Legacy, no longer used by the verdict (which is depletion-only). Kept
  // optional so scenarios saved before its removal still parse.
  successFactor?: number;
  // Order in which taxable/tfsa/rrsp are drawn down. Cash cushion is always
  // the last resort. After the RRIF conversion age the 'rrsp' slot draws the RRIF.
  withdrawalOrder: WithdrawalAccount[];
  // One-time cash events: inflows land in an account, outflows add to that
  // year's spending need.
  events?: CashEvent[];
  // Spending phases: % of desired spending per age band (go-go / slow-go /
  // no-go). Empty/absent = 100% at every age.
  spendingBands?: SpendingBand[];
  // Optional spouse: a second, independent plan whose results are combined
  // with the primary's for household totals.
  spouse?: SpouseInputs;
  // DB / bridge pensions: taxable income stacked with CPP/OAS. Bridge benefits
  // have endAge set; lifetime pensions leave it null.
  pensions?: Pension[];
  // Optional reverse mortgage: borrow against home equity via scheduled draws
  // and/or a last-resort top-up. Proceeds are tax-free (no GIS/clawback impact);
  // the loan compounds against the home and erodes net equity.
  reverseMortgage?: ReverseMortgage;
}

export interface SpouseInputs {
  enabled: boolean;
  currentAge: number;
  retirementAge: number;
  rrspBalance: number;
  tfsaBalance: number;
  taxableBalance: number;
  cashCushionBalance: number;
  rrspContribution: number;
  tfsaContribution: number;
  taxableContribution: number;
  cppStartAge: number | null;
  cppMonthlyAmount: number; // age-65 amount; adjustment applied
  oasStartAge: number | null;
  oasYearsInCanada: number;
  desiredSpending: number; // the spouse's own after-tax income goal (today's $)
  withdrawalOrder?: WithdrawalAccount[];
  pensions?: Pension[]; // the spouse's own DB / bridge pensions
}

export interface CashEvent {
  id: string;
  age: number;
  label: string;
  amount: number; // always positive; direction decides the sign
  direction: 'in' | 'out';
  account?: 'rrsp' | 'tfsa' | 'taxable' | 'cash'; // inflows only; default taxable
  // Recurrence: absent = one-time at `age`. Set endAge to repeat every year
  // from `age` through endAge inclusive (e.g. "yearly for X years" →
  // endAge = age + X − 1). Amounts are per-occurrence, in that year's dollars.
  endAge?: number | null;
}

export interface ReverseMortgage {
  enabled: boolean;
  homeValue: number;          // current market value, today's dollars
  appreciationRate: number;   // annual home-price growth (e.g. 0.02)
  interestRate: number;       // annual rate charged on the loan (e.g. 0.065)
  // Loan-to-value ceiling: borrowing (both scheduled draws and top-up) stops
  // once the loan reaches maxLtv × current home value. Lenders typically cap
  // reverse mortgages near 0.55. Defaults to 0.55 when omitted.
  maxLtv?: number;
  // Scheduled draws: amount/yr (today's dollars, CPI-indexed like spending)
  // from startAge for durationYears. Optional — combine with top-up or use alone.
  drawAmount?: number;
  startAge?: number;
  durationYears?: number;
  // Top-up mode: after every account is drained, borrow just enough each year
  // to cover the remaining spending need (the true last resort).
  topUp?: boolean;
}

export interface Pension {
  id: string;
  label: string;
  annualAmount: number;   // $/yr at startAge, in today's dollars
  startAge: number;
  endAge: number | null;  // null = lifetime; set = bridge/temporary (pays through endAge)
  indexedToCpi: boolean;  // grow with CPI (when indexTaxTables is on) vs flat nominal
}

export interface SpendingBand {
  fromAge: number;      // applies from this age until the next band
  pctOfBase: number;    // 0..1+ fraction of desiredSpending (e.g. 1, 0.85, 0.7)
}

export interface AccountBreakdown {
  age: number;
  rrspBalance: number;
  rrifBalance: number;
  tfsaBalance: number;
  taxableBalance: number;
  cashCushionBalance: number;
}

/**
 * Per-year drill-down: where the money actually came from and what happened.
 * Everything is optional/additive so CSV export, PrintSummary, the household
 * combiner and pension splitting are unaffected. Amounts are nominal dollars
 * of that year, matching the rest of the breakdown row.
 */
// The pipeline intermediates a decumulation year runs through, captured so the
// "How the math works" page can show the actual numbers the engine used (not a
// re-derivation). All optional-sourced values are filled during the run.
export interface YearCalc {
  // Benefit stacking: cpp + oas + pension gross, its after-tax value alone,
  // and what the portfolio must therefore supply after tax.
  cppMonthlyAtStart: number;   // age-65 CPP amount × the start-age multiplier
  otherGross: number;          // cpp + oas + pension (taxable benefit income)
  netBenefits: number;         // after-tax value of otherGross on its own
  neededAfterTax: number;      // spending target − netBenefits (≥0)
  // RRIF-minimum pass (0 before the conversion age).
  rrifMinNet: number;          // after-tax cash the mandatory minimum contributed
  rrifMinExcess: number;       // excess over need, redeposited into taxable
  // Remaining after-tax need at each step of the pipeline (the "need ladder").
  needAfterBenefits: number;   // before any draws (== neededAfterTax)
  needAfterRrifMin: number;
  needAfterGis: number;
  needAfterDraws: number;      // after the ordered account draws
  needAfterCash: number;
  needFinal: number;           // residual (0 unless the plan depleted)
  // Taxable-account state used for the gains gross-up.
  gainsFraction: number;       // embedded-gain fraction at draw time
  taxableAcb: number;          // adjusted cost base at year end
  // Tax decomposition.
  totalNetIncome: number;      // otherGross + registeredGross + gains×inclusion
  taxOnBenefits: number;       // tax(otherGross) — subtracted to isolate withdrawal tax
}

export interface YearDetail {
  // Withdrawal provenance — gross dollars that LEFT each source this year.
  // rrifMin is the mandatory RRIF minimum (a subset of registered draws);
  // rrif/rrsp are discretionary registered draws; rmDraw is reverse-mortgage
  // borrowing (tax-free). Registered and taxable draws are grossed up for tax.
  withdraw: { rrifMin: number; rrif: number; rrsp: number; tfsa: number; taxable: number; cash: number; rmDraw: number };
  // Market growth / interest earned per account this year (before it's added).
  growth: { rrsp: number; rrif: number; tfsa: number; taxable: number; cash: number };
  // Contributions per account (accumulation years only).
  contrib?: { rrsp: number; tfsa: number; taxable: number };
  // Tax decomposition for the year's withdrawals.
  tax: { oasClawback: number; capitalGains: number; registeredGross: number };
  // Reverse mortgage, when enabled.
  rm?: { interestAccrued: number; scheduledDraw: number; topUpDraw: number; homeValue: number; loanBalance: number };
  // Cash events that fired this year (labelled in/out).
  events: Array<{ label: string; direction: 'in' | 'out'; amount: number }>;
  // The pipeline intermediates (decumulation years), for the math page.
  calc?: YearCalc;
}

export interface YearlyBreakdown {
  age: number;
  startingBalance: number;
  contributions: number;
  marketGains: number;
  withdrawals: number;
  incomeTax: number;
  cumulativeTax: number;
  spendingTarget: number; // this year's after-tax income goal, in nominal dollars of that year
  // Unfunded spending gap this year (0 until the portfolio depletes; afterwards
  // it shrinks as late-starting benefits begin to cover spending). Optional so
  // older fixtures/types still compile; the engine always sets it.
  shortfall?: number;
  endingBalance: number;
  rrspBalance: number;
  rrifBalance: number;
  tfsaBalance: number;
  taxableBalance: number;
  cashCushionBalance: number;
  cppIncome: number;
  oasIncome: number;
  gisIncome: number;
  pensionIncome: number; // DB / bridge pension gross income this year (taxable)
  // Reverse mortgage (undefined when the feature is off). homeValue appreciates,
  // loanBalance compounds with interest + draws, netHomeEquity = value − loan.
  homeValue?: number;
  loanBalance?: number;
  netHomeEquity?: number;
  // Pension-splitting inputs, captured per-year so the household pass can
  // recompute tax with a split applied. Undefined for singles.
  splitEligibleIncome?: number; // RRIF/RRSP draws (from conversion age) + DB pensions — NOT CPP/OAS
  unsplitNetIncome?: number;    // this person's net income before any split
  // Set on the year the split changes this person's reported tax.
  splitTransferred?: number;    // eligible income moved OUT to the spouse (+) or received IN (−)
  // Per-year drill-down (provenance, growth, tax, RM, events). Present on
  // per-person plans; dropped by the household combiner.
  detail?: YearDetail;
}

export interface RetirementResults {
  totalNetWorthAtRetirement: number;
  depletionAge: number | null;
  yearlyBreakdown: YearlyBreakdown[];
  accountBreakdown: AccountBreakdown[];
  status: 'ON_TRACK' | 'SHORTFALL';
  withdrawalRate: number;
  averageReturn: number;
  retirementAge: number;
  spouse?: RetirementResults; // present when inputs.spouse.enabled
}

const MAX_TAX_ITERATIONS = 100;
const TAX_TOLERANCE = 1.0;

/**
 * Run the projection. Tax model follows the real Canadian engine:
 *  - CPP and OAS are taxable income.
 *  - RRSP/RRIF withdrawals are taxed; the amount withdrawn is grossed up
 *    (binary search) so total after-tax income hits the spending target.
 *  - TFSA and taxable-account withdrawals are after-tax money (no tax).
 *  - RRIF minimums are forced; the after-tax excess over spending is
 *    redeposited into the taxable account.
 *  - Withdrawals respect the user-configured account order; the cash
 *    cushion is always the last resort.
 */
export function calculateRetirement(
  inputs: RetirementInputs,
  config: AppConfig,
  options?: {
    returnSequence?: Record<number, number>;
    // Couple GIS context, set when this person has an enabled spouse: CRA
    // assesses each spouse's GIS on COMBINED non-OAS income and pays the
    // (lower) couple rate when both receive OAS, the single rate when only
    // one does. The engine knows each spouse's CPP/pension income up front,
    // so the combined base uses those; each spouse's discretionary registered
    // draws only count toward their own reduction (the partner's land next
    // year via Service Canada's quarterly recalc).
    spouseContext?: {
      cppStartAge: number | null;
      cppMonthlyAmount: number;
      oasStartAge: number | null;
      oasYearsInCanada: number;
      currentAge: number;
      pensions?: Pension[];
    };
  }
): RetirementResults {
  const {
    currentAge,
    retirementAge,
    maxAge,
    rrspBalance,
    tfsaBalance,
    taxableBalance,
    cashCushionBalance,
    rrspContribution,
    tfsaContribution,
    taxableContribution,
    desiredSpending,
    investmentReturn,
    provinceCode,
    cppMonthlyAmount,
    cppAdjustedAmount,
    cppStartAge,
    oasStartAge,
    oasYearsInCanada,
    withdrawalOrder,
    pensions
  } = inputs;

  const order: WithdrawalAccount[] =
    Array.isArray(withdrawalOrder) && withdrawalOrder.length > 0
      ? withdrawalOrder
      : ['tfsa', 'taxable', 'rrsp'];

  const pensionList: Pension[] = Array.isArray(pensions) ? pensions : [];

  const cushionRate = config.engine.cashCushionRate;
  const rrifAge = config.engine.rrifConversionAge;

  // Inflation: spending is entered in today's dollars and inflated each year
  // from the current age. When indexTaxTables is on, the tax system, OAS and
  // CPP are inflated by the same factor (mirroring CRA indexation), so the
  // projection stays in real terms; with it off, numbers are nominal dollars
  // against today's (unindexed) tax tables.
  const inflation = Math.max(0, config.engine.inflationRate ?? 0);
  const indexTables = config.engine.indexTaxTables === true;
  // Spending inflation is a separate switch from tax/benefit indexation: a plan
  // can hold spending flat in today's dollars while still indexing the tax
  // system (or vice versa). Default on so pre-toggle plans are unchanged.
  const indexSpending = config.engine.indexSpending !== false;
  const factorAt = (age: number) => Math.pow(1 + inflation, Math.max(0, age - currentAge));
  // The CPI multiplier applied to the spending target; 1 when indexSpending is off.
  const spendingFactorAt = (age: number) => (indexSpending ? factorAt(age) : 1);

  // Spending phases: fraction of desired spending at each age (default 1).
  const bands = Array.isArray(inputs.spendingBands) ? [...inputs.spendingBands].sort((a, b) => a.fromAge - b.fromAge) : [];
  const spendingPctAt = (age: number): number => {
    let pct = 1;
    for (const b of bands) {
      if (age >= b.fromAge) pct = b.pctOfBase;
      else break;
    }
    return pct;
  };

  // Cash events: one-time (age only) or recurring (age..endAge inclusive).
  const events = Array.isArray(inputs.events) ? inputs.events : [];
  const eventsAt = (age: number) => events.filter(e =>
    e.age === age || (e.endAge != null && age >= e.age && age <= e.endAge));
  const eventOutAt = (age: number) => eventsAt(age).filter(e => e.direction === 'out').reduce((s, e) => s + e.amount, 0);
  const configCache = new Map<number, AppConfig>();
  const configAt = (age: number): AppConfig => {
    if (!indexTables) return config;
    const f = factorAt(age);
    if (f === 1) return config;
    let c = configCache.get(age);
    if (!c) {
      c = indexConfig(config, f);
      configCache.set(age, c);
    }
    return c;
  };

  // Couple GIS: the spouse's CPP/pension income at a given calendar year
  // (keyed by this person's age). Same shapes as the primary's own math —
  // CPP adjusted for start age and CPI, pensions active in their age window.
  const spouseCtx = options?.spouseContext;
  const spouseFixedIncomeAt = (age: number): { fixed: number; hasOas: boolean } => {
    if (!spouseCtx) return { fixed: 0, hasOas: false };
    const spouseAge = age - (currentAge - spouseCtx.currentAge);
    let fixed = 0;
    if (spouseCtx.cppStartAge != null && spouseAge >= spouseCtx.cppStartAge) {
      fixed += spouseCtx.cppMonthlyAmount
        * cppAdjustmentMultiplier(spouseCtx.cppStartAge, config)
        * 12 * (indexTables ? factorAt(age) : 1);
    }
    for (const p of spouseCtx.pensions ?? []) {
      if (spouseAge < p.startAge) continue;
      if (p.endAge != null && spouseAge > p.endAge) continue;
      fixed += p.annualAmount * (p.indexedToCpi && indexTables ? factorAt(age) : 1);
    }
    const hasOas = spouseCtx.oasStartAge != null
      && spouseAge >= spouseCtx.oasStartAge
      && oasAnnualGross(spouseAge, spouseCtx.oasStartAge, spouseCtx.oasYearsInCanada, configAt(age)) > 0;
    return { fixed, hasOas };
  };

  // Per-age return override (Monte Carlo); falls back to the constant rate.
  const seq = options?.returnSequence;
  const rateAt = (age: number) => (seq && typeof seq[age] === 'number' ? seq[age] : investmentReturn);

  const yearlyBreakdown: YearlyBreakdown[] = [];
  const accountBreakdown: AccountBreakdown[] = [];

  let rrsp = rrspBalance;
  let rrif = 0;
  let tfsa = tfsaBalance;
  let taxable = taxableBalance;
  let cashCushion = cashCushionBalance;
  let cumulativeTax = 0;

  // Reverse mortgage: the home appreciates while the loan compounds with
  // interest + draws. Proceeds are tax-free, so draws land in the cash cushion
  // and never touch taxable income (no GIS/clawback effect). Inert unless enabled.
  const rm = inputs.reverseMortgage;
  const rmOn = rm?.enabled === true && (rm.homeValue ?? 0) > 0;
  let homeValue = rmOn ? rm.homeValue : 0;
  let rmLoan = 0;
  // Loan-to-value ceiling (default 0.55, the typical lender cap). The ceiling
  // is a HARD limit on the balance: new draws stop once it's reached, and the
  // balance is clamped to it after each year's interest accrual — modelling the
  // "no negative equity guarantee" Canadian reverse mortgages carry, so net
  // equity never falls below (1 − maxLtv) × home value.
  const rmMaxLtv = Math.min(1, Math.max(0, rm?.maxLtv ?? 0.55));
  // Headroom left to borrow this year, given the current home value and loan.
  const rmHeadroom = () => Math.max(0, homeValue * rmMaxLtv - rmLoan);
  // Take a draw, capped at the LTV headroom. Returns the amount actually drawn.
  const rmDraw = (want: number): number => {
    const amt = Math.min(want, rmHeadroom());
    if (amt > 0) rmLoan += amt;
    return amt;
  };
  // Apply one year's interest to the loan, then clamp the balance at the LTV
  // ceiling. A max loan-to-value is a hard limit on what the lender will ever
  // be owed: without the clamp, a loan near the ceiling with interest above
  // home appreciation compounds unbounded past it, driving net equity deeply
  // negative (no lender allows the balance to exceed the agreed share of the
  // home's value — the "no negative equity guarantee"). Clamping here keeps
  // net equity ≥ (1 − maxLtv) × home value.
  const rmAccrue = () => {
    rmLoan *= 1 + Math.max(0, rm?.interestRate ?? 0);
    const ceiling = homeValue * rmMaxLtv;
    if (rmLoan > ceiling) rmLoan = ceiling;
  };
  // A scheduled draw is due this year (startAge through startAge+duration−1).
  const rmScheduledAt = (age: number): number => {
    if (!rmOn || !(rm.drawAmount! > 0) || rm.startAge == null) return 0;
    if (age < rm.startAge) return 0;
    if (rm.durationYears != null && age >= rm.startAge + rm.durationYears) return 0;
    return rm.drawAmount! * spendingFactorAt(age); // CPI-indexed like spending
  };

  // Adjusted cost base of the taxable account: contributions raise it,
  // growth does not. The embedded-gain fraction of any withdrawal is taxed
  // at the capital-gains inclusion rate.
  let taxableAcb = taxableBalance * Math.min(1, Math.max(0, config.engine.taxableAcbRatio));
  const gainsFraction = () => (taxable > 0 ? Math.max(0, Math.min(1, 1 - taxableAcb / taxable)) : 0);
  const inclusion = Math.min(1, Math.max(0, config.engine.capitalGainsInclusion));

  const totalBalance = () => rrsp + rrif + tfsa + taxable + cashCushion;

  // ---------------- accumulation phase ----------------
  for (let age = currentAge; age < retirementAge; age++) {
    const startingTotal = totalBalance();

    const r = rateAt(age);
    const rrspGains = rrsp * r;
    const tfsaGains = tfsa * r;
    const taxableGains = taxable * r;
    const cashGains = cashCushion * cushionRate;

    rrsp += rrspGains + rrspContribution;
    tfsa += tfsaGains + tfsaContribution;
    taxable += taxableGains + taxableContribution;
    taxableAcb += taxableContribution;
    cashCushion += cashGains;

    // Reverse mortgage: appreciate the home, accrue interest, take any
    // scheduled draw into the cash cushion (rare pre-retirement, but allowed).
    // Draws are capped at the LTV headroom.
    let accRmInterest = 0, accRmScheduled = 0;
    if (rmOn) {
      homeValue *= 1 + Math.max(0, rm?.appreciationRate ?? 0);
      const loanBefore = rmLoan;
      rmAccrue();
      accRmInterest = rmLoan - loanBefore;
      const sched = rmDraw(rmScheduledAt(age));
      cashCushion += sched;
      accRmScheduled = sched;
    }

    yearlyBreakdown.push({
      age,
      startingBalance: startingTotal,
      contributions: rrspContribution + tfsaContribution + taxableContribution,
      marketGains: rrspGains + tfsaGains + taxableGains + cashGains,
      withdrawals: 0,
      incomeTax: 0,
      cumulativeTax,
      spendingTarget: 0,
      endingBalance: totalBalance(),
      rrspBalance: rrsp,
      rrifBalance: rrif,
      tfsaBalance: tfsa,
      taxableBalance: taxable,
      cashCushionBalance: cashCushion,
      cppIncome: 0,
      oasIncome: 0,
      gisIncome: 0,
      pensionIncome: 0,
      detail: {
        withdraw: { rrifMin: 0, rrif: 0, rrsp: 0, tfsa: 0, taxable: 0, cash: 0, rmDraw: 0 },
        growth: { rrsp: rrspGains, rrif: 0, tfsa: tfsaGains, taxable: taxableGains, cash: cashGains },
        contrib: { rrsp: rrspContribution, tfsa: tfsaContribution, taxable: taxableContribution },
        tax: { oasClawback: 0, capitalGains: 0, registeredGross: 0 },
        ...(rmOn ? { rm: { interestAccrued: accRmInterest, scheduledDraw: accRmScheduled, topUpDraw: 0, homeValue, loanBalance: rmLoan } } : {}),
        events: [],
      },
      ...(rmOn ? { homeValue, loanBalance: rmLoan, netHomeEquity: homeValue - rmLoan } : {})
    });

    accountBreakdown.push({
      age,
      rrspBalance: rrsp,
      rrifBalance: rrif,
      tfsaBalance: tfsa,
      taxableBalance: taxable,
      cashCushionBalance: cashCushion
    });
  }

  // ---------------- decumulation phase ----------------
  let depletionAge: number | null = null;
  const totalStartingRetirement = totalBalance();

  for (let age = retirementAge; age <= maxAge; age++) {
    // RRSP converts to RRIF at the configured age. `>=` so a plan that
    // starts retirement past the conversion age converts immediately
    // rather than skipping conversion (and RRIF minimums) forever.
    if (age >= rrifAge && rrsp > 0) {
      rrif += rrsp;
      rrsp = 0;
    }

    const startingTotal = totalBalance();
    const yearConfig = configAt(age);

    // Reverse mortgage: appreciate the home, accrue this year's interest, and
    // take any scheduled draw into the cash cushion (tax-free proceeds).
    // Draws are capped at the LTV headroom.
    let rmInterest = 0, rmScheduled = 0;
    if (rmOn) {
      homeValue *= 1 + Math.max(0, rm?.appreciationRate ?? 0);
      const loanBefore = rmLoan;
      rmAccrue();
      rmInterest = rmLoan - loanBefore;
      const sched = rmDraw(rmScheduledAt(age));
      cashCushion += sched;
      rmScheduled = sched;
    }

    // Cash events firing this year (in flows applied below; out flows raise the
    // spending target). Captured for the year's drill-down.
    const yearEvents = eventsAt(age).map(ev => ({ label: ev.label, direction: ev.direction, amount: ev.amount }));

    // Cash-event inflows land at the start of the year (before withdrawals).
    for (const ev of eventsAt(age)) {
      if (ev.direction !== 'in') continue;
      const dest = ev.account ?? 'taxable';
      if (dest === 'rrsp') rrsp += ev.amount;
      else if (dest === 'tfsa') tfsa += ev.amount;
      else if (dest === 'cash') cashCushion += ev.amount;
      else { taxable += ev.amount; taxableAcb += ev.amount; }
    }

    // This year's spending target: today's dollars, inflated to this year when
    // indexSpending is on (otherwise held flat in today's dollars).
    const yearSpending = desiredSpending * spendingFactorAt(age) * spendingPctAt(age) + eventOutAt(age);

    // Gross benefit income (taxable). OAS amounts come from the (possibly
    // indexed) config; CPP is inflated manually when indexation is on.
    // cppMonthlyAmount is the age-65 amount unless cppAdjustedAmount is set —
    // the engine applies the 0.6%/month early penalty / 0.7%/month deferral
    // bonus (floored at 60, capped at 70) itself.
    const cppMonthlyAtStart = cppStartAge != null
      ? cppMonthlyAmount * (cppAdjustedAmount ? 1 : cppAdjustmentMultiplier(cppStartAge, config))
      : 0;
    const cppGross = cppStartAge != null && age >= cppStartAge
      ? cppMonthlyAtStart * 12 * (indexTables ? factorAt(age) : 1)
      : 0;
    const oasGross = oasStartAge != null ? oasAnnualGross(age, oasStartAge, oasYearsInCanada, yearConfig) : 0;

    // DB / bridge pensions: taxable income stacked with CPP/OAS. A pension is
    // active from startAge through endAge (null = lifetime). Indexed pensions
    // grow with CPI when table indexation is on; non-indexed stay flat nominal.
    let pensionGross = 0;
    for (const p of pensionList) {
      if (age < p.startAge) continue;
      if (p.endAge != null && age > p.endAge) continue;
      pensionGross += p.annualAmount * (p.indexedToCpi && indexTables ? factorAt(age) : 1);
    }

    const otherGross = cppGross + oasGross + pensionGross;

    // After-tax value of the benefits on their own.
    const netBenefits = calculateTax(otherGross, provinceCode, yearConfig).takeHome;

    // What the portfolio must supply after tax so total take-home = spending.
    const neededAfterTax = Math.max(0, yearSpending - netBenefits);

    let actualWithdrawals = 0;  // gross dollars leaving registered accounts + raw dollars elsewhere
    let registeredGross = 0;    // RRSP/RRIF gross withdrawn this year (taxable)
    let capitalGains = 0;       // taxable-account gains realized this year (taxed at inclusion rate)
    let remainingAfterTaxNeed = neededAfterTax;
    // Per-source withdrawal provenance for the year's drill-down.
    const wd = { rrifMin: 0, rrif: 0, rrsp: 0, tfsa: 0, taxable: 0, cash: 0, rmDraw: 0 };
    // Calc trace for the math page: the intermediates a year runs through.
    const calc: YearCalc = {
      cppMonthlyAtStart, otherGross, netBenefits, neededAfterTax,
      rrifMinNet: 0, rrifMinExcess: 0,
      needAfterBenefits: remainingAfterTaxNeed, needAfterRrifMin: remainingAfterTaxNeed,
      needAfterGis: remainingAfterTaxNeed, needAfterDraws: remainingAfterTaxNeed,
      needAfterCash: remainingAfterTaxNeed, needFinal: remainingAfterTaxNeed,
      gainsFraction: gainsFraction(), taxableAcb,
      totalNetIncome: otherGross, taxOnBenefits: calculateTax(otherGross, provinceCode, yearConfig).totalTax,
    };

    // 1. Mandatory RRIF minimum — forced out first. After-tax excess over the
    //    spending need is redeposited into taxable (still withdrawn & taxed).
    if (isRrifMandatory(age, config) && rrif > 0) {
      const minimum = calculateRrifMinimum(age, rrif, config);
      rrif -= minimum;
      actualWithdrawals += minimum;
      registeredGross += minimum;
      wd.rrifMin += minimum;

      const netFromRrif = calculateTax(minimum + otherGross, provinceCode, yearConfig).takeHome - netBenefits;
      calc.rrifMinNet = netFromRrif;

      const excess = netFromRrif - remainingAfterTaxNeed;
      if (excess > 0) {
        taxable += excess;
        taxableAcb += excess;
      }
      calc.rrifMinExcess = Math.max(0, excess);
      remainingAfterTaxNeed = Math.max(0, remainingAfterTaxNeed - netFromRrif);
    }
    calc.needAfterRrifMin = remainingAfterTaxNeed;

    // Gross income already stacking into the brackets this year (benefits +
    // any RRIF minimum). Additional registered draws are taxed on top of it.
    const stackedGross = () => otherGross + registeredGross;

    // GIS: tax-free, based on income EXCLUDING OAS itself (CPP + pensions +
    // registered draws + realized capital gains). Computed after the mandatory
    // RRIF minimum so the minimum's effect is captured. Discretionary draws
    // below further reduce it: we recompute once after the main draws and
    // credit back any overestimate, so the year doesn't pay GIS the draw
    // should have clawed back. (Real life settles this via Service Canada's
    // quarterly recalc — modelling it in-year keeps the projection honest.)
    // Couple rules apply when a spouse context is present: entitlement is
    // assessed on combined non-OAS income, at the couple rate when both
    // spouses receive OAS, the single rate when only this person does.
    const gisAt = () => {
      if (oasGross <= 0) return 0;
      if (spouseCtx) {
        const sp = spouseFixedIncomeAt(age);
        return gisAnnualCouple(
          registeredGross + capitalGains,
          cppGross + pensionGross + sp.fixed,
          sp.hasOas,
          yearConfig
        );
      }
      return gisAnnual(cppGross + pensionGross + registeredGross + capitalGains, yearConfig);
    };
    let gisGross = gisAt();
    remainingAfterTaxNeed = Math.max(0, remainingAfterTaxNeed - gisGross);
    calc.needAfterGis = remainingAfterTaxNeed;

    // 2. Draw the remaining after-tax need in the configured order.
    const drawFrom = (account: WithdrawalAccount): void => {
      if (remainingAfterTaxNeed <= 0) return;

      if (account === 'tfsa') {
        // After-tax money: $1 withdrawn = $1 of need.
        const draw = Math.min(tfsa, remainingAfterTaxNeed);
        tfsa -= draw;
        actualWithdrawals += draw;
        wd.tfsa += draw;
        remainingAfterTaxNeed -= draw;
        return;
      }

      if (account === 'taxable') {
        // Only the embedded-gain fraction of each withdrawal is taxable
        // (at the inclusion rate). Gross up so the after-tax proceeds cover
        // the need; ACB leaves pro-rata with the draw.
        const f = gainsFraction();
        const drawGross = grossTaxableWithdrawal(remainingAfterTaxNeed, stackedGross() + capitalGains * inclusion, f, inclusion, provinceCode, yearConfig);
        const draw = Math.min(taxable, drawGross);
        taxable -= draw;
        taxableAcb = Math.max(0, taxableAcb - draw * (1 - f));
        capitalGains += draw * f;
        actualWithdrawals += draw;
        wd.taxable += draw;
        // Credit the draw's after-tax value against the need: draw minus the
        // incremental tax on its included gain.
        const base = stackedGross() + capitalGains * inclusion;
        const netOfDraw = draw
          - (calculateTax(base, provinceCode, yearConfig).totalTax - calculateTax(base - draw * f * inclusion, provinceCode, yearConfig).totalTax);
        remainingAfterTaxNeed = Math.max(0, remainingAfterTaxNeed - netOfDraw);
        return;
      }

      // 'rrsp' slot — pre-conversion draws RRSP, post-conversion draws RRIF.
      // Registered money is taxed: gross up so take-home covers the need.
      const balance = age >= rrifAge ? rrif : rrsp;
      if (balance <= 0) return;

      const grossNeeded = grossRegisteredWithdrawal(remainingAfterTaxNeed, stackedGross(), provinceCode, yearConfig);

      if (balance >= grossNeeded) {
        if (age >= rrifAge) { rrif -= grossNeeded; wd.rrif += grossNeeded; } else { rrsp -= grossNeeded; wd.rrsp += grossNeeded; }
        actualWithdrawals += grossNeeded;
        registeredGross += grossNeeded;
        remainingAfterTaxNeed = 0;
      } else {
        // Insufficient: drain the account, credit only its after-tax value.
        const base = stackedGross();
        const marginalNet = calculateTax(balance + base, provinceCode, yearConfig).takeHome
          - calculateTax(base, provinceCode, yearConfig).takeHome;
        if (age >= rrifAge) { rrif = 0; wd.rrif += balance; } else { rrsp = 0; wd.rrsp += balance; }
        actualWithdrawals += balance;
        registeredGross += balance;
        remainingAfterTaxNeed = Math.max(0, remainingAfterTaxNeed - marginalNet);
      }
    };

    for (const account of order) {
      drawFrom(account);
    }
    calc.needAfterDraws = remainingAfterTaxNeed;

    // 3. Cash cushion — last resort, after-tax money.
    if (remainingAfterTaxNeed > 0 && cashCushion > 0) {
      const draw = Math.min(cashCushion, remainingAfterTaxNeed);
      cashCushion -= draw;
      actualWithdrawals += draw;
      wd.cash += draw;
      remainingAfterTaxNeed -= draw;
    }
    calc.needAfterCash = remainingAfterTaxNeed;

    // 4. Reverse-mortgage top-up — the true last resort. Once every account
    //    is drained, borrow just enough to cover the year's remaining need,
    //    capped at the LTV headroom (loan ≤ maxLtv × home value). Proceeds are
    //    tax-free, so $1 borrowed = $1 of need met; the loan (already accrued
    //    interest above) grows by the draw.
    if (remainingAfterTaxNeed > 0 && rmOn && rm?.topUp) {
      const draw = rmDraw(remainingAfterTaxNeed);
      if (draw > 0) {
        actualWithdrawals += draw;
        wd.rmDraw += draw;
        remainingAfterTaxNeed -= draw;
      }
    }
    calc.needFinal = remainingAfterTaxNeed;

    // Recompute GIS now that the year's discretionary draws (and the capital
    // gains they realized) are known. If the draws clawed GIS back further
    // than the initial estimate, the overpayment is returned to the taxable
    // account (it was borrowed against income that never materialized).
    {
      const gisFinal = gisAt();
      if (gisFinal < gisGross) {
        const overpaid = gisGross - gisFinal;
        taxable += overpaid;
        taxableAcb += overpaid;
        gisGross = gisFinal;
      }
    }

    // Single consistent tax figure: total tax on (benefits + registered
    // withdrawals) minus tax on benefits alone, plus the OAS recovery tax
    // (clawback) when total net income crosses the threshold.
    const totalNetIncome = otherGross + registeredGross + capitalGains * inclusion;
    const oasClawback = oasGross > 0
      ? Math.min(oasGross, Math.max(0, totalNetIncome - yearConfig.oas.clawbackThreshold) * yearConfig.oas.clawbackRate)
      : 0;
    const incomeTax = calculateTax(totalNetIncome, provinceCode, yearConfig).totalTax
      - calculateTax(otherGross, provinceCode, yearConfig).totalTax
      + oasClawback;
    cumulativeTax += incomeTax;
    calc.totalNetIncome = totalNetIncome;
    calc.taxableAcb = taxableAcb;
    calc.gainsFraction = gainsFraction();

    // Apply market growth after withdrawals.
    const r = rateAt(age);
    const rrspGains = rrsp * r;
    const rrifGains = rrif * r;
    const tfsaGains = tfsa * r;
    const taxableGains = taxable * r;
    const cashGains = cashCushion * cushionRate;

    rrsp += rrspGains;
    rrif += rrifGains;
    tfsa += tfsaGains;
    taxable += taxableGains;
    cashCushion += cashGains;

    const endingTotal = totalBalance();

    // Depletion = investable accounts exhausted AND no remaining way to fund
    // spending. With a reverse-mortgage top-up, remaining LTV headroom keeps
    // the plan afloat (it borrows the shortfall), so only count depletion once
    // the loan has hit the LTV ceiling too. Recorded, NOT truncated: the loop
    // keeps projecting to maxAge so benefits that start after the money runs
    // out (a late pension, CPP, OAS, GIS) still accrue into rows and the year's
    // unfunded shortfall (calc.needFinal) stays visible. Balances clamp at 0 —
    // the portfolio can fund nothing further, but income keeps flowing.
    const rmCanBorrow = rmOn && rm?.topUp && rmHeadroom() > 0;
    if (endingTotal <= 0 && !rmCanBorrow && depletionAge === null) {
      depletionAge = age;
    }

    // Pension-splitting inputs: eligible income is RRIF/RRSP registered draws
    // (which only exist from the RRIF-conversion age onward, so age ≥ 65 in
    // practice) plus DB/bridge pensions. CPP and OAS are NOT eligible. Captured
    // pre-split; the household pass applies the split to the reported tax.
    const splitEligibleIncome = registeredGross + pensionGross;
    const unsplitNetIncome = totalNetIncome;

    yearlyBreakdown.push({
      age,
      startingBalance: startingTotal,
      contributions: 0,
      marketGains: rrspGains + rrifGains + tfsaGains + taxableGains + cashGains,
      withdrawals: actualWithdrawals,
      incomeTax,
      cumulativeTax,
      spendingTarget: yearSpending,
      endingBalance: Math.max(0, endingTotal),
      // The year's unfunded spending gap: what the target couldn't be covered by
      // benefits + portfolio. Zero until depletion; afterwards it shrinks as
      // late-starting benefits (pension/CPP/OAS/GIS) begin to cover spending.
      shortfall: Math.max(0, remainingAfterTaxNeed),
      rrspBalance: Math.max(0, rrsp),
      rrifBalance: Math.max(0, rrif),
      tfsaBalance: Math.max(0, tfsa),
      taxableBalance: Math.max(0, taxable),
      cashCushionBalance: Math.max(0, cashCushion),
      cppIncome: cppGross,
      oasIncome: oasGross,
      gisIncome: gisGross,
      pensionIncome: pensionGross,
      splitEligibleIncome,
      unsplitNetIncome,
      detail: {
        withdraw: wd,
        growth: { rrsp: rrspGains, rrif: rrifGains, tfsa: tfsaGains, taxable: taxableGains, cash: cashGains },
        tax: { oasClawback, capitalGains, registeredGross },
        ...(rmOn ? { rm: { interestAccrued: rmInterest, scheduledDraw: rmScheduled, topUpDraw: wd.rmDraw, homeValue, loanBalance: rmLoan } } : {}),
        events: yearEvents,
        calc,
      },
      ...(rmOn ? { homeValue, loanBalance: rmLoan, netHomeEquity: homeValue - rmLoan } : {})
    });

    accountBreakdown.push({
      age,
      rrspBalance: Math.max(0, rrsp),
      rrifBalance: Math.max(0, rrif),
      tfsaBalance: Math.max(0, tfsa),
      taxableBalance: Math.max(0, taxable),
      cashCushionBalance: Math.max(0, cashCushion)
    });
  }

  const totalNetWorthAtRetirement =
    yearlyBreakdown.find(y => y.age === retirementAge)?.startingBalance ??
    totalStartingRetirement;

  // The verdict is the simulation itself: the plan is SHORTFALL only if the
  // money actually runs out before max age. (The old 25× rule-of-thumb check
  // was dropped — it ignored post-retirement benefits and growth, so it could
  // contradict the depletion result.)
  let status: 'ON_TRACK' | 'SHORTFALL' = 'ON_TRACK';
  if (depletionAge !== null && depletionAge < maxAge) {
    status = 'SHORTFALL';
  }

  const withdrawalRate = totalStartingRetirement > 0
    ? (desiredSpending * spendingFactorAt(retirementAge)) / totalStartingRetirement
    : 0;

  const primary: RetirementResults = {
    totalNetWorthAtRetirement,
    depletionAge,
    yearlyBreakdown,
    accountBreakdown,
    status,
    withdrawalRate,
    averageReturn: investmentReturn,
    retirementAge
  };

  return primary;
}

/**
 * Top-level entry point. When a spouse is enabled, both plans are computed
 * with each other's benefit context so GIS is assessed on COMBINED non-OAS
 * income at the correct (couple vs single) rate — CRA's couple rules.
 * `calculateRetirement` itself runs one person's plan; this wrapper supplies
 * the cross-references.
 */
export function calculateHousehold(
  inputs: RetirementInputs,
  config: AppConfig,
  options?: { returnSequence?: Record<number, number> }
): RetirementResults {
  const sp = inputs.spouse;
  const primary = calculateRetirement(inputs, config, sp?.enabled ? {
    ...options,
    spouseContext: {
      cppStartAge: sp.cppStartAge,
      cppMonthlyAmount: sp.cppMonthlyAmount,
      oasStartAge: sp.oasStartAge,
      oasYearsInCanada: sp.oasYearsInCanada,
      currentAge: sp.currentAge,
      pensions: sp.pensions,
    },
  } : options);

  if (sp?.enabled) {
    const spouseResults = calculateRetirement({
      currentAge: sp.currentAge,
      retirementAge: sp.retirementAge,
      maxAge: inputs.maxAge,
      rrspBalance: sp.rrspBalance,
      tfsaBalance: sp.tfsaBalance,
      taxableBalance: sp.taxableBalance,
      cashCushionBalance: sp.cashCushionBalance,
      rrspContribution: sp.rrspContribution,
      tfsaContribution: sp.tfsaContribution,
      taxableContribution: sp.taxableContribution,
      annualWithdrawal: 0,
      investmentReturn: inputs.investmentReturn,
      returnVolatility: 0,
      provinceCode: inputs.provinceCode,
      cppStartAge: sp.cppStartAge,
      cppMonthlyAmount: sp.cppMonthlyAmount,
      cppAdjustedAmount: false,
      oasStartAge: sp.oasStartAge,
      oasYearsInCanada: sp.oasYearsInCanada,
      desiredSpending: sp.desiredSpending,
      withdrawalOrder: sp.withdrawalOrder ?? inputs.withdrawalOrder,
      spouse: undefined,
      pensions: sp.pensions
    }, config, {
      ...options,
      spouseContext: {
        cppStartAge: inputs.cppStartAge,
        cppMonthlyAmount: inputs.cppMonthlyAmount,
        oasStartAge: inputs.oasStartAge,
        oasYearsInCanada: inputs.oasYearsInCanada,
        currentAge: inputs.currentAge,
        pensions: inputs.pensions,
      },
    });
    primary.spouse = spouseResults;
    if (spouseResults.status === 'SHORTFALL') primary.status = 'SHORTFALL';
    applyPensionSplitting(primary, spouseResults, inputs, config, sp.currentAge);
  }

  return primary;
}

/**
 * Household view of the projection for display: both spouses' per-year rows
 * summed into a single breakdown, aligned to the PRIMARY's age axis (the
 * chart/table X-axis is the primary's age). The spouse row for the same
 * calendar year has age = primary age − (primary.currentAge − spouse.currentAge).
 * Returns the primary's own breakdown unchanged when there is no spouse.
 *
 * Monetary flows and balances are summed; the per-account balances are summed
 * per account; cpp/oas/gis/pension income are summed. splitTransferred is
 * household net (≈0, since one spouse's out-transfer is the other's receipt)
 * and is left undefined to avoid implying income vanishes.
 */
export function combineHouseholdBreakdown(
  results: RetirementResults,
  inputs: RetirementInputs
): YearlyBreakdown[] {
  const spouse = results.spouse;
  if (!spouse) return results.yearlyBreakdown;

  const ageOffset = inputs.currentAge - (inputs.spouse?.currentAge ?? inputs.currentAge);
  const spouseByCalYear = new Map(spouse.yearlyBreakdown.map(y => [y.age + ageOffset, y]));

  // The household view sums flows; per-source drill-down detail doesn't sum
  // cleanly into one row, so combined rows drop it (detail === undefined). The
  // table reads per-person detail straight from the primary/spouse plans.
  return results.yearlyBreakdown.map(py => {
    const sy = spouseByCalYear.get(py.age);
    if (!sy) return { ...py, splitTransferred: undefined, detail: undefined };
    const rm = (py.homeValue !== undefined || sy.homeValue !== undefined)
      ? {
          homeValue: (py.homeValue ?? 0) + (sy.homeValue ?? 0),
          loanBalance: (py.loanBalance ?? 0) + (sy.loanBalance ?? 0),
          netHomeEquity: (py.netHomeEquity ?? 0) + (sy.netHomeEquity ?? 0),
        }
      : {};
    return {
      age: py.age,
      startingBalance: py.startingBalance + sy.startingBalance,
      contributions: py.contributions + sy.contributions,
      marketGains: py.marketGains + sy.marketGains,
      withdrawals: py.withdrawals + sy.withdrawals,
      incomeTax: py.incomeTax + sy.incomeTax,
      cumulativeTax: py.cumulativeTax + sy.cumulativeTax,
      spendingTarget: py.spendingTarget + sy.spendingTarget,
      shortfall: (py.shortfall ?? 0) + (sy.shortfall ?? 0),
      endingBalance: py.endingBalance + sy.endingBalance,
      rrspBalance: py.rrspBalance + sy.rrspBalance,
      rrifBalance: py.rrifBalance + sy.rrifBalance,
      tfsaBalance: py.tfsaBalance + sy.tfsaBalance,
      taxableBalance: py.taxableBalance + sy.taxableBalance,
      cashCushionBalance: py.cashCushionBalance + sy.cashCushionBalance,
      cppIncome: py.cppIncome + sy.cppIncome,
      oasIncome: py.oasIncome + sy.oasIncome,
      gisIncome: py.gisIncome + sy.gisIncome,
      pensionIncome: py.pensionIncome + sy.pensionIncome,
      ...rm,
      splitTransferred: undefined,
      detail: undefined,
    };
  });
}

/** The household-level outcome of a plan run: when the COMBINED money runs out. */
export interface HouseholdOutcome {
  /** First age the combined household balance is exhausted; null = funded to max age. */
  depletionAge: number | null;
  /** Combined household balance at max age (0 once depleted). */
  endingBalance: number;
  status: 'ON_TRACK' | 'SHORTFALL';
}

/**
 * Household-first verdict. Couples share money: the plan only runs out when the
 * COMBINED balance (both partners' accounts, summed by combineHouseholdBreakdown)
 * is exhausted — not when either partner's silo independently hits zero. This is
 * the verdict the UI shows; the per-person plans remain for tax/GIS/drill-down.
 *
 * Depletion = a year where the combined balance is exhausted AND there's still an
 * unfunded spending gap (shortfall > 0) — i.e. the household genuinely can't cover
 * that year. A single person reduces to the primary's own result unchanged.
 */
export function householdOutcome(results: RetirementResults, inputs: RetirementInputs): HouseholdOutcome {
  const combined = combineHouseholdBreakdown(results, inputs);
  const depletedRow = combined.find(y => y.endingBalance <= 0 && (y.shortfall ?? 0) > 0);
  const depletionAge = depletedRow ? depletedRow.age : null;
  const last = combined[combined.length - 1];
  const endingBalance = depletionAge !== null ? 0 : Math.max(0, last?.endingBalance ?? 0);
  const status: 'ON_TRACK' | 'SHORTFALL' =
    depletionAge !== null && depletionAge < inputs.maxAge ? 'SHORTFALL' : 'ON_TRACK';
  return { depletionAge, endingBalance, status };
}

/**
 * Pension income splitting (couples). CRA lets up to pensionSplitMaxRate of
 * eligible pension income be allocated from the higher-taxed spouse to the
 * lower-taxed one. This adjusts ONLY the reported tax figures — the drawdown
 * cash-flow, GIS (assessed on pre-split income) and balances are unchanged,
 * because each spouse's plan was already computed from their own unsplit
 * income. For each overlapping year we test allocating in both directions and
 * keep whichever lowers combined tax (subject to the 50% cap and not driving
 * the transferor's net income below zero).
 */
function applyPensionSplitting(
  primary: RetirementResults,
  spouse: RetirementResults,
  inputs: RetirementInputs,
  config: AppConfig,
  spouseCurrentAge: number
): void {
  const maxRate = config.engine.pensionSplitMaxRate ?? 0;
  if (maxRate <= 0) return;

  const indexTables = config.engine.indexTaxTables === true;
  const inflation = Math.max(0, config.engine.inflationRate ?? 0);
  // Calendar-year inflation factor: spouse rows are offset in age but share the
  // same calendar year as the primary row they pair with.
  const factorAt = (calendarAge: number) => Math.pow(1 + inflation, Math.max(0, calendarAge - inputs.currentAge));
  const configCache = new Map<number, AppConfig>();
  const configAt = (calendarAge: number): AppConfig => {
    if (!indexTables) return config;
    const f = factorAt(calendarAge);
    if (f === 1) return config;
    let c = configCache.get(calendarAge);
    if (!c) { c = indexConfig(config, f); configCache.set(calendarAge, c); }
    return c;
  };

  const province = inputs.provinceCode;
  // Full-tax on a net income figure (the per-year incomeTax the engine stored
  // is tax on incremental registered income, so here we recompute from the
  // person's total net income to apply the split correctly).
  const fullTax = (net: number, yearConfig: AppConfig) => calculateTax(net, province, yearConfig).totalTax;
  // OAS clawback for a given net income and OAS receipt.
  const clawback = (net: number, oas: number, yearConfig: AppConfig) =>
    oas > 0 ? Math.min(oas, Math.max(0, net - yearConfig.oas.clawbackThreshold) * yearConfig.oas.clawbackRate) : 0;

  // Total (tax + clawback) for one person in a year at a given net income.
  const burden = (net: number, oas: number, yearConfig: AppConfig) =>
    fullTax(net, yearConfig) + clawback(net, oas, yearConfig);

  // Match rows by calendar year: the spouse row for the same calendar year has
  // age = primary age − ageOffset (spouse's own age in that year).
  const ageOffset = inputs.currentAge - spouseCurrentAge;
  const spouseRows = new Map(spouse.yearlyBreakdown.map(y => [y.age + ageOffset, y]));

  // Recompute each person's per-year tax with the split, accumulating the
  // correction onto cumulativeTax from the first changed year onward.
  for (const py of primary.yearlyBreakdown) {
    const sy = spouseRows.get(py.age);
    if (!sy) continue;
    if (py.splitEligibleIncome === undefined || sy.splitEligibleIncome === undefined) continue;

    const yearConfig = configAt(py.age);
    const pNet = py.unsplitNetIncome!, sNet = sy.unsplitNetIncome!;
    const pOas = py.oasIncome, sOas = sy.oasIncome;

    const baseCombined = burden(pNet, pOas, yearConfig) + burden(sNet, sOas, yearConfig);

    // Candidate transfers: primary → spouse (t > 0) and spouse → primary (t < 0).
    // Each is capped at maxRate × the transferor's eligible income and at the
    // transferor's net income (can't transfer more than you have).
    //
    // Two probes per direction:
    //   • the maximum allowed transfer, and
    //   • the EQUALIZING transfer — the amount that brings the two net incomes
    //     level ((pNet − sNet) / 2). CRA splitting can never help past that
    //     point: transferring more would just move income into the recipient's
    //     now-equal-or-higher brackets. Without this probe, a near-zero-income
    //     spouse gets hit with the full 50% max — pushing the transfer deep
    //     into their brackets and inventing tax on a return that had no income.
    const candidates: number[] = [0];
    const equalize = (pNet - sNet) / 2; // >0: primary is higher; <0: spouse is higher
    const pMax = Math.min(maxRate * py.splitEligibleIncome, pNet);
    const sMax = Math.min(maxRate * sy.splitEligibleIncome, sNet);
    if (pMax > 0) {
      candidates.push(pMax);
      const eq = Math.min(pMax, Math.max(0, equalize));
      if (eq > 0 && eq !== pMax) candidates.push(eq);
    }
    if (sMax > 0) {
      candidates.push(-sMax);
      const eq = Math.min(sMax, Math.max(0, -equalize));
      if (eq > 0 && eq !== sMax) candidates.push(-eq);
    }

    let bestT = 0;
    let bestCombined = baseCombined;
    for (const t of candidates) {
      if (t === 0) continue;
      const combined = burden(pNet - t, pOas, yearConfig) + burden(sNet + t, sOas, yearConfig);
      if (combined < bestCombined - 0.01) { bestCombined = combined; bestT = t; }
    }
    if (bestT === 0) continue;

    // Re-derive each person's incomeTax under the split so that it stays
    // comparable to the unsplit figure (tax on registered draws + clawback).
    // We store the DELTA from the unsplit burden onto incomeTax and mark the
    // transferred amount for display.
    const pNewBurden = burden(pNet - bestT, pOas, yearConfig);
    const sNewBurden = burden(sNet + bestT, sOas, yearConfig);
    const pOldBurden = burden(pNet, pOas, yearConfig);
    const sOldBurden = burden(sNet, sOas, yearConfig);
    py.incomeTax += pNewBurden - pOldBurden;
    sy.incomeTax += sNewBurden - sOldBurden;
    py.splitTransferred = bestT;       // + = primary gave to spouse
    sy.splitTransferred = -bestT;      // spouse's view (received if bestT > 0)
  }

  // Rebuild cumulativeTax as a running sum so it stays consistent with the
  // adjusted per-year incomeTax figures.
  let cum = 0;
  for (const y of primary.yearlyBreakdown) { cum += y.incomeTax; y.cumulativeTax = cum; }
  cum = 0;
  for (const y of spouse.yearlyBreakdown) { cum += y.incomeTax; y.cumulativeTax = cum; }
}

/**
 * CPP early/late adjustment: −0.6% per month before 65 (floor −36% at 60),
 * +0.7% per month after 65 (cap +42% at 70). Rates are configurable in
 * Settings → CPP.
 */
export function cppAdjustmentMultiplier(startAge: number, config: AppConfig): number {
  const c = config.cpp;
  const clamped = Math.max(c.earliestAge, Math.min(c.maxDeferralAge, startAge));
  if (clamped < c.standardAge) {
    return 1 - (c.standardAge - clamped) * 12 * c.earlyPenaltyPerMonth;
  }
  return 1 + (clamped - c.standardAge) * 12 * c.deferralBonusPerMonth;
}

/**
 * Gross taxable-account withdrawal whose after-tax value equals
 * `neededAfterTax`, given that fraction `gainsFrac` of each dollar is a
 * capital gain taxed at `inclusion`, stacked on `baseGross` of existing
 * taxable income. With zero embedded gains this is the identity.
 */
function grossTaxableWithdrawal(
  neededAfterTax: number,
  baseGross: number,
  gainsFrac: number,
  inclusion: number,
  provinceCode: string,
  config: AppConfig
): number {
  if (neededAfterTax <= 0) return 0;
  const taxableFrac = gainsFrac * inclusion;
  if (taxableFrac <= 0) return neededAfterTax;

  let lower = neededAfterTax;
  let upper = neededAfterTax * 2;
  // After-tax value of the withdrawal = W − incremental tax on the included
  // gain (a takeHome *difference* would wrongly subtract the whole post-tax
  // benefit income, not just the tax increment).
  const net = (w: number) =>
    w - (calculateTax(baseGross + w * taxableFrac, provinceCode, config).totalTax
       - calculateTax(baseGross, provinceCode, config).totalTax);
  while (net(upper) < neededAfterTax) upper *= 1.5;
  for (let i = 0; i < MAX_TAX_ITERATIONS; i++) {
    const mid = (lower + upper) / 2;
    const difference = net(mid) - neededAfterTax;
    if (Math.abs(difference) <= TAX_TOLERANCE) return mid;
    if (difference > 0) upper = mid; else lower = mid;
  }
  return (lower + upper) / 2;
}

/**
 * Gross registered (RRSP/RRIF) withdrawal whose after-tax value, stacked on
 * top of existing gross benefit income, equals `neededAfterTax`.
 * Mirrors WithdrawalAmounts#annualRrsp binary search.
 */
function grossRegisteredWithdrawal(
  neededAfterTax: number,
  otherGross: number,
  provinceCode: string,
  config: AppConfig
): number {
  if (neededAfterTax <= 0) return 0;

  if (otherGross <= 0) {
    // No other income: simple reverse-tax.
    return findGrossIncomeForTakeHome(neededAfterTax, provinceCode, config);
  }

  // With CPP/OAS stacking into the brackets, binary search on total take-home.
  const targetTakeHome = neededAfterTax + calculateTax(otherGross, provinceCode, config).takeHome;
  let lower = 0;
  let upper = findGrossIncomeForTakeHome(targetTakeHome, provinceCode, config);

  for (let i = 0; i < MAX_TAX_ITERATIONS; i++) {
    const candidate = (lower + upper) / 2;
    const totalTakeHome = calculateTax(candidate + otherGross, provinceCode, config).takeHome;
    const difference = totalTakeHome - targetTakeHome;
    if (Math.abs(difference) <= TAX_TOLERANCE) return candidate;
    if (difference > 0) {
      upper = candidate;
    } else {
      lower = candidate;
    }
  }
  return (lower + upper) / 2;
}
