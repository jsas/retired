// Print-summary section toggles, persisted in the same panel-state store the
// collapsible panels and the welcome dismissal use, so the user's choices
// survive reloads.

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

const PANEL_STATE_KEY = 'wealthconsole_panel_state';
const OPTS_KEY = 'print_opts';

export function loadPrintOptions(): PrintOptions {
  try {
    const raw = localStorage.getItem(PANEL_STATE_KEY);
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
    const raw = localStorage.getItem(PANEL_STATE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    state[OPTS_KEY] = opts;
    localStorage.setItem(PANEL_STATE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}
