import { describe, it, expect } from 'vitest';
import { buildCsv, buildProjectionObject, toYaml, buildExport, DEFAULT_PROJECTION_EXPORT } from './projectionExport';
import { calculateRetirement, calculateHousehold, type RetirementResults } from './retirementEngine';
import { testConfig, baseInputs } from '../test/helpers';

const config = testConfig();
const opts = DEFAULT_PROJECTION_EXPORT;

// A plan with spouse + RM + an event so every column group has data.
function richInputs() {
  return baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 75,
    rrspBalance: 200000, tfsaBalance: 150000, taxableBalance: 100000, cashCushionBalance: 20000,
    desiredSpending: 30000,
    events: [{ id: 'e1', age: 70, label: 'Sell boat', amount: 25000, direction: 'in', account: 'taxable' }],
    reverseMortgage: {
      enabled: true, homeValue: 600000, appreciationRate: 0.02, interestRate: 0.06,
      drawAmount: 5000, startAge: 68, durationYears: 2, topUp: false,
    },
    spouse: {
      enabled: true, currentAge: 60, retirementAge: 65,
      rrspBalance: 0, tfsaBalance: 80000, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: null, cppMonthlyAmount: 0,
      oasStartAge: null, oasYearsInCanada: 40, desiredSpending: 10000,
      withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
    },
  });
}

function rich(): { results: RetirementResults; inputs: ReturnType<typeof richInputs> } {
  const inputs = richInputs();
  return { results: calculateHousehold(inputs, config), inputs };
}

describe('projection CSV export', () => {
  it('emits one row per person per year with person and calendarYear columns', () => {
    const { results, inputs } = rich();
    const csv = buildCsv(results, inputs, opts.columnGroups);
    const lines = csv.split('\n');
    const header = lines[0].split(',');
    expect(header[0]).toBe('person');
    expect(header[1]).toBe('age');
    expect(header[2]).toBe('calendarYear');
    // 11 primary years (65..75) + 11 spouse years (60..70, spouse maxAge follows own plan rows)
    const youRows = lines.filter(l => l.startsWith('you,'));
    const spouseRows = lines.filter(l => l.startsWith('spouse,'));
    expect(youRows.length).toBe(results.yearlyBreakdown.length);
    expect(spouseRows.length).toBe(results.spouse!.yearlyBreakdown.length);
    // Calendar year aligns the same calendar year for both people: spouse is
    // 5 years younger, so spouse age 60 shares the year of primary age 65.
    const year = new Date().getFullYear();
    expect(youRows[0].split(',')[2]).toBe(String(year));
    expect(spouseRows[0].split(',')[2]).toBe(String(year));
    void inputs;
  });

  it('includes withdrawal-source and growth columns from the year detail', () => {
    const { results, inputs } = rich();
    const csv = buildCsv(results, inputs, opts.columnGroups);
    const header = csv.split('\n')[0];
    for (const col of ['wdRrifMin', 'wdRrsp', 'wdTfsa', 'wdTaxable', 'wdTaxableGainPortion', 'wdCash', 'wdReverseMortgage',
      'growthRrsp', 'growthTfsa', 'growthTaxable', 'growthCash', 'oasClawback']) {
      expect(header).toContain(col);
    }
    // A TFSA-draw year must show that draw in its column, so the drill-down
    // numbers actually make it into the export.
    const youTfsaDraw = results.yearlyBreakdown.find(y => (y.detail?.withdraw.tfsa ?? 0) > 0.5);
    expect(youTfsaDraw).toBeDefined();
    const rowLine = csv.split('\n').find(l => l.startsWith(`you,${youTfsaDraw!.age},`))!;
    const cols = header.split(',');
    expect(Number(rowLine.split(',')[cols.indexOf('wdTfsa')])).toBeCloseTo(youTfsaDraw!.detail!.withdraw.tfsa, 1);
    void inputs;
  });

  it('respects the column-group selection', () => {
    const { results, inputs } = rich();
    const csv = buildCsv(results, inputs, ['balances']);
    const header = csv.split('\n')[0];
    expect(header).toContain('rrspBalance');
    expect(header).not.toContain('withdrawals');
    expect(header).not.toContain('wdTfsa');
    expect(header).not.toContain('cppIncome');
  });

  it('emits one column per cash event, signed by direction', () => {
    const { results, inputs } = rich();
    const csv = buildCsv(results, inputs, opts.columnGroups);
    const [header, ...lines] = csv.split('\n');
    const cols = header.split(',');
    const evIdx = cols.indexOf('event:Sell boat');
    expect(evIdx).toBeGreaterThan(-1);
    const row70 = lines.find(l => l.startsWith('you,70,'))!.split(',');
    expect(Number(row70[evIdx])).toBe(25000); // 'in' → positive
    const row69 = lines.find(l => l.startsWith('you,69,'))!.split(',');
    expect(row69[evIdx]).toBe(''); // no event that year
  });

  it('includes reverse-mortgage columns only when the feature is on', () => {
    const { results, inputs } = rich();
    const csv = buildCsv(results, inputs, opts.columnGroups);
    expect(csv.split('\n')[0]).toContain('rmLoan');
    const plain = calculateRetirement(baseInputs(), config);
    const csvPlain = buildCsv(plain, baseInputs(), opts.columnGroups);
    expect(csvPlain.split('\n')[0]).not.toContain('rmLoan');
  });
});

