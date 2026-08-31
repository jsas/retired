import type { AppConfig } from './appConfig';
import {
  calculateTax,
  findGrossIncomeForTakeHome,
  calculateRrifMinimum,
  isRrifMandatory,
  oasAnnualGross,
  gisAnnual,
  gisAnnualCouple,
  indexConfig,
  selfEmployedCppContribution
} from './canadianTax';
import {
  legacyToPerson,
  legacyToShared,
  eventEndpoints,
  toHousehold,
  enabledPeople,
  type Household,
  type PersonInputs,
  type SharedInputs,
} from './householdTypes';

export type WithdrawalAccount = 'rrsp' | 'tfsa' | 'taxable' | 'rdsp';

// ---------------------------------------------------------------------------
// Income register (issue #24, Phase 1)
// ---------------------------------------------------------------------------

/**
 * The tax character of one income source. This drives how the engine treats
 * the source: earned kinds (employment / self-employment) build RRSP room and
 * stack for tax like wages; pension is eligible for pension-splitting and
 * carries a pension adjustment that reduces RRSP room; rental is taxable
 * investment income (no RRSP room, no pension-splitting). All four kinds are
 * live in the engine (issue #119).
 */
export type IncomeKind = 'employment' | 'pension' | 'selfEmployment' | 'rental';

/**
 * One source of a person's income — the unified register that replaces the
 * separate `pensions[]` and `employment[]` arrays. Every source has an amount,
 * an active window, and an indexation flag; the KIND carries the tax character
 * and any kind-specific behaviour.
 *
 * endAge convention: `null` = lifetime (the common case for pensions). Earned
 * kinds (employment/selfEmployment) should set a finite endAge — working
 * forever is rarely intended — but the field stays nullable uniformly so the
 * register has one shape; a null endAge on an earned kind simply runs to the
 * horizon.
 */
export interface IncomeSource {
  id: string;
  label: string;
  kind: IncomeKind;
  annualAmount: number;            // gross $/yr at startAge, today's dollars
  startAge: number;
  endAge: number | null;           // null = lifetime
  indexedToCpi: boolean;
  // Earned kinds only: where the after-tax net is saved in save-mode, and
  // whether the source tops up spending first (RM-style) instead of saving.
  destAccount?: 'rrsp' | 'tfsa' | 'taxable' | 'cash';
  topUpSpending?: boolean;
  // Earned kinds only: the share of the after-tax net that is SAVED each year
  // (0–1); the rest is assumed consumed by working-year living costs, which the
  // model doesn't track. Unset = 1 (save the whole net) so existing scenarios
  // are unchanged. Applies in BOTH phases: before retirement it is the only way
  // earned income enters the plan at all (issue #119).
  savingsRate?: number;
  // Pension kind only (Phase 2 room tracking): whether this pension's pension
  // adjustment (PA) reduces RRSP room, and the annual PA dollars. Default 0.
  rrspEligible?: boolean;
  pensionAdjustment?: number;
}

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
  // Contribution room (issue #24 Phase 2): the CRA notice-of-assessment dollars
  // available to contribute TODAY. `null`/absent = unlimited (enforcement off —
  // the pre-#24 behaviour, so existing scenarios are unchanged); a number turns
  // enforcement on: registered deposits are capped at remaining room and the
  // excess spills to taxable. Room accrues each year (TFSA: +annual limit;
  // RRSP: +18% of earned income, capped) and TFSA withdrawals re-add room the
  // following year.
  tfsaRoom?: number | null;
  rrspRoom?: number | null;
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
  // The person's income register: DB/bridge pensions (kind 'pension') and
  // semi-/post-retirement work (kind 'employment') — see IncomeSource. This
  // replaces the legacy separate `pensions[]`/`employment[]` arrays (older
  // payloads are migrated to `income[]` on load). Absent/empty = no income
  // beyond CPP/OAS.
  income?: IncomeSource[];
  // Optional reverse mortgage: borrow against home equity via scheduled draws
  // and/or a last-resort top-up. Proceeds are tax-free (no GIS/clawback impact);
  // the loan compounds against the home and erodes net equity.
  reverseMortgage?: ReverseMortgage;
  // Registered Disability Savings Plan — the primary person is the beneficiary.
  // Optional; absent = no RDSP.
  rdsp?: RdspInputs;
  // First Home Savings Account — the primary person's FHSA. Optional; absent =
  // no FHSA. Accumulation-only (never enters the withdrawal order).
  fhsa?: FhsaInputs;
  // The person's debts: mortgage, credit cards, car/student/personal loans,
  // lines of credit. Each compounds at its own rate and is serviced out of
  // cash flow (added to the year's spending need), so it drags on the plan
  // until paid off. Absent/empty = debt-free.
  debts?: Debt[];
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
  // Contribution room (issue #24 Phase 2) — same semantics as the primary's:
  // null/absent = unlimited, a number turns enforcement on.
  tfsaRoom?: number | null;
  rrspRoom?: number | null;
  cppStartAge: number | null;
  cppMonthlyAmount: number; // age-65 amount; adjustment applied
  oasStartAge: number | null;
  oasYearsInCanada: number;
  desiredSpending: number; // the spouse's own after-tax income goal (today's $)
  withdrawalOrder?: WithdrawalAccount[];
  income?: IncomeSource[]; // the spouse's own income register (pensions + work)
  // Full-person parity fields. Optional so scenarios saved before the spouse
  // carried them still parse; absent = none (an empty list / no reverse
  // mortgage). These make the spouse a first-class person: their own one-time
  // cash events (incl. transfers), go-go/slow-go/no-go spending phases, and a
  // reverse mortgage all flow into their run exactly like the primary's.
  events?: CashEvent[];
  spendingBands?: SpendingBand[];
  reverseMortgage?: ReverseMortgage;
  // The spouse's own RDSP (they are the beneficiary). Optional; absent = none.
  rdsp?: RdspInputs;
  // The spouse's own FHSA. Optional; absent = none.
  fhsa?: FhsaInputs;
  // The spouse's own debts. Optional; absent = none.
  debts?: Debt[];
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
  // Product type. 'reverse' (default): interest COMPOUNDS into the loan and the
  //   balance is hard-capped at maxLtv × home value (the Canadian "no negative
  //   equity guarantee"). 'heloc': the year's interest is PAID as a cash-flow
  //   expense (added to spending) instead of compounding, and there is no
  //   negative-equity guarantee — the balance is NOT clamped at the LTV ceiling
  //   (draws still stop at it, but interest is paid so it doesn't grow past).
  //   Absent = 'reverse' (back-compat with plans saved before the toggle).
  mode?: 'reverse' | 'heloc';
  // Loan-to-value ceiling: borrowing (both scheduled draws and top-up) stops
  // once the loan reaches maxLtv × current home value. Lenders typically cap
  // reverse mortgages near 0.55. Defaults to 0.55 when omitted.
  maxLtv?: number;
  // Scheduled draws: amount/yr (today's dollars, CPI-indexed like spending)
  // from startAge for durationYears. Optional — combine with top-up or use alone.
  // Convention: `startAge`/`durationYears` are OPTIONAL — omit them entirely
  // (never pass an explicit `null`, which the schema rejects) when no schedule
  // is wanted. Contrast with IncomeSource.endAge above, which is the opposite
  // contract: required, with an explicit `null` meaning "lifetime".
  drawAmount?: number;
  startAge?: number;
  durationYears?: number;
  // Top-up mode: after every account is drained, borrow just enough each year
  // to cover the remaining spending need (the true last resort).
  topUp?: boolean;
}

export interface SpendingBand {
  fromAge: number;      // applies from this age until the next band
  pctOfBase: number;    // 0..1+ fraction of desiredSpending (e.g. 1, 0.85, 0.7)
}

/**
 * A Registered Disability Savings Plan. Per-person (a beneficiary holds their
 * own RDSP). The account is tax-SHELTERED (not deductible on the way in, like a
 * TFSA) but unlike a TFSA the grant/bond/growth portion is TAXABLE on the way
 * out — only the contribution principal comes back tax-free. Grants (CDSG) and
 * bonds (CDSB) are paid on income-tested rules driven by `familyIncome`.
 * Parameters (thresholds, caps, end ages) live in config.rdsp. Absent = the
 * person has no RDSP.
 */
export interface RdspInputs {
  enabled: boolean;
  balance: number;          // current RDSP market value, today's dollars
  contribution: number;     // planned contribution $/yr while accumulating (pre-retirement)
  // Annual family income used for the CDSG/CDSB income tests, today's dollars.
  // For a beneficiary 19+ that's their own + spouse's income (the app uses the
  // current year's; CRA actually reads the return from 2 years prior). Indexed
  // with CPI when indexTaxTables is on, like other income figures.
  familyIncome: number;
  // Basis already in the account: how much of `balance` is after-tax
  // CONTRIBUTION principal (vs grant/bond/growth). Used to split withdrawals
  // into the tax-free (contribution) and taxable (grant/bond/growth) portions.
  // Defaults to `balance` when omitted (a pre-existing balance is assumed to be
  // all contributed principal — the common case for a plan opened years ago).
  contributionBasis?: number;
  dtcEligible: boolean;     // Disability Tax Credit eligible — required to hold/receive grants & bonds
}

/**
 * A First Home Savings Account. Per-person. Contributions are DEDUCTIBLE (like
 * an RRSP — they reduce taxable income in the contribution year), growth is
 * tax-sheltered, and a qualifying first-home withdrawal is tax-free. This
 * engine models the ACCUMULATION side only: the FHSA never enters the
 * retirement withdrawal order, and at the retirement boundary any remaining
 * balance is assumed transferred to the RRSP (the no-qualifying-home path —
 * CRA allows a direct FHSA→RRSP/RRIF transfer with no contribution room
 * required). Parameters (annual/lifetime limits, lifespan) live in config.fhsa.
 * Absent = the person has no FHSA.
 */
