// The page catalog: the contract the tools, the routing drift test, the
// sitemap artifact, and the training corpus all lean on. These are the
// semantic invariants; route⇄VIEW_ROUTES parity lives in src/lib/
// viewRoutes.test.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NAV_CATALOG, allPages, canonicalView, pageForView,
  pageTitleLine, rankPages, searchablePages, buildSitemapJson, buildSitemapXml,
} from './navigation';

describe('NAV_CATALOG shape', () => {
  it('has unique viewIds and routes', () => {
    const views = NAV_CATALOG.map((e) => e.viewId);
    const routes = NAV_CATALOG.map((e) => e.route);
    expect(new Set(views).size).toBe(views.length);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('every entry is describable and findable', () => {
    for (const e of NAV_CATALOG) {
      expect(e.title.length).toBeGreaterThan(1);
      expect(e.description.length).toBeGreaterThan(10);
      expect(e.keywords.length).toBeGreaterThan(0);
      expect(e.route).toBe(e.route.toLowerCase());
      expect(e.route).not.toMatch(/[/#]/);
    }
  });

  it('folded views point at real, unfolded destinations', () => {
    for (const e of NAV_CATALOG) {
      if (e.foldedInto == null) continue;
      const target = pageForView(e.foldedInto);
      expect(target, `folded ${e.viewId} -> missing ${e.foldedInto}`).toBeDefined();
      expect(target!.foldedInto, `fold of a fold (${e.viewId})`).toBeUndefined();
    }
  });
});

describe('rankPages', () => {
  it('routes plain words to the page that holds them', () => {
    expect(rankPages('tfsa room')[0]?.viewId).toBe('details');
    expect(rankPages('monte carlo')[0]?.viewId).toBe('eq');
    expect(rankPages('backup')[0]?.viewId).toBe('data');
    expect(rankPages('tax tables')[0]?.viewId).toBe('settings');
    expect(rankPages('print')[0]?.viewId).toBe('print');
    expect(rankPages('compare')[0]?.viewId).toBe('scenarios');
  });

  it('searches only the reachable pages — folded legacy views never surface', () => {
    for (const q of ['monte carlo', 'optimize', 'export', 'sharing', 'backtest', 'compare']) {
      const ids = rankPages(q).map((e) => e.viewId);
      expect(ids, `query "${q}" surfaced a folded page`).not.toContain('montecarlo');
      expect(ids, `query "${q}" surfaced a folded page`).not.toContain('export');
    }
  });

  it('hoists the current page first so "already here" is the first thing read', () => {
    const ranked = rankPages('compare', 'eq');
    expect(ranked[0]?.viewId).toBe('scenarios');
    // With the user on the destination itself, it leads.
    const here = rankPages('compare', 'scenarios');
    expect(here[0]?.viewId).toBe('scenarios');
    // A folded currentView canonicalizes for the hoist (on #/monte-carlo means
    // on Insights, and an Insights search result is "already here").
    const folded = rankPages('monte carlo', 'montecarlo');
    expect(folded[0]?.viewId).toBe('eq');
  });

  it('is deterministic: no query, no matches', () => {
    expect(rankPages('')).toEqual([]);
    expect(rankPages('   ')).toEqual([]);
    expect(rankPages('zzzqqq nothing')).toEqual([]);
  });
});

describe('canonicalView / pageTitleLine', () => {
  it('maps folded views to their destination, identity otherwise', () => {
    expect(canonicalView('montecarlo')).toBe('eq');
    expect(canonicalView('sharing')).toBe('data');
    expect(canonicalView('eq')).toBe('eq');
    expect(canonicalView('projection')).toBe('projection');
  });

  it('names pages by their UI title — folded pages report their destination', () => {
    expect(pageTitleLine('projection')).toBe('Dashboard');
    expect(pageTitleLine('details')).toBe('Details');
    expect(pageTitleLine('eq')).toBe('Insights');
    expect(pageTitleLine('scenarios')).toBe('Profiles');
    expect(pageTitleLine('data')).toBe('Data');
    // A legacy view's line is the page the user actually sees.
    expect(pageTitleLine('montecarlo')).toBe('Insights');
  });

  it('titles are article-safe (no leading The/An/A — "on the X page" reads right)', () => {
    for (const e of searchablePages()) {
      expect(e.title, `title "${e.title}" starts with an article`).not.toMatch(/^(The|An?|Some)\s/i);
    }
  });
});

describe('sitemap artifact serialization', () => {
  // The committed copy at the repo root is pinned byte-for-byte against these
  // functions (see the root-level test below) — same bytes the Vite plugin
  // writes into dist/. Keep the two PAGES_ORIGIN constants in sync.
  const PAGES_ORIGIN = 'https://jsas.github.io/retired';

  it('lists the user-facing pages, in catalog order, no folds no chrome', () => {
    const doc = JSON.parse(buildSitemapJson(PAGES_ORIGIN)) as {
      pages: Array<{ view: string; route: string; url: string; title: string }>;
    };
    const views = doc.pages.map((p) => p.view);
    expect(views).toEqual(searchablePages().filter((e) => e.betaOnly == null).map((e) => e.viewId));
    for (const p of doc.pages) {
      expect(p.route).toMatch(/^#\//);
      expect(p.url).toBe(`${PAGES_ORIGIN}/${p.route}`);
      expect(p.title.length).toBeGreaterThan(0);
    }
    // Folded legacy views and beta-only chrome never appear.
    expect(views).not.toContain('montecarlo');
    expect(views).not.toContain('styleguide');
  });

  it('the XML mirrors the JSON page list', () => {
    const xml = buildSitemapXml(PAGES_ORIGIN);
    const jsonViews = (JSON.parse(buildSitemapJson(PAGES_ORIGIN)) as { pages: Array<{ url: string }> }).pages;
    for (const p of jsonViews) expect(xml).toContain(`<loc>${p.url}</loc>`);
    expect(xml).toMatch(/^<\?xml version="1\.0"/);
    expect(xml).toContain('Do not edit by hand');
  });

  it('the committed root sitemap.json equals the generated bytes', () => {
    // The CI gate regenerates-and-diffs; this test catches drift locally in
    // `npx vitest run`, golden-master style (CLAUDE.md rule 2).
    const committed = readFileSync(join(process.cwd(), 'sitemap.json'), 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(buildSitemapJson(PAGES_ORIGIN));
  });

  it('allPages covers the union; searchablePages hides the folds', () => {
    expect(allPages().length).toBeGreaterThan(searchablePages().length);
    for (const e of searchablePages()) expect(e.foldedInto).toBeUndefined();
  });
});
