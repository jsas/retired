// @vitest-environment jsdom
// The beta page wrappers: the Data page is ONE home — the share surface
// (SharingPage) and the full backup/restore/projection-export surface
// (DataPage) stacked — so nothing lives on a side route. Issue #162 split the
// old combined Insights page into the five Tools-menu surfaces, each featuring
// the shared projection timeline. See BETA-MAP §3b.
// jsdom (not node) because SharingPage builds a share URL from window.location.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '@retired/engine-core/types';
import { baseInputs, testConfig } from '../../../packages/engine-core/test/helpers';
import { calculateHousehold } from '@retired/engine-core/retirementEngine';
import {
  BetaDataPage, BetaSchedulePage, BetaSteeringPage, BetaOptimizerPage,
  BetaMonteCarloPage, BetaBacktestPage, BetaSolverPage,
} from './pages';
import { DEFAULT_PROJECTION_EXPORT } from '../../lib/projectionExport';
import { runBacktest } from '../../lib/historicalReturns';
import { defaultEqBands } from '../../lib/eqStorage';

const config = testConfig();
const inputs = baseInputs();
const results = calculateHousehold(inputs, config);
const scenarios: Scenario[] = [{ id: 's1', name: 'Test plan', inputs }];

const chip = { tone: 'holds', age: '90+', label: 'the plan holds' } as const;
const breakdown = results.yearlyBreakdown ?? [];
const timeline = { breakdown, currentAge: inputs.currentAge, retirementAge: results.retirementAge };
// EqPage needs the band map — the same all-roam default App starts with.
const bands = defaultEqBands();
const solved = { successRate: null, grid: null, gridSize: 9, solving: false };

// The projection timeline is the one thing every Tools page shares — the
// aria-label it renders is the marker we assert on.
const TIMELINE_MARK = 'aria-label="Projection from age';

describe('The Projection page (was Schedule — issue #162)', () => {
  it('renames to Projection and features the timeline over the table', () => {
    const html = renderToStaticMarkup(
      createElement(BetaSchedulePage, {
        chip, timeline,
        breakdown, retirementAge: results.retirementAge, currentAge: inputs.currentAge, maxAge: inputs.maxAge,
        onRetirementAgeChange: () => {},
      }),
    );
    expect(html).toContain('Projection');
    expect(html).toContain(TIMELINE_MARK);
    expect(html).toContain('Ending Balance'); // the schedule table below it
  });
});

describe('The Tools menu pages each feature the projection timeline', () => {
  it('Steering: the equalizer, with EqPage’s own live timeline', () => {
    const html = renderToStaticMarkup(
      createElement(BetaSteeringPage, {
        chip,
        eqProps: { inputs, config, onChange: () => {}, bands, onBandsChange: () => {}, solved, projection: { results, breakdown } },
      }),
    );
    expect(html).toContain('Steering');
    expect(html).toContain(TIMELINE_MARK);
  });

  it('Optimizer: the strategy explorer under the timeline', () => {
    const html = renderToStaticMarkup(
      createElement(BetaOptimizerPage, {
        chip, timeline, optimizeProps: { inputs, config, onApply: () => {} },
      }),
    );
    expect(html).toContain('Optimizer');
    expect(html).toContain(TIMELINE_MARK);
    expect(html).toContain('Suggested course of action');
  });

  it('Monte Carlo: the fan under the timeline (needs a request)', () => {
    const html = renderToStaticMarkup(
      createElement(BetaMonteCarloPage, {
        chip, timeline,
        mcProps: { request: { inputs, config, runs: 5, volatility: 0.15 }, retirementAge: results.retirementAge },
      }),
    );
    expect(html).toContain('Monte Carlo');
    expect(html).toContain(TIMELINE_MARK);
  });

  it('Monte Carlo with no request still shows the timeline + a nudge', () => {
    const html = renderToStaticMarkup(
      createElement(BetaMonteCarloPage, { chip, timeline, mcProps: null }),
    );
    expect(html).toContain(TIMELINE_MARK);
    expect(html).toContain('volatility');
  });

  it('Backtest: the history bars under the timeline', () => {
    // The real runner is synchronous — feed the page its actual output.
    const backtest = runBacktest(inputs, config, calculateHousehold);
    const html = renderToStaticMarkup(
      createElement(BetaBacktestPage, {
        chip, timeline, backtestProps: { result: backtest },
      }),
    );
    expect(html).toContain('Backtest');
    expect(html).toContain(TIMELINE_MARK);
    expect(html).toContain('Worst Window');
  });

  it('Solver: the spending solve under the timeline', () => {
    const html = renderToStaticMarkup(
      createElement(BetaSolverPage, {
        chip, timeline, solverProps: { inputs, config, onApply: () => {} },
      }),
    );
    expect(html).toContain('Solver');
    expect(html).toContain(TIMELINE_MARK);
    expect(html).toContain('Target success rate');
  });
});

describe('BetaDataPage — one Data home', () => {
  it('renders the share surface and the backup/restore surface together', () => {
    const html = renderToStaticMarkup(
      createElement(BetaDataPage, {
        chip: { tone: 'holds', age: '90+', label: 'the plan holds' },
        // SharingPage props
        inputs,
        scenarioName: 'Test plan',
        onImport: () => {},
        // DataPage props
        exportOptions: { ...DEFAULT_PROJECTION_EXPORT },
        onExportOptionsChange: () => {},
        hasSpouse: false,
        results,
        config,
        scenarios,
        activeScenarioId: 's1',
        onExportFull: () => {},
        onImportFull: () => {},
        onImportProjection: () => {},
      }),
    );
    // SharingPage halves
    expect(html).toContain('Send this plan');
    expect(html).toContain('Receive a plan');
    // DataPage halves
    expect(html).toContain('Export projection');
    expect(html).toContain('Export full backup');
    expect(html).toContain('Import');
  });
});
