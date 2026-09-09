// @vitest-environment node
// The map renders its terrain from the real engine. These smoke tests render
// the SVG to static markup and assert the load-bearing pieces are present: the
// boundary path, the hold-wash, the grid, the you-are-here dot + tag, and the
// legend — and that the dot colour follows the plan's status.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContourMap } from './ContourMap';
import { baseInputs, testConfig } from '../../../packages/engine-core/test/helpers';

const config = testConfig();
const WIN = { ageMin: 55, ageMax: 75, spendTop: 160000, spendBottom: 20000 };

const plan = baseInputs({
  currentAge: 55,
  retirementAge: 62,
  maxAge: 90,
  tfsaBalance: 800000,
  rrspBalance: 200000,
  desiredSpending: 60000,
  investmentReturn: 0.05,
  cppStartAge: null,
  oasStartAge: null,
});

const render = (inputs = plan) =>
  renderToStaticMarkup(
    <ContourMap inputs={inputs} config={config} window={WIN} onChange={() => {}} />,
  );

describe('ContourMap', () => {
  it('renders the pad: boundary path, hold-wash, grid, and axis titles', () => {
    const html = render();
    expect(html).toContain('<svg');
    expect(html).toContain('url(#holdWash)');           // the wash fill
    expect(html.match(/<path/g)!.length).toBeGreaterThanOrEqual(3); // wash + deep + boundary
    expect(html).toContain('the age you start drawing');
    expect(html).toContain('what you spend each year');
  });

  it('marks "you are here" with the current age and spending', () => {
    const html = render();
    expect(html).toContain('you are here');
    expect(html).toContain('62');
    expect(html).toContain('$60k');
  });

  it('colours the dot blue when the plan holds and rose when it runs out', () => {
    const holds = render(plan);
    expect(holds).toContain('#1d4ed8'); // BLUE dot

    // Push spending far above the boundary → the plan runs out early.
    const short = render({ ...plan, desiredSpending: 159000 });
    expect(short).toContain('#f43f5e'); // RED_DOT
  });

  it('shows the legend with the plan-to age', () => {
    const html = render();
    expect(html).toContain('the boundary');
    expect(html).toContain('lasts past 90');
    expect(html).toContain('runs out early');
  });
});
