import { describe, it, expect } from 'vitest';
import { viewFromHash, hashForView, foldTarget, VIEW_ROUTES, type View } from './viewRoutes';
import { NAV_CATALOG } from '@retired/mcp-tools/navigation';

describe('viewFromHash', () => {
  it('maps each canonical route to its view', () => {
    expect(viewFromHash('#/projection')).toBe('projection');
    expect(viewFromHash('#/year-math')).toBe('math');
    expect(viewFromHash('#/steering')).toBe('eq');
    expect(viewFromHash('#/optimize')).toBe('optimize');
    expect(viewFromHash('#/compare')).toBe('compare');
    expect(viewFromHash('#/monte-carlo')).toBe('montecarlo');
    expect(viewFromHash('#/backtest')).toBe('backtest');
    expect(viewFromHash('#/print')).toBe('print');
    expect(viewFromHash('#/export')).toBe('export');
    expect(viewFromHash('#/scenarios')).toBe('scenarios');
    expect(viewFromHash('#/sharing')).toBe('sharing');
    expect(viewFromHash('#/donate')).toBe('donate');
    expect(viewFromHash('#/welcome')).toBe('welcome');
    expect(viewFromHash('#/help')).toBe('help');
    expect(viewFromHash('#/settings')).toBe('settings');
    expect(viewFromHash('#/styleguide')).toBe('styleguide');
    expect(viewFromHash('#/details')).toBe('details');
    expect(viewFromHash('#/data')).toBe('data');
  });

  it('accepts hashes without the leading slash', () => {
    expect(viewFromHash('#steering')).toBe('eq');
  });

  it('routes hashes carrying a query-string deep-link to their page', () => {
    // The ? hints deep-link into Help (#/help?topic=…), Details carries
    // ?section=… — the query must not break route matching.
    expect(viewFromHash('#/help?topic=assistant')).toBe('help');
    expect(viewFromHash('#/details?section=spending')).toBe('details');
    expect(viewFromHash('#steering?x=1')).toBe('eq');
  });

  it('ignores a trailing slash', () => {
    expect(viewFromHash('#/steering/')).toBe('eq');
  });

  it('returns null for an empty hash', () => {
    expect(viewFromHash('')).toBeNull();
    expect(viewFromHash('#')).toBeNull();
    expect(viewFromHash('#/')).toBeNull();
  });

  it('returns null for unknown routes', () => {
    expect(viewFromHash('#/bogus')).toBeNull();
  });

  it('returns null for #plan= share links (different namespace)', () => {
    expect(viewFromHash('#plan=abc123')).toBeNull();
  });
});

describe('hashForView', () => {
  it('round-trips every unfolded view', () => {
    // Folded legacy views intentionally resolve to their destination page —
    // the round-trip for those is covered by the fold tests below.
    const views: View[] = [
      'projection', 'math', 'eq', 'scenarios', 'data', 'print', 'donate',
      'welcome', 'help', 'settings', 'styleguide', 'details',
    ];
    for (const v of views) {
      expect(viewFromHash(hashForView(v))).toBe(v);
    }
  });

  it('folds legacy views to their destination page', () => {
    expect(foldTarget('optimize')).toBe('eq');
    expect(foldTarget('montecarlo')).toBe('eq');
    expect(foldTarget('backtest')).toBe('eq');
    expect(foldTarget('compare')).toBe('scenarios');
    expect(foldTarget('export')).toBe('data');
    expect(foldTarget('sharing')).toBe('data');
  });

  it('hashForView prints the destination hash for folded views', () => {
    // A "Go to Monte Carlo" link the assistant prints must land on Insights —
    // not on a dead folded route.
    expect(hashForView('montecarlo')).toBe('#/steering');
    expect(hashForView('optimize')).toBe('#/steering');
    expect(hashForView('backtest')).toBe('#/steering');
    expect(hashForView('compare')).toBe('#/scenarios');
    expect(hashForView('export')).toBe('#/data');
    expect(hashForView('sharing')).toBe('#/data');
  });

  it('round-trips folded views through their fold', () => {
    for (const v of ['optimize', 'montecarlo', 'backtest', 'compare', 'export', 'sharing'] as View[]) {
      expect(viewFromHash(hashForView(v))).toBe(foldTarget(v));
    }
  });

  it('uses every route exactly once', () => {
    const routes = Object.values(VIEW_ROUTES);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

// Drift gate: the routes and the catalog each cover EVERY view, neither
// direction may lose a view and no entry may drop its title/keywords (a view
// with no keywords is a find_page false-negative).
describe('view/routes ⇔ catalog drift', () => {
  it('catalog contains every view the SPA can render', () => {
    const catViews = new Set(NAV_CATALOG.map((e) => e.viewId));
    for (const v of Object.keys(VIEW_ROUTES) as View[]) {
      expect(catViews.has(v)).toBe(true);
    }
  });

  it('VIEW_ROUTES covers every catalog entry', () => {
    for (const entry of NAV_CATALOG) {
      expect(VIEW_ROUTES[entry.viewId]).toBe(entry.route);
    }
  });

  it('catalog entries keep their searchable keywords (or find_page dies)', () => {
    for (const entry of NAV_CATALOG) {
      expect(entry.keywords.length).toBeGreaterThan(0);
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('hashForView/viewFromHash covers every catalog entry (fold-aware)', () => {
    for (const entry of NAV_CATALOG) {
      const target = entry.foldedInto ?? entry.viewId;
      expect(viewFromHash(hashForView(entry.viewId))).toBe(target);
    }
  });
});
