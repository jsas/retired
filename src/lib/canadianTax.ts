// Pure tax / RRIF / OAS math, parameterized by AppConfig so every table is
// user-editable. Logic ported from the retirement-drawdown-simular-canada
// engine (src/config/taxTables.js, rrifRates.js, oasConfigData.js), which was
// itself ported from the original Ruby version's config/*.yml files.

import type { AppConfig, TaxTable } from './appConfig';

export interface TaxResult {
  federalTax: number;
  provincialTax: number;
  totalTax: number;
  takeHome: number;
}

function applyProgressiveTax(income: number, brackets: number[], rates: number[]): number {
  let tax = 0;
  let previousBracket = 0;

  for (let i = 0; i < brackets.length; i++) {
    if (income > brackets[i]) {
      tax += (brackets[i] - previousBracket) * rates[i];
      previousBracket = brackets[i];
    } else {
      tax += (income - previousBracket) * rates[i];
      return tax;
    }
  }

  if (income > previousBracket) {
    tax += (income - previousBracket) * rates[rates.length - 1];
  }
  return tax;
}

function taxOnTable(grossIncome: number, table: TaxTable): number {
  if (grossIncome <= 0) return 0;
  const raw = applyProgressiveTax(grossIncome, table.brackets, table.rates);
  return Math.max(raw - table.exemption * table.rates[0], 0);
}

/** Federal + provincial tax on gross income. Unknown province → federal only.
 *  Quebec gets the 16.5% federal abatement; Ontario adds its surtax on
 *  provincial tax above the two configured thresholds. */
export function calculateTax(grossIncome: number, provinceCode: string, config: AppConfig): TaxResult {
  if (grossIncome <= 0) {
    return { federalTax: 0, provincialTax: 0, totalTax: 0, takeHome: 0 };
  }

  let federalTax = taxOnTable(grossIncome, config.federal);
  if (provinceCode === 'QC' && (config.qcFederalAbatement ?? 0) > 0) {
    federalTax = Math.max(0, federalTax * (1 - config.qcFederalAbatement));
  }

  const provinceTable = config.provinces[provinceCode];
  let provincialTax = provinceTable ? taxOnTable(grossIncome, provinceTable) : 0;
  if (provinceCode === 'ONT' && config.ontarioSurtax) {
    const s = config.ontarioSurtax;
    provincialTax += Math.max(0, provincialTax - s.threshold1) * s.rate1
                   + Math.max(0, provincialTax - s.threshold2) * s.rate2;
  }

  const totalTax = federalTax + provincialTax;
  return { federalTax, provincialTax, totalTax, takeHome: grossIncome - totalTax };
}

/** After-tax value of a gross income stream on its own. */
export function takeHome(grossIncome: number, provinceCode: string, config: AppConfig): number {
  return calculateTax(grossIncome, provinceCode, config).takeHome;
}

/**
 * Reverse: gross income required to produce a desired after-tax amount.
 * Binary search, same approach as the Ruby/JS engine.
 */
export function findGrossIncomeForTakeHome(
  desiredTakeHome: number,
  provinceCode: string,
  config: AppConfig
): number {
  if (desiredTakeHome <= 0) return 0;

  let lowerBound = desiredTakeHome;
  let upperBound = desiredTakeHome * 1.5;
  while (calculateTax(upperBound, provinceCode, config).takeHome < desiredTakeHome) {
    upperBound *= 1.5;
  }
  const tolerance = 0.01;

  while (upperBound - lowerBound > tolerance) {
    const mid = (lowerBound + upperBound) / 2;
    if (calculateTax(mid, provinceCode, config).takeHome < desiredTakeHome) {
      lowerBound = mid;
    } else {
      upperBound = mid;
    }
  }

  return upperBound;
}

// ---- RRIF minimum withdrawals ---------------------------------------------

export function isRrifMandatory(age: number, config: AppConfig): boolean {
  return age >= config.engine.rrifConversionAge;
}

export function calculateRrifMinimum(age: number, balance: number, config: AppConfig): number {
  if (!isRrifMandatory(age, config)) return 0;
  const cappedAge = Math.min(age, 95);
  const rate = config.rrifRates[String(cappedAge)] ?? config.rrifRates['95'] ?? 0.20;
  return balance * rate;
}

// ---- OAS benefit math ------------------------------------------------------

