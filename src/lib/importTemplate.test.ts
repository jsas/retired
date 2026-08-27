import { describe, it, expect } from 'vitest';
import { buildTemplateCsv, parseTemplateCsv } from './importTemplate';

describe('buildTemplateCsv', () => {
  it('has a key,value header and one row per template field', () => {
    const csv = buildTemplateCsv();
    const lines = csv.split(/\r?\n/).filter(l => l && !l.startsWith('#'));
    expect(lines[0]).toBe('key,value');
    expect(lines.some(l => l.startsWith('currentAge,'))).toBe(true);
    expect(lines.some(l => l.startsWith('spouse.currentAge,'))).toBe(true);
  });

  it('round-trips: the shipped template parses back with the same values', () => {
    const { inputs, warnings } = parseTemplateCsv(buildTemplateCsv());
    expect(warnings).toEqual([]);
    expect(inputs.currentAge).toBe(45);
    expect(inputs.retirementAge).toBe(65);
    expect(inputs.provinceCode).toBe('ONT');
    expect(inputs.rrspBalance).toBe(250000);
    expect(inputs.cppAdjustedAmount).toBe(false);
    // Template ships with all spouse rows blank → no spouse.
    expect(inputs.spouse).toBeUndefined();
  });
});

describe('parseTemplateCsv', () => {
  it('defaults every blank field', () => {
    const csv = 'key,value\ncurrentAge,50\nretirementAge,60\n';
    const { inputs } = parseTemplateCsv(csv);
    expect(inputs.currentAge).toBe(50);
    expect(inputs.retirementAge).toBe(60);
    expect(inputs.maxAge).toBe(95);
    expect(inputs.desiredSpending).toBe(60000);
    expect(inputs.tfsaBalance).toBe(0);
    expect(inputs.cppStartAge).toBe(65);
    expect(inputs.oasYearsInCanada).toBe(40);
    expect(inputs.withdrawalOrder).toEqual(['taxable', 'rrsp', 'tfsa']);
  });

  it('tolerates $ and thousands separators on numbers', () => {
    const csv = 'key,value\ndesiredSpending,$75000\ninvestmentReturn,0.05\nrrspBalance,$250,000\n';
    const { inputs } = parseTemplateCsv(csv);
    expect(inputs.desiredSpending).toBe(75000);
    expect(inputs.investmentReturn).toBe(0.05);
    // The trailing ",000" becomes a garbage extra row that warns, but the
    // value itself parses — commas are stripped by the number reader.
    expect(inputs.rrspBalance).toBe(250000);
  });

  it('enables the spouse when any spouse field is filled', () => {
    const csv = 'key,value\nspouse.currentAge,43\nspouse.rrspBalance,120000\n';
    const { inputs } = parseTemplateCsv(csv);
    expect(inputs.spouse?.enabled).toBe(true);
    expect(inputs.spouse?.currentAge).toBe(43);
    expect(inputs.spouse?.rrspBalance).toBe(120000);
    expect(inputs.spouse?.cppStartAge).toBe(65);
  });

  it('keeps spouse undefined when every spouse row is blank', () => {
    const csv = 'key,value\nspouse.currentAge,\nspouse.rrspBalance,\n';
    expect(parseTemplateCsv(csv).inputs.spouse).toBeUndefined();
  });

  it('warns on unknown keys but still imports', () => {
    const csv = 'key,value\ncurrentAge,50\nfavoriteColor,blue\n';
    const { inputs, warnings } = parseTemplateCsv(csv);
    expect(inputs.currentAge).toBe(50);
    expect(warnings.some(w => w.includes('favoriteColor'))).toBe(true);
  });

  it('uses the name row, defaulting when blank', () => {
    expect(parseTemplateCsv('key,value\nname,Retire early\n').name).toBe('Retire early');
    expect(parseTemplateCsv('key,value\nname,\n').name).toBe('Imported plan');
  });

  it('throws on a file with no key,value rows', () => {
    expect(() => parseTemplateCsv('just some text\nmore text')).toThrow(/template/);
  });
});
