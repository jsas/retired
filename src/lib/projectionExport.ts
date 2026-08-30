// Projection export: CSV / JSON / YAML of the year-by-year table, with the
// drill-down detail (withdrawal provenance, per-account growth, tax
// decomposition, reverse mortgage, events) so a year can be fully
// reconstructed outside the app. CSV flattens the detail into extra columns
// (one row per person per year for households); JSON/YAML keep the nested
// structure and can carry a metadata envelope.
import type { AppConfig } from './appConfig';
import type { RetirementInputs, RetirementResults, YearlyBreakdown } from './retirementEngine';

export type ExportFormat = 'csv' | 'json' | 'yaml';
export type Subject = 'household' | 'you' | 'spouse';
export type ColumnGroup = 'balances' | 'flows' | 'benefits' | 'withdrawalSources' | 'growth' | 'tax' | 'reverseMortgage' | 'rdsp' | 'events';
export type MetaSection = 'profile' | 'options' | 'settings';

export interface ProjectionExportOptions {
  format: ExportFormat;
  subject: Subject;                    // ignored for CSV (always all rows)
  columnGroups: ColumnGroup[];         // CSV only
  includeDetail: boolean;              // JSON/YAML: attach the YearDetail object
  includeMetadata: boolean;            // JSON/YAML envelope
  metadataSections: MetaSection[];
}

export const COLUMN_GROUPS: Array<{ key: ColumnGroup; label: string; hint: string }> = [
  { key: 'balances', label: 'Account balances', hint: 'Starting/ending balance and RRSP, RRIF, TFSA, taxable, cash cushion' },
  { key: 'flows', label: 'Year flows', hint: 'Contributions, market gains, spending target, withdrawals' },
  { key: 'benefits', label: 'Benefits', hint: 'CPP, OAS, GIS, pension income' },
  { key: 'withdrawalSources', label: 'Withdrawal sources', hint: 'RRIF minimum, RRIF/RRSP/TFSA/taxable/cash draws, taxable-gain portion, reverse-mortgage draw' },
  { key: 'growth', label: 'Growth per account', hint: 'Interest/growth earned by each account' },
  { key: 'tax', label: 'Tax detail', hint: 'Income tax, OAS clawback portion, cumulative tax' },
  { key: 'reverseMortgage', label: 'Reverse mortgage', hint: 'Home value, loan, equity, interest accrued, scheduled vs top-up draws' },
  { key: 'rdsp', label: 'RDSP', hint: 'Balance, contribution, grant (CDSG), bond (CDSB), growth, withdrawal + taxable portion' },
  { key: 'events', label: 'Cash events', hint: 'One column per labelled event' },
];

export const METADATA_SECTIONS: Array<{ key: MetaSection; label: string; hint: string }> = [
  { key: 'profile', label: 'Profile & inputs', hint: 'Scenario name, ages, province, account balances, spending, benefits, spouse' },
  { key: 'options', label: 'Projection options', hint: 'Withdrawal order, spending bands, pensions, events, reverse mortgage, verdict' },
  { key: 'settings', label: 'Engine settings', hint: 'Inflation, RRIF conversion age, tax tables, split limit and other engine config' },
];

export const DEFAULT_PROJECTION_EXPORT: ProjectionExportOptions = {
  format: 'csv',
  subject: 'household',
  columnGroups: COLUMN_GROUPS.map(g => g.key),
  includeDetail: true,
  includeMetadata: true,
  metadataSections: ['profile', 'options', 'settings'],
};

// Persisted in the same panel-state store as print options (via the prefKv
// facade — store kv row + localStorage mirror, issue #20).
import { prefKV } from './prefKv';

const PANEL_STATE_KEY = 'wealthconsole_panel_state';
const OPTS_KEY = 'export_opts';

