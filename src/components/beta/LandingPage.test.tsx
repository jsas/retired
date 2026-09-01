// @vitest-environment jsdom
// The landing: the f7 front door. A minimal wordmark header (NO app nav, NO
// verdict chip, NO assistant), the answer chips + composer inline under each
// question, and About/Help/Legal footnotes at the very bottom. The completion
// state offers two exits — both to the dashboard, differing only in whether
// the assistant dock opens on arrival.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { LandingPage } from './LandingPage';
import { testConfig } from '../../../packages/engine-core/test/helpers';

const config = testConfig();

// React 19 needs this to recognize act() outside @testing-library/react.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stub localStorage (jsdom doesn't expose it here) with an isolated Map so
// pref writes don't leak between tests — same pattern as BetaPage.test.tsx.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

describe('LandingPage', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  /** Render and walk the five questions, answering by chip (they cover the
   *  parse paths: ages, money with suffixes, and the yes/no benefits). */
  const renderCompleted = (onBuild = vi.fn()) => {
    const answers = ['55', '65', '$500k', '$60k', 'Yes, the usual'];
    act(() => {
      root.render(<LandingPage config={config} onBuild={onBuild} />);
    });
    for (const a of answers) {
      const chip = [...container.querySelectorAll('button')].find(b => b.textContent === a);
      if (!chip) throw new Error(`no chip "${a}" — questions: ${container.textContent}`);
      act(() => { chip.click(); });
    }
    return onBuild;
  };

  it('opens with the greeting and the first question', () => {
    act(() => { root.render(<LandingPage config={config} onBuild={() => {}} />); });
    expect(container.textContent).toContain("Hi. I'm RE");
    expect(container.textContent).toContain('make your money last as long as you');
    expect(container.textContent).toContain('how old are you');
  });

  it('offers answer chips inline under the first question', () => {
    act(() => { root.render(<LandingPage config={config} onBuild={() => {}} />); });
    const chips = [...container.querySelectorAll('button')].map(b => b.textContent?.trim());
    expect(chips).toContain('55');
    expect(chips).toContain('60');
    expect(chips).toContain('65');
  });

  it('has a minimal wordmark header — no app nav, no verdict chip, no assistant', () => {
    act(() => { root.render(<LandingPage config={config} onBuild={() => {}} />); });
    expect(container.textContent).toContain('tired');
    expect(container.textContent).not.toContain('Assistant');
    expect(container.querySelector('nav'));
  });

  it('after the questions offers the two exits: go to dashboard, keep chatting', () => {
    renderCompleted();
    const labels = [...container.querySelectorAll('button')].map(b => b.textContent?.trim());
    expect(labels).toContain('Go to dashboard');
    expect(labels).toContain('Keep chatting');
    // the wordy two-door copy is gone
    expect(container.textContent).not.toContain('Open the dashboard');
    expect(container.textContent).not.toContain('Tune the details');
  });

  it('"Go to dashboard" closes the dock, "Keep chatting" opens it — both build the plan', () => {
    const onBuild = renderCompleted();

    const go = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Go to dashboard');
    act(() => { go!.click(); });
    expect(onBuild).toHaveBeenCalledTimes(1);
    expect(onBuild).toHaveBeenCalledWith(expect.anything(), { openAssistant: false });
    expect(store.get('wealthconsole_dock_open')).toBe('0');

    // Remount to reset onBuild's call count, then take the other exit.
    act(() => { root.unmount(); });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onBuild2 = renderCompleted();

    const keep = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Keep chatting');
    act(() => { keep!.click(); });
    expect(onBuild2).toHaveBeenCalledTimes(1);
    expect(onBuild2).toHaveBeenCalledWith(expect.anything(), { openAssistant: true });
    expect(store.get('wealthconsole_dock_open')).toBe('1');
  });

  it('the footer exit also builds the plan', () => {
    const onBuild = renderCompleted();
    const footerBtn = [...container.querySelectorAll('footer button')].find(b => b.textContent?.includes('Go to dashboard')) as HTMLButtonElement;
    act(() => { footerBtn!.click(); });
    expect(onBuild).toHaveBeenCalled();
  });

  it('carries the §8.8 footnotes at the very bottom — legal, open-source, privacy', () => {
    act(() => { root.render(<LandingPage config={config} onBuild={() => {}} />); });
    expect(container.textContent).toContain('Not advice.');
    expect(container.textContent).toContain('not financial, tax, or investment advice');
    expect(container.querySelector('a[href="https://github.com/jsas/retired"]')).toBeTruthy();
    expect(container.querySelector('a[href="#/help"]'));
    expect(container.textContent).toContain('stays in this browser');
  });
});
