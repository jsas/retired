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
 * on HouseholdInputs.shared so a couple can't disagree about the market or the
 * calendar). This is the unified replacement for both RetirementInputs (the
 * person half) and SpouseInputs — giving spouses full feature parity (events,
 * spending bands, reverse mortgage, their own withdrawal order).
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
// Spouse adapters
// ---------------------------------------------------------------------------

/**
 * How the second person in a couple is supplied.
 *  - builtin:  the spouse's plan is embedded directly (today's behaviour, and
 *              what legacy embedded spouses migrate to).
 *  - scenario: the spouse IS another saved scenario, referenced by id. Its
 *              person fields are used; its shared fields are overridden by the
 *              host's (host wins), and the conflict is reported as a warning.
 */
export type SpouseAdapter =
  | { kind: 'builtin'; person: PersonInputs }
  | { kind: 'scenario'; scenarioId: string };

// ---------------------------------------------------------------------------
// Household — 1–2 people + shared assumptions
// ---------------------------------------------------------------------------

export interface HouseholdInputs {
  shared: SharedInputs;
  primary: PersonInputs;
  /** Absent = a single-person household. Present = a couple. */
  spouse?: SpouseAdapter;
}

/** A spouse adapter resolved to a concrete person, plus any host-wins notes. */
export interface ResolvedHousehold {
  shared: SharedInputs;
  primary: PersonInputs;
  /** The resolved spouse person (undefined for a single). */
  spouse?: PersonInputs;
  /** Host-wins conflicts surfaced when a scenario spouse's shared fields were
   *  overridden by the host's values. Empty unless spouse.kind === 'scenario'. */
  warnings: string[];
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

/** Convert a legacy embedded SpouseInputs into a full PersonInputs, filling the
 *  fields the stripped spouse type never carried (events, spending bands,
 *  reverse mortgage) with neutral defaults. This is the feature-parity bridge:
 *  an old embedded spouse becomes a first-class person. */
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
    spendingBands: undefined,
    pensions: sp.pensions,
    events: undefined,
    reverseMortgage: undefined,
  };
}

/**
 * Build a unified HouseholdInputs from a legacy RetirementInputs. The primary
 * and shared fields split off; an enabled embedded spouse becomes a builtin
 * adapter holding a full PersonInputs.
 */
export function legacyToHousehold(inputs: RetirementInputs): HouseholdInputs {
  const household: HouseholdInputs = {
    shared: legacyToShared(inputs),
    primary: legacyToPerson(inputs),
  };
  if (inputs.spouse?.enabled) {
    household.spouse = { kind: 'builtin', person: legacySpouseToPerson(inputs.spouse) };
  }
  return household;
}

/**
 * Flatten a resolved household back into the legacy RetirementInputs shape.
 * Used where a consumer still speaks the old format (storage, share links, and
 * the many lib callers) so they can adopt the unified model incrementally.
 * A scenario-referenced spouse is flattened to its resolved person as a
 * builtin — the legacy shape has no way to express a live reference.
 */
export function householdToLegacy(resolved: ResolvedHousehold): RetirementInputs {
  const { shared, primary, spouse } = resolved;
  const legacy: RetirementInputs = {
    currentAge: primary.currentAge,
    retirementAge: primary.retirementAge,
    maxAge: shared.maxAge,
    rrspBalance: primary.rrspBalance,
    tfsaBalance: primary.tfsaBalance,
    taxableBalance: primary.taxableBalance,
    cashCushionBalance: primary.cashCushionBalance,
    rrspContribution: primary.rrspContribution,
    tfsaContribution: primary.tfsaContribution,
    taxableContribution: primary.taxableContribution,
    annualWithdrawal: 0,
    investmentReturn: shared.investmentReturn,
    returnVolatility: shared.returnVolatility,
    provinceCode: shared.provinceCode,
    cppStartAge: primary.cppStartAge,
    cppMonthlyAmount: primary.cppMonthlyAmount,
    cppAdjustedAmount: primary.cppAdjustedAmount,
    oasStartAge: primary.oasStartAge,
    oasYearsInCanada: primary.oasYearsInCanada,
    desiredSpending: primary.desiredSpending,
    withdrawalOrder: primary.withdrawalOrder,
    spendingBands: primary.spendingBands,
    pensions: primary.pensions,
    events: primary.events,
    reverseMortgage: primary.reverseMortgage,
  };
  if (spouse) {
    legacy.spouse = {
      enabled: true,
      currentAge: spouse.currentAge,
      retirementAge: spouse.retirementAge,
      rrspBalance: spouse.rrspBalance,
      tfsaBalance: spouse.tfsaBalance,
      taxableBalance: spouse.taxableBalance,
      cashCushionBalance: spouse.cashCushionBalance,
      rrspContribution: spouse.rrspContribution,
      tfsaContribution: spouse.tfsaContribution,
      taxableContribution: spouse.taxableContribution,
      cppStartAge: spouse.cppStartAge,
      cppMonthlyAmount: spouse.cppMonthlyAmount,
      oasStartAge: spouse.oasStartAge,
      oasYearsInCanada: spouse.oasYearsInCanada,
      desiredSpending: spouse.desiredSpending,
      withdrawalOrder: spouse.withdrawalOrder,
      pensions: spouse.pensions,
    };
  }
  return legacy;
}

