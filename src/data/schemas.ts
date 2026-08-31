import { z } from 'zod';
import type {
  RetirementInputs, SpouseInputs, CashEvent, IncomeSource, SpendingBand,
  ReverseMortgage, WithdrawalAccount, RdspInputs, FhsaInputs, Debt,
} from '../lib/retirementEngine';
import type { AppConfig, TaxTable } from '../lib/appConfig';
import type { Scenario } from '../lib/types';
import { migrateInputs } from './migrations';

/**
 * Zod schemas — the single source of truth for every shape the app PERSISTS
 * (scenarios, engine config, the whole-app database document). Everything that
 * crosses a storage boundary (localStorage, the SQLite blob, an imported file)
 * is parsed through these, so a malformed or stale payload is either migrated
 * or rejected at the door instead of corrupting the app state.
 *
 * The schemas are typed against the engine interfaces: a mismatch between the
 * two is a compile error here, not a runtime surprise in the field.
 */

// ---------------------------------------------------------------------------
// Engine input shapes
// ---------------------------------------------------------------------------

const withdrawalAccount = z.enum(['rrsp', 'tfsa', 'taxable', 'rdsp']) satisfies z.ZodType<WithdrawalAccount>;

const transferEndpoint = z.union([
  z.object({ kind: z.literal('external') }),
  z.object({
    kind: z.literal('account'),
    person: z.enum(['primary', 'spouse']),
    account: z.enum(['rrsp', 'tfsa', 'taxable', 'cash']),
  }),
]);

export const cashEventSchema = z.object({
  id: z.string(),
  age: z.number(),
  label: z.string(),
  amount: z.number(),
  direction: z.enum(['in', 'out']),
  account: z.enum(['rrsp', 'tfsa', 'taxable', 'cash']).optional(),
  endAge: z.number().nullish(),
  from: transferEndpoint.optional(),
  to: transferEndpoint.optional(),
}) satisfies z.ZodType<CashEvent>;

// One entry in a person's income register. All four kinds are live in the
// engine (issue #119): employment/selfEmployment are earned (build RRSP room,
// save their net), pension is split-eligible retirement income, rental is
// taxable investment income. Replaces the legacy pensionSchema /
// employmentIncomeSchema pair.
export const incomeSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['employment', 'pension', 'selfEmployment', 'rental']),
  annualAmount: z.number(),
  startAge: z.number(),
  endAge: z.number().nullable(),
  indexedToCpi: z.boolean(),
  destAccount: z.enum(['rrsp', 'tfsa', 'taxable', 'cash']).optional(),
  topUpSpending: z.boolean().optional(),
  savingsRate: z.number().min(0).max(1).optional(),
  rrspEligible: z.boolean().optional(),
  pensionAdjustment: z.number().optional(),
}) satisfies z.ZodType<IncomeSource>;

export const spendingBandSchema = z.object({
  fromAge: z.number(),
  pctOfBase: z.number(),
}) satisfies z.ZodType<SpendingBand>;

export const reverseMortgageSchema = z.object({
  enabled: z.boolean(),
  homeValue: z.number(),
  appreciationRate: z.number(),
  interestRate: z.number(),
  mode: z.enum(['reverse', 'heloc']).optional(),
  maxLtv: z.number().optional(),
  drawAmount: z.number().optional(),
  startAge: z.number().optional(),
  durationYears: z.number().optional(),
  topUp: z.boolean().optional(),
}) satisfies z.ZodType<ReverseMortgage>;

export const rdspSchema = z.object({
  enabled: z.boolean(),
  balance: z.number(),
  contribution: z.number(),
  familyIncome: z.number(),
  contributionBasis: z.number().optional(),
  dtcEligible: z.boolean(),
}) satisfies z.ZodType<RdspInputs>;

export const fhsaSchema = z.object({
  enabled: z.boolean(),
  balance: z.number(),
  contribution: z.number(),
  contributionBasis: z.number().optional(),
  openAge: z.number().optional(),
}) satisfies z.ZodType<FhsaInputs>;

