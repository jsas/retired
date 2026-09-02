// Global application configuration: tax tables, RRIF rates, OAS parameters,
// and engine assumptions. Everything here is user-editable via the Settings
// modal; persistence lives in the SQL store (issue #21) — this module is pure
// types, defaults and validation. Defaults are the Canadian values ported from
// the retirement-drawdown engine.

export interface TaxTable {
  brackets: number[];
  rates: number[];
  exemption: number;
}

export interface OasConfig {
  baseMonthly65to74: number;
  baseMonthly75plus: number;
  deferralBonusPerMonth: number;
  eligibleAge: number;
  maxDeferralAge: number;
  minResidencyYears: number;
  fullPensionResidencyYears: number;
  clawbackRate: number;      // recovery tax rate on net income above the threshold
  clawbackThreshold: number; // annual net income where OAS recovery begins
  // Guaranteed Income Supplement (single person): max annual amount, clawed
  // back at gisReductionRate per dollar of income excluding OAS. Approximated
  // annually (Service Canada recalculates quarterly).
  gisMaxAnnualSingle: number;
  // Couple (both spouses on full OAS): max annual amount PER SPOUSE, clawed
  // back at gisReductionRate per dollar of COMBINED income excluding OAS.
  // Each spouse's entitlement is assessed on household income. (When only one
  // spouse receives OAS, CRA instead pays that spouse up to the single amount
  // against combined income — handled by the engine, no extra config.)
  gisMaxAnnualCouple: number;
  gisReductionRate: number;
}

export interface CppConfig {
  standardAge: number;          // unadjusted benefit age (65)
  earliestAge: number;          // earliest start (60)
  maxDeferralAge: number;       // latest start (70)
  earlyPenaltyPerMonth: number; // reduction per month before standardAge (0.006)
  deferralBonusPerMonth: number; // increase per month after standardAge (0.007)
  // Self-employed CPP payroll contribution (2026): a self-employed person pays
  // BOTH the employee and employer shares — selfEmployedRate × pensionable
  // earnings (net self-employment income between the basic exemption and the
  // YMPE). That contribution is a DEDUCTION from taxable income (the employee
  // half as a deduction, the employer half not taxed either — modelled as one
  // pre-tax deduction). 0 disables the deduction.
  selfEmployedRate: number;     // combined employee+employer rate (0.119 in 2026)
  ympe: number;                 // Year's Maximum Pensionable Earnings ($71,300 in 2026)
  basicExemption: number;       // earnings below this are exempt ($3,500)
}

export interface EngineConfig {
  cashCushionRate: number;   // annual growth rate of the cash cushion
  rrifConversionAge: number; // age at which RRSP converts to RRIF
  inflationRate: number;     // annual CPI — the rate behind both toggles below
  indexSpending: boolean;    // inflate the spending target each year by CPI (off = flat in today's dollars)
  indexTaxTables: boolean;   // also inflate tax brackets, exemptions, OAS amounts/threshold and CPP each year
  capitalGainsInclusion: number; // fraction of a capital gain included in taxable income (0.5)
  taxableAcbRatio: number;   // ACB as a fraction of the initial taxable balance (1 = all principal)
  // Pension income splitting (couples): up to half of eligible pension income
  // (RRIF/RRSP draws from the RRIF-conversion age, plus DB/bridge pensions —
  // NOT CPP or OAS) may be allocated to the lower-taxed spouse. Set 0 to
  // disable. CRA's maximum is 0.5.
  pensionSplitMaxRate: number;
  // Registered-plan limits (2026): the TFSA annual dollar limit and the RRSP
  // annual maximum (18% of earned income, capped here). Used to flag deposits
  // that exceed a year's limit; full room tracking is issue #24.
  tfsaAnnualLimit: number;
  rrspAnnualMax: number;
}

/**
 * Registered Disability Savings Plan parameters (2026). A savings plan for
 * Canadians eligible for the Disability Tax Credit: contributions are NOT
 * deductible, growth is tax-sheltered, and the federal government adds
 * Canada Disability Savings Grants (CDSG, matching contributions) and Bonds
 * (CDSB, income-tested, no contribution needed). On withdrawal, the
 * CONTRIBUTION portion is tax-free while the grant/bond/growth portion is
 * taxable income. Sources: canada.ca "How much you could get in grants and
 * bonds" (2026 thresholds).
 *
 * NOT modelled (by design, surfaced in Help): the 10-year Assistance
 * Holdback Amount (AHA) clawback on withdrawal, and the 10-year carry-forward
 * of unused grant/bond entitlements.
 */
