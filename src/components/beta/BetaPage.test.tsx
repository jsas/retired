// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BetaPage, MOBILE_MENU_ITEMS, type VerdictChip } from './BetaPage';

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
    // the fullscreen toggle (arrows out to expand); closing lives on the
    // header toggle now — no × in the dock header
    expect(html).toContain('aria-label="Expand the assistant to fullscreen"');
    expect(html).not.toContain('aria-label="Close the assistant"');
  });

  it('the Assistant toggle is ALWAYS in the header — even with no assistant wired', () => {
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, children: createElement('div', null, 'page-body') }),
    );
    expect(html).toContain('>Assistant</button>');
    expect(html).toContain('page-body');
    // but the dock rail itself stays out — nothing to show
    expect(html).not.toContain('chat-body');
  });

  it('keeps the persistent verdict chip and the named homes', () => {
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, assistant: createElement('div'), children: createElement('div') }),
    );
    expect(html).toContain('90+');
    for (const label of ['Details', 'Schedule', 'Insights', 'Profiles']) {
      expect(html, label).toContain(label);
    }
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
    for (const label of ['Dashboard', 'Schedule', 'Insights', 'Profiles', 'Details', 'Data', 'Print', 'Settings', 'Help']) {
      expect(labels, label).toContain(label);
    }
  });

  it('the dock header carries the fullscreen expand control', () => {
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, assistant: createElement('div'), children: createElement('div') }),
    );
    expect(html).toContain('title="Fullscreen"');
    expect(html).toContain('aria-label="Expand the assistant to fullscreen"');
  });
});
