// Print-summary section toggles, persisted in the same panel-state store the
// collapsible panels and the welcome dismissal use, so the user's choices
// survive reloads and travel with .sqlite backups (issue #20 — via the
// prefKv facade: store kv row + localStorage mirror).

export interface PrintOptions {
  includeTimeline: boolean;
  includeMonteCarlo: boolean;
  includeMilestones: boolean;
  includeDetailedTable: boolean;
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  includeTimeline: false,
  includeMonteCarlo: false,
  includeMilestones: true,
  includeDetailedTable: false
};

import { prefKV } from './prefKv';

const PANEL_STATE_KEY = 'wealthconsole_panel_state';
const OPTS_KEY = 'print_opts';

export function loadPrintOptions(): PrintOptions {
  try {
    const raw = prefKV().getItem(PANEL_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw)[OPTS_KEY];
      if (parsed && typeof parsed === 'object') {
        return {
          includeTimeline: parsed.includeTimeline === true,
          includeMonteCarlo: parsed.includeMonteCarlo === true,
          includeMilestones: parsed.includeMilestones !== false, // default true
          includeDetailedTable: parsed.includeDetailedTable === true
        };
      }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_PRINT_OPTIONS };
}

export function savePrintOptions(opts: PrintOptions): void {
  try {
    const kv = prefKV();
    const raw = kv.getItem(PANEL_STATE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    state[OPTS_KEY] = opts;
    kv.setItem(PANEL_STATE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}