export interface FhsaInputs {
  enabled: boolean;
  balance: number;          // current FHSA market value, today's dollars
  contribution: number;     // planned contribution $/yr (capped at config.fhsa.annualLimit)
  // Contributions already made toward the LIFETIME limit (so a plan opened a
  // few years ago carries its prior contributions). Defaults to `balance` when
  // omitted — a pre-existing balance is assumed to be all contributed principal.
  contributionBasis?: number;
  openAge?: number;         // age the account was opened; the 15-year clock runs from here
}

/**
 * One liability a person carries — the unified debt register. A mortgage is
 * just a debt with `kind: 'mortgage'` (its payment ends at payoff, freeing the
 * biggest cash flow). The engine compounds the balance at `interestRate` each
 * year and services the debt out of cash flow: the year's payments are added
 * to that year's spending need (funded from accounts like any other expense),
 * so a debt drags on the plan until it's paid off. Payments are after-tax
 * money, so they never touch taxable income, GIS, or the OAS clawback.
 *
 * A debt is active from `startAge` (default the current age) until the balance
 * reaches $0 — or until `endAge` if one is set (an explicit amortization end,
 * e.g. a mortgage "paid off at 68"). The payment is capped at the remaining
 * balance each year, so the final year pays less and the debt then stops.
 */
export interface Debt {
  id: string;
  label: string;              // "Mortgage", "Credit card", "Car loan"
  kind: 'mortgage' | 'creditCard' | 'loan' | 'lineOfCredit' | 'other';
  balance: number;            // principal outstanding today (today's dollars)
  interestRate: number;       // annual rate charged on the balance (e.g. 0.051)
  monthlyPayment: number;     // fixed payment, today's dollars
  startAge?: number;          // when payments start (default: current age)
  endAge?: number | null;     // explicit stop-age override; absent/null = until paid off
}

