// Deep-link routes for the SPA: each view lives at #/<route> so pages are
// linkable and the browser back/forward buttons navigate the app. Share links
// (#plan=…) are a different hash namespace and are consumed before routing runs.
//
// The routes DERIVE from @retired/mcp-tools/navigation (the catalog) — a
// rename or add in the catalog still compiles if these helpers flip, and
// adding a view to viewRoutes alone fails the drift test below.

import { NAV_CATALOG, pageTitleLine, type View, type NavEntry } from '@retired/mcp-tools/navigation';

export type { View };

export const VIEW_ROUTES: Record<View, string> = Object.fromEntries(
  (NAV_CATALOG as ReadonlyArray<NavEntry>).map((e) => [e.viewId, e.route]),
) as Record<View, string>;

// Map a location hash ('#/steering', '#steering', '#/steering/') to its view.
// Query-string deep-links (#/help?topic=rrsp, #/details?section=spending) route
// to their page — the destination reads its own ?param off the hash. Returns
// null for empty/unknown hashes (including #plan= share links) so the caller
// can keep its current view.
export function viewFromHash(hash: string): View | null {
  const route = hash.replace(/^#\/?/, '').replace(/\?.*$/, '').replace(/\/+$/, '');
  for (const entry of NAV_CATALOG) {
    if (entry.route === route) return entry.viewId;
  }
  return null;
}

// The canonical hash for a view ('#/steering'). Folded legacy views
// (optimize/montecarlo/backtest/compare/export/sharing) keep their own
// routes for parsing, but the canonical link points at the page their
// catalog entry folds into — so a "Go to Monte Carlo" link the assistant
// prints lands on Insights, not a dead route.
export function hashForView(view: View): string {
  const target = foldTarget(view);
  return `#/${VIEW_ROUTES[target]}`;
}

// Resolve a view through its catalog's foldedInto chain (one hop today;
// looped defensively in case the catalog ever chains folds).
export function foldTarget(view: View): View {
  let target = view;
  const seen = new Set<View>();
  while (true) {
    const entry = (NAV_CATALOG as ReadonlyArray<NavEntry>).find(e => e.viewId === target);
    if (!entry?.foldedInto || seen.has(target)) return target;
    seen.add(target);
    target = entry.foldedInto;
  }
}

// The friendly title the assistant's prompt uses conversationally.
export { pageTitleLine };
