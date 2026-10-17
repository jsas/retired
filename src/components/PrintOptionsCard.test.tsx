// @vitest-environment node
// The Print & export page body, rebuilt in the f7 design: BetaPage owns the
// page title, so the card renders NO heading of its own (the old double
// header), no decorative blue icons, and a flat ink print button.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { PrintOptionsCard } from './PrintOptionsCard';

const base = {
  onChange: () => {},
  onPrint: () => {},
  mcPending: false,
  mcResults: null,
};

describe('PrintOptionsCard (beta design)', () => {
  it('renders no inner page heading — BetaPage owns the title', () => {
    const html = renderToStaticMarkup(createElement(PrintOptionsCard, {
      ...base,
      options: { includeTimeline: false, includeMonteCarlo: false, includeMilestones: true, includeDetailedTable: false },
    }));
    // The old card forked its own big h2 ("Print summary options") inside the
    // page's PRINT & EXPORT label — the double header. Gone. (Panel's own
    // small section label h2 is the system's, that stays.)
    expect(html).not.toContain('Print summary options');
    expect(html).not.toContain('text-lg font-bold');
    // the section label and the option rows remain
    expect(html).toContain('Build the printout');
    expect(html).toContain('Projection timeline chart');
    expect(html).toContain('Major spending milestones');
  });

  it('uses no decorative blue — the print button is ink, flat, square', () => {
    const html = renderToStaticMarkup(createElement(PrintOptionsCard, {
      ...base,
      options: { includeTimeline: false, includeMonteCarlo: false, includeMilestones: true, includeDetailedTable: false },
    }));
    expect(html).not.toContain('text-blue-600');   // old icon tint
    expect(html).not.toContain('bg-blue-600');     // old button fill
    expect(html).not.toContain('rounded');         // flat/square rule
    expect(html).toContain('bg-slate-900');        // the ink primary button
  });

  it('disables printing while the Monte Carlo fan is still computing', () => {
    const html = renderToStaticMarkup(createElement(PrintOptionsCard, {
      ...base,
      options: { includeTimeline: false, includeMonteCarlo: true, includeMilestones: false, includeDetailedTable: false },
      mcPending: true,
    }));
    expect(html).toContain('disabled');
    expect(html).toContain('Running 500 simulations');
  });
});
