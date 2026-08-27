// Unified person/household model — the architectural core of the planner.
//
// A HOUSEHOLD is 1–2 PEOPLE plus a small set of shared assumptions (market
// return, volatility, province, horizon). A PERSON is the atom: their accounts,
// ages, CPP/OAS/pensions, spending goal, and cash events. The engine runs one
// person at a time (calculatePerson) and couples two at three seams (GIS,
// pension-splitting, combined breakdown) in calculateHousehold.
//
// This module is the single source of truth for the shapes and for converting
// to/from the legacy RetirementInputs layout (which flattened the primary
// person and the shared household fields into one object). Keeping the
// converters here means every consumer (engine, storage, share links, Monte
// Carlo, the solvers) can migrate to the unified model independently while the
// wire/storage formats stay stable.

import type { RetirementInputs, SpouseInputs, CashEvent, WithdrawalAccount, Pension, SpendingBand, ReverseMortgage } from './retirementEngine';

// ---------------------------------------------------------------------------
// Accounts & transfers
// ---------------------------------------------------------------------------

/** A real account a person holds. 'cash' is the after-tax cash cushion. */
export type AccountId = 'rrsp' | 'tfsa' | 'taxable' | 'cash';

/** Which member of the household an endpoint belongs to. */
export type PersonRef = 'primary' | 'spouse';

/**
 * One end of a cash movement. `external` is money entering/leaving the model
 * from outside (a house sale in, a renovation out). Otherwise the endpoint is
 * one of a person's accounts, enabling account→account transfers (the RRSP
 * meltdown: rrsp → tfsa) and inter-spousal transfers.
 */
export type TransferEndpoint =
  | { kind: 'external' }
  | { kind: 'account'; person: PersonRef; account: AccountId };

// ---------------------------------------------------------------------------
// Person — the atom
// ---------------------------------------------------------------------------

/**
 * One person's complete plan. Everything needed to project their accounts and
 * benefits for a lifetime, EXCEPT the household-shared assumptions (which live
 * on SharedInputs so a couple can't disagree about the market or the calendar).
 * This is the unified replacement for both RetirementInputs (the person half)
 * and SpouseInputs — giving spouses full feature parity (events, spending
 * bands, reverse mortgage, their own withdrawal order).
 */
export interface PersonInputs {
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
  cppMonthlyAmount: number;      // monthly CPP at 65; engine applies early/deferral adjustment
  cppAdjustedAmount: boolean;    // true = amount already adjusted for the start age
  oasStartAge: number | null;
  oasYearsInCanada: number;
  desiredSpending: number;       // after-tax income goal, today's dollars
  withdrawalOrder: WithdrawalAccount[];
  spendingBands?: SpendingBand[];
  pensions?: Pension[];
  events?: CashEvent[];
  reverseMortgage?: ReverseMortgage;
}

// ---------------------------------------------------------------------------
// Shared household assumptions
// ---------------------------------------------------------------------------

/**
 * The handful of fields a household shares. Lifting these off the person is
 * what makes a couple coherent: both partners experience the same market, file
 * in the same province, and project to the same horizon. When a spouse is a
 * reference to another scenario, these are the HOST's values — the referenced
 * plan's own shared fields are ignored (with a surfaced warning).
 */
export interface SharedInputs {
  maxAge: number;
  investmentReturn: number;
  returnVolatility: number;
  provinceCode: string;
}

// ---------------------------------------------------------------------------
// Legacy ↔ unified converters
// ---------------------------------------------------------------------------

/** Strip the household-shared fields off a legacy RetirementInputs, leaving the
 *  person half. */
export function legacyToPerson(inputs: RetirementInputs): PersonInputs {
  return {
    currentAge: inputs.currentAge,
    retirementAge: inputs.retirementAge,
    rrspBalance: inputs.rrspBalance,
    tfsaBalance: inputs.tfsaBalance,
    taxableBalance: inputs.taxableBalance,
    cashCushionBalance: inputs.cashCushionBalance,
    rrspContribution: inputs.rrspContribution,
    tfsaContribution: inputs.tfsaContribution,
    taxableContribution: inputs.taxableContribution,
    cppStartAge: inputs.cppStartAge,
    cppMonthlyAmount: inputs.cppMonthlyAmount,
    cppAdjustedAmount: inputs.cppAdjustedAmount,
    oasStartAge: inputs.oasStartAge,
    oasYearsInCanada: inputs.oasYearsInCanada,
    desiredSpending: inputs.desiredSpending,
    withdrawalOrder: inputs.withdrawalOrder,
    spendingBands: inputs.spendingBands,
    pensions: inputs.pensions,
    events: inputs.events,
    reverseMortgage: inputs.reverseMortgage,
  };
}

