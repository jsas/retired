import type { RetirementInputs } from './retirementEngine';

// Import template: a flat key,value CSV that someone can fill in from Excel /
// Google Sheets and import as a new scenario — the only realistic "import
// interop" for retirement plans, since no financial program exports plan
// inputs in a standard shape. The template is deliberately limited to the
// fields a spreadsheet user can sensibly type (ages, balances, benefits,
// spending); strategy structures (spending bands, events, pensions, reverse
// mortgage, withdrawal order) stay app-side and fall back to defaults here.
//
// Format:
//   key,value          — header row (required)
//   name,My plan       — optional scenario name
//   currentAge,45      — one field per row; blank values = use the default
// spouse fields are prefixed `spouse.`; spouse is enabled when any spouse row
// has a non-blank value.
export const TEMPLATE_FILENAME = 'retirement-import-template.csv';

/** Keys in the order they appear in the downloadable template. */
const TEMPLATE_ROWS: Array<[string, string]> = [
  ['name', 'My plan'],
  ['currentAge', '45'],
  ['retirementAge', '65'],
  ['maxAge', '95'],
  ['provinceCode', 'ONT'],
  ['desiredSpending', '60000'],
  ['investmentReturn', '0.05'],
  ['rrspBalance', '250000'],
  ['tfsaBalance', '80000'],
  ['taxableBalance', '40000'],
  ['cashCushionBalance', '15000'],
  ['rrspContribution', '12000'],
  ['tfsaContribution', '6000'],
  ['taxableContribution', '0'],
  ['cppStartAge', '65'],
  ['cppMonthlyAmount', '1000'],
  ['oasStartAge', '65'],
  ['oasYearsInCanada', '40'],
  ['spouse.currentAge', ''],
  ['spouse.retirementAge', ''],
  ['spouse.desiredSpending', ''],
  ['spouse.rrspBalance', ''],
  ['spouse.tfsaBalance', ''],
  ['spouse.taxableBalance', ''],
  ['spouse.cashCushionBalance', ''],
  ['spouse.rrspContribution', ''],
  ['spouse.tfsaContribution', ''],
  ['spouse.taxableContribution', ''],
  ['spouse.cppStartAge', ''],
  ['spouse.cppMonthlyAmount', ''],
  ['spouse.oasStartAge', ''],
  ['spouse.oasYearsInCanada', ''],
];

export function buildTemplateCsv(): string {
  const lines = [
    '# Fill in the value column; leave a value blank to use the default. spouse.* rows are optional — filling any of them adds a spouse.',
    'key,value',
    ...TEMPLATE_ROWS.map(([k, v]) => `${k},${v}`),
  ];
  return lines.join('\r\n');
}

