// Input migration: fills fields added after a scenario was persisted so older
// payloads load cleanly. Pure — no storage. Moved out of scenarioStorage.ts when
// the SQL store became the single source of truth; lives under data/ because
// it's part of the persistence boundary, not the engine.

import type { RetirementInputs, IncomeSource } from '../lib/retirementEngine';

// The legacy array element shapes, defined structurally here because the engine
// no longer exports them (no-legacy cutover). They describe what OLD payloads
// looked like at the persistence boundary; nothing outside this module reads
// them. A legacy pension had a nullable endAge (null = lifetime); a legacy
// employment row had a required finite endAge plus save-mode fields.
interface LegacyPension {
  id: string; label: string; annualAmount: number; startAge: number;
  endAge: number | null; indexedToCpi: boolean;
}
interface LegacyEmployment {
  id: string; label: string; annualAmount: number; startAge: number;
  endAge: number; destAccount?: 'rrsp' | 'tfsa' | 'taxable' | 'cash';
  topUpSpending?: boolean; indexedToCpi: boolean;
}

/**
 * Fold the legacy `pensions[]` + `employment[]` arrays into the unified
 * `income[]` register (issue #24). Deterministic order: pensions first, then
 * employment — this matches the order the two arrays were conceptually applied
 * and keeps checkpoint/strategy diffs stable. Each entry keeps its id/label/
 * window/amount/indexation; the kind carries its tax character. The legacy
 * arrays are DELETED so downstream code reads `income[]` only (no dual state).
 * Already-migrated payloads (income present, legacy absent) are returned
 * untouched; `income` always wins when both somehow coexist.
 */
function foldToIncome(record: Record<string, unknown>): void {
  const pensions = Array.isArray(record.pensions) ? (record.pensions as LegacyPension[]) : [];
  const employment = Array.isArray(record.employment) ? (record.employment as LegacyEmployment[]) : [];
  const existing = Array.isArray(record.income) ? (record.income as IncomeSource[]) : null;

  if (!existing) {
    const income: IncomeSource[] = [
      ...pensions.map((p): IncomeSource => ({
        id: p.id, label: p.label, kind: 'pension',
        annualAmount: p.annualAmount, startAge: p.startAge,
        endAge: p.endAge, indexedToCpi: p.indexedToCpi,
      })),
      ...employment.map((e): IncomeSource => ({
        id: e.id, label: e.label, kind: 'employment',
        annualAmount: e.annualAmount, startAge: e.startAge,
        endAge: e.endAge, indexedToCpi: e.indexedToCpi,
        destAccount: e.destAccount, topUpSpending: e.topUpSpending,
      })),
    ];
    if (income.length > 0 || pensions.length > 0 || employment.length > 0) {
      record.income = income;
    }
  }

  delete record.pensions;
  delete record.employment;
}

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

  // Income register (issue #24): fold legacy pensions[]+employment[] into
  // income[] and drop the old keys. Runs BEFORE any consumer reads the record
  // so the engine/UI/tools only ever see the unified register.
  foldToIncome(migrated);
  const sp = migrated.spouse as Record<string, unknown> | undefined;
  if (sp && typeof sp === 'object') {
    // The spouse is a first-class person — fold their income the same way.
    foldToIncome(sp);
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
