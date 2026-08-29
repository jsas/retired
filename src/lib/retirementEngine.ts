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
import {
  legacyToPerson,
  legacyToShared,
  legacySpouseToPerson,
  eventEndpoints,
  type PersonInputs,
  type SharedInputs,
} from './householdTypes';

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
  // How the spouse plan is supplied. Absent (or kind 'builtin') = the spouse
  // is embedded directly in `spouse` (today's behaviour). kind 'scenario' =
  // the spouse IS another saved scenario, referenced by id: the app resolves
  // that scenario's person into `spouse` (host wins on the shared household
  // fields, with the conflicts surfaced as warnings), so the engine always
  // sees a concrete SpouseInputs. The reference is the source of truth;
  // `spouse` is its materialized view.
  spouseSource?: SpouseSource;
  // DB / bridge pensions: taxable income stacked with CPP/OAS. Bridge benefits
  // have endAge set; lifetime pensions leave it null.
  pensions?: Pension[];
  // Semi-retirement / post-retirement work: earned income, taxed in the year
  // earned, then saved (destAccount) or used to top up spending. See
  // EmploymentIncome. Absent/empty = not working.
  employment?: EmploymentIncome[];
  // Optional reverse mortgage: borrow against home equity via scheduled draws
  // and/or a last-resort top-up. Proceeds are tax-free (no GIS/clawback impact);
  // the loan compounds against the home and erodes net equity.
  reverseMortgage?: ReverseMortgage;
}

/** Where the spouse's plan comes from (see RetirementInputs.spouseSource). */
export type SpouseSource =
  | { kind: 'builtin' }
  | { kind: 'scenario'; scenarioId: string };

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
  employment?: EmploymentIncome[]; // the spouse's own work income
  // Full-person parity fields. Optional so scenarios saved before the spouse
  // carried them still parse; absent = none (an empty list / no reverse
  // mortgage). These make the spouse a first-class person: their own one-time
  // cash events (incl. transfers), go-go/slow-go/no-go spending phases, and a
  // reverse mortgage all flow into their run exactly like the primary's.
  events?: CashEvent[];
  spendingBands?: SpendingBand[];
  reverseMortgage?: ReverseMortgage;
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
  // Optional explicit transfer endpoints (advanced mode). When set, they make
  // the event a TRANSFER between two accounts/people rather than a simple
  // in/out flow: `from` is where the money leaves (an account, or external),
  // `to` is where it lands (an account, or external = spending). Registered
  // sources (rrsp) are taxed on withdrawal before the after-tax remainder is
  // redeposited — the RRSP→TFSA "meltdown". When both are absent the legacy
  // direction/account semantics apply (see householdTypes.eventEndpoints).
  // Declared structurally here (not via the householdTypes import) to avoid a
  // module cycle; householdTypes.TransferEndpoint is the canonical shape.
  from?: { kind: 'external' } | { kind: 'account'; person: 'primary' | 'spouse'; account: 'rrsp' | 'tfsa' | 'taxable' | 'cash' };
  to?: { kind: 'external' } | { kind: 'account'; person: 'primary' | 'spouse'; account: 'rrsp' | 'tfsa' | 'taxable' | 'cash' };
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

/**
 * Semi-retirement / post-retirement work. Earned income — taxed in the year
 * it's earned (stacks with CPP/OAS/pensions/RRIF for the marginal rate, OAS
 * clawback and GIS), then the after-tax net either:
 *  - topUpSpending=false (save mode): lands in destAccount and compounds, or
 *  - topUpSpending=true  (top-up mode, RM-style): covers that year's spending
 *    first (displacing portfolio withdrawals); only net above the need is saved.
 * Contribution-room limits are ignored, consistent with the rest of the app.
 */
