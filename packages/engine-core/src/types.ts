// Shared domain types. The Scenario interface lived in scenarioStorage.ts while
// that module doubled as a storage backend; with the SQL store the single source
// of truth, the type stands alone here so storage and shape evolve independently.

import type { RetirementInputs } from './retirementEngine';

export interface Scenario {
  id: string;
  name: string;
  inputs: RetirementInputs;
  /** True on the plans the app ships (`buildDefaultScenarios`). State, not a
   *  name match: which plan is a stock example used to be decided by whether the
   *  English prefix "Example - " was on it, so a French reader, a rename, or a
   *  translated plan name changed what the app believed the plan was. A plan the
   *  user made — duplicate, save-as, import, New Scenario — never carries it. */
  isExample?: boolean;
}