const num = (raw: string | undefined, fallback: number): number => {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw.trim().replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

const intOrNull = (raw: string | undefined, fallback: number): number | null => {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

export interface CsvTemplateResult {
  name: string;
  inputs: RetirementInputs;
  /** Non-fatal notes: unrecognized keys, bad values that fell back to defaults. */
  warnings: string[];
}

const KNOWN_KEYS = new Set([
  'name', 'currentAge', 'retirementAge', 'maxAge', 'provinceCode',
  'desiredSpending', 'investmentReturn', 'returnVolatility',
  'rrspBalance', 'tfsaBalance', 'taxableBalance', 'cashCushionBalance',
  'rrspContribution', 'tfsaContribution', 'taxableContribution',
  'cppStartAge', 'cppMonthlyAmount', 'oasStartAge', 'oasYearsInCanada',
]);

const KNOWN_SPOUSE_KEYS = new Set([
  'currentAge', 'retirementAge', 'desiredSpending',
  'rrspBalance', 'tfsaBalance', 'taxableBalance', 'cashCushionBalance',
  'rrspContribution', 'tfsaContribution', 'taxableContribution',
  'cppStartAge', 'cppMonthlyAmount', 'oasStartAge', 'oasYearsInCanada',
]);

/** Parse template CSV text into scenario inputs, or throw with a readable reason. */
export function parseTemplateCsv(text: string): CsvTemplateResult {
  const warnings: string[] = [];
  const fields = new Map<string, string>();
  const spouseFields = new Map<string, string>();

  const lines = text.split(/\r?\n/);
  let sawHeader = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // No quoting support needed: keys are fixed and values are numbers/names
    // without commas. Split once so a name may contain a comma.
    const idx = line.indexOf(',');
    if (idx < 0) { warnings.push(`Skipped line "${line}" — expected key,value.`); continue; }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
    if (key === 'key' && value.toLowerCase() === 'value') { sawHeader = true; continue; }
    if (key.startsWith('spouse.')) {
      const sub = key.slice('spouse.'.length);
      if (KNOWN_SPOUSE_KEYS.has(sub)) spouseFields.set(sub, value);
      else warnings.push(`Unknown key "${key}" ignored.`);
    } else if (KNOWN_KEYS.has(key)) {
      fields.set(key, value);
    } else {
      warnings.push(`Unknown key "${key}" ignored.`);
    }
  }
  if (!sawHeader && fields.size === 0 && spouseFields.size === 0) {
    throw new Error('That CSV does not look like the import template (no key,value rows found).');
  }

  const currentAge = num(fields.get('currentAge'), 45);
  const retirementAge = num(fields.get('retirementAge'), 65);

  const inputs: RetirementInputs = {
    currentAge,
    retirementAge,
    maxAge: num(fields.get('maxAge'), 95),
    provinceCode: (fields.get('provinceCode') || 'ONT').toUpperCase(),
    desiredSpending: num(fields.get('desiredSpending'), 60000),
    investmentReturn: num(fields.get('investmentReturn'), 0.05),
    returnVolatility: num(fields.get('returnVolatility'), 0.15),
    rrspBalance: num(fields.get('rrspBalance'), 0),
    tfsaBalance: num(fields.get('tfsaBalance'), 0),
    taxableBalance: num(fields.get('taxableBalance'), 0),
    cashCushionBalance: num(fields.get('cashCushionBalance'), 0),
    rrspContribution: num(fields.get('rrspContribution'), 0),
    tfsaContribution: num(fields.get('tfsaContribution'), 0),
    taxableContribution: num(fields.get('taxableContribution'), 0),
    // Template amounts are the age-65 amounts; the engine applies the
    // early/deferral adjustment for the chosen start age.
    cppStartAge: intOrNull(fields.get('cppStartAge'), 65),
    cppMonthlyAmount: num(fields.get('cppMonthlyAmount'), 0),
    cppAdjustedAmount: false,
    oasStartAge: intOrNull(fields.get('oasStartAge'), 65),
    oasYearsInCanada: num(fields.get('oasYearsInCanada'), 40),
    annualWithdrawal: 0,
    withdrawalOrder: ['taxable', 'rrsp', 'tfsa'],
    pensions: [],
  };

  // Spouse: enabled when any spouse.* row has a non-blank value. Host fields
  // (maxAge, province, return) are shared with the household, so the spouse
  // block only carries person-level numbers.
  const hasSpouse = [...spouseFields.values()].some(v => v !== '');
  if (hasSpouse) {
    inputs.spouse = {
      enabled: true,
      currentAge: num(spouseFields.get('currentAge'), Math.max(18, currentAge - 2)),
      retirementAge: num(spouseFields.get('retirementAge'), retirementAge),
      desiredSpending: num(spouseFields.get('desiredSpending'), Math.round(inputs.desiredSpending / 2)),
      rrspBalance: num(spouseFields.get('rrspBalance'), 0),
      tfsaBalance: num(spouseFields.get('tfsaBalance'), 0),
      taxableBalance: num(spouseFields.get('taxableBalance'), 0),
      cashCushionBalance: num(spouseFields.get('cashCushionBalance'), 0),
      rrspContribution: num(spouseFields.get('rrspContribution'), 0),
      tfsaContribution: num(spouseFields.get('tfsaContribution'), 0),
      taxableContribution: num(spouseFields.get('taxableContribution'), 0),
      cppStartAge: intOrNull(spouseFields.get('cppStartAge'), 65),
      cppMonthlyAmount: num(spouseFields.get('cppMonthlyAmount'), 0),
      oasStartAge: intOrNull(spouseFields.get('oasStartAge'), 65),
      oasYearsInCanada: num(spouseFields.get('oasYearsInCanada'), 40),
    };
  }

  return { name: fields.get('name') || 'Imported plan', inputs, warnings };
}
