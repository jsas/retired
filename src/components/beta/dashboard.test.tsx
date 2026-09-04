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
import { ProjectionTimeline } from '../../design/ProjectionTimeline';
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

describe('dashboard life timeline (ProjectionTimeline)', () => {
  const toSeries = (rows: typeof breakdown) => [{ id: 'plan', label: 'portfolio', area: true, points: rows.map(r => ({ age: r.age, value: r.endingBalance })) }];
  it('renders the axis and the you / start-drawing pins', () => {
    const html = renderToStaticMarkup(
      <ProjectionTimeline
        series={toSeries(breakdown)}
        pins={[
          { age: plan.currentAge, label: `you · ${plan.currentAge}`, place: 'below', anchor: 'start' },
          { age: plan.retirementAge, label: `start drawing · ${plan.retirementAge}` },
        ]}
      />,
    );
    expect(html).toContain('<svg');
    expect(html).toContain('you · 55');
    expect(html).toContain('start drawing · 62');
  });
  it('marks where the money runs out when the plan depletes', () => {
    const broke = { ...plan, tfsaBalance: 5000, rrspBalance: 0, desiredSpending: 120000 };
    const brokeRows = calculateHousehold(broke, config).yearlyBreakdown;
    const depAge = brokeRows.find(r => r.endingBalance <= 0)?.age ?? null;
    const html = renderToStaticMarkup(
      <ProjectionTimeline
        series={toSeries(brokeRows)}
        pins={depAge != null ? [{ age: depAge, label: `money runs out · ${depAge}` }] : []}
      />,
    );
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