export const debtSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['mortgage', 'creditCard', 'loan', 'lineOfCredit', 'other']),
  balance: z.number(),
  interestRate: z.number(),
  monthlyPayment: z.number(),
  startAge: z.number().optional(),
  endAge: z.number().nullish(),
}) satisfies z.ZodType<Debt>;

const spouseSourceSchema = z.union([
  z.object({ kind: z.literal('builtin') }),
  z.object({ kind: z.literal('scenario'), scenarioId: z.string() }),
]);

export const spouseSchema = z.object({
  enabled: z.boolean(),
  currentAge: z.number(),
  retirementAge: z.number(),
  rrspBalance: z.number(),
  tfsaBalance: z.number(),
  taxableBalance: z.number(),
  cashCushionBalance: z.number(),
  rrspContribution: z.number(),
  tfsaContribution: z.number(),
  taxableContribution: z.number(),
  tfsaRoom: z.number().nullable().optional(),
  rrspRoom: z.number().nullable().optional(),
  cppStartAge: z.number().nullable(),
  cppMonthlyAmount: z.number(),
  oasStartAge: z.number().nullable(),
  oasYearsInCanada: z.number(),
  desiredSpending: z.number(),
  withdrawalOrder: z.array(withdrawalAccount).optional(),
  income: z.array(incomeSourceSchema).optional(),
  events: z.array(cashEventSchema).optional(),
  spendingBands: z.array(spendingBandSchema).optional(),
  reverseMortgage: reverseMortgageSchema.optional(),
  rdsp: rdspSchema.optional(),
  fhsa: fhsaSchema.optional(),
  debts: z.array(debtSchema).optional(),
}) satisfies z.ZodType<SpouseInputs>;

export const retirementInputsSchema = z.object({
  currentAge: z.number(),
  retirementAge: z.number(),
  maxAge: z.number(),
  rrspBalance: z.number(),
  tfsaBalance: z.number(),
  taxableBalance: z.number(),
  cashCushionBalance: z.number(),
  rrspContribution: z.number(),
  tfsaContribution: z.number(),
  taxableContribution: z.number(),
  tfsaRoom: z.number().nullable().optional(),
  rrspRoom: z.number().nullable().optional(),
  annualWithdrawal: z.number(),
  investmentReturn: z.number(),
  returnVolatility: z.number(),
  provinceCode: z.string(),
  cppStartAge: z.number().nullable(),
  cppMonthlyAmount: z.number(),
  cppAdjustedAmount: z.boolean(),
  oasStartAge: z.number().nullable(),
  oasYearsInCanada: z.number(),
  desiredSpending: z.number(),
  successFactor: z.number().optional(),
  withdrawalOrder: z.array(withdrawalAccount),
  events: z.array(cashEventSchema).optional(),
  spendingBands: z.array(spendingBandSchema).optional(),
  spouse: spouseSchema.optional(),
  spouseSource: spouseSourceSchema.optional(),
  income: z.array(incomeSourceSchema).optional(),
  reverseMortgage: reverseMortgageSchema.optional(),
  rdsp: rdspSchema.optional(),
  fhsa: fhsaSchema.optional(),
  debts: z.array(debtSchema).optional(),
}) satisfies z.ZodType<RetirementInputs>;

export const scenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  inputs: retirementInputsSchema,
}) satisfies z.ZodType<Scenario>;

// ---------------------------------------------------------------------------
// Engine configuration
// ---------------------------------------------------------------------------

const taxTableSchema: z.ZodType<TaxTable> = z.object({
  brackets: z.array(z.number()),
  rates: z.array(z.number()),
  exemption: z.number(),
}).refine(t => t.rates.length === t.brackets.length + 1, {
  message: 'rates must have exactly one more entry than brackets',
});

