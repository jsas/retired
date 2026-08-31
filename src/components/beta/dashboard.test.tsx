// @vitest-environment node
// Smoke tests for the dashboard's live surfaces: the market dial, down-market
// check, life timeline, and evidence row. Each renders from the real engine
// and asserts its load-bearing content shows up.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculateHousehold } from '@retired/engine-core/retirementEngine';
import { baseInputs, testConfig } from '../../../packages/engine-core/test/helpers';
import { MarketDial } from './MarketDial';
import { DownMarketCheck, DOWN_MARKET_RETURN } from './DownMarketCheck';
import { LifeTimeline } from './LifeTimeline';
import { EvidenceRow } from './EvidenceRow';

const config = testConfig();

const plan = baseInputs({
  currentAge: 55, retirementAge: 62, maxAge: 90,
  tfsaBalance: 800000, rrspBalance: 200000,
  desiredSpending: 60000, investmentReturn: 0.05,
  cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
});

const results = calculateHousehold(plan, config);
const breakdown = results.yearlyBreakdown;

describe('MarketDial', () => {
  it('renders the down↔up return fader with the current value', () => {
    const html = renderToStaticMarkup(<MarketDial value={0.03} onChange={() => {}} />);
    expect(html).toContain('Markets');
    expect(html).toContain('3.0%');
    expect(html).toContain('down');
  });
});

describe('DownMarketCheck', () => {
  it('uses a 1.2% down-market return', () => {
    expect(DOWN_MARKET_RETURN).toBe(0.012);
  });
  it('reports a hold when the plan survives the down market', () => {
    const html = renderToStaticMarkup(<DownMarketCheck inputs={plan} config={config} />);
    expect(html).toMatch(/Down-market (check|warning)/);
    expect(html).toContain('1.2%');
  });
});

describe('LifeTimeline', () => {
  it('renders the axis, year ticks, and the you / work-ends pins', () => {
    const html = renderToStaticMarkup(<LifeTimeline inputs={plan} breakdown={breakdown} />);
    expect(html).toContain('<svg');
    expect(html).toContain('you · 55');
    expect(html).toContain('work ends · 62');
  });
  it('shows the run-out pin when the plan depletes, else the outlasts note', () => {
    const broke = { ...plan, tfsaBalance: 5000, rrspBalance: 0, desiredSpending: 120000 };
    const brokeRows = calculateHousehold(broke, config).yearlyBreakdown;
    const html = renderToStaticMarkup(<LifeTimeline inputs={broke} breakdown={brokeRows} />);
    expect(html).toMatch(/money runs out · \d+/);
  });
});

describe('EvidenceRow', () => {
  it('renders the key numbers and the account bars', () => {
    const html = renderToStaticMarkup(<EvidenceRow inputs={plan} results={results} breakdown={breakdown} />);
    expect(html).toContain('Money lasts to');
    expect(html).toContain('In the pot at work');
    expect(html).toContain('CPP + OAS');
    expect(html).toContain('RRSP');
    expect(html).toContain('TFSA');
  });
});
