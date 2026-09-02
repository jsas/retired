// Shared domain types. The Plan interface lived in scenarioStorage.ts while
// that module doubled as a storage backend; with the SQL store the single source
// of truth, the type stands alone here so storage and shape evolve independently.

import type { RetirementInputs } from './retirementEngine';

export interface Plan {
  id: string;
  name: string;
  inputs: RetirementInputs;
}
