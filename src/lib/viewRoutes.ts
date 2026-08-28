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
  | 'welcome';

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
};

// Map a location hash ('#/steering', '#steering', '#/steering/') to its view.
// Returns null for empty/unknown hashes (including #plan= share links) so the
// caller can keep its current view.
export function viewFromHash(hash: string): View | null {
  const route = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  for (const [view, r] of Object.entries(VIEW_ROUTES) as Array<[View, string]>) {
    if (r === route) return view;
  }
  return null;
}

// The canonical hash for a view ('#/steering').
export function hashForView(view: View): string {
  return `#/${VIEW_ROUTES[view]}`;
}