/** Lift the household-shared fields off a legacy RetirementInputs. */
export function legacyToShared(inputs: RetirementInputs): SharedInputs {
  return {
    maxAge: inputs.maxAge,
    investmentReturn: inputs.investmentReturn,
    returnVolatility: inputs.returnVolatility,
    provinceCode: inputs.provinceCode,
  };
}

/**
 * A baseline embedded spouse for a plan that has none — the single source of
 * truth used by BOTH the setup wizard ("add a spouse") and the sidebar's
 * spouse checkbox. Ages start at the host's; balances/contributions are zero;
 * CPP/OAS at 65 with typical amounts; spending defaults to half the host's
 * goal (a reasonable single-person share of a couple's spending). Centralizing
 * this keeps the two "add spouse" paths from drifting apart.
 */
export function baselineSpouse(host: {
  currentAge: number;
  retirementAge: number;
  desiredSpending: number;
}): NonNullable<RetirementInputs['spouse']> {
  return {
    enabled: true,
    currentAge: host.currentAge,
    retirementAge: host.retirementAge,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
    cppStartAge: 65, cppMonthlyAmount: 900,
    oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: Math.round(host.desiredSpending / 2),
  };
}

/** Convert a legacy embedded SpouseInputs into a full PersonInputs. The spouse
 *  type carries the full-person parity fields (events, spending bands, reverse
 *  mortgage) optionally — they're passed straight through (absent = none), so
 *  an embedded spouse is a first-class person. Withdrawal order defaults when
 *  absent (older saved spouses may not carry one). */
export function legacySpouseToPerson(sp: SpouseInputs): PersonInputs {
  return {
    currentAge: sp.currentAge,
    retirementAge: sp.retirementAge,
    rrspBalance: sp.rrspBalance,
    tfsaBalance: sp.tfsaBalance,
    taxableBalance: sp.taxableBalance,
    cashCushionBalance: sp.cashCushionBalance,
    rrspContribution: sp.rrspContribution,
    tfsaContribution: sp.tfsaContribution,
    taxableContribution: sp.taxableContribution,
    cppStartAge: sp.cppStartAge,
    cppMonthlyAmount: sp.cppMonthlyAmount,
    // Legacy spouses always entered an already-adjusted CPP amount is NOT true —
    // the household run passed cppAdjustedAmount:false for spouses, so preserve
    // that: the spouse amount is the age-65 amount and gets adjusted.
    cppAdjustedAmount: false,
    oasStartAge: sp.oasStartAge,
    oasYearsInCanada: sp.oasYearsInCanada,
    desiredSpending: sp.desiredSpending,
    withdrawalOrder: sp.withdrawalOrder ?? ['tfsa', 'taxable', 'rrsp'],
    spendingBands: sp.spendingBands,
    pensions: sp.pensions,
    events: sp.events,
    reverseMortgage: sp.reverseMortgage,
  };
}

// ---------------------------------------------------------------------------
// Cash-event transfer helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an event to explicit from/to endpoints, filling defaults for the
 * legacy direction/account representation:
 *   direction 'in'  → external → { primary, account ?? taxable }
 *   direction 'out' → { primary, account ?? <withdrawal order> } → external(spending)
 * Explicit from/to (when present) always win.
 */
export function eventEndpoints(ev: CashEvent): { from: TransferEndpoint; to: TransferEndpoint } {
  const external: TransferEndpoint = { kind: 'external' };
  if (ev.from || ev.to) {
    return {
      from: ev.from ?? external,
      to: ev.to ?? external,
    };
  }
  if (ev.direction === 'in') {
    return {
      from: external,
      to: { kind: 'account', person: 'primary', account: ev.account ?? 'taxable' },
    };
  }
  // 'out': source defaults to the person's accounts in withdrawal order, sink
  // is external spending. The engine handles the multi-account draw.
  return {
    from: { kind: 'account', person: 'primary', account: ev.account ?? 'cash' },
    to: external,
  };
}

