// How the dashboard talks about "the money" — the investable pot on the
// life-timeline, not the engine's ON_TRACK flag.
//
// The engine can stay ON_TRACK after the portfolio hits $0 when a reverse
// mortgage still has LTV headroom (spending is borrowed, not drawn). The chart
// pin and "Left at {maxAge}" already follow endingBalance; the receipts and
// verdict chip used to print `{maxAge}+` / "past the plan" from status alone,
// so a drained pot could read as lasting past the horizon. These helpers keep
// those surfaces on the same leftover.

import type { YearlyBreakdown } from '@retired/engine-core/retirementEngine';

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
