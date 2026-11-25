// How the dashboard talks about "the money" — the investable pot on the
// life-timeline, not the engine's ON_TRACK flag.
//
// The engine can stay ON_TRACK after the portfolio hits $0 when a reverse
// mortgage still has LTV headroom (spending is borrowed, not drawn). The chart
// pin and "Left at {maxAge}" already follow endingBalance; the receipts and
// verdict chip used to print `{maxAge}+` / "past the plan" from status alone,
// so a drained pot could read as lasting past the horizon. These helpers keep
// those surfaces on the same leftover.

import type { RetirementInputs, YearlyBreakdown } from '@retired/engine-core/retirementEngine';

/** First age the investable pot is empty (matches the "money runs out" pin). */
export function firstEmptyAge(breakdown: YearlyBreakdown[]): number | null {
  return breakdown.find(r => r.endingBalance <= 0)?.age ?? null;
}

export interface PotDisplay {
  /** Last year's ending investable balance. */
  leftover: number;
  /** First empty year; null if the pot never hits zero. */
  emptyAge: number | null;
  /** True only when leftover is still in the pot at the horizon. */
  holds: boolean;
  /** Age shown on "Money lasts to" / the verdict chip. */
  lastsTo: number | null;
}

export function potDisplay(breakdown: YearlyBreakdown[], maxAge: number): PotDisplay {
  const leftover = breakdown[breakdown.length - 1]?.endingBalance ?? 0;
  const emptyAge = firstEmptyAge(breakdown);
  const holds = leftover > 0;
  return {
    leftover,
    emptyAge,
    holds,
    lastsTo: holds ? maxAge : emptyAge,
  };
}

/** Within this many years of the horizon a plan that still runs out reads as
 *  borderline, not a failure — the same margin the header chip has always used. */
export const BORDERLINE_YEARS = 6;

/** The header's verdict: tone, age, and the word for it, computed once.
 *  The Dashboard used to rewrite the tone rule inline and then pick its label
 *  from holds/short only, so a borderline plan read "runs short" on the home
 *  page while the header on every other page said "borderline". `labels` comes
 *  from the caller's `pages` namespace so this stays free of i18n imports. */
export function verdictChip(pot: PotDisplay, maxAge: number, labels: {
  holds: string; short: string; borderline: string;
}): { tone: 'holds' | 'short' | 'borderline'; age: string; label: string } {
  const borderline = !pot.holds && pot.emptyAge != null
    && (maxAge - pot.emptyAge) <= BORDERLINE_YEARS;
  return {
    tone: pot.holds ? 'holds' : borderline ? 'borderline' : 'short',
    age: pot.holds ? `${maxAge}+` : `${pot.lastsTo ?? '—'}`,
    label: pot.holds ? labels.holds : borderline ? labels.borderline : labels.short,
  };
}

/** 0–100 snapshot of how close the plan gets to maxAge before money runs out.
 *  Never depletes → 100. Depletes at maxAge → 100. Earlier → round(age/maxAge×100). */
export function formatReScore(ho: { depletionAge: number | null }, maxAge: number): number {
  const { depletionAge } = ho;
  if (depletionAge === null) return 100;
  return Math.min(100, Math.max(0, Math.round((depletionAge / maxAge) * 100)));
}

// ── What the plan still doesn't know ───────────────────────────────────────
// The Dashboard is four numbers and a verdict; everything else a plan can
// carry (balances, partner, debts, one-off events, other income, spending
// phases) lives on Plans and is easy to never open at all. These are the
// registers that read as provably untouched — a switch still off, a list still
// empty — in the order the Plans page shows them.
//
// Province and the CPP/OAS placeholder are deliberately NOT counted: a real
// answer and the default are indistinguishable, and a nudge that is wrong once
// is a nudge the user stops reading.

export type DetailGroupId = 'accounts' | 'partner' | 'debts' | 'events' | 'income' | 'phases';

/** The registers this plan has never been given data for. Empty = nothing left
 *  to add, and the Dashboard's pointer to Plans goes quiet. */
export function unsetDetailGroups(inputs: RetirementInputs): DetailGroupId[] {
  const unset: DetailGroupId[] = [];
  if (!inputs.rrspBalance && !inputs.tfsaBalance && !inputs.taxableBalance && !inputs.cashCushionBalance) {
    unset.push('accounts');
  }
  // A partner is either the embedded spouse or a linked one (`spouseSource`
  // points at another saved scenario, which is how the couple examples ship).
  if (!inputs.spouse?.enabled && inputs.spouseSource?.kind !== 'scenario') unset.push('partner');
  if (!inputs.debts?.length) unset.push('debts');
  if (!inputs.events?.length) unset.push('events');
  if (!inputs.income?.length) unset.push('income');
  if (!inputs.spendingBands?.length) unset.push('phases');
  return unset;
}
