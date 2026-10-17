// Program rules for the assistant's system prompt.
//
// The persona prompt (DEFAULT_SYSTEM_PROMPT) is intentionally generic prose —
// the VOICE. The RULES the assistant must apply correctly (CPP/OAS/GIS
// mechanics, RRIF minimums, registered-plan limits, capital-gains inclusion)
// are NOT prose: they are numbers the engine already owns in AppConfig, and the
// user can edit them in Settings. Hard-coding them into the prompt would let
// the model quote values the program no longer uses. So this module BUILDS the
// rules section from the live config — the same source of truth the engine
// runs on — and buildSystemPrompt appends it. The model therefore always
// describes what THIS app will actually compute.

import type { AppConfig } from '@retired/engine-core/appConfig';
import type { Locale } from '../locale';
import { i18n } from '../i18n';

const money = (n: number, locale?: Locale): string =>
  Math.round(n).toLocaleString(locale ?? 'en-CA');
const pct = (n: number, digits = 1): string => `${(n * 100).toFixed(digits)}%`;

function tRules(
  key: string,
  locale: Locale | undefined,
  fallback: string,
  vars?: Record<string, unknown>,
): string {
  if (!locale) return fallback;
  const result = i18n.t(`rules.${key}`, { ns: 'prompts', lng: locale, ...vars });
  if (typeof result !== 'string' || result === `rules.${key}` || result.startsWith('prompts:')) {
    return fallback;
  }
  return result;
}

/**
 * Render the "Rules this program applies" section for the system prompt, from
 * the live AppConfig. Kept compact (bulleted, one idea per line) because it
 * rides every request; the model reads it as ground truth for how the engine
 * treats benefits, tax, and registered accounts. Prose follows `locale` when
 * given; the figures always come from the live config.
 */
export function buildProgramRules(config: AppConfig, locale?: Locale): string {
  const { cpp, oas, engine, rrifRates } = config;

  const cppEarlyPct = pct(cpp.earlyPenaltyPerMonth, 1);
  const cppLatePct = pct(cpp.deferralBonusPerMonth, 1);
  const oasLatePct = pct(oas.deferralBonusPerMonth, 1);

  // RRIF minimums: quote the first and last configured ages so the model sees
  // the shape without a 25-row table.
  const rrifAges = Object.keys(rrifRates).map(Number).sort((a, b) => a - b);
  const firstRrifAge = rrifAges[0];
  const firstRrifRate = firstRrifAge != null ? rrifRates[String(firstRrifAge)] : undefined;

  const rrifWith = firstRrifAge != null && firstRrifRate != null;
  const rrifLine = rrifWith
    ? tRules(
      'rrifWith',
      locale,
      `- RRIF: RRSP converts to a RRIF at ${engine.rrifConversionAge}; minimum withdrawals are\n  mandatory from ${firstRrifAge} (starting at ${pct(firstRrifRate)} of the balance, rising with age).`,
      { age: engine.rrifConversionAge, firstAge: firstRrifAge, firstRate: pct(firstRrifRate!) },
    )
    : tRules(
      'rrifWithout',
      locale,
      `- RRIF: RRSP converts to a RRIF at ${engine.rrifConversionAge}; minimum withdrawals are mandatory with age.`,
      { age: engine.rrifConversionAge },
    );

  return [
    tRules(
      'header',
      locale,
      'Rules this program applies (from the current engine settings — quote these,\nnot generic figures):',
    ),
    tRules(
      'cpp',
      locale,
      `- CPP: may start ${cpp.earliestAge}–${cpp.maxDeferralAge}; the unadjusted benefit is at\n  ${cpp.standardAge}. Starting earlier cuts it ${cppEarlyPct}/month before ${cpp.standardAge};\n  deferring past ${cpp.standardAge} adds ${cppLatePct}/month up to ${cpp.maxDeferralAge}.`,
      {
        earliest: cpp.earliestAge,
        latest: cpp.maxDeferralAge,
        standard: cpp.standardAge,
        earlyPct: cppEarlyPct,
        latePct: cppLatePct,
      },
    ),
    tRules(
      'oas',
      locale,
      `- OAS: may start ${oas.eligibleAge}–${oas.maxDeferralAge}; deferring adds ${oasLatePct}/month.\n  It is clawed back at ${pct(oas.clawbackRate, 0)} of net income above\n  $${money(oas.clawbackThreshold)}/year. Full OAS needs ${oas.fullPensionResidencyYears}\n  years of residency (minimum ${oas.minResidencyYears}).`,
      {
        eligible: oas.eligibleAge,
        maxDeferral: oas.maxDeferralAge,
        latePct: oasLatePct,
        clawbackRate: pct(oas.clawbackRate, 0),
        threshold: money(oas.clawbackThreshold, locale),
        fullYears: oas.fullPensionResidencyYears,
        minYears: oas.minResidencyYears,
      },
    ),
    tRules(
      'gis',
      locale,
      `- GIS: income-tested; up to $${money(oas.gisMaxAnnualSingle)}/year (single) or\n  $${money(oas.gisMaxAnnualCouple)}/year per spouse (couple), reduced ${pct(oas.gisReductionRate, 0)}\n  per dollar of taxable income excluding OAS.`,
      {
        single: money(oas.gisMaxAnnualSingle, locale),
        couple: money(oas.gisMaxAnnualCouple, locale),
        reduction: pct(oas.gisReductionRate, 0),
      },
    ),
    rrifLine,
    tRules(
      'registered',
      locale,
      `- Registered accounts: RRSP/RRIF withdrawals are fully taxable and count against GIS/OAS;\n  TFSA withdrawals are tax-free and do not. Annual limits: TFSA $${money(engine.tfsaAnnualLimit)},\n  RRSP $${money(engine.rrspAnnualMax)} (18% of earned income, capped).`,
      {
        tfsa: money(engine.tfsaAnnualLimit, locale),
        rrsp: money(engine.rrspAnnualMax, locale),
      },
    ),
    tRules(
      'gains',
      locale,
      `- Capital gains: ${pct(engine.capitalGainsInclusion, 0)} of a gain is taxable. Eligible pension\n  income may be split up to ${pct(engine.pensionSplitMaxRate, 0)} with a spouse.`,
      {
        inclusion: pct(engine.capitalGainsInclusion, 0),
        split: pct(engine.pensionSplitMaxRate, 0),
      },
    ),
    tRules(
      'residents',
      locale,
      '- Only Canadian residents; no US cross-border or non-resident tax.',
    ),
  ].join('\n');
}