describe('projection JSON/YAML export', () => {
  it('household export nests per-person rows aligned to the primary age axis', () => {
    const { results, inputs } = rich();
    const obj = buildProjectionObject('Test plan', inputs, results, config, { ...opts, format: 'json' });
    const proj = obj.projection as { axis: string; you: Array<{ age: number }>; spouse: Array<{ age: number }> };
    expect(proj.axis).toBe('primary-age');
    // Spouse is 5 years younger → their ages shift by +5 onto the primary axis.
    expect(proj.you[0].age).toBe(65);
    expect(proj.spouse[0].age).toBe(65);
    expect(proj.you.length).toBe(results.yearlyBreakdown.length);
    expect(proj.spouse.length).toBe(results.spouse!.yearlyBreakdown.length);
  });

  it('attaches the year detail when includeDetail is on, omits it when off', () => {
    const { results, inputs } = rich();
    const withDetail = buildProjectionObject('p', inputs, results, config, { ...opts, format: 'json', includeDetail: true });
    const projD = withDetail.projection as { you: Array<{ detail?: unknown }> };
    expect(projD.you.every(y => y.detail !== undefined)).toBe(true);
    const without = buildProjectionObject('p', inputs, results, config, { ...opts, format: 'json', includeDetail: false });
    const projN = without.projection as { you: Array<{ detail?: unknown }> };
    expect(projN.you.every(y => y.detail === undefined)).toBe(true);
  });

  it('metadata envelope carries the requested sections only', () => {
    const { results, inputs } = rich();
    const full = buildProjectionObject('My plan', inputs, results, config, { ...opts, format: 'json' });
    const meta = full.metadata as Record<string, unknown>;
    expect(meta.scenario).toBe('My plan');
    expect(typeof meta.generated).toBe('string');
    expect(meta.profile).toBeDefined();
    expect(meta.options).toBeDefined();
    expect(meta.settings).toBeDefined();

    const profileOnly = buildProjectionObject('p', inputs, results, config, {
      ...opts, format: 'json', metadataSections: ['profile'],
    });
    const m2 = profileOnly.metadata as Record<string, unknown>;
    expect(m2.profile).toBeDefined();
    expect(m2.options).toBeUndefined();
    expect(m2.settings).toBeUndefined();

    const none = buildProjectionObject('p', inputs, results, config, { ...opts, format: 'json', includeMetadata: false });
    expect(none.metadata).toBeUndefined();
    expect(none.projection).toBeDefined();
  });

  it('metadata profile captures ages, balances and spouse', () => {
    const { results, inputs } = rich();
    const obj = buildProjectionObject('p', inputs, results, config, { ...opts, format: 'json' });
    const profile = (obj.metadata as { profile: Record<string, unknown> }).profile;
    expect(profile.currentAge).toBe(65);
    expect((profile.balances as Record<string, number>).tfsa).toBe(150000);
    expect((profile.spouse as Record<string, unknown>).currentAge).toBe(60);
  });

  it('subject "you" and "spouse" export only that person', () => {
    const { results, inputs } = rich();
    const you = buildProjectionObject('p', inputs, results, config, { ...opts, format: 'json', subject: 'you' });
    const py = you.projection as { you: unknown[]; spouse?: unknown[] };
    expect(py.you.length).toBeGreaterThan(0);
    expect(py.spouse).toBeUndefined();
    const sp = buildProjectionObject('p', inputs, results, config, { ...opts, format: 'json', subject: 'spouse' });
    const ps = sp.projection as { spouse: unknown[]; you?: unknown[] };
    expect(ps.spouse.length).toBeGreaterThan(0);
    expect(ps.you).toBeUndefined();
  });
});

