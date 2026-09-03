// The site's page map as data: every view the SPA can render, its route, and
// the plain-language words a user (or model) would use to find it. This is the
// single source of truth for find_page / get_sitemap / propose_navigate, the
// Vite sitemap plugin (dist/sitemap.{json,xml}), and the training corpus —
// keeping the map here means no copy can rot against the routes.
//
// The app layer (src/lib/viewRoutes.ts) derives the SPA's hash routing from
// this catalog with a drift test both directions, so adding or renaming a view
// is a one-file change and the combined test fails on half-drift.
//
// KEYED FOR THE BETA SKIN (issue #141): titles/descriptions match what the
// beta chrome shows (Dashboard, The details, Insights, Profiles, Data). The
// surfaces the beta fold into those pages (optimize/monte-carlo/backtest →
// Insights; export/sharing → Data; compare → Profiles) keep their legacy view
// ids for back-compat routing on the stable skin, but carry `foldedInto` and
// are hidden from search/sitemap/proposals. When beta becomes the UI, delete
// the folded entries and the drift test keeps the routes honest.

/** One navigable page (view) in the SPA. `viewId` must be importable by
 *  host-agnostic packages without depending on the app, so it lives here. */
export type View =
  | 'projection'
  | 'details'
  | 'math'
  | 'eq'
  | 'scenarios'
  | 'data'
  | 'print'
  | 'donate'
  | 'agent'
  | 'connections'
  | 'welcome'
  | 'help'
  | 'settings'
  // Beta-skin only: the design-system style guide. Not part of the stable UI —
  // App renders it from the beta branch, but it must be a recognized view so
  // the URL-sync effect doesn't rewrite #/styleguide back to the default view.
  | 'styleguide'
  // Legacy stable-skin pages. On the beta skin these routes land on the page
  // named in `foldedInto` below (or the dashboard for unhandled ones); they
  // stay routable for existing deep links while beta is opt-in.
  | 'optimize'
  | 'compare'
  | 'montecarlo'
  | 'backtest'
  | 'export'
  | 'sharing';

/** What a page is, in model-readable words. `keywords` powers find_page's
 *  ranking and the promptTools instruction hint ("tfsa room" → details). */
export interface NavEntry {
  viewId: View;
  /** The hash-route slug ('steering'), same as VIEW_ROUTES — one short path. */
  route: string;
  /** Human page title, echoed in find_page output and the sitemap artifacts. */
  title: string;
  /** One-line purpose, plain words; appears in get_sitemap + sitemap.json. */
  description: string;
  /** Search terms a user might type (lowercase words/phrases), ranked best-first. */
  keywords: readonly string[];
  /** True if this view is only in the beta design-skin (style guide), so
   *  find_page/get_sitemap can still name it without saying "beta". */
  betaOnly?: true;
  /** Set when the beta skin folds this legacy page into another one: the
   *  canonical destination view. Hidden from search/sitemap; a proposal that
   *  names it is redirected to the destination. */
  foldedInto?: View;
}

/** The page map in rail order (home first, misc last) — get_sitemap lists it
 *  this way and find_page ties break by catalog position, not alphabetically. */
