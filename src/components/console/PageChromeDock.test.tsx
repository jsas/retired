// @vitest-environment jsdom
// The robot button is the dock's only show/hide control (#192). The static
// markup tests prove it renders; this jsdom suite proves the CLICK contract —
// one click hides, the next shows, and even on #/assistant (where the dock
// starts open) the button can hide it again. Nothing may take over the page
// with no way back.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { createElement } from 'react';
import { PageChrome, type VerdictChip } from './PageChrome';

// React 19 needs this to recognize act() outside @testing-library/react.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const chip: VerdictChip = { tone: 'holds', age: '90+', label: 'the plan holds' };

// Stub localStorage with an isolated Map so pref writes don't leak.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

let host: HTMLElement;
let root: Root;

function renderChrome() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      createElement(PageChrome, {
        chip,
        assistant: createElement('div', null, 'chat-body'),
        children: createElement('div', null, 'page-body'),
      }),
    );
  });
}

const toggle = () => {
  const btn = host.querySelector<HTMLButtonElement>('button[aria-label="Assistant"]');
  if (!btn) throw new Error('assistant toggle missing');
  return btn;
};
// Closing NEVER unmounts the conversation — the rail goes `hidden`. So the
// chat stays in the DOM either way; "visible" means the aside is not hidden.
const dockVisible = () => {
  const a = host.querySelector('aside');
  return !!a && !a.className.includes('hidden') && !!a.textContent?.includes('chat-body');
};

beforeEach(() => {
  store.clear();
  window.location.hash = '';
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.location.hash = '';
});

describe('assistant dock toggle (#192)', () => {
  it('one click hides an open dock; the next shows it again', () => {
    store.set('wealthconsole_dock_open', '1');
    renderChrome();
    expect(dockVisible()).toBe(true);
    act(() => { toggle().click(); });
    expect(dockVisible()).toBe(false);
    expect(store.get('wealthconsole_dock_open')).toBe('0');
    act(() => { toggle().click(); });
    expect(dockVisible()).toBe(true);
    expect(store.get('wealthconsole_dock_open')).toBe('1');
  });

  it('on #/assistant the button still hides the dock the route opened', () => {
    // The old bug: setDockOpen forced `open || openRoute`, so on the
    // assistant route the toggle could never close the sheet.
    store.set('wealthconsole_dock_open', '0');
    window.location.hash = '#/assistant';
    renderChrome();
    expect(dockVisible()).toBe(true);
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    act(() => { toggle().click(); });
    expect(dockVisible()).toBe(false);
    // the close persists — a reload on the route reopens, but the pref is '0'
    expect(store.get('wealthconsole_dock_open')).toBe('0');
  });
});