export interface RdspConfig {
  // CDSG (grant): family income at/below grantThreshold gets 300% on the
  // first $500 contributed + 200% on the next $1,000 (max grantAnnualMax/yr,
  // reached with $1,500 of contributions). Above the threshold the match is
  // 100% on the first $1,000 (max $1,000). Family income = the beneficiary's
  // own + spouse's income (app uses current-year income; CRA actually reads
  // the return from 2 years prior).
  grantThreshold: number;
  grantAnnualMax: number;    // max CDSG per year (3,500)
  grantLifetimeMax: number;  // max CDSG over a lifetime (70,000)
  grantEndAge: number;       // grants/bonds are paid up to Dec 31 of the year the beneficiary turns this age (49)
  // CDSB (bond): income-tested, no contribution required. At/below
  // bondThresholdLower pays bondAnnualMax/yr; between lower and upper the bond
  // phases out linearly to $0; at/above the upper threshold, $0.
  bondThresholdLower: number;
  bondThresholdUpper: number;
  bondAnnualMax: number;     // max CDSB per year (1,000)
  bondLifetimeMax: number;   // max CDSB over a lifetime (20,000)
  // Contributions: no annual limit, a lifetime cap, allowed up to Dec 31 of
  // the year the beneficiary turns contributionEndAge (59).
  contributionLifetimeMax: number; // (200,000)
  contributionEndAge: number;      // (59)
}

/**
 * First Home Savings Account parameters (2026). A savings plan for a first
 * home: contributions are DEDUCTIBLE (like an RRSP, reducing taxable income in
 * the year), growth is tax-sheltered, and a withdrawal to buy a qualifying
 * first home is TAX-FREE. If the money isn't used for a qualifying home it can
 * be transferred to an RRSP/RRIF with no contribution room required (taxed on
 * later withdrawal), or withdrawn as taxable income. The account must be used
 * within 15 years of opening. Accumulation-only in this engine: it never
 * enters the retirement withdrawal order.
 *
 * NOT modelled (by design): the qualifying-home withdrawal event itself and
 * the 15-year forced closure — the balance is assumed transferred to the RRSP
 * at the retirement boundary (the common "didn't buy" path). Sources: canada.ca
 * "First Home Savings Account" ($8,000/yr, $40,000 lifetime).
 */
export interface FhsaConfig {
  annualLimit: number;    // max contribution per year (8,000)
  lifetimeLimit: number;  // max total contributions (40,000)
  maxYears: number;       // account must be used within this many years of opening (15)
}

export interface AppConfig {
  federal: TaxTable;
  provinces: Record<string, TaxTable>;
  rrifRates: Record<string, number>; // age (as string) -> minimum rate
  oas: OasConfig;
  cpp: CppConfig;
  engine: EngineConfig;
  rdsp: RdspConfig;
  fhsa: FhsaConfig;
  qcFederalAbatement: number;  // Quebec abatement: fraction of federal tax refunded (0.165)
  ontarioSurtax: {             // Ontario surtax on provincial tax above two thresholds
    threshold1: number; rate1: number;
    threshold2: number; rate2: number;
  };
  general: GeneralConfig;
}

export interface GeneralConfig {
  showWelcomeOnLoad: boolean;  // always show the getting-started welcome card at startup, even after dismissal
  /** Ask to save before switching away from a plan with unsaved edits.
   *  true (default) = prompt each time; false = switch silently (the opt-out). */
  promptToSaveOnSwitch: boolean;
}

