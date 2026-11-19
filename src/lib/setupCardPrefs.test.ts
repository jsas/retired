// @vitest-environment node
// The dismissal lives inside the shared panel-state blob (it rides along in a
// .sqlite backup), so the contract that matters is that dismissing the set-up
// card never clobbers the other panels' state in the same key — and that a
// hand-edited or half-written blob degrades to "keep showing the card" instead
// of throwing on the Dashboard's first paint.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissSetupCard, isSetupCardDismissed } from './setupCardPrefs';

const KEY = 'wealthconsole_panel_state';

// Node env has no localStorage; prefKV degrades to it, so stub a tiny mirror.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

describe('set-up card dismissal', () => {
  beforeEach(() => store.clear());

  it('starts undismissed, with no state written', () => {
    expect(isSetupCardDismissed()).toBe(false);
    expect(store.has(KEY)).toBe(false);
  });

  it('persists a dismissal and leaves the other panels’ state alone', () => {
    store.set(KEY, JSON.stringify({ print_options: { includeMath: true } }));
    dismissSetupCard();
    expect(isSetupCardDismissed()).toBe(true);
    expect(JSON.parse(store.get(KEY)!)).toEqual({
      print_options: { includeMath: true },
      setup_card_dismissed: true,
    });
  });

  it('survives a corrupt or non-object blob by keeping the card visible', () => {
    for (const junk of ['{', 'null', '"nope"', '[1,2]']) {
      store.set(KEY, junk);
      expect(isSetupCardDismissed()).toBe(false);
      expect(() => dismissSetupCard()).not.toThrow();
      expect(isSetupCardDismissed()).toBe(false);
    }
  });

  it('only an explicit true counts as dismissed', () => {
    store.set(KEY, JSON.stringify({ setup_card_dismissed: 'yes' }));
    expect(isSetupCardDismissed()).toBe(false);
    store.set(KEY, JSON.stringify({ setup_card_dismissed: false }));
    expect(isSetupCardDismissed()).toBe(false);
  });
});