export interface EmploymentIncome {
  id: string;
  label: string;
  annualAmount: number;   // gross $/yr at startAge, today's dollars
  startAge: number;
  endAge: number;         // inclusive — work through this age
  destAccount: 'rrsp' | 'tfsa' | 'taxable' | 'cash';
  topUpSpending: boolean;
  indexedToCpi: boolean;
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
  neededAfterTax: number;      // spending target − netBenefits − top-up employment net (≥0)
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
  totalNetIncome: number;      // otherGross + employment + registeredGross + gains×inclusion
  taxOnBenefits: number;       // tax(otherGross) — the benefits-only share of the year's tax
  // Transfer events (account→account / inter-spousal) that fired this year.
  // Each is shown on the math page so the full path is visible: gross amount
  // leaving the source, the tax on a registered source, and the net landing in
  // the destination. Without this a meltdown looks like money vanishing.
  transfers?: Array<{
    label: string;
    from: string;            // human-readable source, e.g. "RRSP" / "outside"
    to: string;              // human-readable destination, e.g. "TFSA" / "spending"
    gross: number;           // amount that left the source
    tax: number;             // incremental tax on a registered source (0 otherwise)
    net: number;             // amount that landed in the destination (gross − tax)
  }>;
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
  // Deposit provenance — gross dollars that LANDED in each account this year
  // from cash events and transfers (inflows + the redeposit side of a
  // transfer). Symmetric to `withdraw` so both ends of a transfer are visible
  // and the year's accounting reconciles on the math page. Optional so older
  // fixtures compile; the engine always sets it.
  deposit?: { rrsp: number; rrif: number; tfsa: number; taxable: number; cash: number };
  // Tax decomposition for the year's withdrawals.
  tax: { oasClawback: number; capitalGains: number; registeredGross: number };
  // Reverse mortgage, when enabled.
  rm?: { interestAccrued: number; scheduledDraw: number; topUpDraw: number; homeValue: number; loanBalance: number };
  // Cash events that fired this year (labelled in/out). `from`/`to` are the
  // human-readable endpoints when the event is a transfer (else undefined and
  // the row is a plain inflow/outflow).
  events: Array<{ label: string; direction: 'in' | 'out'; amount: number; from?: string; to?: string }>;
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
  // Total tax on ALL of the year's income (benefits + employment + registered
  // draws + included capital gains), plus the OAS clawback. Contrasts with
  // incomeTax, which is only the INCREMENTAL tax on withdrawals (tax on total
  // minus tax on benefits alone) — incomeTax legitimately reads $0 late in
  // life once the portfolio is drained, which can look like "tax stopped".
  // Optional so older fixtures compile; the engine sets it on decumulation rows.
  totalTaxPaid?: number;
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
  // Employment (semi-retirement work) this year. gross stacks for tax; net is
  // the after-tax amount saved and/or used to top up spending. Optional so
  // older fixtures compile; the engine always sets them (0 when not working).
  employmentGross?: number;
  employmentTax?: number;
  employmentNet?: number;
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
  // After-tax amounts this person's transfer events sent to the PARTNER's
  // accounts (inter-spousal transfers). The household pass injects these into
  // the partner's run so the transfer is conserved across the household.
  // Undefined for a standalone single-person run with no cross transfers.
  crossDeposits?: Array<{ age: number; account: 'rrsp' | 'tfsa' | 'taxable' | 'cash'; amount: number; label: string }>;
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
/** A drill-down event line, including transfer endpoints when the event is a
 *  transfer (so the math page can show "RRSP → TFSA" rather than just in/out). */
function eventLine(ev: CashEvent): { label: string; direction: 'in' | 'out'; amount: number; from?: string; to?: string } {
  const base = { label: ev.label, direction: ev.direction, amount: ev.amount };
  if (!(ev.from || ev.to)) return base;
  const name = (a: string) => a === 'rrsp' ? 'RRSP' : a === 'tfsa' ? 'TFSA' : a === 'taxable' ? 'Taxable' : 'Cash';
  const ep = (e: NonNullable<CashEvent['from']>) =>
    e.kind === 'external' ? 'outside' : `${name(e.account)}${e.person === 'spouse' ? ' (spouse)' : ''}`;
  return {
    ...base,
    from: ev.from ? ep(ev.from) : 'outside',
    to: ev.to ? ep(ev.to) : 'outside',
  };
}

/**
 * Project ONE person's accounts and benefits across their lifetime. This is the
 * engine's unit of work; a couple is two of these coupled in calculateHousehold.
 * The person supplies their accounts/ages/benefits/spending; the household-
 * shared assumptions (market, province, horizon) come from `shared` so a couple
 * can't disagree about them. Returns the full per-year breakdown for drill-down.
 */
export function calculatePerson(
  person: PersonInputs,
  shared: SharedInputs,
  config: AppConfig,
  options?: {
    returnSequence?: Record<number, number>;
    // Which member of the household this run represents. Transfer events use
    // it to resolve `{person: 'primary'|'spouse'}` endpoints against THIS run:
    // an endpoint naming this person moves money in this run's accounts; one
    // naming the partner is handled by the household pass (which runs both).
    personRef?: 'primary' | 'spouse';
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
      employment?: EmploymentIncome[];
    };
    // After-tax amounts the PARTNER's transfer events sent into THIS person's
    // accounts (inter-spousal transfers), keyed by THIS person's age. Injected
    // by the household pass so an inter-spousal transfer is conserved: one
    // person's cross-deposit is the other's inbound deposit. Landing here is
    // after-tax money (the source run already taxed the draw).
    inboundDeposits?: Array<{ age: number; account: 'rrsp' | 'tfsa' | 'taxable' | 'cash'; amount: number; label: string }>;
  }
): RetirementResults {
  const {
    currentAge,
    retirementAge,
    rrspBalance,
    tfsaBalance,
    taxableBalance,
    cashCushionBalance,
    rrspContribution,
    tfsaContribution,
    taxableContribution,
    desiredSpending,
    cppMonthlyAmount,
    cppAdjustedAmount,
    cppStartAge,
    oasStartAge,
    oasYearsInCanada,
    withdrawalOrder,
    pensions,
    employment
  } = person;
  const { maxAge, investmentReturn, provinceCode } = shared;

  const order: WithdrawalAccount[] =
    Array.isArray(withdrawalOrder) && withdrawalOrder.length > 0
      ? withdrawalOrder
      : ['tfsa', 'taxable', 'rrsp'];

  const pensionList: Pension[] = Array.isArray(pensions) ? pensions : [];
  const employmentList: EmploymentIncome[] = Array.isArray(employment) ? employment : [];

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
  const bands = Array.isArray(person.spendingBands) ? [...person.spendingBands].sort((a, b) => a.fromAge - b.fromAge) : [];
  const spendingPctAt = (age: number): number => {
    let pct = 1;
    for (const b of bands) {
      if (age >= b.fromAge) pct = b.pctOfBase;
      else break;
    }
    return pct;
  };

  // Cash events: one-time (age only) or recurring (age..endAge inclusive).
  // Events before the current age are in the model's past — they can't fire,
  // so drop them defensively (the UI clamps them too, but a saved/imported
  // scenario may carry one).
  const events = (Array.isArray(person.events) ? person.events : []).filter(e => e.age >= currentAge);
  const eventsAt = (age: number) => events.filter(e =>
    e.age === age || (e.endAge != null && age >= e.age && age <= e.endAge));

  // Inbound inter-spousal transfer deposits (from the partner's run), already
  // translated to THIS person's age axis by the household pass. They land at
  // the start of the year like an inflow, as after-tax money.
  const inboundAt = (age: number) => (options?.inboundDeposits ?? []).filter(d => d.age === age);
  // Outflows raise the year's spending need — but a TRANSFER event (from/to
  // set) moves money account→account, so it must NOT be counted as spending
  // (its source draw is handled by the transfer path, not the spending draws).
  const eventOutAt = (age: number) => eventsAt(age)
    .filter(e => e.direction === 'out' && !(e.from || e.to))
    .reduce((s, e) => s + e.amount, 0);
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
    // The spouse's employment income counts toward the couple's GIS base too.
    for (const e of spouseCtx.employment ?? []) {
      if (spouseAge < e.startAge || spouseAge > e.endAge) continue;
      fixed += e.annualAmount * (e.indexedToCpi && indexTables ? factorAt(age) : 1);
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
  const rm = person.reverseMortgage;
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

  // ---- transfer events (account→account / inter-spousal) ----
  // Which household member this run is; transfer endpoints naming this person
  // move money here, endpoints naming the partner are the household pass's
  // concern (it runs both people). Default 'primary' for a standalone run.
  const selfRef = options?.personRef ?? 'primary';
  // Account accessor so the transfer executor can move money across the
  // closure's let-bound balances by name.
  const acct = {
    get: (a: 'rrsp' | 'tfsa' | 'taxable' | 'cash'): number =>
      a === 'rrsp' ? rrsp + rrif : a === 'tfsa' ? tfsa : a === 'taxable' ? taxable : cashCushion,
    // Deposit `amt` into account `a`. RRSP-bound money lands in RRSP pre-
    // conversion, RRIF post- (mirroring the drawdown). Taxable deposits raise
    // ACB (new principal); TFSA/cash are after-tax so no ACB effect.
    put: (a: 'rrsp' | 'tfsa' | 'taxable' | 'cash', amt: number): void => {
      if (amt <= 0) return;
      if (a === 'rrsp') { /* transfers into registered are unusual; land in rrsp */ rrsp += amt; }
      else if (a === 'tfsa') tfsa += amt;
      else if (a === 'cash') cashCushion += amt;
      else { taxable += amt; taxableAcb += amt; }
    },
    // Withdraw up to `amt` from account `a`, returning the amount actually
    // taken. Reduces taxable ACB by the principal portion (keeps the gains
    // fraction correct). Does NOT tax — the caller taxes registered sources.
    take: (a: 'rrsp' | 'tfsa' | 'taxable' | 'cash', amt: number): number => {
      if (amt <= 0) return 0;
      if (a === 'rrsp') {
        const draw = Math.min(rrsp + rrif, amt);
        // Drain RRIF first post-conversion (it's the same registered pool).
        const fromRrif = Math.min(rrif, draw);
        rrif -= fromRrif;
        rrsp -= (draw - fromRrif);
        return draw;
      }
      if (a === 'tfsa') { const d = Math.min(tfsa, amt); tfsa -= d; return d; }
      if (a === 'cash') { const d = Math.min(cashCushion, amt); cashCushion -= d; return d; }
      const f = gainsFraction();
      const d = Math.min(taxable, amt);
      taxableAcb = Math.max(0, taxableAcb - d * (1 - f));
      taxable -= d;
      return d;
    },
  };

  // Cross-person transfer landings this run produced: money leaving THIS
  // person's accounts destined for the partner. The household pass injects
  // these into the partner's run as inflows so an inter-spousal transfer is
  // conserved across the household (the partner's run can't compute the net
  // itself — that depends on this person's marginal tax on the draw).
  const crossDeposits: Array<{ age: number; account: 'rrsp' | 'tfsa' | 'taxable' | 'cash'; amount: number; label: string }> = [];

  /**
   * Execute one transfer event for THIS person. Returns a YearCalc.transfers
   * entry when the event moved money in this run's accounts, else null (a
   * pure in/out, or a transfer the partner side handles). `baseGross` is the
   * taxable income already stacked this year (benefits + prior registered
   * draws) so a registered transfer is taxed at the correct marginal rate;
   * pre-retirement this is 0. `deposit`/`withdraw` accumulators are updated so
   * the year's provenance and the accounting identity both see the move.
   */
  const applyTransferEvent = (
    ev: CashEvent,
    baseGross: number,
    yearConfig: AppConfig,
    deposit: { rrsp: number; rrif: number; tfsa: number; taxable: number; cash: number },
    fireAge: number,
  ): { label: string; from: string; to: string; gross: number; tax: number; net: number } | null => {
    const { from, to } = eventEndpoints(ev);
    // We only move money when the SOURCE is one of this person's accounts
    // (the money physically leaves here). External→account inflows are handled
    // by the plain inflow path.
    if (from.kind !== 'account' || from.person !== selfRef) return null;

    const src = from.account;
    const gross = acct.take(src, ev.amount);
    if (gross <= 0) return null;

    // Tax a REGISTERED source: the withdrawal is income, so only the after-tax
    // remainder can be redeposited (the RRSP-meltdown cost). Find the gross
    // registered withdrawal whose after-tax value, stacked on this year's
    // income, lets us land `ev.amount`... but the user specified the GROSS
    // (ev.amount) to move, so tax = incremental tax on that gross, net = the
    // remainder. TFSA/taxable/cash sources are after-tax money (no tax).
    let tax = 0;
    if (src === 'rrsp') {
      const t0 = calculateTax(baseGross, provinceCode, yearConfig).totalTax;
      const t1 = calculateTax(baseGross + gross, provinceCode, yearConfig).totalTax;
      tax = t1 - t0;
    } else if (src === 'taxable') {
      // Realizing the embedded gain on a taxable transfer is taxable at the
      // inclusion rate (the gain portion leaves the account).
      const f = gainsFraction();
      const includedGain = gross * f * inclusion;
      const t0 = calculateTax(baseGross, provinceCode, yearConfig).totalTax;
      const t1 = calculateTax(baseGross + includedGain, provinceCode, yearConfig).totalTax;
      tax = t1 - t0;
    }
    const net = Math.max(0, gross - tax);

    const name = (a: string) => a === 'rrsp' ? 'RRSP' : a === 'tfsa' ? 'TFSA' : a === 'taxable' ? 'Taxable' : 'Cash';
    const who = (p: string) => (p === selfRef ? '' : p === 'primary' ? ' (primary)' : ' (spouse)');

    // An account→EXTERNAL event is a sourced outflow (e.g. "pay for the car
    // from my TFSA"): the money leaves the plan here, nothing is redeposited.
    // Record it so the year shows the draw; the gross already left via acct.take.
    if (to.kind !== 'account') {
      return {
        label: ev.label,
        from: name(src) + who(from.person),
        to: 'Spending (leaves plan)',
        gross,
        tax,
        net,
      };
    }

    // The destination may be the partner's account. This run only tracks THIS
    // person's balances; credit the deposit locally when it's ours, else hand
    // the after-tax net to the household pass to inject into the partner's run.
    if (to.person === selfRef) {
      acct.put(to.account, net);
      if (to.account === 'rrsp') deposit.rrsp += net;
      else if (to.account === 'tfsa') deposit.tfsa += net;
      else if (to.account === 'cash') deposit.cash += net;
      else deposit.taxable += net;
    } else {
      // Stamp the FIRING age, not the event's start age: a recurring transfer
      // (age 65, endAge 70) must land in the partner's run each year 65..70,
      // not all six occurrences in the first year.
      crossDeposits.push({ age: fireAge, account: to.account, amount: net, label: ev.label });
    }

    return {
      label: ev.label,
      from: name(src) + who(from.person),
      to: name(to.account) + who(to.person),
      gross,
      tax,
      net,
    };
  };

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

    // Cash events fire pre-retirement too — a house sale at 51 lands in its
    // account and then grows; an outflow is funded by drawing down accounts in
    // the configured withdrawal order. Pre-retirement the engine models no
    // employment income, so plain in/out draws are tax-free — but a TRANSFER
    // from a registered account is always a taxable RRSP withdrawal (the
    // meltdown), so that path taxes the draw before redepositing the net.
    const accumDeposit = { rrsp: 0, rrif: 0, tfsa: 0, taxable: 0, cash: 0 };
    const accumTransfers: NonNullable<YearCalc['transfers']> = [];
    let accumTransferTax = 0;
    // Registered transfer draws stack as income within the year so a second
    // transfer the same year is taxed at the right marginal rate.
    let accumTransferBaseGross = 0;
    // Inbound inter-spousal transfers land here as after-tax money.
    for (const d of inboundAt(age)) {
      if (d.account === 'rrsp') { rrsp += d.amount; accumDeposit.rrsp += d.amount; }
      else if (d.account === 'tfsa') { tfsa += d.amount; accumDeposit.tfsa += d.amount; }
      else if (d.account === 'cash') { cashCushion += d.amount; accumDeposit.cash += d.amount; }
      else { taxable += d.amount; taxableAcb += d.amount; accumDeposit.taxable += d.amount; }
    }
    const yearEvents = eventsAt(age).map(eventLine);
    let accumEventOut = 0;
    for (const ev of eventsAt(age)) {
      // Transfer events move money account→account; handle them separately.
      if (ev.from || ev.to) {
        const t = applyTransferEvent(ev, accumTransferBaseGross, configAt(age), accumDeposit, age);
        if (t) {
          accumTransfers.push(t);
          accumTransferTax += t.tax;
          accumTransferBaseGross += t.gross; // stack this draw's income for the next transfer
        }
        continue;
      }
      if (ev.direction === 'in') {
        const dest = ev.account ?? 'taxable';
        if (dest === 'rrsp') { rrsp += ev.amount; accumDeposit.rrsp += ev.amount; }
        else if (dest === 'tfsa') { tfsa += ev.amount; accumDeposit.tfsa += ev.amount; }
        else if (dest === 'cash') { cashCushion += ev.amount; accumDeposit.cash += ev.amount; }
        else { taxable += ev.amount; taxableAcb += ev.amount; accumDeposit.taxable += ev.amount; }
      } else {
        accumEventOut += ev.amount;
        let remaining = ev.amount;
        for (const acct of order) {
          if (remaining <= 0) break;
          if (acct === 'taxable') {
            const draw = Math.min(taxable, remaining);
            // Reduce ACB by the principal portion so the gains fraction stays
            // correct for later (post-retirement) taxable draws.
            if (draw > 0) {
              const f = gainsFraction();
              taxableAcb = Math.max(0, taxableAcb - draw * (1 - f));
              taxable -= draw;
              remaining -= draw;
            }
          } else if (acct === 'tfsa') {
            const draw = Math.min(tfsa, remaining);
            tfsa -= draw; remaining -= draw;
          } else if (acct === 'rrsp') {
            const draw = Math.min(rrsp, remaining);
            rrsp -= draw; remaining -= draw;
          }
        }
        if (remaining > 0) cashCushion = Math.max(0, cashCushion - remaining);
      }
    }

    // A registered transfer draw is a taxable RRSP withdrawal even before
    // retirement (the meltdown tax). Track it in the year's tax so the
    // accounting identity and cumulative totals stay honest.
    cumulativeTax += accumTransferTax;

    yearlyBreakdown.push({
      age,
      startingBalance: startingTotal,
      contributions: rrspContribution + tfsaContribution + taxableContribution,
      marketGains: rrspGains + tfsaGains + taxableGains + cashGains,
      withdrawals: accumEventOut + accumTransfers.reduce((s, t) => s + t.gross, 0),
      incomeTax: accumTransferTax,
      cumulativeTax,
      spendingTarget: accumEventOut,
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
        deposit: accumDeposit,
        tax: { oasClawback: 0, capitalGains: 0, registeredGross: accumTransferBaseGross },
        ...(rmOn ? { rm: { interestAccrued: accRmInterest, scheduledDraw: accRmScheduled, topUpDraw: 0, homeValue, loanBalance: rmLoan } } : {}),
        events: yearEvents,
        // Pre-retirement transfers: surface on the math page too. There is no
        // full YearCalc pipeline pre-retirement, so attach a minimal calc.
        ...(accumTransfers.length > 0 ? { calc: {
          cppMonthlyAtStart: 0, otherGross: 0, netBenefits: 0, neededAfterTax: 0,
          rrifMinNet: 0, rrifMinExcess: 0,
          needAfterBenefits: 0, needAfterRrifMin: 0, needAfterGis: 0,
          needAfterDraws: 0, needAfterCash: 0, needFinal: 0,
          gainsFraction: gainsFraction(), taxableAcb,
          totalNetIncome: accumTransferBaseGross, taxOnBenefits: 0,
          transfers: accumTransfers,
        } } : {}),
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
    const yearEvents = eventsAt(age).map(eventLine);

    // Cash-event inflows land at the start of the year (before withdrawals).
    // Transfers are handled further down, once benefit income is known (their
    // registered draws stack on it for tax).
    const deposit = { rrsp: 0, rrif: 0, tfsa: 0, taxable: 0, cash: 0 };
    for (const ev of eventsAt(age)) {
      if (ev.from || ev.to) continue; // transfer — processed below
      if (ev.direction !== 'in') continue;
      const dest = ev.account ?? 'taxable';
      if (dest === 'rrsp') { rrsp += ev.amount; deposit.rrsp += ev.amount; }
      else if (dest === 'tfsa') { tfsa += ev.amount; deposit.tfsa += ev.amount; }
      else if (dest === 'cash') { cashCushion += ev.amount; deposit.cash += ev.amount; }
      else { taxable += ev.amount; taxableAcb += ev.amount; deposit.taxable += ev.amount; }
    }
    // Inbound inter-spousal transfers (the partner's cross-deposits) land here
    // as after-tax money, at the start of the year.
    for (const d of inboundAt(age)) {
      if (d.account === 'rrsp') { rrsp += d.amount; deposit.rrsp += d.amount; }
      else if (d.account === 'tfsa') { tfsa += d.amount; deposit.tfsa += d.amount; }
      else if (d.account === 'cash') { cashCushion += d.amount; deposit.cash += d.amount; }
      else { taxable += d.amount; taxableAcb += d.amount; deposit.taxable += d.amount; }
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

    // Employment income: earned, so it stacks for tax like the benefits and is
    // taxed in the year it's earned (regardless of what the money is then used
    // for). Split by mode: top-up net covers spending first (RM-style), save
    // net is deposited into its account below.
    let employmentTopUpGross = 0;
    let employmentSaveGross = 0;
    const employmentSaveActive: EmploymentIncome[] = [];
    for (const e of employmentList) {
      if (age < e.startAge || age > e.endAge) continue;
      const amt = e.annualAmount * (e.indexedToCpi && indexTables ? factorAt(age) : 1);
      if (e.topUpSpending) employmentTopUpGross += amt;
      else { employmentSaveGross += amt; employmentSaveActive.push(e); }
    }
    const employmentGross = employmentTopUpGross + employmentSaveGross;
    const otherGrossNoEmployment = cppGross + oasGross + pensionGross;
    const employmentTax = employmentGross > 0
      ? Math.max(0,
          calculateTax(otherGrossNoEmployment + employmentGross, provinceCode, yearConfig).totalTax
          - calculateTax(otherGrossNoEmployment, provinceCode, yearConfig).totalTax)
      : 0;
    const employmentNet = employmentGross - employmentTax;
    // Apportion the net between the two modes pro-rata to their gross.
    const employmentTopUpNet = employmentGross > 0 ? employmentNet * (employmentTopUpGross / employmentGross) : 0;
    const employmentSaveNet = employmentGross > 0 ? employmentNet * (employmentSaveGross / employmentGross) : 0;

    const otherGross = cppGross + oasGross + pensionGross;
    // For all marginal-rate math below, benefits and employment stack together:
    // a registered draw or realized gain lands on TOP of the year's wages, so
    // grossing up on benefits alone would under-estimate withdrawal tax.
    const stackBase = otherGross + employmentGross;

    // After-tax value of the benefits on their own (employment taxed above).
    const netBenefits = calculateTax(otherGross, provinceCode, yearConfig).takeHome;

    // What the portfolio must supply after tax so total take-home = spending.
    // Top-up employment covers part of the need before the portfolio is drawn.
    const neededAfterTax = Math.max(0, yearSpending - netBenefits - employmentTopUpNet);

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

    // Transfer events (account→account / inter-spousal): the RRSP meltdown and
    // friends. A registered source is a taxable withdrawal — we take the gross,
    // estimate the incremental tax on it (stacked on benefits + any draws so
    // far), redeposit the after-tax net into the destination, and add the gross
    // to registeredGross so the year's unified tax figure taxes it exactly once
    // (the estimate is for the redeposit amount and the math-page display).
    // Runs before the spending draws so the transfer's income stacks beneath
    // them. The destination landing in THIS person's accounts is credited now;
    // an inter-spousal landing is mirrored by the household pass.
    for (const ev of eventsAt(age)) {
      if (!(ev.from || ev.to)) continue;
      const t = applyTransferEvent(ev, stackBase + registeredGross, yearConfig, deposit, age);
      if (!t) continue;
      (calc.transfers ??= []).push(t);
      const a = ev.from?.kind === 'account' ? ev.from.account : null;
      if (a === 'rrsp') {
        // Registered source: gross is taxable income (taxed once in the
        // year-end unified figure) and counts as a registered withdrawal.
        registeredGross += t.gross;
        wd.rrsp += t.gross;
        actualWithdrawals += t.gross;
      } else if (a === 'tfsa') { wd.tfsa += t.gross; actualWithdrawals += t.gross; }
      else if (a === 'taxable') {
        // A taxable transfer realizes the embedded gain just like a taxable
        // spending draw: add it to capitalGains so the year's unified tax,
        // GIS and OAS clawback all see it (and the math page doesn't report
        // zero tax while the estimate already left the balances).
        wd.taxable += t.gross;
        actualWithdrawals += t.gross;
        capitalGains += t.gross * gainsFraction();
      }
      else if (a === 'cash') { wd.cash += t.gross; actualWithdrawals += t.gross; }
    }

    // 1. Mandatory RRIF minimum — forced out first. After-tax excess over the
    //    spending need is redeposited into taxable (still withdrawn & taxed).
    if (isRrifMandatory(age, config) && rrif > 0) {
      const minimum = calculateRrifMinimum(age, rrif, config);
      rrif -= minimum;
      actualWithdrawals += minimum;
      registeredGross += minimum;
      wd.rrifMin += minimum;

      const netFromRrif = calculateTax(minimum + stackBase, provinceCode, yearConfig).takeHome
        - calculateTax(stackBase, provinceCode, yearConfig).takeHome;
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
    // employment + any RRIF minimum). Additional registered draws are taxed on
    // top of it.
    const stackedGross = () => stackBase + registeredGross;

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
          cppGross + pensionGross + employmentGross + sp.fixed,
          sp.hasOas,
          yearConfig
        );
      }
      return gisAnnual(stackBase + registeredGross + capitalGains - oasGross, yearConfig);
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

    // Employment net is saved. Save-mode net goes to its account directly;
    // top-up net that exceeded the year's spending need is saved too (the
    // rest already displaced withdrawals). Deposit at end of year, after
    // withdrawals, as after-tax money.
    {
      const afterBenefits = Math.max(0, yearSpending - netBenefits);
      const topUpExcess = Math.max(0, employmentTopUpNet - afterBenefits);
      // Save-mode: split the save net across active save jobs by gross share.
      const perJob: Array<{ e: EmploymentIncome; net: number }> = [];
      for (const e of employmentSaveActive) {
        const g = e.annualAmount * (e.indexedToCpi && indexTables ? factorAt(age) : 1);
        perJob.push({ e, net: employmentSaveGross > 0 ? employmentSaveNet * (g / employmentSaveGross) : 0 });
      }
      const depositEmployment = (e: EmploymentIncome, amt: number) => {
        if (amt <= 0) return;
        if (e.destAccount === 'rrsp') { rrsp += amt; deposit.rrsp += amt; }
        else if (e.destAccount === 'tfsa') { tfsa += amt; deposit.tfsa += amt; }
        else if (e.destAccount === 'cash') { cashCushion += amt; deposit.cash += amt; }
        else { taxable += amt; taxableAcb += amt; deposit.taxable += amt; }
      };
      for (const { e, net } of perJob) depositEmployment(e, net);
      // Top-up excess goes to the first top-up job's account (or taxable).
      if (topUpExcess > 0) {
        const firstTopUp = employmentList.find(e => e.topUpSpending && age >= e.startAge && age <= e.endAge);
        if (firstTopUp) depositEmployment(firstTopUp, topUpExcess);
        else { taxable += topUpExcess; taxableAcb += topUpExcess; deposit.taxable += topUpExcess; }
      }
    }

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

    // Single consistent tax figure: total tax on (benefits + employment +
    // registered withdrawals) minus tax on (benefits + employment) alone, plus
    // the OAS recovery tax (clawback) when total net income crosses the
    // threshold. Employment is taxed exactly once: it's inside totalNetIncome
    // (so brackets and clawback see it) and its marginal share — this figure
    // minus what a no-employment year would report — equals employmentTax.
    const totalNetIncome = otherGross + employmentGross + registeredGross + capitalGains * inclusion;
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
      totalTaxPaid: calculateTax(totalNetIncome, provinceCode, yearConfig).totalTax + oasClawback,
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
      employmentGross,
      employmentTax,
      employmentNet,
      splitEligibleIncome,
      unsplitNetIncome,
      detail: {
        withdraw: wd,
        growth: { rrsp: rrspGains, rrif: rrifGains, tfsa: tfsaGains, taxable: taxableGains, cash: cashGains },
        deposit,
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
    retirementAge,
    ...(crossDeposits.length > 0 ? { crossDeposits } : {}),
  };

  return primary;
}

/**
 * Legacy adapter: run the PRIMARY person's plan from a legacy RetirementInputs
 * (which flattens the person and the household-shared fields together). New
 * code should call calculatePerson with an explicit person + shared. This keeps
 * the many existing consumers (storage, share links, Monte Carlo, solvers)
 * working unchanged while the unified model is adopted. NOTE: this runs only
 * the primary person — it ignores inputs.spouse; use calculateHousehold for a
 * couple.
 */
export function calculateRetirement(
  inputs: RetirementInputs,
  config: AppConfig,
  options?: Parameters<typeof calculatePerson>[3]
): RetirementResults {
  return calculatePerson(legacyToPerson(inputs), legacyToShared(inputs), config, options);
}

/**
 * Top-level entry point. Derives each person's plan from the (possibly legacy)
 * inputs and runs both as full persons — giving the spouse feature parity
 * (their own events, spending bands, reverse mortgage). The two runs exchange
 * benefit context so GIS is assessed on COMBINED non-OAS income at the correct
 * (couple vs single) rate — CRA's couple rules. Pension-splitting is applied
 * as a post-pass, and the household verdict reads the combined breakdown.
 */
export function calculateHousehold(
  inputs: RetirementInputs,
  config: AppConfig,
  options?: { returnSequence?: Record<number, number> }
): RetirementResults {
  const shared = legacyToShared(inputs);
  const primaryPerson = legacyToPerson(inputs);
  const sp = inputs.spouse?.enabled ? legacySpouseToPerson(inputs.spouse) : undefined;

  const primaryCtx = sp ? {
    cppStartAge: sp.cppStartAge,
    cppMonthlyAmount: sp.cppMonthlyAmount,
    oasStartAge: sp.oasStartAge,
    oasYearsInCanada: sp.oasYearsInCanada,
    currentAge: sp.currentAge,
    pensions: sp.pensions,
    employment: sp.employment,
  } : undefined;

  // --- Re-home mis-filed transfer events -----------------------------------
  // A transfer event FIRES only in the run of the person its money leaves
  // (applyTransferEvent requires from.person === selfRef). A transfer authored
  // on person A's event list but sourced from person B's account would
  // otherwise never fire: A's run skips it (not the source) and B's run never
  // sees A's events. Re-home it: hand each person the partner's transfer events
  // whose explicit `from` names THIS person, translated onto this person's age
  // axis. The destination landing is handled by the cross-deposit pass below,
  // so a re-homed transfer still conserves household money.
  // Events authored on `owner`'s list that are sourced from `selfRef`'s
  // accounts, re-stamped from the owner's age axis onto selfRef's. The age the
  // author picked is a CALENDAR intent; convert via the current-age gap.
  const rehome = (
    ownerEvents: CashEvent[] | undefined,
    ownerCurrentAge: number,
    selfRef: 'primary' | 'spouse',
    selfCurrentAge: number,
  ): CashEvent[] => (ownerEvents ?? [])
    .filter(e => e.from && e.from.kind === 'account' && e.from.person === selfRef)
    .map(e => ({
      ...e,
      // owner-age → calendar-year → self-age (same convention as `translate`).
      age: e.age - (ownerCurrentAge - selfCurrentAge),
      // Recurring events carry endAge on the same axis; shift it too.
      ...(e.endAge != null ? { endAge: e.endAge - (ownerCurrentAge - selfCurrentAge) } : {}),
    }));

  const primaryRun: PersonInputs = sp
    ? { ...primaryPerson, events: [...(primaryPerson.events ?? []), ...rehome(sp.events, sp.currentAge, 'primary', primaryPerson.currentAge)] }
    : primaryPerson;

  const primary = calculatePerson(primaryRun, shared, config, {
    ...options,
    personRef: 'primary',
    ...(primaryCtx ? { spouseContext: primaryCtx } : {}),
  });

  if (sp) {
    // The spouse's effective events: their own, plus any transfers the primary
    // authored that pull FROM the spouse's accounts (re-homed onto the spouse's
    // age axis).
    const spRun: PersonInputs = {
      ...sp,
      events: [...(sp.events ?? []), ...rehome(primaryPerson.events, primaryPerson.currentAge, 'spouse', sp.currentAge)],
    };

    // Age translation for inter-spousal transfers: a cross-deposit stamped at
    // the SOURCE's age lands in the partner at the same CALENDAR year, which
    // on the partner's age axis is source-age minus the current-age gap.
    const translate = (
      deposits: NonNullable<RetirementResults['crossDeposits']>,
      fromCurrentAge: number,
      toCurrentAge: number,
    ) => deposits.map(d => ({ ...d, age: d.age - (fromCurrentAge - toCurrentAge) }));

    // Run the spouse, injecting any primary→spouse transfer landings (after-tax).
    const pToS = translate(primary.crossDeposits ?? [], primaryPerson.currentAge, sp.currentAge);
    let spouseResults = calculatePerson(spRun, shared, config, {
      ...options,
      personRef: 'spouse',
      spouseContext: {
        cppStartAge: primaryPerson.cppStartAge,
        cppMonthlyAmount: primaryPerson.cppMonthlyAmount,
        oasStartAge: primaryPerson.oasStartAge,
        oasYearsInCanada: primaryPerson.oasYearsInCanada,
        currentAge: primaryPerson.currentAge,
        pensions: primaryPerson.pensions,
        employment: primaryPerson.employment,
      },
      ...(pToS.length > 0 ? { inboundDeposits: pToS } : {}),
    });

    // If the spouse ALSO sent transfers back to the primary, re-run the primary
    // with those injected (one extra pass; transfers are typically defined on
    // one person's events, so this converges without ping-pong).
    const sToP = translate(spouseResults.crossDeposits ?? [], sp.currentAge, primaryPerson.currentAge);
    let finalPrimary = primary;
    if (sToP.length > 0) {
      finalPrimary = calculatePerson(primaryRun, shared, config, {
        ...options,
        personRef: 'primary',
        ...(primaryCtx ? { spouseContext: primaryCtx } : {}),
        inboundDeposits: sToP,
      });
      // The primary's re-run may have changed its own cross-deposits to the
      // spouse; re-inject and re-run the spouse once more for consistency.
      const pToS2 = translate(finalPrimary.crossDeposits ?? [], primaryPerson.currentAge, sp.currentAge);
      spouseResults = calculatePerson(spRun, shared, config, {
        ...options,
        personRef: 'spouse',
        spouseContext: {
          cppStartAge: primaryPerson.cppStartAge,
          cppMonthlyAmount: primaryPerson.cppMonthlyAmount,
          oasStartAge: primaryPerson.oasStartAge,
          oasYearsInCanada: primaryPerson.oasYearsInCanada,
          currentAge: primaryPerson.currentAge,
          pensions: primaryPerson.pensions,
          employment: primaryPerson.employment,
        },
        ...(pToS2.length > 0 ? { inboundDeposits: pToS2 } : {}),
      });
    }

    finalPrimary.spouse = spouseResults;
    if (spouseResults.status === 'SHORTFALL') finalPrimary.status = 'SHORTFALL';
    applyPensionSplitting(finalPrimary, spouseResults, inputs, config, sp.currentAge);
    return finalPrimary;
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

  // An INTER-SPOUSAL transfer shows up as a withdrawal in the sender's row but
  // its landing is not a withdrawal in the receiver's row — so summing the two
  // `withdrawals` counts the moved money as if it left the household, and the
  // combined row stops reconciling (start + gains − withdrawals ≠ end). Net
  // those internal moves back out. After-tax, so sender-gross ≥ receiver-net;
  // the difference is meltdown tax, which leaves the household via incomeTax.
  const transferNetAt = (y: YearlyBreakdown, ref: 'primary' | 'spouse'): number => {
    const ts = y.detail?.calc?.transfers;
    if (!ts) return 0;
    let n = 0;
    for (const t of ts) {
      if (ref === 'primary' && t.to.includes('(spouse)')) n += t.net;
      if (ref === 'spouse' && t.to.includes('(primary)')) n += t.net;
    }
    return n;
  };

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
    // Both partners' internal sends are removed once: a one-way transfer is
    // counted once, a two-way pair is removed on both sides. Result: the
    // combined row reconciles (start + gains − externalWithdrawals = end,
    // modulo the meltdown tax already in incomeTax).
    const internal = transferNetAt(py, 'primary') + transferNetAt(sy, 'spouse');
    return {
      age: py.age,
      startingBalance: py.startingBalance + sy.startingBalance,
      contributions: py.contributions + sy.contributions,
      marketGains: py.marketGains + sy.marketGains,
      withdrawals: py.withdrawals + sy.withdrawals - internal,
      incomeTax: py.incomeTax + sy.incomeTax,
      totalTaxPaid: (py.totalTaxPaid ?? 0) + (sy.totalTaxPaid ?? 0),
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
      employmentGross: (py.employmentGross ?? 0) + (sy.employmentGross ?? 0),
      employmentTax: (py.employmentTax ?? 0) + (sy.employmentTax ?? 0),
      employmentNet: (py.employmentNet ?? 0) + (sy.employmentNet ?? 0),
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
    // Total tax on all income moves by the same delta as the incremental figure
    // (the split reallocates income; total burden changes identically).
    py.totalTaxPaid = (py.totalTaxPaid ?? 0) + (pNewBurden - pOldBurden);
    sy.totalTaxPaid = (sy.totalTaxPaid ?? 0) + (sNewBurden - sOldBurden);
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