// 2026 Canadian tax figures (CRA indexation 2.0% for 2026; Alberta's new 8%
// low-income bracket and the 14% federal low rate are 2026 legislative changes,
// not indexation). Provinces that don't index (MB, PE) keep their legislated
// 2025/2026 values. Basic personal amounts are the known 2026 values where
// published, otherwise the 2025 amount indexed by 2.0%.
export const DEFAULT_APP_CONFIG: AppConfig = {
  federal: {
    brackets: [58523, 117045, 181440, 258482],
    rates: [0.14, 0.205, 0.26, 0.29, 0.33],
    exemption: 16452
  },
  provinces: {
    ONT: { brackets: [53891, 107785, 150000, 220000], rates: [0.0505, 0.0915, 0.1116, 0.1216, 0.1316], exemption: 13002 },
    NL:  { brackets: [44678, 89254, 159528, 223340, 285319, 570638, 1141275], rates: [0.087, 0.145, 0.158, 0.178, 0.198, 0.208, 0.213, 0.218], exemption: 11288 },
    PE:  { brackets: [33328, 64656, 105000, 140000], rates: [0.095, 0.1347, 0.166, 0.1762, 0.19], exemption: 14250 },
    NS:  { brackets: [30995, 61991, 97417, 157124], rates: [0.0879, 0.1495, 0.1667, 0.175, 0.21], exemption: 8919 },
    NB:  { brackets: [52333, 104666, 193861], rates: [0.094, 0.14, 0.16, 0.195], exemption: 13664 },
    MB:  { brackets: [47564, 101200], rates: [0.108, 0.1275, 0.174], exemption: 15969 },
    SK:  { brackets: [54532, 155805], rates: [0.105, 0.125, 0.145], exemption: 19881 },
    AB:  { brackets: [61200, 154259, 185111, 246813, 370220], rates: [0.08, 0.10, 0.12, 0.13, 0.14, 0.15], exemption: 22323 },
    BC:  { brackets: [50363, 100728, 115648, 140430, 190405, 265545], rates: [0.0506, 0.077, 0.105, 0.1229, 0.147, 0.168, 0.205], exemption: 13191 },
    YT:  { brackets: [58523, 117045, 181440, 500000], rates: [0.064, 0.09, 0.109, 0.128, 0.15], exemption: 16452 },
    NT:  { brackets: [53003, 106009, 172346], rates: [0.059, 0.086, 0.122, 0.1405], exemption: 18199 },
    NU:  { brackets: [55801, 111602, 181439], rates: [0.04, 0.07, 0.09, 0.115], exemption: 19659 },
    QC:  { brackets: [54345, 108680, 132245], rates: [0.14, 0.19, 0.24, 0.2575], exemption: 18942 }
  },
  rrifRates: {
    '71': 0.0528, '72': 0.0540, '73': 0.0553, '74': 0.0567, '75': 0.0582,
    '76': 0.0598, '77': 0.0617, '78': 0.0636, '79': 0.0658, '80': 0.0682,
    '81': 0.0708, '82': 0.0738, '83': 0.0771, '84': 0.0808, '85': 0.0851,
    '86': 0.0899, '87': 0.0955, '88': 0.1021, '89': 0.1099, '90': 0.1192,
    '91': 0.1306, '92': 0.1449, '93': 0.1634, '94': 0.1879, '95': 0.2000
  },
  oas: {
    baseMonthly65to74: 742.31,
    baseMonthly75plus: 816.54,
    deferralBonusPerMonth: 0.006,
    eligibleAge: 65,
    maxDeferralAge: 70,
    minResidencyYears: 10,
    fullPensionResidencyYears: 40,
    clawbackRate: 0.15,
    clawbackThreshold: 95323,
    // GIS (single, max OAS pensioner), July–September 2026 quarter:
    // $1,123.17/mo, reduced 50¢/$ of non-OAS income (cutoff $22,800).
    gisMaxAnnualSingle: 13478,
    // Couple (both on full OAS): $676.09/mo per spouse (same quarter),
    // reduced 50¢/$ of COMBINED non-OAS income (cutoff $30,096 combined).
    gisMaxAnnualCouple: 8113,
    gisReductionRate: 0.5
  },
  cpp: {
    standardAge: 65,
    earliestAge: 60,
    maxDeferralAge: 70,
    earlyPenaltyPerMonth: 0.006,
    deferralBonusPerMonth: 0.007,
    // 2026 self-employed CPP: 11.9% combined, $71,300 YMPE, $3,500 exemption.
    selfEmployedRate: 0.119,
    ympe: 71300,
    basicExemption: 3500
  },
  engine: {
    cashCushionRate: 0.005,
    rrifConversionAge: 71,
    inflationRate: 0.02,
    indexSpending: true,
    indexTaxTables: false,
    capitalGainsInclusion: 0.5,
    taxableAcbRatio: 1,
    pensionSplitMaxRate: 0.5,
    tfsaAnnualLimit: 7000,
    rrspAnnualMax: 32890
  },
  // 2026 RDSP parameters (canada.ca "How much you could get in grants and
  // bonds", July 2026 thresholds).
  rdsp: {
    grantThreshold: 117045,
    grantAnnualMax: 3500,
    grantLifetimeMax: 70000,
    grantEndAge: 49,
    bondThresholdLower: 38237,
    bondThresholdUpper: 58523,
    bondAnnualMax: 1000,
    bondLifetimeMax: 20000,
    contributionLifetimeMax: 200000,
    contributionEndAge: 59,
  },
  // 2026 FHSA parameters (canada.ca "First Home Savings Account").
  fhsa: {
    annualLimit: 8000,
    lifetimeLimit: 40000,
    maxYears: 15,
  },
  qcFederalAbatement: 0.165,
  // 2026 Ontario surtax thresholds (2025 values × 1.02 CRA indexation).
  ontarioSurtax: { threshold1: 5925, rate1: 0.20, threshold2: 7577, rate2: 0.56 },
  general: { showWelcomeOnLoad: false, promptToSaveOnSwitch: true }
};

