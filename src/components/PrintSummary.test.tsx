// @vitest-environment node
// The print sheet joins the f7 system: it reads the design tokens (no raw
// hex in the markup), keeps zero inline styles, and stays square (no
// rounded logo/boxes). The old sheet used the old-skin blue-600, a rounded
// RE: block and red-600 negatives — all ruled out here.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { PrintSummary } from './PrintSummary';
import { calculateHousehold, type RetirementInputs } from '@retired/engine-core/retirementEngine';
import { baseInputs, testConfig } from '../../packages/engine-core/test/helpers';
import { DEFAULT_PRINT_OPTIONS } from '../lib/printOptions';

const inputs: RetirementInputs = baseInputs({
  currentAge: 65,
  retirementAge: 65,
  desiredSpending: 40000,
  tfsaBalance: 500000,
  cppStartAge: 65,
  cppMonthlyAmount: 500,
  oasStartAge: 65,
});

const results = calculateHousehold(inputs, testConfig());

const render = (overrides: Partial<Parameters<typeof PrintSummary>[0]> = {}) =>
  renderToStaticMarkup(createElement(PrintSummary, {
    scenarioName: 'Test plan',
    inputs,
    results,
    householdBreakdown: results.yearlyBreakdown,
    options: { ...DEFAULT_PRINT_OPTIONS },
    mcResults: null,
    rrifConversionAge: 71,
    ...overrides,
  }));

describe('PrintSummary (f7 tokens)', () => {
  it('renders the sheet: wordmark, verdict-first tables, milestones', () => {
    const html = render();
    expect(html).toContain('RE: tired — Retirement Plan Summary');
    for (const section of ['Verdict', 'Profile', 'Savings']) {
      expect(html, section).toContain(section);
    }
    // Verdict first (guide principle 1) — its table precedes Profile's.
    expect(html.indexOf('Status')).toBeLessThan(html.indexOf('Current age'));
    expect(html).toContain('Major spending milestones');
    expect(html).toContain('Age 65'); // a milestone row rendered
  });

  it('keeps blue for data/verdict only — structure is ink and slate', () => {
    const html = render();
    // The header rule is INK, not the verdict accent…
    expect(html).toContain('border-slate-900');
    expect(html).not.toContain('border-blue-700');
    // …and section labels are the guide's slate, not blue.
    expect(html).not.toContain('text-blue-700 mb-1');
    expect(html).toContain('uppercase'); // the section-label style survives
  });

  it('carries no raw hex and no inline styles — tokens/classes only', () => {
    const html = render();
    expect(html).not.toContain('style="');
    // The old skin's palette, banned from the sheet:
    expect(html).not.toContain('#2563eb'); // old blue-600
    expect(html).not.toContain('#3b82f6'); // old blue-500
    expect(html).not.toContain('#dc2626'); // old red-600
    expect(html).not.toContain('border-radius');
  });

  it('keeps the print-only marker and the optional sections off unless asked', () => {
    const html = render();
    expect(html).toContain('print-only'); // index.css shows it only in @media print
    expect(html).not.toContain('Detailed year-by-year');
    expect(html).not.toContain('Monte Carlo simulation');
  });

  it('renders the detailed table and per-person rows when enabled', () => {
    const html = render({ options: { ...DEFAULT_PRINT_OPTIONS, includeDetailedTable: true } });
    expect(html).toContain('Detailed year-by-year');
    expect(html).toContain('Withdrawn');
  });
});
