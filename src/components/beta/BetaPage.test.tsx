// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BetaPage, MOBILE_MENU_ITEMS, TOOLS_MENU_ITEMS, type VerdictChip } from './BetaPage';

// Node has no localStorage — stub it so the dock-open pref read/write works.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

const chip: VerdictChip = { tone: 'holds', age: '90+', label: 'the plan holds' };

describe('BetaPage assistant dock', () => {
  it('renders the Assistant toggle and the dock rail when an assistant is given', () => {
    const html = renderToStaticMarkup(
      createElement(BetaPage, {
        chip,
        assistant: createElement('div', null, 'chat-body'),
        children: createElement('div', null, 'page-body'),
      }),
    );
    expect(html).toContain('Assistant');
    expect(html).toContain('chat-body');
    expect(html).toContain('page-body');
    // the grow/shrink arrows live ON the Assistant button now (nowhere else)
    expect(html).toContain('aria-label="Grow the assistant to fullscreen"');
    expect(html).not.toContain('aria-label="Close the assistant"');
  });

  it('the Assistant toggle is ALWAYS in the header — even with no assistant wired', () => {
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, children: createElement('div', null, 'page-body') }),
    );
    expect(html).toContain('>Assistant<');
    expect(html).toContain('page-body');
    // but the dock rail itself stays out — nothing to show
    expect(html).not.toContain('chat-body');
  });

  it('keeps the persistent verdict chip and the named homes', () => {
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, assistant: createElement('div'), children: createElement('div') }),
    );
    expect(html).toContain('90+');
    for (const label of ['Details', 'Projection', 'Tools', 'Profiles']) {
      expect(html, label).toContain(label);
    }
  });

  it('the Tools menu carries all five analytic surfaces', () => {
    // Issue #162: Steering, Optimizer, Monte Carlo, Backtest, Solver — the
    // dropdown's item list is the contract the pages hang off. (The Dropdown
    // renders its children only when open, so the static markup proves the
    // trigger; the item list is proven against the exported source of truth.)
    expect(TOOLS_MENU_ITEMS.map(t => t.view)).toEqual(['eq', 'optimize', 'montecarlo', 'backtest', 'solver']);
    expect(TOOLS_MENU_ITEMS.map(t => t.label)).toEqual(['Steering', 'Optimizer', 'Monte Carlo', 'Backtest', 'Solver']);
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, assistant: createElement('div'), children: createElement('div') }),
    );
    expect(html).toContain('>Tools');
  });

  it('offers a phone Menu carrying the same named homes', () => {
    // Under md the inline links hide and a Menu ▾ takes over — the menu's
    // item list must cover every home (nothing dropped on phones), and the
    // trigger must render.
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, children: createElement('div') }),
    );
    expect(html).toContain('Menu');
    const labels = MOBILE_MENU_ITEMS.map(i => i.label);
    for (const label of ['Dashboard', 'Projection', 'Details', 'Steering', 'Optimizer', 'Monte Carlo', 'Backtest', 'Solver', 'Profiles', 'Data', 'Print', 'Settings', 'Assistant connection', 'Help']) {
      expect(labels, label).toContain(label);
    }
  });

  it('the assistant route opens the dock regardless of the saved pref', () => {
    // '#/assistant' is an explicit open — a closed-dock pref can't beat it.
    store.set('wealthconsole_dock_open', '0');
    const fakeWindow = { location: { hash: '#/assistant' } };
    vi.stubGlobal('window', fakeWindow);
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, assistant: createElement('div', null, 'chat-body'), children: createElement('div') }),
    );
    expect(html).toContain('chat-body');
    // the rail is mounted (fixed sheet on phones / sticky rail on desktop)
    expect(html).toMatch(/fixed inset-0 top-12 z-50 flex flex-col/);
    vi.unstubAllGlobals();
  });

  it('the Assistant button in the header carries the grow/shrink control', () => {
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, assistant: createElement('div'), children: createElement('div') }),
    );
    expect(html).toContain('title="Grow"');
    expect(html).toContain('aria-label="Grow the assistant to fullscreen"');
  });

  it('the open dock shows as a full-screen sheet on phones (not hidden below lg)', () => {
    // The open (non-fullscreen) state must be `flex` on phones with the sticky
    // rail only from lg up — a `hidden` in the base classes would blank the
    // assistant for every phone user.
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, assistant: createElement('div'), children: createElement('div') }),
    );
    expect(html).toMatch(/class="[^"]*fixed inset-0 top-12 z-50 flex flex-col lg:sticky/);
    expect(html).not.toMatch(/flex flex-col hidden/);
  });
});
