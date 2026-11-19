import type { Scenario } from '@retired/engine-core/types';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';

/** What the tab holds while the SQL store is still opening. */
export interface LiveState {
  /** The plan list as rendered (seeded from the localStorage mirror, or the
   *  first-run examples on a blank machine). */
  scenarios: Scenario[];
  activeId: string;
  /** The plan on screen, including edits that have not been saved yet. */
  inputs: RetirementInputs;
  /** True while an edit exists that has not reached `scenarios`/disk. */
  dirty: boolean;
}

export interface MergedState {
  scenarios: Scenario[];
  activeScenarioId: string;
  inputs: RetirementInputs;
  /** Whether the caller must still treat the plan on screen as unsaved. */
  dirty: boolean;
}

/**
 * Merge the store's authoritative plans with whatever the tab holds at the
 * moment it opens (B10).
 *
 * Adopting is not optional: the persist effect writes the rendered list back
 * over the rows (`saveScenarios` starts with `DELETE FROM scenarios`), so a tab
 * that keeps its seed list while the open is in flight overwrites the user's
 * stored plans with example plans. An unsaved edit is the one thing that wins
 * over the store — and only for the single plan it was made on. That way a user
 * who typed into a plan during a slow open keeps the edit *and* keeps every plan
 * the store held, instead of one or the other.
 */
export function mergeOnOpen(
  stored: { scenarios: Scenario[]; activeScenarioId: string },
  live: LiveState,
): MergedState {
  // Nothing came back (a fresh store with no rows and no defaults): keep the
  // screen exactly as it is rather than selecting a plan that doesn't exist.
  if (stored.scenarios.length === 0) {
    return { scenarios: live.scenarios, activeScenarioId: live.activeId, inputs: live.inputs, dirty: live.dirty };
  }

  const edited = live.dirty ? live.scenarios.find(s => s.id === live.activeId) : undefined;
  if (edited) {
    const mine: Scenario = { ...edited, inputs: live.inputs };
    return {
      scenarios: stored.scenarios.some(s => s.id === mine.id)
        ? stored.scenarios.map(s => (s.id === mine.id ? mine : s))
        : [...stored.scenarios, mine],
      activeScenarioId: mine.id,
      inputs: live.inputs,
      dirty: true,
    };
  }

  // A stored active id that no longer resolves (a plan deleted in another tab)
  // must not blank the app — fall back to the first stored plan.
  const active = stored.scenarios.find(s => s.id === stored.activeScenarioId) ?? stored.scenarios[0];
  return {
    scenarios: stored.scenarios,
    activeScenarioId: active.id,
    // Cloned so editing the plan on screen can't mutate the store's own objects.
    inputs: structuredClone(active.inputs),
    dirty: false,
  };
}
