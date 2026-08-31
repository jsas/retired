// @vitest-environment node
// The landing: five questions build a starter plan, then the verdict + doors.
// It sits in the shared BetaPage chrome, so the whole site (Dashboard, Details,
// Plans…) is reachable from the header — the landing is the front door, not a
// dead end.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingPage } from './LandingPage';
import { testConfig } from '../../../packages/engine-core/test/helpers';

const config = testConfig();
const chip = { tone: 'holds' as const, age: '95+', label: 'the plan holds' };
const renderLanding = () => renderToStaticMarkup(<LandingPage config={config} chip={chip} onBuild={() => {}} />);

describe('LandingPage', () => {
  it('opens with the greeting and the first question', () => {
    const html = renderLanding();
    expect(html).toContain('money will outlast you');
    expect(html).toContain('how old are you right now');
    expect(html).toContain('Nothing is sent anywhere');
  });

  it('offers answer chips for the first question', () => {
    const html = renderLanding();
    for (const c of ['55', '60', '65']) expect(html).toContain(c);
  });

  it('is wrapped in the site chrome — nav to the rest of the app', () => {
    const html = renderLanding();
    // the header links (Dashboard, Schedule, Insights, Plans)
    expect(html).toContain('#/projection');
    expect(html).toContain('Dashboard');
    // the fast escape door
    expect(html).toContain('Skip to the dashboard');
  });
});