export const appConfigSchema: z.ZodType<AppConfig> = z.object({
  federal: taxTableSchema,
  // z.record's value type is `T | undefined` under noUncheckedIndexedAccess;
  // the config interfaces index without undefined, so cast the record shape.
  provinces: z.record(z.string(), taxTableSchema) as z.ZodType<Record<string, TaxTable>>,
  rrifRates: z.record(z.string(), z.number()) as z.ZodType<Record<string, number>>,
  oas: z.object({
    baseMonthly65to74: z.number(),
    baseMonthly75plus: z.number(),
    deferralBonusPerMonth: z.number(),
    eligibleAge: z.number(),
    maxDeferralAge: z.number(),
    minResidencyYears: z.number(),
    fullPensionResidencyYears: z.number(),
    clawbackRate: z.number(),
    clawbackThreshold: z.number(),
    gisMaxAnnualSingle: z.number(),
    gisMaxAnnualCouple: z.number(),
    gisReductionRate: z.number(),
  }),
  cpp: z.object({
    standardAge: z.number(),
    earliestAge: z.number(),
    maxDeferralAge: z.number(),
    earlyPenaltyPerMonth: z.number(),
    deferralBonusPerMonth: z.number(),
    selfEmployedRate: z.number(),
    ympe: z.number(),
    basicExemption: z.number(),
  }),
  engine: z.object({
    cashCushionRate: z.number(),
    rrifConversionAge: z.number(),
    inflationRate: z.number(),
    indexSpending: z.boolean(),
    indexTaxTables: z.boolean(),
    capitalGainsInclusion: z.number(),
    taxableAcbRatio: z.number(),
    pensionSplitMaxRate: z.number(),
    tfsaAnnualLimit: z.number(),
    rrspAnnualMax: z.number(),
  }),
  rdsp: z.object({
    grantThreshold: z.number(),
    grantAnnualMax: z.number(),
    grantLifetimeMax: z.number(),
    grantEndAge: z.number(),
    bondThresholdLower: z.number(),
    bondThresholdUpper: z.number(),
    bondAnnualMax: z.number(),
    bondLifetimeMax: z.number(),
    contributionLifetimeMax: z.number(),
    contributionEndAge: z.number(),
  }),
  fhsa: z.object({
    annualLimit: z.number(),
    lifetimeLimit: z.number(),
    maxYears: z.number(),
  }),
  qcFederalAbatement: z.number(),
  ontarioSurtax: z.object({
    threshold1: z.number(), rate1: z.number(),
    threshold2: z.number(), rate2: z.number(),
  }),
  general: z.object({
    showWelcomeOnLoad: z.boolean(),
    promptToSaveOnSwitch: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// The whole-app database document (one row in the SQLite store / one JSON file)
// ---------------------------------------------------------------------------

export const appDbDocSchema = z.object({
  version: z.number(),
  scenarios: z.array(scenarioSchema).min(1),
  activeScenarioId: z.string(),
  config: appConfigSchema,
});

export type AppDbDoc = z.infer<typeof appDbDocSchema>;

/**
 * Parse an untrusted persisted payload into the app database document.
 * Legacy payloads (pre-schema fields, bare scenario arrays) are run through
 * the input migrator first so one code path handles both. Returns null when
 * the payload can't be made to fit — callers fall back to defaults.
 */
export function parseAppDbDoc(raw: unknown): AppDbDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  // Migrate each scenario's inputs first (fills fields added by later
  // versions), then validate the result strictly.
  if (Array.isArray(candidate.scenarios)) {
    for (const s of candidate.scenarios) {
      if (s && typeof s === 'object' && 'inputs' in s) {
        (s as { inputs: unknown }).inputs = migrateInputs((s as { inputs: object }).inputs);
      }
    }
  }
  const result = appDbDocSchema.safeParse(candidate);
  if (!result.success) return null;
  // An active id that no longer exists falls back to the first scenario.
  if (!result.data.scenarios.some(s => s.id === result.data.activeScenarioId)) {
    result.data.activeScenarioId = result.data.scenarios[0].id;
  }
  return result.data;
}