// ---------------------------------------------------------------------------
// Spouse-source resolution (the spouse-adapter the app actually stores)
// ---------------------------------------------------------------------------

export interface ResolvedSpouse {
  /** The materialized spouse plan the engine runs (undefined when the link
   *  can't be resolved — e.g. the referenced scenario was deleted). */
  spouse?: SpouseInputs;
  /** Host-wins conflicts + resolution problems, surfaced to the user. */
  warnings: string[];
}

/**
 * Materialize a spouse from its source. A builtin spouse is used as-is. A
 * scenario spouse is looked up among the saved scenarios and its person half
 * extracted into the SpouseInputs shape; the HOST's shared household fields
 * (province, return, horizon) always win over the referenced plan's own, and
 * each overridden field that differed is reported as a warning so the UI can
 * show exactly what was ignored.
 *
 * Circular references (A's spouse is B while B's spouse is A) and self-
 * references are guarded by comparing against the host's own scenario id and
 * the referenced plan's own spouseSource: a detected cycle yields no spouse
 * and a warning rather than a loop.
 */
export function resolveSpouseSource(
  host: RetirementInputs,
  scenarios: Array<{ id: string; inputs: RetirementInputs }>,
  hostScenarioId?: string,
): ResolvedSpouse {
  const src = host.spouseSource;
  if (!src || src.kind === 'builtin') {
    return { spouse: host.spouse, warnings: [] };
  }

  const warnings: string[] = [];
  const targetId = src.scenarioId;

  // Self-reference is the degenerate cycle.
  if (hostScenarioId != null && targetId === hostScenarioId) {
    return { warnings: ['A plan cannot be its own spouse — the spouse link was ignored.'] };
  }
  const target = scenarios.find(s => s.id === targetId);
  if (!target) {
    return { warnings: ['Linked spouse scenario was not found — the spouse link was ignored.'] };
  }
  // Direct two-way cycle: the target names this host as ITS spouse.
  const tSrc = target.inputs.spouseSource;
  if (tSrc?.kind === 'scenario' && hostScenarioId != null && tSrc.scenarioId === hostScenarioId) {
    return { warnings: ['Circular spouse reference detected — the spouse link was ignored.'] };
  }

  // Host wins on the shared household fields; report each that differed, with
  // the reason — a couple lives in one province, experiences one market, and
  // shares one planning horizon, so the household supplies a single value for
  // both partners. Explaining WHY (not just WHAT was ignored) is what makes the
  // override feel principled rather than arbitrary.
  const their = target.inputs;
  if (their.provinceCode !== host.provinceCode) {
    warnings.push(`Province: using yours (${host.provinceCode}), not the linked plan's (${their.provinceCode}) — a household files taxes in one province. Edit the linked plan's province to match if you both live there.`);
  }
  if (their.investmentReturn !== host.investmentReturn) {
    warnings.push(`Investment return: using yours, not the linked plan's — both partners' accounts are projected with one shared market assumption so the household is internally consistent.`);
  }
  if (their.maxAge !== host.maxAge) {
    warnings.push(`Horizon (max age): using yours, not the linked plan's — a household projects both partners to a single planning horizon.`);
  }

  // Materialize the referenced plan's person into the SpouseInputs shape the
  // engine runs (the shared fields come from the host, so they're not copied).
  const spouse: SpouseInputs = {
    enabled: true,
    currentAge: their.currentAge,
    retirementAge: their.retirementAge,
    rrspBalance: their.rrspBalance,
    tfsaBalance: their.tfsaBalance,
    taxableBalance: their.taxableBalance,
    cashCushionBalance: their.cashCushionBalance,
    rrspContribution: their.rrspContribution,
    tfsaContribution: their.tfsaContribution,
    taxableContribution: their.taxableContribution,
    cppStartAge: their.cppStartAge,
    cppMonthlyAmount: their.cppMonthlyAmount,
    oasStartAge: their.oasStartAge,
    oasYearsInCanada: their.oasYearsInCanada,
    desiredSpending: their.desiredSpending,
    withdrawalOrder: their.withdrawalOrder,
    pensions: their.pensions,
    // Full-person parity: the linked plan's own events (incl. transfers),
    // spending bands and reverse mortgage run as the spouse's, just like an
    // embedded spouse. Absent on the source = none.
    events: their.events,
    spendingBands: their.spendingBands,
    reverseMortgage: their.reverseMortgage,
  };
  return { spouse, warnings };
}
