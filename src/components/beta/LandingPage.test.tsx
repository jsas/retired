// @vitest-environment node
// The landing: the f7 front door. A minimal wordmark header (NO app nav, NO
// verdict chip, NO assistant), the answer chips + composer inline under each
// question, and About/Help/Legal footnotes at the very bottom.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingPage } from './LandingPage';
import { testConfig } from '../../../packages/engine-core/test/helpers';

const config = testConfig();
const renderLanding = () => renderToStaticMarkup(<LandingPage config={config} onBuild={() => {}} />);

describe('LandingPage', () => {
  it('opens with the greeting and the first question', () => {
    const html = renderLanding();
    expect(html).toContain('money will outlast you');
    expect(html).toContain('how old are you right now');
    expect(html).toContain('Nothing is sent anywhere');
  });

  it('offers answer chips inline under the first question', () => {
    const html = renderLanding();
    for (const c of ['55', '60', '65']) expect(html).toContain(c);
  });

  it('has a minimal wordmark header — no app nav, no verdict chip, no assistant', () => {
    const html = renderLanding();
    expect(html).toContain('RE:');
    expect(html).toContain('tired');
    // none of the app chrome
    expect(html).not.toContain('aria-label="Close the assistant"');
    expect(html).not.toContain('Details ▾');
  });

  it('carries the §8.8 footnotes at the very bottom — legal, open-source, privacy', () => {
    const html = renderLanding();
    expect(html).toContain('Not advice.');
    expect(html).toContain('not financial, tax, or investment advice');
    expect(html).toContain('github.com/jsas/retired');
    expect(html).toContain('#/help');
    expect(html).toContain('stays in this browser');
  });
});