export const NAV_CATALOG: ReadonlyArray<NavEntry> = [
  {
    viewId: 'projection',
    route: 'projection',
    title: 'Dashboard',
    description: 'The plan at a glance: the verdict (funded or depleted, with age and shortfall), key metrics, and the doors to everything else.',
    keywords: ['dashboard', 'home', 'verdict', 'funded', 'depleted', 'run out', 'shortfall', 'money run out', 'projection', 'overview', 'main page'],
  },
  {
    viewId: 'details',
    route: 'details',
    // Title is "Details" (not the page's "The details" display form) so the
    // ambient line reads "on the Details page", not "on the The details page".
    title: 'Details',
    description: 'Every input behind the plan, sectioned: personal profile, spouse, account balances and contribution room (TFSA/RRSP), contribution rates, income, government benefits, cash events, spending phases, debts and the reverse mortgage, and market hypotheses.',
    keywords: ['tfsa room', 'rrsp room', 'contribution room', 'caps', 'balances', 'accounts', 'contributions', 'income', 'benefits', 'cpp', 'oas', 'spending', 'spouse', 'debts', 'loan', 'reverse mortgage', 'volatility', 'returns', 'market hypotheses', 'inputs', 'edit', 'change my numbers', 'the details'],
  },
  {
    viewId: 'math',
    route: 'year-math',
    title: 'Year-by-year',
    description: 'The schedule table: one row per retirement year with withdrawals, tax, and balances — pick the columns you care about.',
    keywords: ['schedule', 'year-by-year', 'year by year', 'table', 'columns', 'withdrawals', 'tax paid', 'one year'],
  },
  {
    viewId: 'eq',
    route: 'steering',
    title: 'Insights',
    description: 'Everything the plan can be nudged by: the equalizer lever ranking (CPP/OAS timing, pension start, withdrawal order, reverse mortgage, part-time work), the optimize variants with one-click apply, the Monte Carlo odds, and the historical backtest.',
    keywords: ['insights', 'steering', 'equalizer', 'levers', 'options', 'ranked', 'what helps most', 'optimize', 'best option', 'apply', 'monte carlo', 'simulation', 'odds', 'success rate', 'probabilities', 'backtest', 'historical', '1926', 'stress test', 'past markets'],
  },
  {
    viewId: 'scenarios',
    route: 'scenarios',
    title: 'Profiles',
    description: 'Your saved plans: open, rename, duplicate, delete, and roll back revisions — plus the side-by-side comparison of every profile.',
    keywords: ['profiles', 'scenarios', 'saved plans', 'manager', 'duplicate', 'rename', 'delete', 'compare', 'side-by-side', 'which plan', 'revisions'],
  },
  {
    viewId: 'data',
    route: 'data',
    title: 'Data',
    description: 'Everything in and out: share a plan by link or code, full backup and restore, and exporting the plan or projections to CSV/JSON.',
    keywords: ['data', 'backup', 'restore', 'export', 'csv', 'json', 'download', 'spreadsheet', 'share', 'link', 'code', 'snapshot', 'import', 'send plan'],
  },
  {
    viewId: 'print',
    route: 'print',
    title: 'Print & export',
    description: 'One-page printable summary of the plan and its key numbers, with the export options.',
    keywords: ['print', 'summary', 'one page', 'pdf', 'report'],
  },
  {
    viewId: 'settings',
    route: 'settings',
    title: 'Settings',
    description: 'Tax tables (user-editable), export defaults, assistant/system prompt defaults.',
    keywords: ['settings', 'tax tables', 'defaults', 'prompt', 'province', 'edit table'],
  },
  {
    viewId: 'connections',
    route: 'connections',
    title: 'Assistant connection',
    description: 'Where the assistant runs: local model or online provider, the API key, and exactly what the chat may see.',
    keywords: ['connections', 'api key', 'llm', 'provider', 'local', 'online', 'model', 'privacy', 'wire'],
  },
  {
    viewId: 'agent',
    route: 'assistant',
    title: 'Assistant',
    description: 'The AI assistant full-screen: ask about the plan, what-if it, or change it with propose_* cards you approve.',
    keywords: ['assistant', 'ai', 'chat', 'help me', 'what-if', 'ask', 'agent'],
  },
  {
    viewId: 'help',
    route: 'help',
    title: 'Help',
    description: 'In-app explanation of every feature in the plain-language terms the app itself uses.',
    keywords: ['help', 'docs', 'explain', 'how do i', 'how to', 'manual', 'faq'],
  },
  {
    viewId: 'donate',
    route: 'donate',
    title: 'Support this app',
    description: 'Ways to support the app (it is free and open source).',
    keywords: ['donate', 'support', 'contribute', 'sponsor', 'pay'],
  },
  {
    viewId: 'welcome',
    route: 'welcome',
    title: 'Welcome',
    description: 'The front door: five questions build a starter plan, then the doors to the rest of the app.',
    keywords: ['welcome', 'start', 'getting started', 'onboarding', 'first time', 'new plan', 'build a plan'],
  },
  {
    viewId: 'styleguide',
    route: 'styleguide',
    title: 'Style Guide',
    description: 'Design-system reference for the app itself; not part of the plan surface.',
    keywords: ['style guide', 'design', 'beta', 'components'],
    betaOnly: true,
  },
  // ── Legacy stable-skin pages, folded on beta ────────────────────────────
  // Kept so #/optimize etc. keep parsing and the stable header still compiles;
  // hidden from search/sitemap because beta is the destination UI.
  {
    viewId: 'optimize',
    route: 'optimize',
    title: 'Optimize',
    description: 'Named plan variants scored on sustainable spending, with one-click apply.',
    keywords: ['optimize', 'variants', 'best lever', 'compare timing', 'apply best'],
    foldedInto: 'eq',
  },
  {
    viewId: 'montecarlo',
    route: 'monte-carlo',
    title: 'Monte Carlo',
    description: 'Probabilistic run: success rate across market futures and a depletion histogram.',
    keywords: ['monte carlo', 'simulation', 'odds', 'success rate', 'market futures', 'probabilistic'],
    foldedInto: 'eq',
  },
  {
    viewId: 'backtest',
    route: 'backtest',
    title: 'Backtest',
    description: 'Run the plan against every historical market stretch back to 1926.',
    keywords: ['backtest', 'historical', '1926', 'stress test', 'past markets'],
    foldedInto: 'eq',
  },
  {
    viewId: 'compare',
    route: 'compare',
    title: 'Compare',
    description: 'Side-by-side outcomes across all saved profiles.',
    keywords: ['compare', 'side-by-side', 'which plan', 'vs'],
    foldedInto: 'scenarios',
  },
  {
    viewId: 'export',
    route: 'export',
    title: 'Export',
    description: 'Export the plan or computed projections to CSV / JSON.',
    keywords: ['export', 'csv', 'json', 'download', 'data', 'spreadsheet'],
    foldedInto: 'data',
  },
  {
    viewId: 'sharing',
    route: 'sharing',
    title: 'Sharing',
    description: 'Share a plan with a link or download a snapshot for import.',
    keywords: ['share', 'link', 'public', 'snapshot', 'import', 'send plan'],
    foldedInto: 'data',
  },
] as const;

