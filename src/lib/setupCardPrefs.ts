// The Dashboard's set-up card (the intro screen's replacement). The card shows
// itself while the plan on screen isn't the user's own; once they dismiss it
// that choice is remembered, in the same panel-state blob the print options
// use (issue #20 — through the prefKv facade, so it rides along in a .sqlite
// backup). Settings → "Show the set-up card" is the override that ignores the
// dismissal and shows the card on every visit.
import { prefKV } from './prefKv';

const PANEL_STATE_KEY = 'wealthconsole_panel_state';
const DISMISS_KEY = 'setup_card_dismissed';

export function isSetupCardDismissed(): boolean {
  try {
    const raw = prefKV().getItem(PANEL_STATE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!parsed && typeof parsed === 'object' && parsed[DISMISS_KEY] === true;
  } catch { return false; }
}

export function dismissSetupCard(): void {
  try {
    const kv = prefKV();
    const raw = kv.getItem(PANEL_STATE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    if (!state || typeof state !== 'object') return;
    state[DISMISS_KEY] = true;
    kv.setItem(PANEL_STATE_KEY, JSON.stringify(state));
  } catch { /* storage unavailable — the card simply keeps showing */ }
}
