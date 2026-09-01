// Deep-link routes for the SPA: each view lives at #/<route> so pages are
// linkable and the browser back/forward buttons navigate the app. Share links
// (#plan=…) are a different hash namespace and are consumed before routing runs.

export type View =
  | 'projection'
  | 'settings'
  | 'help'
  | 'math'
  | 'eq'
  | 'optimize'
  | 'compare'
  | 'montecarlo'
  | 'backtest'
  | 'print'
  | 'export'
  | 'scenarios'
  | 'sharing'
  | 'donate'
  | 'agent'
  | 'connections'
  | 'welcome'
  // Beta-skin only: the design-system style guide. Not part of the stable UI —
  // App renders it from the beta branch, but it must be a recognized view so
  // the URL-sync effect doesn't rewrite #/styleguide back to the default view.
  | 'styleguide'
  // Beta-skin pages (the f7 rebuild). These reuse the stable routes where one
  // already exists (schedule→year-math, insights→steering, plans→scenarios,
  // settings) and add the two new ones (details, data).
  | 'details'
  | 'data';

export const VIEW_ROUTES: Record<View, string> = {
  projection: 'projection',
  math: 'year-math',
  eq: 'steering',
  optimize: 'optimize',
  compare: 'compare',
  montecarlo: 'monte-carlo',
  backtest: 'backtest',
  print: 'print',
  export: 'export',
  scenarios: 'scenarios',
  sharing: 'sharing',
  donate: 'donate',
  agent: 'assistant',
  connections: 'connections',
  welcome: 'welcome',
  help: 'help',
  settings: 'settings',
  styleguide: 'styleguide',
  details: 'details',
  data: 'data',
};

// Map a location hash ('#/steering', '#steering', '#/steering/') to its view.
// Query-string deep-links (#/help?topic=rrsp, #/details?section=spending) route
// to their page — the destination reads its own ?param off the hash. Returns
// null for empty/unknown hashes (including #plan= share links) so the caller
// can keep its current view.
export function viewFromHash(hash: string): View | null {
  const route = hash.replace(/^#\/?/, '').replace(/\?.*$/, '').replace(/\/+$/, '');
  for (const [view, r] of Object.entries(VIEW_ROUTES) as Array<[View, string]>) {
    if (r === route) return view;
  }
  return null;
}

// The canonical hash for a view ('#/steering').
export function hashForView(view: View): string {
  return `#/${VIEW_ROUTES[view]}`;
}