/** Full path the model can print to the user: `#/steering`. */
export function hashForEntry(entry: NavEntry): string {
  return `#/${entry.route}`;
}

/** "Dashboard", "Insights", … — the phrasing for the ambient current-page
 *  line (`buildSystemPrompt` uses this so the prompt and find_page's
 *  "already here" start with the same friendly title). A folded legacy view
 *  reports its destination's title, since that is the page the user sees. */
export function pageTitleLine(view: View): string {
  const e = NAV_CATALOG.find((n) => n.viewId === view);
  if (!e) return view;
  if (e.foldedInto) {
    const target = NAV_CATALOG.find((n) => n.viewId === e.foldedInto);
    if (target) return target.title;
  }
  return e.title;
}

// The loop imports pageTitleLine from mcp-tools deliberately: ambient "you
// are currently on X" matches find_page result titles, and the sitemap.xml
// emitted by the plugin contains the same editorializing once, not twice.

/** The pages a user can actually reach on the current (beta) UI: the catalog
 *  minus the legacy surfaces folded into other pages. get_sitemap lists these,
 *  find_page searches these, and propose_navigate redirects anything else. */
export function searchablePages(): ReadonlyArray<NavEntry> {
  return NAV_CATALOG.filter((e) => e.foldedInto == null);
}

