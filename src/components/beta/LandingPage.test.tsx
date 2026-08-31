// @vitest-environment node
// The landing: five questions build a starter plan, then the verdict + two
// doors. Renders the greeting and first question; the plan builder maps chat
// answers onto a real RetirementInputs.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingPage } from './LandingPage';
import { testConfig } from '../../../packages/engine-core/test/helpers';

const config = testConfig();

describe('LandingPage', () => {
  it('opens with the greeting and the first question', () => {
    const html = renderToStaticMarkup(<LandingPage config={config} onBuild={() => {}} />);
    expect(html).toContain('money will outlast you');
    expect(html).toContain('how old are you right now');
    expect(html).toContain('Nothing is sent anywhere');
  });

  it('offers answer chips for the first question', () => {
    const html = renderToStaticMarkup(<LandingPage config={config} onBuild={() => {}} />);
    for (const chip of ['55', '60', '65']) expect(html).toContain(chip);
  });
});
