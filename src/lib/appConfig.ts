// Global application configuration: tax tables, RRIF rates, OAS parameters,
// and engine assumptions. Everything here is user-editable via the Settings
// modal and persisted to localStorage under 'wealthconsole_config'.
// Defaults are the Canadian values ported from the retirement-drawdown engine.

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
  gisReductionRate: number;
}

export interface CppConfig {
  standardAge: number;          // unadjusted benefit age (65)
  earliestAge: number;          // earliest start (60)
  maxDeferralAge: number;       // latest start (70)
  earlyPenaltyPerMonth: number; // reduction per month before standardAge (0.006)
  deferralBonusPerMonth: number; // increase per month after standardAge (0.007)
}

export interface EngineConfig {
  cashCushionRate: number;   // annual growth rate of the cash cushion
  rrifConversionAge: number; // age at which RRSP converts to RRIF
  inflationRate: number;     // annual CPI — the rate behind both toggles below
  indexSpending: boolean;    // inflate the spending target each year by CPI (off = flat in today's dollars)
  indexTaxTables: boolean;   // also inflate tax brackets, exemptions, OAS amounts/threshold and CPP each year
  capitalGainsInclusion: number; // fraction of a capital gain included in taxable income (0.5)
  taxableAcbRatio: number;   // ACB as a fraction of the initial taxable balance (1 = all principal)
}

export interface AppConfig {
  federal: TaxTable;
  provinces: Record<string, TaxTable>;
  rrifRates: Record<string, number>; // age (as string) -> minimum rate
  oas: OasConfig;
  cpp: CppConfig;
  engine: EngineConfig;
  qcFederalAbatement: number;  // Quebec abatement: fraction of federal tax refunded (0.165)
  ontarioSurtax: {             // Ontario surtax on provincial tax above two thresholds
    threshold1: number; rate1: number;
    threshold2: number; rate2: number;
  };
  general: GeneralConfig;
}

export interface GeneralConfig {
  showWelcomeOnLoad: boolean;  // always show the getting-started welcome card at startup, even after dismissal
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
    // GIS 2026 (single, max OAS pensioner): ~$1,105/mo, reduced 50¢/$ of
    // non-OAS income.
    gisMaxAnnualSingle: 13260,
    gisReductionRate: 0.5
  },
  cpp: {
    standardAge: 65,
    earliestAge: 60,
    maxDeferralAge: 70,
    earlyPenaltyPerMonth: 0.006,
    deferralBonusPerMonth: 0.007
  },
  engine: {
    cashCushionRate: 0.005,
    rrifConversionAge: 71,
    inflationRate: 0.02,
    indexSpending: true,
    indexTaxTables: false,
    capitalGainsInclusion: 0.5,
    taxableAcbRatio: 1
  },
  qcFederalAbatement: 0.165,
  // 2026 Ontario surtax thresholds (2025 values × 1.02 CRA indexation).
  ontarioSurtax: { threshold1: 5925, rate1: 0.20, threshold2: 7577, rate2: 0.56 },
  general: { showWelcomeOnLoad: false }
};

const CONFIG_STORAGE_KEY = 'wealthconsole_config';

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
  if (typeof o.gisReductionRate !== 'number') o.gisReductionRate = DEFAULT_APP_CONFIG.oas.gisReductionRate;
  // CPP adjustment config was added after earlier schemas — back-fill defaults.
  const cpp = c.cpp as Partial<CppConfig> | undefined;
  if (!cpp || [
    cpp.standardAge, cpp.earliestAge, cpp.maxDeferralAge,
    cpp.earlyPenaltyPerMonth, cpp.deferralBonusPerMonth
  ].some(v => typeof v !== 'number')) {
    (c as AppConfig).cpp = { ...DEFAULT_APP_CONFIG.cpp };
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
  }

  return c as AppConfig;
}

export function loadAppConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_APP_CONFIG);
    const validated = validateAppConfig(JSON.parse(raw));
    return validated ?? structuredClone(DEFAULT_APP_CONFIG);
  } catch {
    return structuredClone(DEFAULT_APP_CONFIG);
  }
}

export function saveAppConfig(config: AppConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('Failed to persist config to localStorage:', err);
  }
}

export function resetAppConfig(): AppConfig {
  const fresh = structuredClone(DEFAULT_APP_CONFIG);
  saveAppConfig(fresh);
  return fresh;
}