/** Resolve a folded legacy view (or any view) to the destination the beta
 *  skin shows. Identity for canonical pages. */
export function canonicalView(view: View): View {
  const e = NAV_CATALOG.find((n) => n.viewId === view);
  return e?.foldedInto ?? view;
}

/** Ranked search over the reachable pages. `currentView` is hoisted first so
 *  the model hears "you are already here" before jumping somewhere else.
 *  Uses a simple weighted match (exact phrase > title > description >
 *  substring) so the filter in #141's "the site is searchable" stays
 *  deterministic — this is the module a fine-tuned model would call learnable
 *  without re-coding. */
export function rankPages(query: string, currentView?: View): NavEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const score = (entry: NavEntry): number => {
    let best = 0;
    for (const keyword of entry.keywords) {
      const k = keyword.toLowerCase();
      if (k === q) best = Math.max(best, 100);
      else if (q.startsWith(k) || k.startsWith(q)) best = Math.max(best, 80);
      else if (k.includes(q)) best = Math.max(best, 60);
      else if (q.includes(k)) best = Math.max(best, 40);
    }
    if (entry.title.toLowerCase() === q) best = Math.max(best, 95);
    if (entry.title.toLowerCase().includes(q)) best = Math.max(best, 55);
    if (entry.description.toLowerCase().includes(q)) best = Math.max(best, 15);
    return best;
  };

  const pages = searchablePages();
  const ranked = pages.filter((e) => score(e) > 0);
  ranked.sort((a, b) => score(b) - score(a));
  if (currentView) {
    const current = ranked.find((e) => e.viewId === canonicalView(currentView));
    if (current) {
      return [current, ...ranked.filter((e) => e !== current)];
    }
  }
  return ranked;
}

/** Look up one entry by view id, or null. */
export function pageForView(view: View): NavEntry | undefined {
  return NAV_CATALOG.find((e) => e.viewId === view);
}

/** All entries the current app build knows about, folded legacy pages included
 *  (routing needs them; search should use `searchablePages`). */
export function allPages(): ReadonlyArray<NavEntry> {
  return NAV_CATALOG;
}

// ---------------------------------------------------------------------------
// Sitemap artifact serialization (issue #141)
//
// The Vite plugin (vite.config.ts) writes these strings into dist/sitemap.{json,xml}
// at build time, and a test pins the committed copy at the repo root to the
// exact same functions — the artifacts, the tools, and the drift gate all
// generate from the one catalog, so none can rot against the others.
// ---------------------------------------------------------------------------

export interface SitemapEntry {
  view: View;
  route: string;
  url: string;
  title: string;
  description: string;
  keywords: string[];
}

/** The user-facing pages, serialized. Folded legacy views share their
 *  destination's entry; beta-only chrome (the style guide) stays out. */
export function sitemapEntries(origin: string): SitemapEntry[] {
  return searchablePages()
    .filter((e) => e.betaOnly == null)
    .map((e) => ({
      view: e.viewId,
      route: hashForEntry(e),
      // Canonical form: origin/, then the hash. Browsers redirect
      // /retired → /retired/ before the hash, so crawlers want the slash.
      url: `${origin.replace(/\/+$/, '')}/${hashForEntry(e)}`,
      title: e.title,
      description: e.description,
      keywords: [...e.keywords],
    }));
}

export function buildSitemapJson(origin: string): string {
  return JSON.stringify({ pages: sitemapEntries(origin) }, null, 2) + '\n';
}

export function buildSitemapXml(origin: string): string {
  const items = sitemapEntries(origin).map((p) =>
    `  <url>\n    <loc>${p.url}</loc>\n    <!-- ${p.title} -->\n  </url>`,
  ).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!-- Generated from packages/mcp-tools/src/navigation.ts (NAV_CATALOG) by the emit-sitemap Vite plugin. Do not edit by hand. -->\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + `${items}\n</urlset>\n`;
}