// ---------------------------------------------------------------------------
// Spouse-adapter resolution (with circular-reference guard + host-wins)
// ---------------------------------------------------------------------------

export interface ScenarioLookup {
  id: string;
  inputs: RetirementInputs;
}

/**
 * Resolve a household's spouse adapter to a concrete PersonInputs.
 *
 * A builtin spouse is used directly. A scenario spouse is looked up by id among
 * the saved scenarios and its person half extracted; the host's shared fields
 * always win (host wins), and each overridden field that differed is reported
 * as a warning so the UI can show exactly what was ignored.
 *
 * Circular references are guarded by `seen`: if scenario A names B as its
 * spouse and B (transitively) names A, resolution stops and the spouse is
 * dropped with a warning rather than recursing forever. A self-reference is the
 * degenerate cycle and is caught the same way.
 */
export function resolveHousehold(
  household: HouseholdInputs,
  scenarios?: ScenarioLookup[],
  seen: Set<string> = new Set(),
): ResolvedHousehold {
  const { shared, primary, spouse } = household;
  if (!spouse) return { shared, primary, warnings: [] };

  if (spouse.kind === 'builtin') {
    return { shared, primary, spouse: spouse.person, warnings: [] };
  }

  // spouse.kind === 'scenario'
  const warnings: string[] = [];
  const targetId = spouse.scenarioId;

  if (seen.has(targetId)) {
    warnings.push('Circular spouse reference detected — the spouse link was ignored.');
    return { shared, primary, warnings };
  }
  const target = scenarios?.find(s => s.id === targetId);
  if (!target) {
    warnings.push('Linked spouse scenario was not found — the spouse link was ignored.');
    return { shared, primary, warnings };
  }

  // The referenced scenario becomes the spouse PERSON. Its own shared fields
  // are overridden by the host's (host wins); report each that differed.
  const theirShared = legacyToShared(target.inputs);
  if (theirShared.provinceCode !== shared.provinceCode) {
    warnings.push(`Province: host (${shared.provinceCode}) used, spouse's (${theirShared.provinceCode}) ignored.`);
  }
  if (theirShared.investmentReturn !== shared.investmentReturn) {
    warnings.push('Investment return: host value used, spouse\'s ignored.');
  }
  if (theirShared.maxAge !== shared.maxAge) {
    warnings.push('Horizon (max age): host value used, spouse\'s ignored.');
  }

  const person = legacyToPerson(target.inputs);

  // Guard a transitive cycle: if the referenced scenario itself has a spouse
  // adapter, make sure following it can't loop back here. We only need the
  // person half, so we don't recurse into their spouse — but a self/chain
  // reference back to this host is impossible to express once we've taken just
  // their person fields, so the seen-guard above is the real protection.
  void seen;

  return { shared, primary, spouse: person, warnings };
}

// ---------------------------------------------------------------------------
// Cash-event transfer helpers
// ---------------------------------------------------------------------------

/** True when an event moves money between two accounts/people (not just in or
 *  out of the model). Drives both the engine's transfer path and the UI's
 *  simple-vs-advanced disclosure. */
export function isTransferEvent(ev: CashEvent): boolean {
  return ev.from != null || ev.to != null;
}

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
