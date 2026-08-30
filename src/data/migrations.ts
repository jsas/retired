// Input migration: fills fields added after a scenario was persisted so older
// payloads load cleanly. Pure — no storage. Moved out of scenarioStorage.ts when
// the SQL store became the single source of truth; lives under data/ because
// it's part of the persistence boundary, not the engine.

import type { RetirementInputs } from '../lib/retirementEngine';

/** Fill in inputs fields added after a scenario was saved. */
export function migrateInputs(inputs: object): RetirementInputs {
  return migrateRecord(inputs as Record<string, unknown>);
}

function migrateRecord(inputs: Record<string, unknown>): RetirementInputs {
  const migrated = { ...inputs };

  // v1 → v2: single annualContribution split per account (it used to all go
  // into the TFSA, so preserve that behaviour).
  if (typeof migrated.annualContribution === 'number' && typeof migrated.tfsaContribution !== 'number') {
    migrated.rrspContribution = 0;
    migrated.tfsaContribution = migrated.annualContribution;
    migrated.taxableContribution = 0;
  }
  delete migrated.annualContribution;

  if (typeof migrated.returnVolatility !== 'number') {
    migrated.returnVolatility = 0.15;
  }

  // v2 → v3: the CPP adjustment calculator treats cppMonthlyAmount as the
  // age-65 amount. Existing scenarios entered an already-adjusted amount, so
  // flag them to preserve their behaviour (no double adjustment).
  if (typeof migrated.cppAdjustedAmount !== 'boolean') {
    migrated.cppAdjustedAmount = true;
  }

  // Pensions added later — back-fill an empty list for pre-existing scenarios.
  if (!Array.isArray(migrated.pensions)) {
    migrated.pensions = [];
  }
  // Employment income added later — same treatment.
  if (!Array.isArray(migrated.employment)) {
    migrated.employment = [];
  }
  const sp = migrated.spouse as Record<string, unknown> | undefined;
  if (sp && typeof sp === 'object') {
    if (!Array.isArray(sp.pensions)) sp.pensions = [];
    if (!Array.isArray(sp.employment)) sp.employment = [];
    // Full-person parity fields (events, spending bands) — back-fill empty
    // lists so downstream code can treat them as arrays. reverseMortgage stays
    // genuinely optional (absent = no reverse mortgage).
    if (!Array.isArray(sp.events)) sp.events = [];
    if (!Array.isArray(sp.spendingBands)) sp.spendingBands = [];
  }

  // Spouse adapter added later (spouseSource). Absent = the embedded spouse is
  // edited inline, i.e. a 'builtin' adapter — normalize to that explicitly so
  // downstream code can rely on the discriminated union. A malformed value is
  // dropped back to builtin rather than trusted.
  {
    const src = migrated.spouseSource as Record<string, unknown> | undefined;
    const valid = src && typeof src === 'object'
      && (src.kind === 'builtin' || (src.kind === 'scenario' && typeof src.scenarioId === 'string'));
    migrated.spouseSource = valid
      ? (src.kind === 'scenario' ? { kind: 'scenario', scenarioId: src.scenarioId as string } : { kind: 'builtin' })
      : { kind: 'builtin' };
  }

  return migrated as unknown as RetirementInputs;
}
