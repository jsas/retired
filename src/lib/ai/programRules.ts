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

const money = (n: number): string => Math.round(n).toLocaleString('en-CA');
const pct = (n: number, digits = 1): string => `${(n * 100).toFixed(digits)}%`;

/**
 * Render the "Rules this program applies" section for the system prompt, from
 * the live AppConfig. Kept compact (bulleted, one idea per line) because it
 * rides every request; the model reads it as ground truth for how the engine
 * treats benefits, tax, and registered accounts.
 */
export function buildProgramRules(config: AppConfig): string {
  const { cpp, oas, engine, rrifRates } = config;

  const cppEarlyPct = pct(cpp.earlyPenaltyPerMonth, 1);
  const cppLatePct = pct(cpp.deferralBonusPerMonth, 1);
  const oasLatePct = pct(oas.deferralBonusPerMonth, 1);

  // RRIF minimums: quote the first and last configured ages so the model sees
  // the shape without a 25-row table.
  const rrifAges = Object.keys(rrifRates).map(Number).sort((a, b) => a - b);
  const firstRrifAge = rrifAges[0];
  const firstRrifRate = firstRrifAge != null ? rrifRates[String(firstRrifAge)] : undefined;

  const lines: string[] = [
    'Rules this program applies (from the current engine settings — quote these,',
    'not generic figures):',
    `- CPP: may start ${cpp.earliestAge}–${cpp.maxDeferralAge}; the unadjusted benefit is at`,
    `  ${cpp.standardAge}. Starting earlier cuts it ${cppEarlyPct}/month before ${cpp.standardAge};`,
    `  deferring past ${cpp.standardAge} adds ${cppLatePct}/month up to ${cpp.maxDeferralAge}.`,
    `- OAS: may start ${oas.eligibleAge}–${oas.maxDeferralAge}; deferring adds ${oasLatePct}/month.`,
    `  It is clawed back at ${pct(oas.clawbackRate, 0)} of net income above`,
    `  $${money(oas.clawbackThreshold)}/year. Full OAS needs ${oas.fullPensionResidencyYears}`,
    `  years of residency (minimum ${oas.minResidencyYears}).`,
    `- GIS: income-tested; up to $${money(oas.gisMaxAnnualSingle)}/year (single) or`,
    `  $${money(oas.gisMaxAnnualCouple)}/year per spouse (couple), reduced ${pct(oas.gisReductionRate, 0)}`,
    '  per dollar of taxable income excluding OAS.',
    `- RRIF: RRSP converts to a RRIF at ${engine.rrifConversionAge}; minimum withdrawals are` +
      (firstRrifAge != null && firstRrifRate != null
        ? `\n  mandatory from ${firstRrifAge} (starting at ${pct(firstRrifRate)} of the balance, rising with age).`
        : ' mandatory with age.'),
    `- Registered accounts: RRSP/RRIF withdrawals are fully taxable and count against GIS/OAS;`,
    `  TFSA withdrawals are tax-free and do not. Annual limits: TFSA $${money(engine.tfsaAnnualLimit)},`,
    `  RRSP $${money(engine.rrspAnnualMax)} (18% of earned income, capped).`,
    `- Capital gains: ${pct(engine.capitalGainsInclusion, 0)} of a gain is taxable. Eligible pension`,
    `  income may be split up to ${pct(engine.pensionSplitMaxRate, 0)} with a spouse.`,
    '- Only Canadian residents; no US cross-border or non-resident tax.',
  ];
  return lines.join('\n');
}