export function loadProjectionExportOptions(): ProjectionExportOptions {
  try {
    const raw = prefKV().getItem(PANEL_STATE_KEY);
    if (raw) {
      const p = JSON.parse(raw)[OPTS_KEY];
      if (p && typeof p === 'object') {
        return {
          format: p.format === 'json' || p.format === 'yaml' ? p.format : 'csv',
          subject: p.subject === 'you' || p.subject === 'spouse' ? p.subject : 'household',
          columnGroups: Array.isArray(p.columnGroups)
            ? p.columnGroups.filter((g: string) => COLUMN_GROUPS.some(c => c.key === g))
            : [...DEFAULT_PROJECTION_EXPORT.columnGroups],
          includeDetail: p.includeDetail !== false,
          includeMetadata: p.includeMetadata !== false,
          metadataSections: Array.isArray(p.metadataSections)
            ? p.metadataSections.filter((s: string) => METADATA_SECTIONS.some(m => m.key === s))
            : [...DEFAULT_PROJECTION_EXPORT.metadataSections],
        };
      }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_PROJECTION_EXPORT };
}

export function saveProjectionExportOptions(opts: ProjectionExportOptions): void {
  try {
    const kv = prefKV();
    const raw = kv.getItem(PANEL_STATE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    state[OPTS_KEY] = opts;
    kv.setItem(PANEL_STATE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Row → record mapping (shared by CSV columns and JSON/YAML output)
// ---------------------------------------------------------------------------

function rowToRecord(row: YearlyBreakdown, groups: ColumnGroup[], eventKeys: string[]): Record<string, number | string> {
  const d = row.detail;
  const rec: Record<string, number | string> = { age: row.age };
  if (groups.includes('balances')) {
    rec.startingBalance = row.startingBalance;
    rec.endingBalance = row.endingBalance;
    rec.rrspBalance = row.rrspBalance;
    rec.rrifBalance = row.rrifBalance;
    rec.tfsaBalance = row.tfsaBalance;
    rec.taxableBalance = row.taxableBalance;
    rec.cashCushionBalance = row.cashCushionBalance;
  }
  if (groups.includes('flows')) {
    rec.contributions = row.contributions;
    rec.marketGains = row.marketGains;
    rec.spendingTarget = row.spendingTarget;
    rec.withdrawals = row.withdrawals;
  }
  if (groups.includes('benefits')) {
    rec.cppIncome = row.cppIncome;
    rec.oasIncome = row.oasIncome;
    rec.gisIncome = row.gisIncome;
    rec.pensionIncome = row.pensionIncome;
  }
  if (groups.includes('withdrawalSources')) {
    rec.wdRrifMin = d?.withdraw.rrifMin ?? 0;
    rec.wdRrif = d?.withdraw.rrif ?? 0;
    rec.wdRrsp = d?.withdraw.rrsp ?? 0;
    rec.wdTfsa = d?.withdraw.tfsa ?? 0;
    rec.wdTaxable = d?.withdraw.taxable ?? 0;
    rec.wdTaxableGainPortion = d?.tax.capitalGains ?? 0;
    rec.wdCash = d?.withdraw.cash ?? 0;
    rec.wdReverseMortgage = d?.withdraw.rmDraw ?? 0;
  }
  if (groups.includes('growth')) {
    rec.growthRrsp = d?.growth.rrsp ?? 0;
    rec.growthRrif = d?.growth.rrif ?? 0;
    rec.growthTfsa = d?.growth.tfsa ?? 0;
    rec.growthTaxable = d?.growth.taxable ?? 0;
    rec.growthCash = d?.growth.cash ?? 0;
  }
  if (groups.includes('tax')) {
    rec.incomeTax = row.incomeTax;
    rec.totalTaxPaid = row.totalTaxPaid ?? 0;
    rec.oasClawback = d?.tax.oasClawback ?? 0;
    rec.cumulativeTax = row.cumulativeTax;
  }
  if (groups.includes('reverseMortgage') && row.netHomeEquity !== undefined) {
    rec.homeValue = row.homeValue ?? 0;
    rec.rmLoan = row.loanBalance ?? 0;
    rec.homeEquity = row.netHomeEquity;
    rec.rmInterestAccrued = d?.rm?.interestAccrued ?? 0;
    rec.rmScheduledDraw = d?.rm?.scheduledDraw ?? 0;
    rec.rmTopUpDraw = d?.rm?.topUpDraw ?? 0;
  }
  if (groups.includes('rdsp') && row.rdspBalance !== undefined) {
    rec.rdspBalance = row.rdspBalance;
    rec.rdspContribution = d?.rdsp?.contribution ?? 0;
    rec.rdspGrant = d?.rdsp?.grant ?? 0;
    rec.rdspBond = d?.rdsp?.bond ?? 0;
    rec.rdspGrowth = d?.rdsp?.growth ?? 0;
    rec.rdspWithdrawal = d?.rdsp?.withdrawal ?? 0;
    rec.rdspTaxablePortion = d?.rdsp?.taxablePortion ?? 0;
    rec.rdspContributionBasis = d?.rdsp?.contributionBasis ?? 0;
  }
  if (groups.includes('events')) {
    for (const key of eventKeys) {
      const ev = d?.events.find(e => e.label === key);
      rec[`event:${key}`] = ev ? (ev.direction === 'in' ? ev.amount : -ev.amount) : '';
    }
  }
  return rec;
}

// All event labels across the rows, in first-seen order (stable columns).
function collectEventKeys(rows: YearlyBreakdown[]): string[] {
  const keys: string[] = [];
  for (const r of rows) {
    for (const ev of r.detail?.events ?? []) {
      if (!keys.includes(ev.label)) keys.push(ev.label);
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvEscape(v: number | string): string {
  const s = typeof v === 'number' ? String(v) : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per person per year ("you" / "spouse"), with household rows dropped
// in favour of each person's own rows so the detail columns stay meaningful.
// The spouse's age is their own; calendarYear ties the two people together.
export function buildCsv(
  results: RetirementResults,
  inputs: RetirementInputs,
  groups: ColumnGroup[],
): string {
  const spouse = results.spouse;
  const people: Array<{ person: string; rows: YearlyBreakdown[]; currentAge: number }> = [
    { person: 'you', rows: results.yearlyBreakdown, currentAge: inputs.currentAge },
  ];
  if (spouse) {
    people.push({ person: 'spouse', rows: spouse.yearlyBreakdown, currentAge: inputs.spouse?.currentAge ?? inputs.currentAge });
  }
  const eventKeys = groups.includes('events')
    ? [...new Set(people.flatMap(p => collectEventKeys(p.rows)))]
    : [];

  // Header order = record insertion order; build from a sample record per
  // group combination so unchecked groups leave no dangling columns.
  const sample = rowToRecord(people[0].rows[0], groups, eventKeys);
  const dataHeaders = Object.keys(sample).filter(k => k !== 'age');
  const headers = ['person', 'age', 'calendarYear', ...dataHeaders];

  const lines = [headers.join(',')];
  for (const p of people) {
    const baseYear = new Date().getFullYear();
    for (const row of p.rows) {
      const rec = rowToRecord(row, groups, eventKeys);
      const calendarYear = baseYear + (row.age - p.currentAge);
      lines.push([p.person, row.age, calendarYear, ...dataHeaders.map(h => csvEscape(rec[h] ?? ''))].join(','));
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON / YAML
// ---------------------------------------------------------------------------

function rowsToObjects(rows: YearlyBreakdown[], includeDetail: boolean, currentAge: number) {
  const baseYear = new Date().getFullYear();
  return rows.map(r => {
    const { detail, ...rest } = r;
    return {
      calendarYear: baseYear + (r.age - currentAge),
      ...rest, // includes age
      ...(includeDetail && detail ? { detail } : {}),
    };
  });
}

// Strip undefined values recursively so the export stays clean.
function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== undefined) out[k] = clean(val);
    }
    return out as T;
  }
  return v;
}

export function buildProjectionObject(
  scenarioName: string,
  inputs: RetirementInputs,
  results: RetirementResults,
  config: AppConfig,
  opts: ProjectionExportOptions,
): Record<string, unknown> {
  const spouse = results.spouse;
  const offset = inputs.currentAge - (inputs.spouse?.currentAge ?? inputs.currentAge);
  const alignToPrimary = (rows: YearlyBreakdown[]) =>
    rows.map(r => ({ ...r, age: r.age + offset, calendarYear: new Date().getFullYear() + (r.age + offset - inputs.currentAge) }));

  let projection: Record<string, unknown>;
  if (opts.subject === 'household' && spouse) {
    projection = {
      axis: 'primary-age',
      note: `Both people aligned to your age axis (calendar years). Spouse is ${Math.abs(offset)} year(s) ${offset > 0 ? 'younger' : 'older'}; their rows' ages are shifted by ${offset} to match.`,
      you: rowsToObjects(results.yearlyBreakdown, opts.includeDetail, inputs.currentAge),
      spouse: rowsToObjects(alignToPrimary(spouse.yearlyBreakdown) as YearlyBreakdown[], opts.includeDetail, inputs.currentAge),
    };
  } else if (opts.subject === 'spouse' && spouse) {
    projection = {
      axis: 'spouse-age',
      spouse: rowsToObjects(spouse.yearlyBreakdown, opts.includeDetail, inputs.spouse?.currentAge ?? inputs.currentAge),
    };
  } else {
    projection = {
      axis: 'age',
      you: rowsToObjects(results.yearlyBreakdown, opts.includeDetail, inputs.currentAge),
    };
  }

  if (!opts.includeMetadata) return clean({ projection });

  const meta: Record<string, unknown> = { generated: new Date().toISOString(), scenario: scenarioName, tool: 'RE: tired' };
  for (const section of opts.metadataSections) {
    if (section === 'profile') {
      meta.profile = {
        currentAge: inputs.currentAge,
        retirementAge: inputs.retirementAge,
        maxAge: inputs.maxAge,
        provinceCode: inputs.provinceCode,
        desiredSpending: inputs.desiredSpending,
        investmentReturn: inputs.investmentReturn,
        returnVolatility: inputs.returnVolatility,
        balances: {
          rrsp: inputs.rrspBalance, tfsa: inputs.tfsaBalance,
          taxable: inputs.taxableBalance, cashCushion: inputs.cashCushionBalance,
        },
        cpp: { startAge: inputs.cppStartAge, monthlyAmount: inputs.cppMonthlyAmount },
        oas: { startAge: inputs.oasStartAge, yearsInCanada: inputs.oasYearsInCanada },
        spouse: inputs.spouse?.enabled ? {
          currentAge: inputs.spouse.currentAge,
          retirementAge: inputs.spouse.retirementAge,
          desiredSpending: inputs.spouse.desiredSpending,
          balances: {
            rrsp: inputs.spouse.rrspBalance, tfsa: inputs.spouse.tfsaBalance,
            taxable: inputs.spouse.taxableBalance, cashCushion: inputs.spouse.cashCushionBalance,
          },
          cpp: { startAge: inputs.spouse.cppStartAge, monthlyAmount: inputs.spouse.cppMonthlyAmount },
          oas: { startAge: inputs.spouse.oasStartAge, yearsInCanada: inputs.spouse.oasYearsInCanada },
        } : undefined,
      };
    } else if (section === 'options') {
      meta.options = {
        withdrawalOrder: inputs.withdrawalOrder,
        spendingBands: inputs.spendingBands,
        pensions: inputs.pensions,
        events: inputs.events,
        reverseMortgage: inputs.reverseMortgage,
        verdict: {
          status: results.status,
          depletionAge: results.depletionAge,
          withdrawalRate: results.withdrawalRate,
          totalNetWorthAtRetirement: results.totalNetWorthAtRetirement,
        },
      };
    } else if (section === 'settings') {
      meta.settings = config.engine;
    }
  }
  return clean({ metadata: meta, projection });
}

// ---------------------------------------------------------------------------
// Minimal YAML serializer (the export shape is flat/nested plain data — no
// anchors, no multiline strings — so a small recursive writer suffices and
// avoids a dependency).
// ---------------------------------------------------------------------------

function yamlScalar(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : 'null';
  if (typeof v === 'boolean') return String(v);
  const s = String(v);
  // Quote when the scalar could parse as something else or break the line.
  if (s === '' || /[:#\[\]{},&*?|>'"%@`]/.test(s) || /^\s|\s$/.test(s) || /^(true|false|null|yes|no|on|off)$/i.test(s) || /^-?\d/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

export function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`;
    return value.map(item => {
      if (item && typeof item === 'object') {
        // Object item: render at indent+1, then hoist the first line up onto
        // the dash line ("- age: 55" style) for compactness.
        const inner = toYaml(item, indent + 1);
        const lines = inner.split('\n');
        const first = lines[0].trimStart();
        const rest = lines.slice(1);
        return [`${pad}- ${first}`, ...rest].join('\n');
      }
      return `${pad}- ${yamlScalar(item)}`;
    }).join('\n');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return `${pad}{}`;
    return entries.map(([k, v]) => {
      // Quote non-plain keys, escaping backslashes first (order matters —
      // same double-quoted YAML string rules as yamlScalar).
      const key = /^[A-Za-z0-9_]+$/.test(k) ? k : `"${k.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      if (Array.isArray(v)) {
        if (v.length === 0) return `${pad}${key}: []`;
        return `${pad}${key}:\n${toYaml(v, indent + 1)}`;
      }
      if (v && typeof v === 'object') {
        if (Object.keys(v as object).length === 0) return `${pad}${key}: {}`;
        return `${pad}${key}:\n${toYaml(v, indent + 1)}`;
      }
      return `${pad}${key}: ${yamlScalar(v)}`;
    }).join('\n');
  }
  return `${pad}${yamlScalar(value)}`;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export interface ExportPayload {
  content: string;
  mime: string;
  extension: string;
}

export function buildExport(
  scenarioName: string,
  inputs: RetirementInputs,
  results: RetirementResults,
  config: AppConfig,
  opts: ProjectionExportOptions,
): ExportPayload {
  if (opts.format === 'csv') {
    return { content: buildCsv(results, inputs, opts.columnGroups), mime: 'text/csv', extension: 'csv' };
  }
  const obj = buildProjectionObject(scenarioName, inputs, results, config, opts);
  if (opts.format === 'yaml') {
    return { content: toYaml(obj) + '\n', mime: 'text/yaml', extension: 'yaml' };
  }
  return { content: JSON.stringify(obj, null, 2), mime: 'application/json', extension: 'json' };
}