export interface AccountBreakdown {
  age: number;
  rrspBalance: number;
  rrifBalance: number;
  tfsaBalance: number;
  taxableBalance: number;
  cashCushionBalance: number;
  rdspBalance?: number; // undefined when the person has no RDSP
  fhsaBalance?: number;  // undefined when the person has no FHSA
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
  withdraw: { rrifMin: number; rrif: number; rrsp: number; tfsa: number; taxable: number; cash: number; rmDraw: number; rdsp?: number };
  // Market growth / interest earned per account this year (before it's added).
  growth: { rrsp: number; rrif: number; tfsa: number; taxable: number; cash: number; rdsp?: number; fhsa?: number };
  // Contributions per account (accumulation years only).
  contrib?: { rrsp: number; tfsa: number; taxable: number; rdsp?: number; fhsa?: number };
  // RDSP flow this year, when the account exists. contribution/grant/bond are
  // deposits; growth is the year's sheltered growth; balance/contributionBasis
  // are year-end. taxableFraction is the share of any withdrawal that is
  // taxable (grant + bond + growth). withdrawal is the gross drawn this year
  // (decumulation); of that, taxablePortion is taxable income and the rest is
  // the tax-free return of contribution principal.
  rdsp?: {
    contribution: number; grant: number; bond: number; growth: number;
    balance: number; contributionBasis: number; taxableFraction: number;
    withdrawal?: number; taxablePortion?: number;
  };
  // FHSA flow this year, when the account exists. contribution is the year's
  // (deductible) deposit; growth is the year's sheltered growth; balance and
  // contributionBasis are year-end. Accumulation-only — never withdrawn in the
  // plan, so no taxable-fraction split is needed.
  fhsa?: {
    contribution: number; growth: number; balance: number; contributionBasis: number;
  };
  // Deposit provenance — gross dollars that LANDED in each account this year
  // from cash events and transfers (inflows + the redeposit side of a
  // transfer). Symmetric to `withdraw` so both ends of a transfer are visible
  // and the year's accounting reconciles on the math page. Optional so older
  // fixtures compile; the engine always sets it.
  deposit?: { rrsp: number; rrif: number; tfsa: number; taxable: number; cash: number };
  // Contribution-room overflow (issue #24): the dollars that WOULD have landed
  // in a registered account this year but were redirected to taxable because
  // the account's remaining room ran out. Only present when room tracking is
  // on (tfsaRoom/rrspRoom set) and an overflow actually occurred.
  overflow?: { tfsa: number; rrsp: number };
  // Remaining contribution room at year END (after this year's accrual and all
  // capped deposits), for each account being tracked. Absent for an account
  // whose room is unlimited (null). Lets the agent/UI answer "room left in
  // year X" without re-deriving the ledger.
  roomRemaining?: { tfsa?: number; rrsp?: number };
  // Tax decomposition for the year's withdrawals.
  tax: { oasClawback: number; capitalGains: number; registeredGross: number };
  // Reverse mortgage / HELOC, when enabled. interestAccrued is the year's
  // interest; in HELOC mode that interest is PAID (interestExpense, added to
  // spending) rather than compounded into the loan.
  rm?: { interestAccrued: number; scheduledDraw: number; topUpDraw: number; homeValue: number; loanBalance: number; interestExpense?: number };
  // Per-debt flow this year, when the person has debts. interestAccrued is the
  // year's interest charge; payment is what was actually serviced (capped at
  // the balance); balanceEnd is the principal outstanding at year end.
  debts?: Array<{ label: string; kind: Debt['kind']; interestAccrued: number; payment: number; balanceEnd: number }>;
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
  // RDSP balance (undefined when the person has no RDSP). Included in the
  // ending/total balance; the grant/bond/growth portion is taxable on withdrawal.
  rdspBalance?: number;
  // FHSA balance (undefined when the person has no FHSA). Included in the
  // ending/total balance; accumulation-only — transferred to the RRSP at the
  // retirement boundary, never drawn in the plan.
  fhsaBalance?: number;
  cppIncome: number;
  oasIncome: number;
  gisIncome: number;
  pensionIncome: number; // DB / bridge pension gross income this year (taxable)
  // Rental (taxable investment income) gross this year. Reported separately
  // from pensionIncome because rental is NOT eligible for pension-splitting.
  // Optional so older fixtures compile; the engine sets it (0 when no rental).
  rentalIncome?: number;
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
  // Debts (undefined when the person has none). debtPayments is the total
  // serviced out of cash flow this year (added to the spending need);
  // debtBalance is the total principal outstanding at year end.
  debtPayments?: number;
  debtBalance?: number;
  // Pension-splitting inputs, captured per-year so the household pass can
  // recompute tax with a split applied. Undefined for singles.
  splitEligibleIncome?: number; // DB pensions + registered draws (registered only from age 65) — NOT CPP/OAS
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
  // This person's non-OAS draw income per their own age (registered draws +
  // realized capital gains + RDSP taxable portion) — the exact base their GIS
  // reduction used. The household pass hands it to the partner's run so couple
  // GIS is assessed on the FULL combined income (issue #26). A plain record
  // (age → dollars) so results stay JSON/clone-safe. Undefined when a caller
  // ran the person standalone without a spouse context.
  householdDraws?: Record<number, number>;
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

// ---------------------------------------------------------------------------
// RDSP (Registered Disability Savings Plan) — grants & bonds
// ---------------------------------------------------------------------------

/**
 * Canada Disability Savings Grant for a year, given the contribution and the
 * income band. At/below the threshold: 300% on the first $500 + 200% on the
 * next $1,000 (max grantAnnualMax, reached with $1,500 contributed). Above it:
 * 100% on the first $1,000 (max $1,000). Capped by the year's annual max and
 * the remaining lifetime grant room.
 */
function rdspGrantFor(contribution: number, familyIncome: number, cfg: AppConfig['rdsp'], lifetimeRemaining: number): number {
  if (contribution <= 0 || lifetimeRemaining <= 0) return 0;
  const c = contribution;
  let grant: number;
  if (familyIncome <= cfg.grantThreshold) {
    grant = Math.min(c, 500) * 3 + Math.min(Math.max(0, c - 500), 1000) * 2;
    grant = Math.min(grant, cfg.grantAnnualMax);
  } else {
    grant = Math.min(c, 1000) * 1;
    grant = Math.min(grant, 1000); // the high-income band's annual max is $1,000
  }
  return Math.min(grant, lifetimeRemaining);
}

/**
 * Canada Disability Savings Bond for a year — income-tested, no contribution
 * needed. At/below the lower threshold pays the full bondAnnualMax; between the
 * lower and upper thresholds it phases out linearly to $0; at/above the upper
 * threshold, $0. Capped by the remaining lifetime bond room.
 */
function rdspBondFor(familyIncome: number, cfg: AppConfig['rdsp'], lifetimeRemaining: number): number {
  if (lifetimeRemaining <= 0) return 0;
  let bond = 0;
  if (familyIncome <= cfg.bondThresholdLower) {
    bond = cfg.bondAnnualMax;
  } else if (familyIncome < cfg.bondThresholdUpper) {
    const span = cfg.bondThresholdUpper - cfg.bondThresholdLower;
    const frac = span > 0 ? (cfg.bondThresholdUpper - familyIncome) / span : 0;
    bond = cfg.bondAnnualMax * Math.max(0, frac);
  }
  return Math.min(bond, lifetimeRemaining);
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
    // one does. The engine knows each spouse's CPP/pension income up front;
    // each partner's own registered draws are fed back by the household pass
    // (see partnerDrawsAt) so the combined base counts BOTH sides.
    spouseContext?: {
      cppStartAge: number | null;
      cppMonthlyAmount: number;
      oasStartAge: number | null;
      oasYearsInCanada: number;
      currentAge: number;
      income?: IncomeSource[];
      // The partner's non-OAS draw income per THEIR age (registered draws +
      // realized capital gains + RDSP taxable portion) — the same "own" base
      // this run feeds into its own GIS. Absent on the first household pass
      // (and in standalone runs): those draws depend on the partner's GIS,
      // which depends on this person's draws — a fixed point the household
      // pass iterates to convergence (issue #26).
      partnerDrawsAt?: (age: number) => number;
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
    income
  } = person;
  const { maxAge, investmentReturn, provinceCode } = shared;

  const order: WithdrawalAccount[] =
    Array.isArray(withdrawalOrder) && withdrawalOrder.length > 0
      ? withdrawalOrder
      : ['tfsa', 'taxable', 'rrsp'];

  // RDSP drawdown opt-in (E-01): the 'rdsp' slot only draws when it appears in
  // the order, but nothing in the UI/ingest ever puts it there — so without this
  // an enabled RDSP accumulated and was never spent. When an RDSP is active and
  // the order doesn't mention it, inject it ahead of the taxable account: an
  // RDSP dollar is partly a tax-free return of contribution principal, so it's
  // cheaper to spend than a fully-taxable-gain dollar but (unlike a TFSA dollar)
  // not wholly tax-free. An explicit order that already places 'rdsp' is honoured
  // as-is; one that deliberately omits it can only be produced by hand-editing.
  const rdspActiveForOrder =
    person.rdsp?.enabled === true && person.rdsp?.dtcEligible === true && (person.rdsp?.balance ?? 0) > 0;
  const effectiveOrder: WithdrawalAccount[] =
    rdspActiveForOrder && !order.includes('rdsp')
      ? (() => {
          const idx = order.indexOf('taxable');
          const next = [...order];
          next.splice(idx === -1 ? next.length : idx, 0, 'rdsp');
          return next;
        })()
      : order;

  // The unified income register, split by kind into the lists the rest of the
  // run consumes. `employmentList` is the EARNED list — employment AND
  // self-employment both stack for tax like wages, build RRSP room, and save
  // their after-tax net into a destination account. `rentalList` is taxable
  // investment income: no RRSP room, no savings vehicle — its net lands in
  // taxable each year, like a pension (but rental does NOT pension-split).
  const incomeSources: IncomeSource[] = Array.isArray(income) ? income : [];
  const pensionList: IncomeSource[] = incomeSources.filter(s => s.kind === 'pension');
  const employmentList: IncomeSource[] = incomeSources.filter(s => s.kind === 'employment' || s.kind === 'selfEmployment');
  const rentalList: IncomeSource[] = incomeSources.filter(s => s.kind === 'rental');

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

  // This year's earned income (employment + self-employment) for RRSP accrual —
  // 18% of earned income builds room. Computed standalone from the register so
  // it's available in BOTH loops (the decumulation `employmentGross` isn't in
  // scope pre-retirement, and the accumulation `preRetIncome` fuses pensions in).
  const earnedIncomeAt = (age: number): number => {
    let gross = 0;
    for (const e of incomeSources) {
      if (e.kind !== 'employment' && e.kind !== 'selfEmployment') continue;
      if (age < e.startAge) continue;
      if (e.endAge != null && age > e.endAge) continue;
      gross += e.annualAmount * (e.indexedToCpi && indexTables ? factorAt(age) : 1);
    }
    return gross;
  };
  // This year's total pension adjustment (PA) from DB pensions — reduces RRSP
  // room accrual dollar-for-dollar (CRA: a DB pension's PA eats RRSP room).
  const pensionAdjustmentAt = (age: number): number => {
    let pa = 0;
    for (const p of pensionList) {
      if (age < p.startAge) continue;
      if (p.endAge != null && age > p.endAge) continue;
      pa += p.pensionAdjustment ?? 0;
    }
    return pa;
  };

  /**
   * Accrue one year's contribution room at the START of the person's age-year
   * (CRA grants the year's TFSA limit on Jan 1; RRSP room from last year's
   * earned income becomes available). Also re-adds LAST year's TFSA withdrawals
   * to TFSA room (the CRA rule: withdrawals free room again on the next Jan 1).
   * No-ops for whichever room is unlimited (null).
   */
  const accrueRoom = (age: number): void => {
    if (tfsaRoom !== null) {
      const limit = config.engine.tfsaAnnualLimit * (indexTables ? factorAt(age) : 1);
      tfsaRoom += limit + tfsaWithdrawnLastYear;
    }
    if (rrspRoom !== null) {
      const cap = config.engine.rrspAnnualMax * (indexTables ? factorAt(age) : 1);
      const accrual = Math.max(0, Math.min(0.18 * earnedIncomeAt(age), cap) - pensionAdjustmentAt(age));
      rrspRoom += accrual;
    }
    // The re-add is consumed (or not) this year; reset for the coming year.
    tfsaWithdrawnLastYear = 0;
  };

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
  const spouseFixedIncomeAt = (age: number): { fixed: number; hasOas: boolean; partnerDraws: number } => {
    if (!spouseCtx) return { fixed: 0, hasOas: false, partnerDraws: 0 };
    const spouseAge = age - (currentAge - spouseCtx.currentAge);
    let fixed = 0;
    if (spouseCtx.cppStartAge != null && spouseAge >= spouseCtx.cppStartAge) {
      fixed += spouseCtx.cppMonthlyAmount
        * cppAdjustmentMultiplier(spouseCtx.cppStartAge, config)
        * 12 * (indexTables ? factorAt(age) : 1);
    }
    for (const p of (spouseCtx.income ?? []).filter(s => s.kind === 'pension')) {
      if (spouseAge < p.startAge) continue;
      if (p.endAge != null && spouseAge > p.endAge) continue;
      fixed += p.annualAmount * (p.indexedToCpi && indexTables ? factorAt(age) : 1);
    }
    // The spouse's earned + rental income counts toward the couple's GIS base
    // too (self-employment is earned; rental is taxable investment income —
    // both reduce the couple's GIS).
    for (const e of (spouseCtx.income ?? []).filter(s => s.kind === 'employment' || s.kind === 'selfEmployment' || s.kind === 'rental')) {
      if (spouseAge < e.startAge) continue;
      if (e.endAge != null && spouseAge > e.endAge) continue;
      fixed += e.annualAmount * (e.indexedToCpi && indexTables ? factorAt(age) : 1);
    }
    const hasOas = spouseCtx.oasStartAge != null
      && spouseAge >= spouseCtx.oasStartAge
      && oasAnnualGross(spouseAge, spouseCtx.oasStartAge, spouseCtx.oasYearsInCanada, configAt(age)) > 0;
    // The partner's discretionary draws, looked up on THEIR age axis (GIS is
    // assessed on the calendar year's combined income; age − the current-age
    // gap is the same translation `fixed` above already uses).
    const partnerDraws = spouseCtx.partnerDrawsAt?.(spouseAge) ?? 0;
    return { fixed, hasOas, partnerDraws };
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

  // Contribution room (issue #24). `null` = unlimited (enforcement off — the
  // pre-#24 behaviour). A number seeds the CRA notice-of-assessment room and
  // turns enforcement on. The engine accrues room each year (TFSA: +the annual
  // limit; RRSP: +18% of that year's earned income, capped at the config max,
  // minus each DB pension's pension adjustment) and a TFSA withdrawal re-adds
  // to room the FOLLOWING year (the CRA rule). `tfsaWithdrawnLastYear` carries
  // the prior year's TFSA draws so the re-add can land one year late.
  let tfsaRoom: number | null = person.tfsaRoom ?? null;
  let rrspRoom: number | null = person.rrspRoom ?? null;
  let tfsaWithdrawnLastYear = 0;
  // This year's overflow (registered deposit redirected to taxable for lack of
  // room), accumulated per account and surfaced on the year's detail.
  const yearOverflow = { tfsa: 0, rrsp: 0 };

  /**
   * Cap a registered deposit at the account's remaining room and redirect the
   * excess to taxable (same after-tax dollars, ACB-tracked). Returns the amount
   * that actually lands registered. With room off (null) the full amount lands.
   * Growth and the RRSP→RRIF conversion are NOT deposits and never pass here.
   */
  const capToRoom = (account: 'rrsp' | 'tfsa', amount: number): number => {
    if (amount <= 0) return 0;
    if (account === 'tfsa') {
      if (tfsaRoom === null) return amount;
      const land = Math.min(amount, Math.max(0, tfsaRoom));
      tfsaRoom -= land;
      const excess = amount - land;
      if (excess > 0) { taxable += excess; taxableAcb += excess; yearOverflow.tfsa += excess; }
      return land;
    }
    if (rrspRoom === null) return amount;
    const land = Math.min(amount, Math.max(0, rrspRoom));
    rrspRoom -= land;
    const excess = amount - land;
    if (excess > 0) { taxable += excess; taxableAcb += excess; yearOverflow.rrsp += excess; }
    return land;
  };

  // Per-age non-OAS draw income (the GIS "own" base), captured in the
  // decumulation loop for the household pass's couple-GIS iteration (#26).
  const householdDraws: Record<number, number> = {};

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
  // Product type: reverse mortgage (default) compounds interest into the loan
  // and caps the balance at the LTV ceiling; a HELOC instead charges the year's
  // interest as a cash-flow expense and carries no negative-equity guarantee.
  const rmIsHeloc = rm?.mode === 'heloc';
  // This year's interest charge, computed but NOT yet applied. Reverse mode:
  // it's added to the loan below. HELOC mode: it's returned so the caller can
  // add it to the year's spending (the interest is serviced, not deferred).
  const rmInterestCharge = () => rmLoan * Math.max(0, rm?.interestRate ?? 0);
  // Apply one year's interest. Reverse: accrue onto the loan, then clamp the
  // balance at the LTV ceiling. A max loan-to-value is a hard limit on what the
  // lender will ever be owed: without the clamp, a loan near the ceiling with
  // interest above home appreciation compounds unbounded past it, driving net
  // equity deeply negative (no lender allows the balance to exceed the agreed
  // share of the home's value — the "no negative equity guarantee"). Clamping
  // here keeps net equity ≥ (1 − maxLtv) × home value.
  // HELOC: interest is PAID this year (handled by the caller as an expense), so
  // it does not accrue and no clamp applies — there is no negative-equity
  // guarantee, so net equity may go negative if draws outpace appreciation.
  const rmAccrue = () => {
    if (rmIsHeloc) return; // interest serviced annually, not compounded
    rmLoan += rmInterestCharge();
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

  // Debts: each liability compounds at its own rate and is serviced out of cash
  // flow. Track the live principal per debt id; absent/empty = debt-free. The
  // payment is capped at the remaining balance so the final year pays less.
  const debtList: Debt[] = Array.isArray(person.debts) ? person.debts : [];
  const debtBal = new Map<string, number>();
  for (const d of debtList) debtBal.set(d.id, Math.max(0, d.balance));
  const debtOn = debtList.length > 0;
  // Total principal outstanding right now (year-end figure is read after the
  // year's payments, so callers take this AFTER applying the year's ledger).
  const debtBalanceNow = () => {
    let t = 0;
    for (const v of debtBal.values()) t += v;
    return t;
  };
  // Run one year's interest + payment for every active debt. Returns the year's
  // total payment (added to the spending need) and per-debt detail rows. A debt
  // is active from startAge (default currentAge) until paid off, or until
  // endAge when one is set. Interest accrues on the balance first, then the
  // payment (capped at the post-interest balance) comes off.
  const runDebtYear = (age: number): { total: number; rows: NonNullable<YearDetail['debts']> } => {
    const rows: NonNullable<YearDetail['debts']> = [];
    let total = 0;
    for (const d of debtList) {
      const bal0 = debtBal.get(d.id) ?? 0;
      const startAge = d.startAge ?? currentAge;
      const active = age >= startAge && (d.endAge == null || age <= d.endAge) && bal0 > 0;
      if (!active) { rows.push({ label: d.label, kind: d.kind, interestAccrued: 0, payment: 0, balanceEnd: bal0 }); continue; }
      const interest = bal0 * Math.max(0, d.interestRate);
      let bal = bal0 + interest;
      const want = Math.max(0, d.monthlyPayment) * 12;
      const payment = Math.min(want, bal);
      bal -= payment;
      debtBal.set(d.id, bal);
      total += payment;
      rows.push({ label: d.label, kind: d.kind, interestAccrued: interest, payment, balanceEnd: bal });
    }
    return { total, rows };
  };
  const gainsFraction = () => (taxable > 0 ? Math.max(0, Math.min(1, 1 - taxableAcb / taxable)) : 0);
  const inclusion = Math.min(1, Math.max(0, config.engine.capitalGainsInclusion));

  // RDSP: tax-sheltered growth, contributions not deductible, grant/bond/growth
  // taxable on withdrawal. Tracked by BASIS so a withdrawal can be split into
  // the tax-free contribution portion and the taxable grant/bond/growth portion.
  // Grants/bonds are paid only while DTC-eligible and only up to the year the
  // beneficiary turns grantEndAge; contributions up to contributionEndAge.
  const rdspIn = person.rdsp;
  const rdspCfg = config.rdsp;
  const rdspOn = rdspIn?.enabled === true && rdspIn?.dtcEligible === true;
  let rdspBal = rdspOn ? Math.max(0, rdspIn.balance) : 0;
  // The contribution principal already inside the opening balance (tax-free on
  // the way out). Defaults to the whole balance — a long-held plan is assumed
  // to be mostly contributed principal.
  let rdspContribBasis = rdspOn ? Math.min(rdspBal, Math.max(0, rdspIn.contributionBasis ?? rdspIn.balance)) : 0;
  // Grant/bond principal paid in to date (a subset of the taxable portion on
  // withdrawal). The opening balance is assumed to hold none of either beyond
  // the contribution basis (its taxable remainder is growth).
  let rdspGrantBasis = 0, rdspBondBasis = 0;
  // The fraction of any withdrawal that is TAXABLE (grant + bond + growth).
  const rdspTaxableFraction = () => (rdspBal > 0 ? Math.max(0, Math.min(1, 1 - rdspContribBasis / rdspBal)) : 0);

  // FHSA: deductible-in, tax-sheltered growth, accumulation-only. Tracked by
  // contribution basis toward the LIFETIME limit (config.fhsa.lifetimeLimit).
  // At the retirement boundary the balance transfers to the RRSP (the
  // no-qualifying-home path — CRA allows the transfer with no RRSP room).
  const fhsaIn = person.fhsa;
  const fhsaCfg = config.fhsa;
  const fhsaOn = fhsaIn?.enabled === true;
  let fhsaBal = fhsaOn ? Math.max(0, fhsaIn.balance) : 0;
  // Contributions already made toward the lifetime cap. Defaults to the opening
  // balance (a pre-existing balance is assumed all contributed principal).
  let fhsaContribBasis = fhsaOn ? Math.min(Math.max(0, fhsaIn.contributionBasis ?? fhsaIn.balance), fhsaCfg.lifetimeLimit) : 0;
  const fhsaOpenAge = fhsaIn?.openAge ?? currentAge;

  const totalBalance = () => rrsp + rrif + tfsa + taxable + cashCushion + rdspBal + fhsaBal;

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
      // A registered destination consumes room: only the in-room portion lands
      // registered; the excess spills to taxable (the meltdown's after-tax net
      // is capped by TFSA room, so the rest becomes taxable — issue #24).
      const land = to.account === 'rrsp' ? capToRoom('rrsp', net)
        : to.account === 'tfsa' ? capToRoom('tfsa', net)
        : net;
      acct.put(to.account, land);
      if (to.account === 'rrsp') deposit.rrsp += land;
      else if (to.account === 'tfsa') deposit.tfsa += land;
      else if (to.account === 'cash') deposit.cash += land;
      else deposit.taxable += land;
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
    // New year: accrue this year's room (and re-add last year's TFSA draws),
    // and reset the year's overflow accumulator.
    accrueRoom(age);
    yearOverflow.tfsa = 0; yearOverflow.rrsp = 0;

    const r = rateAt(age);
    const rrspGains = rrsp * r;
    const tfsaGains = tfsa * r;
    const taxableGains = taxable * r;
    const cashGains = cashCushion * cushionRate;

    // Growth is not a deposit and never consumes room; only the CONTRIBUTION is
    // capped (issue #24). The fused `balance += gains + contribution` line is
    // split so the cap applies to the contribution alone, the excess spilling
    // to taxable (tracked in ACB by capToRoom).
    rrsp += rrspGains + capToRoom('rrsp', rrspContribution);
    tfsa += tfsaGains + capToRoom('tfsa', tfsaContribution);
    taxable += taxableGains + taxableContribution;
    taxableAcb += taxableContribution;
    cashCushion += cashGains;

    // RDSP: contribution + CDSG/CDSB grants, then growth on the whole account.
    // Contributions stop after the year the beneficiary turns contributionEndAge
    // and are lifetime-capped; grants/bonds stop after grantEndAge and are
    // income-tested (family income indexed with CPI when indexTaxTables is on).
    let rdspContribution = 0, rdspGrant = 0, rdspBond = 0, rdspGains = 0;
    if (rdspOn) {
      if (age <= rdspCfg.contributionEndAge) {
        const want = Math.max(0, rdspIn.contribution) * (indexTables ? factorAt(age) : 1);
        const lifetimeLeft = Math.max(0, rdspCfg.contributionLifetimeMax - rdspContribBasis);
        rdspContribution = Math.min(want, lifetimeLeft);
      }
      if (age <= rdspCfg.grantEndAge) {
        const famIncome = Math.max(0, rdspIn.familyIncome) * (indexTables ? factorAt(age) : 1);
        rdspGrant = rdspGrantFor(rdspContribution, famIncome, rdspCfg, rdspCfg.grantLifetimeMax - rdspGrantBasis);
        rdspBond = rdspBondFor(famIncome, rdspCfg, rdspCfg.bondLifetimeMax - rdspBondBasis);
      }
      rdspGains = rdspBal * r;
      rdspBal += rdspContribution + rdspGrant + rdspBond + rdspGains;
      rdspContribBasis += rdspContribution;
      rdspGrantBasis += rdspGrant;
      rdspBondBasis += rdspBond;
    }

    // FHSA: deductible contribution (capped at the annual + lifetime limits),
    // then tax-sheltered growth on the whole account. The contribution reduces
    // the year's taxable income (like an RRSP) — subtracted from the earnings
    // base below. Contributions stop once the 15-year clock runs out.
    let fhsaContribution = 0, fhsaGains = 0;
    if (fhsaOn) {
      if (age < fhsaOpenAge + fhsaCfg.maxYears) {
        const annualLimit = fhsaCfg.annualLimit * (indexTables ? factorAt(age) : 1);
        const want = Math.min(Math.max(0, fhsaIn.contribution) * (indexTables ? factorAt(age) : 1), annualLimit);
        const lifetimeLeft = Math.max(0, fhsaCfg.lifetimeLimit - fhsaContribBasis);
        fhsaContribution = Math.min(want, lifetimeLeft);
      }
      fhsaGains = fhsaBal * r;
      fhsaBal += fhsaContribution + fhsaGains;
      fhsaContribBasis += fhsaContribution;
    }

    // Reverse mortgage / HELOC: appreciate the home, accrue interest (reverse)
    // or charge it as an expense (HELOC), take any scheduled draw into the cash
    // cushion (rare pre-retirement, but allowed). Draws are capped at headroom.
    let accRmInterest = 0, accRmScheduled = 0, accRmInterestExpense = 0;
    if (rmOn) {
      homeValue *= 1 + Math.max(0, rm?.appreciationRate ?? 0);
      if (rmIsHeloc) {
        accRmInterestExpense = rmInterestCharge();
        accRmInterest = accRmInterestExpense; // reported as this year's interest
      } else {
        const loanBefore = rmLoan;
        rmAccrue();
        accRmInterest = rmLoan - loanBefore;
      }
      const sched = rmDraw(rmScheduledAt(age));
      cashCushion += sched;
      accRmScheduled = sched;
    }

    // Cash events fire pre-retirement too — a house sale at 51 lands in its
    // account and then grows; an outflow is funded by drawing down accounts in
    // the configured withdrawal order. Pre-retirement the engine models no
    // benefit income and doesn't tax plain in/out draws — but a TRANSFER
    // from a registered account is always a taxable RRSP withdrawal (the
    // meltdown), so that path taxes the draw before redepositing the net.
    const accumDeposit = { rrsp: 0, rrif: 0, tfsa: 0, taxable: 0, cash: 0 };
    const accumTransfers: NonNullable<YearCalc['transfers']> = [];
    let accumTransferTax = 0;
    // Pre-retirement income: wages + DB/bridge pensions active this year, using
    // the exact window/indexation rules of the decumulation phase so the two
    // phases agree. This is REAL income — it is taxed and the after-tax net is
    // saved into the source's account (issue #119: it used to vanish, feeding
    // only the transfer-tax floor). A registered meltdown stacks on TOP of it —
    // taxing from a $0 floor would under-state the tax for someone still working
    // (issue #25).
    const yearCfg = configAt(age);
    let employmentGrossAccum = 0;
    let selfEmploymentGrossAccum = 0; // subset of employmentGross — self-emp only
    let pensionGrossAccum = 0;
    let rentalGrossAccum = 0;
    const employmentActiveAccum: Array<{ e: IncomeSource; gross: number }> = [];
    for (const e of employmentList) {
      if (age < e.startAge) continue;
      if (e.endAge != null && age > e.endAge) continue;
      const g = e.annualAmount * (e.indexedToCpi && indexTables ? factorAt(age) : 1);
      employmentGrossAccum += g;
      if (e.kind === 'selfEmployment') selfEmploymentGrossAccum += g;
      employmentActiveAccum.push({ e, gross: g });
    }
    for (const p of pensionList) {
      if (age < p.startAge) continue;
      if (p.endAge != null && age > p.endAge) continue;
      pensionGrossAccum += p.annualAmount * (p.indexedToCpi && indexTables ? factorAt(age) : 1);
    }
    for (const r of rentalList) {
      if (age < r.startAge) continue;
      if (r.endAge != null && age > r.endAge) continue;
      rentalGrossAccum += r.annualAmount * (r.indexedToCpi && indexTables ? factorAt(age) : 1);
    }
    // Self-employed CPP: the both-sides contribution is a DEDUCTION from taxable
    // income, so the year's self-employment earnings are taxed net of it. The
    // FHSA contribution is deductible too (like an RRSP) — both come off the
    // taxable base.
    const selfEmpCppAccum = selfEmployedCppContribution(selfEmploymentGrossAccum, yearCfg);
    // Marginal tax on the year's earned + pension + rental income (no benefits
    // yet pre-retirement), less the self-employed CPP and FHSA deductions.
    // Apportioned pro-rata so each stream's net is its gross minus its share of
    // the tax — the same convention the decumulation loop uses for employment.
    const earningsGrossAccum = employmentGrossAccum + pensionGrossAccum + rentalGrossAccum;
    const earningsTaxAccum = earningsGrossAccum > 0
      ? calculateTax(Math.max(0, earningsGrossAccum - selfEmpCppAccum - fhsaContribution), provinceCode, yearCfg).totalTax
      : 0;
    const netOf = (gross: number): number =>
      earningsGrossAccum > 0 ? gross * (1 - earningsTaxAccum / earningsGrossAccum) : 0;
    const employmentTaxAccum = earningsGrossAccum > 0 ? earningsTaxAccum * (employmentGrossAccum / earningsGrossAccum) : 0;
    const employmentNetAccum = employmentGrossAccum - employmentTaxAccum;
    // Save each active earned source's net × savingsRate into its account
    // (unset savingsRate = save it all); the rest is consumed by working-year
    // living costs, which the model doesn't track. Registered destinations
    // consume room; the overflow spills to taxable via capToRoom. A self-
    // employment source's take-home is its income-tax net MINUS its CPP
    // contribution (real money paid, on top of income tax).
    for (const { e, gross } of employmentActiveAccum) {
      const rate = e.savingsRate ?? 1;
      const cpp = e.kind === 'selfEmployment' && selfEmploymentGrossAccum > 0
        ? selfEmpCppAccum * (gross / selfEmploymentGrossAccum)
        : 0;
      const amt = Math.max(0, netOf(gross) - cpp) * Math.min(1, Math.max(0, rate));
      if (amt <= 0) continue;
      const dest = e.destAccount ?? 'taxable';
      if (dest === 'rrsp') { const land = capToRoom('rrsp', amt); rrsp += land; accumDeposit.rrsp += land; }
      else if (dest === 'tfsa') { const land = capToRoom('tfsa', amt); tfsa += land; accumDeposit.tfsa += land; }
      else if (dest === 'cash') { cashCushion += amt; accumDeposit.cash += amt; }
      else { taxable += amt; taxableAcb += amt; accumDeposit.taxable += amt; }
    }
    // A pre-retirement pension (e.g. a bridge or early DB) is received income,
    // not a savings vehicle — its whole net lands in taxable. Rental is the
    // same: taxable investment income, net deposited to taxable.
    {
      const amt = netOf(pensionGrossAccum + rentalGrossAccum);
      if (amt > 0) { taxable += amt; taxableAcb += amt; accumDeposit.taxable += amt; }
    }
    // Registered transfer draws stack as income within the year so a second
    // transfer the same year is taxed at the right marginal rate. Seeded with
    // the year's income floor (earned + pension gross).
    let accumTransferBaseGross = earningsGrossAccum;
    // Inbound inter-spousal transfers land here as after-tax money. A
    // registered landing is a deposit and consumes room (issue #24).
    for (const d of inboundAt(age)) {
      if (d.account === 'rrsp') { const land = capToRoom('rrsp', d.amount); rrsp += land; accumDeposit.rrsp += land; }
      else if (d.account === 'tfsa') { const land = capToRoom('tfsa', d.amount); tfsa += land; accumDeposit.tfsa += land; }
      else if (d.account === 'cash') { cashCushion += d.amount; accumDeposit.cash += d.amount; }
      else { taxable += d.amount; taxableAcb += d.amount; accumDeposit.taxable += d.amount; }
    }
    const yearEvents = eventsAt(age).map(eventLine);
    let accumEventOut = 0;
    const drawDown = (amount: number) => {
      let remaining = amount;
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
    };
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
        if (dest === 'rrsp') { const land = capToRoom('rrsp', ev.amount); rrsp += land; accumDeposit.rrsp += land; }
        else if (dest === 'tfsa') { const land = capToRoom('tfsa', ev.amount); tfsa += land; accumDeposit.tfsa += land; }
        else if (dest === 'cash') { cashCushion += ev.amount; accumDeposit.cash += ev.amount; }
        else { taxable += ev.amount; taxableAcb += ev.amount; accumDeposit.taxable += ev.amount; }
      } else {
        accumEventOut += ev.amount;
        drawDown(ev.amount);
      }
    }
    // HELOC: the year's interest is serviced as a cash-flow expense, drawn from
    // the accounts like any other pre-retirement outflow. Counted in the year's
    // withdrawals/spending target so the plan's cash-flow requirement is visible.
    if (accRmInterestExpense > 0) {
      accumEventOut += accRmInterestExpense;
      drawDown(accRmInterestExpense);
    }
    // Debts: the year's payments are serviced out of cash flow too, drawn from
    // the accounts like any other pre-retirement outflow. The payment is capped
    // at the remaining balance, so a paid-off debt frees its payment.
    const accumDebt = debtOn ? runDebtYear(age) : { total: 0, rows: [] };
    if (accumDebt.total > 0) {
      accumEventOut += accumDebt.total;
      drawDown(accumDebt.total);
    }

    // The year's tax = the earnings tax (on wages + pension) plus the meltdown
    // transfer tax. Together they equal tax(earnings + transfers) − tax(0): the
    // transfers are computed incrementally over the earnings base, so nothing is
    // taxed twice. Track both so the accounting identity and cumulative totals
    // stay honest.
    const accumIncomeTax = earningsTaxAccum + accumTransferTax;
    cumulativeTax += accumIncomeTax;

    yearlyBreakdown.push({
      age,
      startingBalance: startingTotal,
      contributions: rrspContribution + tfsaContribution + taxableContribution + rdspContribution + fhsaContribution,
      marketGains: rrspGains + tfsaGains + taxableGains + cashGains + rdspGains + fhsaGains,
      withdrawals: accumEventOut + accumTransfers.reduce((s, t) => s + t.gross, 0),
      incomeTax: accumIncomeTax,
      cumulativeTax,
      spendingTarget: accumEventOut,
      endingBalance: totalBalance(),
      rrspBalance: rrsp,
      rrifBalance: rrif,
      tfsaBalance: tfsa,
      taxableBalance: taxable,
      cashCushionBalance: cashCushion,
      ...(rdspOn ? { rdspBalance: rdspBal } : {}),
      ...(fhsaOn ? { fhsaBalance: fhsaBal } : {}),
      cppIncome: 0,
      oasIncome: 0,
      gisIncome: 0,
      pensionIncome: pensionGrossAccum,
      rentalIncome: rentalGrossAccum,
      employmentGross: employmentGrossAccum,
      employmentTax: employmentTaxAccum,
      employmentNet: employmentNetAccum,
      ...(debtOn ? { debtPayments: accumDebt.total, debtBalance: debtBalanceNow() } : {}),
      detail: {
        withdraw: { rrifMin: 0, rrif: 0, rrsp: 0, tfsa: 0, taxable: 0, cash: 0, rmDraw: 0 },
        growth: { rrsp: rrspGains, rrif: 0, tfsa: tfsaGains, taxable: taxableGains, cash: cashGains, ...(fhsaOn ? { fhsa: fhsaGains } : {}) },
        contrib: { rrsp: rrspContribution, tfsa: tfsaContribution, taxable: taxableContribution, ...(rdspOn ? { rdsp: rdspContribution } : {}), ...(fhsaOn ? { fhsa: fhsaContribution } : {}) },
        deposit: accumDeposit,
        ...(yearOverflow.tfsa > 0 || yearOverflow.rrsp > 0 ? { overflow: { tfsa: yearOverflow.tfsa, rrsp: yearOverflow.rrsp } } : {}),
        ...((tfsaRoom !== null || rrspRoom !== null) ? { roomRemaining: { ...(tfsaRoom !== null ? { tfsa: Math.max(0, tfsaRoom) } : {}), ...(rrspRoom !== null ? { rrsp: Math.max(0, rrspRoom) } : {}) } } : {}),
        tax: { oasClawback: 0, capitalGains: 0, registeredGross: accumTransferBaseGross },
        ...(rdspOn ? { rdsp: { contribution: rdspContribution, grant: rdspGrant, bond: rdspBond, growth: rdspGains, balance: rdspBal, contributionBasis: rdspContribBasis, taxableFraction: rdspTaxableFraction() } } : {}),
        ...(fhsaOn ? { fhsa: { contribution: fhsaContribution, growth: fhsaGains, balance: fhsaBal, contributionBasis: fhsaContribBasis } } : {}),
        ...(rmOn ? { rm: { interestAccrued: accRmInterest, scheduledDraw: accRmScheduled, topUpDraw: 0, homeValue, loanBalance: rmLoan, ...(rmIsHeloc ? { interestExpense: accRmInterestExpense } : {}) } } : {}),
        ...(debtOn ? { debts: accumDebt.rows } : {}),
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
      cashCushionBalance: cashCushion,
      ...(rdspOn ? { rdspBalance: rdspBal } : {}),
      ...(fhsaOn ? { fhsaBalance: fhsaBal } : {})
    });
  }

  // FHSA → RRSP transfer at the retirement boundary: any remaining FHSA balance
  // moves into the RRSP (the no-qualifying-home path; CRA allows the direct
  // transfer with no RRSP contribution room required, so capToRoom is bypassed).
  // The FHSA never enters the decumulation withdrawal order — it has served its
  // purpose (or its 15-year window) by the time drawdown begins.
  if (fhsaOn && fhsaBal > 0) {
    rrsp += fhsaBal;
    fhsaBal = 0;
  }

  // ---------------- decumulation phase ----------------
  let depletionAge: number | null = null;
  const totalStartingRetirement = totalBalance();

  for (let age = retirementAge; age <= maxAge; age++) {
    // New year: accrue this year's room (and re-add last year's TFSA draws),
    // and reset the year's overflow accumulator.
    accrueRoom(age);
    yearOverflow.tfsa = 0; yearOverflow.rrsp = 0;

    // RRSP converts to RRIF at the configured age. `>=` so a plan that
    // starts retirement past the conversion age converts immediately
    // rather than skipping conversion (and RRIF minimums) forever. This is a
    // registered→registered move, NOT a deposit — it never touches room.
    if (age >= rrifAge && rrsp > 0) {
      rrif += rrsp;
      rrsp = 0;
    }

    // Jan-1 RRIF balance: the CRA bases the year's mandatory minimum on the
    // balance at the start of the year. Capture it now, before the transfer
    // loop and any draws shrink `rrif` — a same-year RRSP-meltdown transfer
    // must NOT reduce the mandatory minimum (discretionary moves later in the
    // year don't lower it either).
    const rrifJan1 = rrif;

    const startingTotal = totalBalance();
    const yearConfig = configAt(age);

    // Reverse mortgage / HELOC: appreciate the home, accrue this year's interest
    // (reverse) or charge it as an expense (HELOC), and take any scheduled draw
    // into the cash cushion (tax-free proceeds). Draws are capped at headroom.
    let rmInterest = 0, rmScheduled = 0, rmInterestExpense = 0;
    if (rmOn) {
      homeValue *= 1 + Math.max(0, rm?.appreciationRate ?? 0);
      if (rmIsHeloc) {
        rmInterestExpense = rmInterestCharge();
        rmInterest = rmInterestExpense; // reported as this year's interest
      } else {
        const loanBefore = rmLoan;
        rmAccrue();
        rmInterest = rmLoan - loanBefore;
      }
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
      if (dest === 'rrsp') { const land = capToRoom('rrsp', ev.amount); rrsp += land; deposit.rrsp += land; }
      else if (dest === 'tfsa') { const land = capToRoom('tfsa', ev.amount); tfsa += land; deposit.tfsa += land; }
      else if (dest === 'cash') { cashCushion += ev.amount; deposit.cash += ev.amount; }
      else { taxable += ev.amount; taxableAcb += ev.amount; deposit.taxable += ev.amount; }
    }
    // Inbound inter-spousal transfers (the partner's cross-deposits) land here
    // as after-tax money, at the start of the year. A registered landing is a
    // deposit and consumes room (issue #24).
    for (const d of inboundAt(age)) {
      if (d.account === 'rrsp') { const land = capToRoom('rrsp', d.amount); rrsp += land; deposit.rrsp += land; }
      else if (d.account === 'tfsa') { const land = capToRoom('tfsa', d.amount); tfsa += land; deposit.tfsa += land; }
      else if (d.account === 'cash') { cashCushion += d.amount; deposit.cash += d.amount; }
      else { taxable += d.amount; taxableAcb += d.amount; deposit.taxable += d.amount; }
    }

    // This year's spending target: today's dollars, inflated to this year when
    // indexSpending is on (otherwise held flat in today's dollars). A HELOC's
    // annual interest is serviced out of cash flow, so it raises the year's
    // spending need like any other expense. Debt payments are too: each
    // liability's payment is added to the year's need, so the ordered draws
    // gross up to cover it — the debt visibly pushes withdrawals up until it's
    // paid off (after-tax money, so it never touches GIS or the clawback).
    const decumDebt = debtOn ? runDebtYear(age) : { total: 0, rows: [] };
    const yearSpending = desiredSpending * spendingFactorAt(age) * spendingPctAt(age) + eventOutAt(age) + rmInterestExpense + decumDebt.total;

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
    // Rental income: taxable investment income, stacked with CPP/OAS/pension
    // for tax and the clawbacks, but NOT eligible for pension-splitting. Its
    // net lands in taxable below (it's income, not a savings vehicle).
    let rentalGross = 0;
    for (const r of rentalList) {
      if (age < r.startAge) continue;
      if (r.endAge != null && age > r.endAge) continue;
      rentalGross += r.annualAmount * (r.indexedToCpi && indexTables ? factorAt(age) : 1);
    }

    // Employment income: earned, so it stacks for tax like the benefits and is
    // taxed in the year it's earned (regardless of what the money is then used
    // for). Split by mode: top-up net covers spending first (RM-style), save
    // net is deposited into its account below. Self-employment additionally
    // owes the both-sides CPP contribution — a deduction from taxable income
    // AND real money paid out of the year's take-home.
    let employmentTopUpGross = 0;
    let employmentSaveGross = 0;
    let selfEmploymentGross = 0; // subset of the two above — self-emp only
    const employmentSaveActive: IncomeSource[] = [];
    for (const e of employmentList) {
      if (age < e.startAge) continue;
      if (e.endAge != null && age > e.endAge) continue;
      const amt = e.annualAmount * (e.indexedToCpi && indexTables ? factorAt(age) : 1);
      if (e.kind === 'selfEmployment') selfEmploymentGross += amt;
      if (e.topUpSpending) employmentTopUpGross += amt;
      else { employmentSaveGross += amt; employmentSaveActive.push(e); }
    }
    const employmentGross = employmentTopUpGross + employmentSaveGross;
    const selfEmpCpp = selfEmployedCppContribution(selfEmploymentGross, yearConfig);
    const otherGrossNoEmployment = cppGross + oasGross + pensionGross + rentalGross;
    // Employment's marginal tax, computed on income NET of the self-emp CPP
    // deduction (the deduction lowers the taxable stack on both sides).
    const employmentTax = employmentGross > 0
      ? Math.max(0,
          calculateTax(otherGrossNoEmployment + employmentGross - selfEmpCpp, provinceCode, yearConfig).totalTax
          - calculateTax(otherGrossNoEmployment, provinceCode, yearConfig).totalTax)
      : 0;
    // Take-home = gross − income tax − CPP contribution (the contribution is
    // paid out of the year's earnings, not just deducted for tax).
    const employmentNet = employmentGross - employmentTax - selfEmpCpp;
    // Apportion the net between the two modes pro-rata to their gross.
    const employmentTopUpNet = employmentGross > 0 ? employmentNet * (employmentTopUpGross / employmentGross) : 0;
    const employmentSaveNet = employmentGross > 0 ? employmentNet * (employmentSaveGross / employmentGross) : 0;

    const otherGross = cppGross + oasGross + pensionGross + rentalGross;
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
    let rdspTaxable = 0;        // taxable (grant/bond/growth) portion of this year's RDSP withdrawal
    let rdspWithdrawn = 0;      // gross RDSP dollars withdrawn this year
    let remainingAfterTaxNeed = neededAfterTax;
    // Per-source withdrawal provenance for the year's drill-down.
    const wd: { rrifMin: number; rrif: number; rrsp: number; tfsa: number; taxable: number; cash: number; rmDraw: number; rdsp?: number } = { rrifMin: 0, rrif: 0, rrsp: 0, tfsa: 0, taxable: 0, cash: 0, rmDraw: 0 };
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

    // 1. Mandatory RRIF minimum — forced out first, computed on the Jan-1
    //    balance (rrifJan1) per CRA, not the post-transfer balance. After-tax
    //    excess over the spending need is redeposited into taxable (still
    //    withdrawn & taxed).
    if (isRrifMandatory(age, config) && rrifJan1 > 0) {
      const minimum = Math.min(calculateRrifMinimum(age, rrifJan1, config), rrif);
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
    // spouses receive OAS, the single rate when only this person does. The
    // partner's own discretionary draws arrive via spouseContext.partnerDrawsAt
    // (the household pass iterates to the fixed point — issue #26); standalone
    // runs without it keep the documented single-sided approximation.
    const gisAt = () => {
      if (oasGross <= 0) return 0;
      if (spouseCtx) {
        const sp = spouseFixedIncomeAt(age);
        return gisAnnualCouple(
          registeredGross + capitalGains + rdspTaxable,
          cppGross + pensionGross + rentalGross + employmentGross + sp.fixed + sp.partnerDraws,
          sp.hasOas,
          yearConfig
        );
      }
      return gisAnnual(stackBase + registeredGross + capitalGains + rdspTaxable - oasGross, yearConfig);
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

      if (account === 'rdsp') {
        // Only the grant/bond/growth fraction of the withdrawal is taxable; the
        // contribution-principal portion is a tax-free return of capital. Gross
        // up on the taxable portion so the after-tax proceeds cover the need.
        if (!rdspOn || rdspBal <= 0) return;
        const ft = rdspTaxableFraction();
        const drawGross = grossTaxableWithdrawal(remainingAfterTaxNeed, stackedGross() + capitalGains * inclusion + rdspTaxable, ft, 1, provinceCode, yearConfig);
        const draw = Math.min(rdspBal, drawGross);
        const taxablePart = draw * ft;
        rdspBal -= draw;
        rdspContribBasis = Math.max(0, rdspContribBasis - draw * (1 - ft));
        rdspTaxable += taxablePart;
        rdspWithdrawn += draw;
        actualWithdrawals += draw;
        wd.rdsp = (wd.rdsp ?? 0) + draw;
        const base = stackedGross() + capitalGains * inclusion + rdspTaxable;
        const netOfDraw = draw
          - (calculateTax(base, provinceCode, yearConfig).totalTax - calculateTax(base - taxablePart, provinceCode, yearConfig).totalTax);
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

    for (const account of effectiveOrder) {
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
      // Save-mode: split the save net across active save jobs by gross share,
      // then save each job's savingsRate × its share (unset = save it all); the
      // rest is assumed consumed. Matches the pre-retirement accumulation path
      // so the field means the same thing in both phases (issue #119).
      const perJob: Array<{ e: IncomeSource; net: number }> = [];
      for (const e of employmentSaveActive) {
        const g = e.annualAmount * (e.indexedToCpi && indexTables ? factorAt(age) : 1);
        const share = employmentSaveGross > 0 ? employmentSaveNet * (g / employmentSaveGross) : 0;
        const rate = Math.min(1, Math.max(0, e.savingsRate ?? 1));
        perJob.push({ e, net: share * rate });
      }
      const depositEmployment = (e: IncomeSource, amt: number) => {
        if (amt <= 0) return;
        // destAccount is optional on the register; absent = taxable (the
        // legacy default for employment savings). A registered destination is a
        // deposit and consumes room (issue #24).
        const dest = e.destAccount ?? 'taxable';
        if (dest === 'rrsp') { const land = capToRoom('rrsp', amt); rrsp += land; deposit.rrsp += land; }
        else if (dest === 'tfsa') { const land = capToRoom('tfsa', amt); tfsa += land; deposit.tfsa += land; }
        else if (dest === 'cash') { cashCushion += amt; deposit.cash += amt; }
        else { taxable += amt; taxableAcb += amt; deposit.taxable += amt; }
      };
      for (const { e, net } of perJob) depositEmployment(e, net);
      // Top-up excess goes to the first top-up job's account (or taxable).
      if (topUpExcess > 0) {
        const firstTopUp = employmentList.find(e => e.topUpSpending && age >= e.startAge && (e.endAge == null || age <= e.endAge));
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
    // The self-emp CPP contribution is a deduction, so taxable income is net
    // of it (the clawback base still uses the full gross — CRA's clawback is on
    // net income BEFORE the CPP deduction, but the deduction is small and the
    // simplification keeps the two figures consistent).
    const totalNetIncome = otherGross + employmentGross + registeredGross + capitalGains * inclusion + rdspTaxable;
    const taxableNetIncome = Math.max(0, totalNetIncome - selfEmpCpp);
    const oasClawback = oasGross > 0
      ? Math.min(oasGross, Math.max(0, totalNetIncome - yearConfig.oas.clawbackThreshold) * yearConfig.oas.clawbackRate)
      : 0;
    const incomeTax = calculateTax(taxableNetIncome, provinceCode, yearConfig).totalTax
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
    const rdspGains = rdspBal * r; // sheltered growth on the post-withdrawal balance

    rrsp += rrspGains;
    rrif += rrifGains;
    tfsa += tfsaGains;
    taxable += taxableGains;
    cashCushion += cashGains;
    rdspBal += rdspGains;

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

    // Pension-splitting inputs. Eligible income is DB pensions PLUS registered
    // draws — but CRA only lets you split REGISTERED (RRIF/RRSP annuity) income
    // from age 65. Before 65, an RRSP/RRIF withdrawal is NOT split-eligible
    // (a DB pension still is). CPP and OAS are never eligible. Captured
    // pre-split; the household pass applies the split to the reported tax.
    const splitEligibleIncome = pensionGross + (age >= 65 ? registeredGross : 0);
    const unsplitNetIncome = totalNetIncome;

    // The GIS base this run actually used — captured per age so the household
    // pass can feed it to the partner's run and iterate couple GIS to the
    // fixed point (issue #26). Mirrors the "own" side of gisAt() exactly.
    householdDraws[age] = registeredGross + capitalGains + rdspTaxable;

    // TFSA withdrawals this year re-add to room NEXT year (CRA rule). Carry the
    // year's total (spending draws + transfer-outs) so accrueRoom can re-add it.
    tfsaWithdrawnLastYear = wd.tfsa;

    yearlyBreakdown.push({
      age,
      startingBalance: startingTotal,
      contributions: 0,
      marketGains: rrspGains + rrifGains + tfsaGains + taxableGains + cashGains + rdspGains,
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
      ...(rdspOn ? { rdspBalance: Math.max(0, rdspBal) } : {}),
      ...(fhsaOn ? { fhsaBalance: Math.max(0, fhsaBal) } : {}),
      cppIncome: cppGross,
      oasIncome: oasGross,
      gisIncome: gisGross,
      pensionIncome: pensionGross,
      rentalIncome: rentalGross,
      employmentGross,
      employmentTax,
      employmentNet,
      ...(debtOn ? { debtPayments: decumDebt.total, debtBalance: debtBalanceNow() } : {}),
      splitEligibleIncome,
      unsplitNetIncome,
      detail: {
        withdraw: wd,
        growth: { rrsp: rrspGains, rrif: rrifGains, tfsa: tfsaGains, taxable: taxableGains, cash: cashGains, ...(rdspOn ? { rdsp: rdspGains } : {}) },
        deposit,
        ...(yearOverflow.tfsa > 0 || yearOverflow.rrsp > 0 ? { overflow: { tfsa: yearOverflow.tfsa, rrsp: yearOverflow.rrsp } } : {}),
        ...((tfsaRoom !== null || rrspRoom !== null) ? { roomRemaining: { ...(tfsaRoom !== null ? { tfsa: Math.max(0, tfsaRoom) } : {}), ...(rrspRoom !== null ? { rrsp: Math.max(0, rrspRoom) } : {}) } } : {}),
        tax: { oasClawback, capitalGains, registeredGross },
        ...(rdspOn ? { rdsp: { contribution: 0, grant: 0, bond: 0, growth: rdspGains, balance: Math.max(0, rdspBal), contributionBasis: rdspContribBasis, taxableFraction: rdspTaxableFraction(), withdrawal: rdspWithdrawn, taxablePortion: rdspTaxable } } : {}),
        ...(rmOn ? { rm: { interestAccrued: rmInterest, scheduledDraw: rmScheduled, topUpDraw: wd.rmDraw, homeValue, loanBalance: rmLoan, ...(rmIsHeloc ? { interestExpense: rmInterestExpense } : {}) } } : {}),
        ...(debtOn ? { debts: decumDebt.rows } : {}),
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
      cashCushionBalance: Math.max(0, cashCushion),
      ...(rdspOn ? { rdspBalance: Math.max(0, rdspBal) } : {}),
      ...(fhsaOn ? { fhsaBalance: Math.max(0, fhsaBal) } : {})
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
    householdDraws,
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
 * Legacy public entry point — kept stable (the persisted `RetirementInputs`
 * shape, and every test/the golden master call it). It derives the universal
 * Household and delegates to the Household-native core, so the engine genuinely
 * runs off the scalable model. New code should call `calculateHouseholdModel`
 * with an already-derived Household instead.
 */
export function calculateHousehold(
  inputs: RetirementInputs,
  config: AppConfig,
  options?: { returnSequence?: Record<number, number> }
): RetirementResults {
  return calculateHouseholdModel(toHousehold(inputs), config, options);
}

/**
 * Household-native top-level entry point. Runs each enabled person as a full
 * person — giving the spouse feature parity (their own events, spending bands,
 * reverse mortgage). The runs exchange benefit context so GIS is assessed on
 * COMBINED non-OAS income at the correct (couple vs single) rate — CRA's couple
 * rules. Pension-splitting is applied as a post-pass, and the household verdict
 * reads the combined breakdown.
 *
 * Driven by the household's `people` array, not two loose variables: the
 * primary is `people` ref 'primary', the partner ref 'spouse'. A single-person
 * household reduces to the primary's own run unchanged. (The couple-specific
 * math — GIS couple rates, pension splitting — is inherently two-person, but
 * it's selected by the presence of an enabled partner, not by hard-coded shape.)
 */
export function calculateHouseholdModel(
  household: Household,
  config: AppConfig,
  options?: { returnSequence?: Record<number, number> }
): RetirementResults {
  const { shared } = household;
  const runnable = enabledPeople(household);
  const primaryPerson: PersonInputs = runnable.find(p => p.ref === 'primary') ?? runnable[0];
  const spPerson = runnable.find(p => p.ref === 'spouse');
  const sp: PersonInputs | undefined = spPerson && spPerson !== primaryPerson ? spPerson : undefined;
  // Current-age context for the pension-split + combined-breakdown age alignment.
  const primaryCurrentAge = primaryPerson.currentAge;
  const spouseCurrentAge = sp?.currentAge ?? primaryCurrentAge;

  const primaryCtx = sp ? {
    cppStartAge: sp.cppStartAge,
    cppMonthlyAmount: sp.cppMonthlyAmount,
    oasStartAge: sp.oasStartAge,
    oasYearsInCanada: sp.oasYearsInCanada,
    currentAge: sp.currentAge,
    income: sp.income,
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
    .map(e => {
      const shift = ownerCurrentAge - selfCurrentAge;
      // owner-age → calendar-year → self-age (same convention as `translate`).
      const age = e.age - shift;
      // When the partners are different ages, the same calendar year can land
      // BEFORE the receiver's current age. calculatePerson drops past-dated
      // events (e.age >= currentAge), so this would vanish silently. Clamp it
      // to fire as soon as possible instead (issue #27); clamp endAge to the
      // same floor so a recurring window stays valid.
      const clamped = Math.max(age, selfCurrentAge);
      return {
        ...e,
        age: clamped,
        ...(e.endAge != null ? { endAge: Math.max(e.endAge - shift, clamped) } : {}),
      };
    });

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

    // The two runs are coupled in BOTH directions:
    //  - inter-spousal transfers: one person's crossDeposits are the other's
    //    inboundDeposits, and those deposits change what the receiver draws;
    //  - couple GIS (#26): each person's GIS depends on the partner's
    //    discretionary draws, which depend on the partner's GIS. Whoever runs
    //    first sees stale (zero) partner draws.
    // Neither coupling has an analytic solution, so iterate the whole pair
    // until both settle. Convergence is measured on the outputs (max per-year
    // |ΔGIS| < $1 and a byte-stable cross-deposit schedule); the pass cap
    // bounds a pathological oscillation. When GIS is zero everywhere in BOTH
    // runs (adding partner draws can only reduce GIS further — income grows,
    // entitlement shrinks) and transfers flow one way, the initial two runs
    // are already the fixed point and the loop is skipped (Monte Carlo cost).
    let finalPrimary = primary;
    let spouseResults = calculatePerson(spRun, shared, config, {
      ...options,
      personRef: 'spouse',
      ...(primaryCtx ? { spouseContext: { ...primaryCtx } } : {}),
      ...(translate(finalPrimary.crossDeposits ?? [], primaryPerson.currentAge, sp.currentAge).length > 0
        ? { inboundDeposits: translate(finalPrimary.crossDeposits ?? [], primaryPerson.currentAge, sp.currentAge) }
        : {}),
    });

    const gisAnywhere = (r: RetirementResults) => r.yearlyBreakdown.some(y => y.gisIncome > 0);
    const twoWayTransfers = (spouseResults.crossDeposits?.length ?? 0) > 0;
    if (gisAnywhere(finalPrimary) || gisAnywhere(spouseResults) || twoWayTransfers) {
      for (let pass = 0; pass < 5; pass++) {
        const prevGisP = finalPrimary.yearlyBreakdown.map(y => y.gisIncome);
        const prevGisS = spouseResults.yearlyBreakdown.map(y => y.gisIncome);

        // Feed each side's latest outputs back into the other. partnerDrawsAt
        // receives the partner's own age (spouseFixedIncomeAt already did the
        // age-axis translation), so the lookup is a direct hit.
        const pToS = translate(finalPrimary.crossDeposits ?? [], primaryPerson.currentAge, sp.currentAge);
        const sToP = translate(spouseResults.crossDeposits ?? [], sp.currentAge, primaryPerson.currentAge);

        finalPrimary = calculatePerson(primaryRun, shared, config, {
          ...options,
          personRef: 'primary',
          ...(primaryCtx
            ? { spouseContext: { ...primaryCtx, partnerDrawsAt: (a: number) => spouseResults.householdDraws?.[a] ?? 0 } }
            : {}),
          ...(sToP.length > 0 ? { inboundDeposits: sToP } : {}),
        });
        spouseResults = calculatePerson(spRun, shared, config, {
          ...options,
          personRef: 'spouse',
          spouseContext: { ...primaryCtx!, partnerDrawsAt: (a: number) => finalPrimary.householdDraws?.[a] ?? 0 },
          ...(pToS.length > 0 ? { inboundDeposits: pToS } : {}),
        });

        // Converged when neither side's GIS moved more than $1 in any year and
        // each side's cross-deposit schedule is unchanged by the re-run it just
        // received (both directions stable ⇒ household conservation holds).
        const gisSettled =
          finalPrimary.yearlyBreakdown.every((y, i) => Math.abs(y.gisIncome - (prevGisP[i] ?? 0)) < 1) &&
          spouseResults.yearlyBreakdown.every((y, i) => Math.abs(y.gisIncome - (prevGisS[i] ?? 0)) < 1);
        const depositsSettled =
          JSON.stringify(translate(finalPrimary.crossDeposits ?? [], primaryPerson.currentAge, sp.currentAge)) === JSON.stringify(pToS) &&
          JSON.stringify(translate(spouseResults.crossDeposits ?? [], sp.currentAge, primaryPerson.currentAge)) === JSON.stringify(sToP);
        if (gisSettled && depositsSettled) break;
      }
    }

    finalPrimary.spouse = spouseResults;
    if (spouseResults.status === 'SHORTFALL') finalPrimary.status = 'SHORTFALL';
    applyPensionSplitting(finalPrimary, spouseResults, primaryCurrentAge, shared.provinceCode, config, spouseCurrentAge);
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
  household: Household
): YearlyBreakdown[] {
  const spouse = results.spouse;
  if (!spouse) return results.yearlyBreakdown;

  const primaryAge = household.people.find(p => p.ref === 'primary')?.currentAge ?? household.people[0]?.currentAge ?? 0;
  const spouseAge = household.people.find(p => p.ref === 'spouse')?.currentAge ?? primaryAge;
  const ageOffset = primaryAge - spouseAge;
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
      ...((py.rdspBalance !== undefined || sy.rdspBalance !== undefined)
        ? { rdspBalance: (py.rdspBalance ?? 0) + (sy.rdspBalance ?? 0) }
        : {}),
      ...((py.fhsaBalance !== undefined || sy.fhsaBalance !== undefined)
        ? { fhsaBalance: (py.fhsaBalance ?? 0) + (sy.fhsaBalance ?? 0) }
        : {}),
      cppIncome: py.cppIncome + sy.cppIncome,
      oasIncome: py.oasIncome + sy.oasIncome,
      gisIncome: py.gisIncome + sy.gisIncome,
      pensionIncome: py.pensionIncome + sy.pensionIncome,
      rentalIncome: (py.rentalIncome ?? 0) + (sy.rentalIncome ?? 0),
      employmentGross: (py.employmentGross ?? 0) + (sy.employmentGross ?? 0),
      employmentTax: (py.employmentTax ?? 0) + (sy.employmentTax ?? 0),
      employmentNet: (py.employmentNet ?? 0) + (sy.employmentNet ?? 0),
      ...((py.debtPayments !== undefined || sy.debtPayments !== undefined)
        ? { debtPayments: (py.debtPayments ?? 0) + (sy.debtPayments ?? 0) }
        : {}),
      ...((py.debtBalance !== undefined || sy.debtBalance !== undefined)
        ? { debtBalance: (py.debtBalance ?? 0) + (sy.debtBalance ?? 0) }
        : {}),
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
export function householdOutcome(results: RetirementResults, household: Household): HouseholdOutcome {
  const combined = combineHouseholdBreakdown(results, household);
  const depletedRow = combined.find(y => y.endingBalance <= 0 && (y.shortfall ?? 0) > 0);
  const depletionAge = depletedRow ? depletedRow.age : null;
  const last = combined[combined.length - 1];
  const endingBalance = depletionAge !== null ? 0 : Math.max(0, last?.endingBalance ?? 0);
  const status: 'ON_TRACK' | 'SHORTFALL' =
    depletionAge !== null && depletionAge < household.shared.maxAge ? 'SHORTFALL' : 'ON_TRACK';
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
  primaryCurrentAge: number,
  province: string,
  config: AppConfig,
  spouseCurrentAge: number
): void {
  const maxRate = config.engine.pensionSplitMaxRate ?? 0;
  if (maxRate <= 0) return;

  const indexTables = config.engine.indexTaxTables === true;
  const inflation = Math.max(0, config.engine.inflationRate ?? 0);
  // Calendar-year inflation factor: spouse rows are offset in age but share the
  // same calendar year as the primary row they pair with.
  const factorAt = (calendarAge: number) => Math.pow(1 + inflation, Math.max(0, calendarAge - primaryCurrentAge));
  const configCache = new Map<number, AppConfig>();
  const configAt = (calendarAge: number): AppConfig => {
    if (!indexTables) return config;
    const f = factorAt(calendarAge);
    if (f === 1) return config;
    let c = configCache.get(calendarAge);
    if (!c) { c = indexConfig(config, f); configCache.set(calendarAge, c); }
    return c;
  };

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
  const ageOffset = primaryCurrentAge - spouseCurrentAge;
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
  // Upper-bound expansion is capped: net() is monotonic in w for any sane table
  // (every marginal rate < 100%), so the bound is found in a few steps. The cap
  // only trips if a user-edited table makes net() non-monotonic — stop there
  // rather than hang the tab.
  for (let i = 0; i < MAX_TAX_ITERATIONS && net(upper) < neededAfterTax; i++) upper *= 1.5;
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