export function oasDeferralMultiplier(startAge: number, config: AppConfig): number {
  const o = config.oas;
  const monthsDeferred = Math.max((startAge - o.eligibleAge) * 12, 0);
  const maxMonths = (o.maxDeferralAge - o.eligibleAge) * 12;
  return 1 + Math.min(monthsDeferred, maxMonths) * o.deferralBonusPerMonth;
}

/**
 * Annual gross OAS for someone of `currentAge` who started at `startAge` with
 * `yearsInCanada` of post-18 residency. Matches WithdrawalAmounts#oasAnnualGrossIncome.
 */
export function oasAnnualGross(
  currentAge: number,
  startAge: number,
  yearsInCanada: number,
  config: AppConfig
): number {
  const o = config.oas;
  if (yearsInCanada < o.minResidencyYears || currentAge < startAge) return 0;
  const years = Math.min(yearsInCanada, o.fullPensionResidencyYears);
  const baseMonthly = currentAge >= 75 ? o.baseMonthly75plus : o.baseMonthly65to74;
  return (years / o.fullPensionResidencyYears) * baseMonthly * oasDeferralMultiplier(startAge, config) * 12;
}

// ---- GIS -------------------------------------------------------------------

/**
 * Annual Guaranteed Income Supplement for a single OAS pensioner.
 * Reduced at gisReductionRate per dollar of income EXCLUDING OAS itself
 * (CPP, RRSP/RRIF withdrawals, taxable capital gains all count).
 */
export function gisAnnual(incomeExcludingOas: number, config: AppConfig): number {
  const max = config.oas.gisMaxAnnualSingle ?? 0;
  if (max <= 0) return 0;
  return Math.max(0, max - Math.max(0, incomeExcludingOas) * (config.oas.gisReductionRate ?? 0.5));
}

/**
 * Annual GIS for one spouse in a couple, per CRA's couple rules. Entitlement
 * is assessed on COMBINED non-OAS income of both spouses:
 *  - both spouses on OAS: each gets up to gisMaxAnnualCouple, reduced at
 *    gisReductionRate per dollar of combined income;
 *  - only this spouse on OAS (partner under 65 / not yet on OAS): CRA pays up
 *    to the SINGLE amount, still against combined income.
 * Approximation: the engine knows only each spouse's CPP + pension income
 * ahead of time, so combined income = both CPP/pensions + this spouse's
 * registered draws (the spouse's discretionary draws land next year via
 * Service Canada's quarterly recalc, mirroring the single-person note above).
 */
export function gisAnnualCouple(
  ownRegisteredIncome: number,
  combinedFixedIncome: number, // both spouses' CPP + pensions (OAS excluded)
  partnerHasOas: boolean,
  config: AppConfig
): number {
  const rate = config.oas.gisReductionRate ?? 0.5;
  const max = (partnerHasOas ? config.oas.gisMaxAnnualCouple : config.oas.gisMaxAnnualSingle) ?? 0;
  if (max <= 0) return 0;
  const combined = Math.max(0, combinedFixedIncome + ownRegisteredIncome);
  return Math.max(0, max - combined * rate);
}

// ---- Inflation indexing ----------------------------------------------------

/**
 * A copy of `config` with every dollar-denominated table scaled by `factor`:
 * tax brackets and exemptions (federal + provincial), OAS benefit amounts and
 * the clawback threshold. Rates and ages are untouched. Used to model CRA's
 * annual indexation of the tax system to CPI.
 */
export function indexConfig(config: AppConfig, factor: number): AppConfig {
  if (factor === 1) return config;
  const scaleTable = (t: TaxTable): TaxTable => ({
    brackets: t.brackets.map(b => b * factor),
    rates: t.rates,
    exemption: t.exemption * factor
  });
  const provinces: Record<string, TaxTable> = {};
  for (const [code, table] of Object.entries(config.provinces)) {
    provinces[code] = scaleTable(table);
  }
  return {
    ...config,
    federal: scaleTable(config.federal),
    provinces,
    oas: {
      ...config.oas,
      baseMonthly65to74: config.oas.baseMonthly65to74 * factor,
      baseMonthly75plus: config.oas.baseMonthly75plus * factor,
      clawbackThreshold: config.oas.clawbackThreshold * factor,
      gisMaxAnnualSingle: (config.oas.gisMaxAnnualSingle ?? 0) * factor
    },
    ontarioSurtax: {
      ...config.ontarioSurtax,
      threshold1: config.ontarioSurtax.threshold1 * factor,
      threshold2: config.ontarioSurtax.threshold2 * factor
    }
  };
}
