import type { YearlyBreakdown } from '@retired/engine-core/retirementEngine';

/**
 * Schedule column registry.
 *
 * Every data column of the year-by-year table is declared here once — id,
 * header label, header tooltip, the number it shows, and the styling — so the
 * header row, the body rows, and the column picker all read the same list.
 *
 * Two flavours:
 *  - base columns always exist; the user can hide all except `age` and
 *    `endingBalance` (alwaysVisible) via the picker.
 *  - conditional columns (RDSP / FHSA / Home Equity / Debts) only exist when
 *    the feature produced data; they bypass the picker entirely — when they
 *    appear, they appear.
 *
 * The default set keeps the money-flow story on screen; everything else is
 * one "show all" away.
 */

export interface ScheduleColumn {
  id: string;
  label: string;
  title?: string;
  /** Header alignment — body cells are always right-aligned numbers except Age. */
  align: 'left' | 'right';
  /** Cannot be hidden — the row's identity and its bottom line. */
  alwaysVisible?: boolean;
  /** Shown before the user touches the picker. */
  defaultVisible: boolean;
  /** Cell text colour. `strong` marks the retirement-year emphasis column. */
  tone: 'plain' | 'green' | 'red' | 'amber' | 'amberDark' | 'amberDeep' | 'muted' | 'strong';
  value: (row: YearlyBreakdown) => number | undefined;
}

export const SCHEDULE_COLUMNS: readonly ScheduleColumn[] = [
  {
    id: 'age',
    label: 'Age',
    align: 'left',
    alwaysVisible: true,
    defaultVisible: true,
    tone: 'strong',
    value: (r) => r.age,
  },
  {
    id: 'startingBalance',
    label: 'Starting Balance',
    align: 'right',
    defaultVisible: true,
    tone: 'plain',
    value: (r) => r.startingBalance,
  },
  {
    id: 'contributions',
    label: 'Contributions',
    align: 'right',
    defaultVisible: true,
    tone: 'green',
    value: (r) => r.contributions,
  },
  {
    id: 'marketGains',
    label: 'Market Gains',
    align: 'right',
    defaultVisible: true,
    tone: 'plain',
    value: (r) => r.marketGains,
  },
  {
    id: 'spendingTarget',
    label: 'Spending Target',
    title: "After-tax income goal for the year (desired spending inflated to that year)",
    align: 'right',
    defaultVisible: false,
    tone: 'plain',
    value: (r) => r.spendingTarget,
  },
  {
    id: 'withdrawals',
    label: 'Withdrawals',
    align: 'right',
    defaultVisible: true,
    tone: 'red',
    value: (r) => r.withdrawals,
  },
  {
    id: 'incomeTax',
    label: 'Income Tax',
    title: "Incremental tax on this year's withdrawals (registered draws + realized gains) beyond the tax on benefits alone, plus OAS clawback. Reads $0 late in life once the portfolio is drained — that does NOT mean tax stopped; see Total Tax.",
    align: 'right',
    defaultVisible: false,
    tone: 'amber',
    value: (r) => r.incomeTax,
  },
  {
    id: 'totalTax',
    label: 'Total Tax',
    title: "Total tax on ALL of the year's income (CPP, OAS, pension, employment, withdrawals) plus OAS clawback. Charged every year taxable income is received, right to the final year.",
    align: 'right',
    defaultVisible: false,
    tone: 'amberDark',
    value: (r) => r.totalTaxPaid ?? 0,
  },
  {
    id: 'cumulativeTax',
    label: 'Tax Burden',
    title: 'Running total of income tax paid since retirement',
    align: 'right',
    defaultVisible: false,
    tone: 'amberDeep',
    value: (r) => r.cumulativeTax,
  },
  {
    id: 'cpp',
    label: 'CPP',
    align: 'right',
    defaultVisible: true,
    tone: 'green',
    value: (r) => r.cppIncome,
  },
  {
    id: 'oas',
    label: 'OAS',
    align: 'right',
    defaultVisible: true,
    tone: 'green',
    value: (r) => r.oasIncome,
  },
  {
    id: 'gis',
    label: 'GIS',
    title: 'Guaranteed Income Supplement (tax-free; couples assessed on combined income)',
    align: 'right',
    defaultVisible: false,
    tone: 'green',
    value: (r) => r.gisIncome,
  },
  {
    id: 'pension',
    label: 'Pension',
    title: 'Defined-benefit / bridge pension income (taxable)',
    align: 'right',
    defaultVisible: false,
    tone: 'green',
    value: (r) => r.pensionIncome,
  },
  {
    id: 'endingBalance',
    label: 'Ending Balance',
    align: 'right',
    alwaysVisible: true,
    defaultVisible: true,
    tone: 'strong',
    value: (r) => r.endingBalance,
  },
  {
    id: 'rrsp',
    label: 'RRSP',
    align: 'right',
    defaultVisible: false,
    tone: 'muted',
    value: (r) => r.rrspBalance,
  },
  {
    id: 'rrif',
    label: 'RRIF',
    align: 'right',
    defaultVisible: false,
    tone: 'muted',
    value: (r) => r.rrifBalance,
  },
  {
    id: 'tfsa',
    label: 'TFSA',
    align: 'right',
    defaultVisible: false,
    tone: 'muted',
    value: (r) => r.tfsaBalance,
  },
  {
    id: 'taxable',
    label: 'Taxable',
    align: 'right',
    defaultVisible: false,
    tone: 'muted',
    value: (r) => r.taxableBalance,
  },
  {
    id: 'cashCushion',
    label: 'Cash Cushion',
    align: 'right',
    defaultVisible: false,
    tone: 'muted',
    value: (r) => r.cashCushionBalance,
  },
] as const;

