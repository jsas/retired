// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PageChrome, MOBILE_MENU_ITEMS, TOOLS_MENU_ITEMS, type VerdictChip } from './PageChrome';

// Node has no localStorage — stub it so the dock-open pref read/write works.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

const chip: VerdictChip = { tone: 'holds', age: '90+', label: 'the plan holds' };

describe('PageChrome assistant dock', () => {
  it('renders the Assistant robot toggle and the dock rail when an assistant is given', () => {
    const html = renderToStaticMarkup(
      createElement(PageChrome, {
        chip,
        assistant: createElement('div', null, 'chat-body'),
        children: createElement('div', null, 'page-body'),
      }),
    );
    // #192: the word "Assistant" became a robot icon — the accessible name
    // carries it now, not the visible text.
    expect(html).toContain('aria-label="Assistant"');
    expect(html).toContain('chat-body');
    expect(html).toContain('page-body');
    // no fullscreen mode exists — the toggle only opens/hides the dock
    expect(html).not.toContain('Grow');
    expect(html).not.toContain('fullscreen');
  });

  it('the Assistant toggle is ALWAYS in the header — even with no assistant wired', () => {
    const html = renderToStaticMarkup(
      createElement(PageChrome, { chip, children: createElement('div', null, 'page-body') }),
    );
    expect(html).toContain('aria-label="Assistant"');
    expect(html).toContain('page-body');
    // but the dock rail itself stays out — nothing to show
    expect(html).not.toContain('chat-body');
  });

  it('keeps the persistent verdict chip and the named homes', () => {
    const html = renderToStaticMarkup(
      createElement(PageChrome, { chip, assistant: createElement('div'), children: createElement('div') }),
    );
    expect(html).toContain('90+');
    for (const label of ['Dashboard', 'Tools', 'Plans']) {
      expect(html, label).toContain(label);
    }
    // #192: Projection moved into the Tools dropdown — the dropdown renders
    // its items only when open, so the header's static markup no longer
    // carries it as a top-level link.
    expect(html).not.toContain('href="#/projection"');
    expect(html).not.toContain('>Details<');
    expect(html).not.toContain('>Profiles<');
  });

  it('the Tools menu carries the analytic surfaces including Projection and Compare', () => {
    // Issue #162: each analytic surface is its own page; Compare later
    // joined that menu; Steering moved onto the Dashboard (#187). Issue
    // #186 ordered and grouped the menu by outcome section, Projection
    // first. #192: Projection itself moved from the header row into the
    // menu. (The Dropdown renders its children only when open, so the
    // static markup proves the trigger; the item list is proven against
    // the exported source of truth.)
    expect(TOOLS_MENU_ITEMS.map(t => t.view)).toEqual(['projection', 'math', 'optimize', 'montecarlo', 'backtest', 'solver', 'compare']);
    expect(TOOLS_MENU_ITEMS.map(t => t.label)).toEqual(['Projection', 'One Year, Step by Step', 'Improve the Plan', 'Your Odds', 'Test Against History', 'Safe Spending', 'Compare plans']);
    expect(TOOLS_MENU_ITEMS.map(t => t.section)).toEqual(['plan', 'plan', 'explore', 'explore', 'explore', 'explore', 'explore']);
    const html = renderToStaticMarkup(
      createElement(PageChrome, { chip, assistant: createElement('div'), children: createElement('div') }),
    );
    expect(html).toContain('>Tools');
  });

  it('puts a profile icon (to Plans / #/plan) and an undo icon next to the verdict chip', () => {
    const html = renderToStaticMarkup(
      createElement(PageChrome, { chip, children: createElement('div') }),
    );
    expect(html).toContain('aria-label="Your plan — the Plans page"');
    expect(html).toContain('href="#/plan"');
    expect(html).toContain('aria-label="Undo — step back to the previous saved plan"');
    // Undo is inert until App wires a history through PlanUndoContext.
    expect(html).toContain('disabled');
  });

  it('offers a phone Menu carrying the same named homes', () => {
    // Under md the inline links hide and a Menu ▾ takes over — the menu's
    // item list must cover every home (nothing dropped on phones), and the
    // trigger must render.
    const html = renderToStaticMarkup(
      createElement(PageChrome, { chip, children: createElement('div') }),
    );
    expect(html).toContain('Menu');
    // Issue #186: the menu reads in section order — Your plan, Explore,
    // Share & print, Settings & help.
    const labels = MOBILE_MENU_ITEMS.map(i => i.label);
    expect(labels).toEqual(['Dashboard', 'Projection', 'One Year, Step by Step', 'Plans', 'Improve the Plan', 'Your Odds', 'Test Against History', 'Safe Spending', 'Compare plans', 'Data', 'Print & export', 'Settings', 'Assistant connection', 'Help']);
    expect(MOBILE_MENU_ITEMS.map(i => i.section)).toEqual(['plan', 'plan', 'plan', 'plan', 'explore', 'explore', 'explore', 'explore', 'explore', 'share', 'share', 'setup', 'setup', 'setup']);
    expect(labels).not.toContain('Details');
    expect(labels).not.toContain('Profiles');
  });

  it('the assistant route opens the dock regardless of the saved pref', () => {
    // '#/assistant' is an explicit open — a closed-dock pref can't beat it.
    store.set('wealthconsole_dock_open', '0');
    const fakeWindow = { location: { hash: '#/assistant' } };
    vi.stubGlobal('window', fakeWindow);
    const html = renderToStaticMarkup(
      createElement(PageChrome, { chip, assistant: createElement('div', null, 'chat-body'), children: createElement('div') }),
    );
    expect(html).toContain('chat-body');
    // the rail is mounted (fixed sheet on phones / sticky rail on desktop)
    expect(html).toMatch(/fixed inset-0 top-12 z-50 flex flex-col/);
    vi.unstubAllGlobals();
  });

  it('the robot button reports pressed state and carries no grow control', () => {
    // #192: on #/assistant the dock starts open (the button reads pressed),
    // and there is no grow-to-fullscreen affordance anywhere. The click
    // behaviour itself is proven by PageChromeDock.test.tsx (jsdom).
    store.set('wealthconsole_dock_open', '0');
    const fakeWindow = { location: { hash: '#/assistant' } };
    vi.stubGlobal('window', fakeWindow);
    const html = renderToStaticMarkup(
      createElement(PageChrome, { chip, assistant: createElement('div', null, 'chat-body'), children: createElement('div') }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('aria-label="Grow the assistant to fullscreen"');
    expect(html).not.toContain('title="Grow"');
    vi.unstubAllGlobals();
  });

  it('the open dock shows as a full-screen sheet on phones (not hidden below lg)', () => {
    // The open state must be `flex` on phones with the sticky rail only
    // from lg up — a `hidden` in the base classes would blank the assistant
    // for every phone user. There is no fullscreen variant anymore (#192):
    // the sheet is the ONLY page-covering state, and the robot button in
    // the sticky header (z-40 < the sheet's z-50 but the header sits above
    // it via top-12) always hides it again.
    const html = renderToStaticMarkup(
      createElement(PageChrome, { chip, assistant: createElement('div'), children: createElement('div') }),
    );
    expect(html).toMatch(/class="[^"]*fixed inset-0 top-12 z-50 flex flex-col lg:sticky/);
    expect(html).not.toMatch(/flex flex-col hidden/);
    // the takeover variant (`fixed inset-0 z-50 top-12` without the top-12
    // start) is gone — the sheet always begins below the header.
    expect(html).not.toContain('fixed inset-0 z-50 top-12');
    // unprefixed `relative` would beat `fixed` in Tailwind and drop the phone
    // sheet back into the page flow (settings squeezed beside the chat).
    expect(html).not.toMatch(/aria-label="Assistant"[^>]*\brelative\b/);
    expect(html).not.toMatch(/class="[^"]*\brelative\b[^"]*" aria-label="Assistant"/);
  });

  it('the page chrome is wide and the dock remembers a dragged width', () => {
    // Re-stub: the assistant-route test unstubs globals, and Node has no
    // localStorage for prefKV to read the remembered width from.
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
    store.set('wealthconsole_dock_open', '1');
    store.set('wealthconsole_dock_width', '480');
    const html = renderToStaticMarkup(
      createElement(PageChrome, { chip, assistant: createElement('div'), children: createElement('div') }),
    );
    expect(html).toContain('max-w-[90rem]');
    expect(html).not.toContain('max-w-5xl');
    expect(html).toContain('--dock-w:480px');
    expect(html).toContain('aria-label="Resize the assistant"');
    // phones stay a sheet — the width token is a lg: utility, not an inline width
    expect(html).toMatch(/lg:w-\[var\(--dock-w\)\]/);
    expect(html).not.toContain('lg:w-[340px]');
  });
});