describe('YAML serializer', () => {
  it('renders nested objects, arrays and scalars that round-trip as data', () => {
    const yaml = toYaml({
      name: 'plan "A"',
      count: 3,
      nested: { a: 1, b: [1, 2], c: [] },
      list: [{ age: 65, tfsa: 100 }, { age: 66, tfsa: 90 }],
    });
    expect(yaml).toContain('name: "plan \\"A\\""');
    expect(yaml).toContain('count: 3');
    expect(yaml).toContain('nested:\n  a: 1');
    expect(yaml).toContain('b:\n    - 1\n    - 2');
    expect(yaml).toContain('c: []');
    expect(yaml).toContain('list:\n  - age: 65\n    tfsa: 100\n  - age: 66\n    tfsa: 90');
  });

  it('quotes ambiguous scalars so they do not reparse as other types', () => {
    const yaml = toYaml({ a: 'yes', b: '123', c: 'plain', d: 'has: colon' });
    expect(yaml).toContain('a: "yes"');
    expect(yaml).toContain('b: "123"');
    expect(yaml).toContain('c: plain');
    expect(yaml).toContain('d: "has: colon"');
  });

  it('escapes backslashes and quotes in keys and string values', () => {
    // A backslash before the closing quote would otherwise escape it and
    // break the scalar out of its string (CodeQL js/incomplete-sanitization).
    const yaml = toYaml({ 'back\\slash': 1, 'say "hi"': 'C:\\path\\to' });
    expect(yaml).toContain('"back\\\\slash": 1');
    expect(yaml).toContain('"say \\"hi\\"": "C:\\\\path\\\\to"');
  });

  it('produces a YAML export for a real projection', () => {
    const { results, inputs } = rich();
    const payload = buildExport('p', inputs, results, config, { ...opts, format: 'yaml' });
    expect(payload.extension).toBe('yaml');
    expect(payload.content).toContain('metadata:');
    expect(payload.content).toContain('projection:');
    expect(payload.content).toContain('- calendarYear:');
    expect(payload.content).toContain('      age: 65');
  });
});

describe('buildExport dispatch', () => {
  it('returns the right payload shape per format', () => {
    const { results, inputs } = rich();
    const csv = buildExport('p', inputs, results, config, { ...opts, format: 'csv' });
    expect(csv.extension).toBe('csv');
    expect(csv.content.split('\n')[0]).toContain('person,age,calendarYear');
    const json = buildExport('p', inputs, results, config, { ...opts, format: 'json' });
    expect(json.extension).toBe('json');
    expect(() => JSON.parse(json.content)).not.toThrow();
  });
});