export const BASE_COLUMN_IDS: readonly string[] = SCHEDULE_COLUMNS.map((c) => c.id);
export const ALWAYS_VISIBLE_IDS: readonly string[] = SCHEDULE_COLUMNS.filter((c) => c.alwaysVisible).map((c) => c.id);
export const DEFAULT_VISIBLE_IDS: readonly string[] = SCHEDULE_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);

/**
 * The topical reset sets — pickers of one story each, chosen to read as a
 * coherent table rather than the union of everyone's defaults. The picker's
 * Reset cycles through these (then back to the first), so a fresh angle is
 * one click away and the shipped set is always reachable again.
 */
export const TOPICAL_COLUMN_SETS: ReadonlyArray<{ id: string; label: string; ids: readonly string[] }> = [
  {
    id: 'money-flow',
    label: 'Money flow',
    ids: ['startingBalance', 'contributions', 'marketGains', 'withdrawals', 'cpp', 'oas'],
  },
  {
    id: 'accounts',
    label: 'Accounts',
    ids: ['startingBalance', 'rrsp', 'rrif', 'tfsa', 'taxable', 'cashCushion'],
  },
  {
    id: 'tax',
    label: 'Tax',
    ids: ['withdrawals', 'incomeTax', 'totalTax', 'cumulativeTax'],
  },
  {
    id: 'income',
    label: 'Income',
    ids: ['cpp', 'oas', 'gis', 'pension', 'spendingTarget'],
  },
];

/**
 * Resolve which base columns are visible from a stored pref value.
 * `null` (no pref) → the default set. A stored array is intersected with the
 * known ids and always unioned with the always-visible pair, so stale ids
 * from an older build can't hide Age or Ending Balance.
 */
export function resolveVisibleColumns(stored: string[] | null): Set<string> {
  if (!stored) return new Set(DEFAULT_VISIBLE_IDS);
  const known = new Set(BASE_COLUMN_IDS);
  const visible = new Set(stored.filter((id) => known.has(id)));
  for (const id of ALWAYS_VISIBLE_IDS) visible.add(id);
  return visible;
}

export const SCHEDULE_COLS_PREF_KEY = 'wealthconsole_schedule_cols';