function isValidTaxTable(t: unknown): t is TaxTable {
  if (!t || typeof t !== 'object') return false;
  const table = t as TaxTable;
  return (
    Array.isArray(table.brackets) && table.brackets.every(b => typeof b === 'number') &&
    Array.isArray(table.rates) && table.rates.every(r => typeof r === 'number') &&
    table.rates.length === table.brackets.length + 1 &&
    typeof table.exemption === 'number'
  );
}

export function validateAppConfig(raw: unknown): AppConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<AppConfig>;

  if (!isValidTaxTable(c.federal)) return null;
  if (!c.provinces || typeof c.provinces !== 'object') return null;
  for (const [code, table] of Object.entries(c.provinces)) {
    if (typeof code !== 'string' || !isValidTaxTable(table)) return null;
  }
  if (!c.rrifRates || typeof c.rrifRates !== 'object') return null;
  for (const [age, rate] of Object.entries(c.rrifRates)) {
    if (isNaN(parseInt(age)) || typeof rate !== 'number') return null;
  }
  const o = c.oas as Partial<OasConfig> | undefined;
  if (!o || [
    o.baseMonthly65to74, o.baseMonthly75plus, o.deferralBonusPerMonth,
    o.eligibleAge, o.maxDeferralAge, o.minResidencyYears, o.fullPensionResidencyYears
  ].some(v => typeof v !== 'number')) return null;
  // Clawback fields were added after the first config schema — back-fill
  // defaults for configs saved before they existed.
  if (typeof o.clawbackRate !== 'number') o.clawbackRate = DEFAULT_APP_CONFIG.oas.clawbackRate;
  if (typeof o.clawbackThreshold !== 'number') o.clawbackThreshold = DEFAULT_APP_CONFIG.oas.clawbackThreshold;
  // GIS fields were added later — back-fill defaults.
  if (typeof o.gisMaxAnnualSingle !== 'number') o.gisMaxAnnualSingle = DEFAULT_APP_CONFIG.oas.gisMaxAnnualSingle;
  if (typeof o.gisMaxAnnualCouple !== 'number') o.gisMaxAnnualCouple = DEFAULT_APP_CONFIG.oas.gisMaxAnnualCouple;
  if (typeof o.gisReductionRate !== 'number') o.gisReductionRate = DEFAULT_APP_CONFIG.oas.gisReductionRate;
  // CPP adjustment config was added after earlier schemas — back-fill defaults.
  const cpp = c.cpp as Partial<CppConfig> | undefined;
  if (!cpp || [
    cpp.standardAge, cpp.earliestAge, cpp.maxDeferralAge,
    cpp.earlyPenaltyPerMonth, cpp.deferralBonusPerMonth
  ].some(v => typeof v !== 'number')) {
    (c as AppConfig).cpp = { ...DEFAULT_APP_CONFIG.cpp };
  } else {
    // Self-employed CPP fields were added later — back-fill defaults so configs
    // saved before they existed keep the deduction available.
    if (typeof cpp.selfEmployedRate !== 'number') cpp.selfEmployedRate = DEFAULT_APP_CONFIG.cpp.selfEmployedRate;
    if (typeof cpp.ympe !== 'number') cpp.ympe = DEFAULT_APP_CONFIG.cpp.ympe;
    if (typeof cpp.basicExemption !== 'number') cpp.basicExemption = DEFAULT_APP_CONFIG.cpp.basicExemption;
  }
  const e = c.engine as Partial<EngineConfig> | undefined;
  if (!e || typeof e.cashCushionRate !== 'number' || typeof e.rrifConversionAge !== 'number') return null;
  // Inflation fields were added after earlier config schemas — back-fill
  // defaults for configs saved before they existed.
  if (typeof e.inflationRate !== 'number') e.inflationRate = DEFAULT_APP_CONFIG.engine.inflationRate;
  if (typeof e.indexSpending !== 'boolean') e.indexSpending = DEFAULT_APP_CONFIG.engine.indexSpending;
  if (typeof e.indexTaxTables !== 'boolean') e.indexTaxTables = DEFAULT_APP_CONFIG.engine.indexTaxTables;
  // Capital-gains fields were added later — back-fill defaults.
  if (typeof e.capitalGainsInclusion !== 'number') e.capitalGainsInclusion = DEFAULT_APP_CONFIG.engine.capitalGainsInclusion;
  if (typeof e.taxableAcbRatio !== 'number') e.taxableAcbRatio = DEFAULT_APP_CONFIG.engine.taxableAcbRatio;
  // Pension-splitting was added later — back-fill the CRA maximum.
  if (typeof e.pensionSplitMaxRate !== 'number') e.pensionSplitMaxRate = DEFAULT_APP_CONFIG.engine.pensionSplitMaxRate;
  // Registered-plan annual limits were added later — back-fill defaults.
  if (typeof e.tfsaAnnualLimit !== 'number') e.tfsaAnnualLimit = DEFAULT_APP_CONFIG.engine.tfsaAnnualLimit;
  if (typeof e.rrspAnnualMax !== 'number') e.rrspAnnualMax = DEFAULT_APP_CONFIG.engine.rrspAnnualMax;
  // RDSP config was added later — back-fill the whole block (all-or-nothing:
  // a partial RDSP config is treated as absent and replaced with defaults).
  {
    const r = c.rdsp as Partial<RdspConfig> | undefined;
    const nums: Array<keyof RdspConfig> = [
      'grantThreshold', 'grantAnnualMax', 'grantLifetimeMax', 'grantEndAge',
      'bondThresholdLower', 'bondThresholdUpper', 'bondAnnualMax', 'bondLifetimeMax',
      'contributionLifetimeMax', 'contributionEndAge',
    ];
    if (!r || nums.some(k => typeof r[k] !== 'number')) {
      (c as AppConfig).rdsp = { ...DEFAULT_APP_CONFIG.rdsp };
    }
  }
  // FHSA config was added later — back-fill the whole block (all-or-nothing).
  {
    const f = c.fhsa as Partial<FhsaConfig> | undefined;
    if (!f || [f.annualLimit, f.lifetimeLimit, f.maxYears].some(v => typeof v !== 'number')) {
      (c as AppConfig).fhsa = { ...DEFAULT_APP_CONFIG.fhsa };
    }
  }
  // QC abatement / ON surtax were added later — back-fill defaults.
  if (typeof c.qcFederalAbatement !== 'number') (c as AppConfig).qcFederalAbatement = DEFAULT_APP_CONFIG.qcFederalAbatement;
  const os = c.ontarioSurtax as AppConfig['ontarioSurtax'] | undefined;
  if (!os || [os.threshold1, os.rate1, os.threshold2, os.rate2].some(v => typeof v !== 'number')) {
    (c as AppConfig).ontarioSurtax = { ...DEFAULT_APP_CONFIG.ontarioSurtax };
  }
  // General/UI preferences were added later — back-fill defaults.
  const g = c.general as Partial<GeneralConfig> | undefined;
  if (!g || typeof g.showWelcomeOnLoad !== 'boolean') {
    (c as AppConfig).general = { ...DEFAULT_APP_CONFIG.general };
  } else if (typeof g.promptToSaveOnSwitch !== 'boolean') {
    // promptToSaveOnSwitch was added after showWelcomeOnLoad — back-fill it.
    (c as AppConfig).general = { ...g, promptToSaveOnSwitch: true } as GeneralConfig;
  }

  return c as AppConfig;
}

/** A fresh copy of the built-in defaults. Pure — persistence is the caller's
 *  job (the SQL store), so this never touches storage. */
export function defaultAppConfig(): AppConfig {
  return structuredClone(DEFAULT_APP_CONFIG);
}
