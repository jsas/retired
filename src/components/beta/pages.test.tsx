// @vitest-environment jsdom
// The beta page wrappers: the Data page is ONE home — the share surface
// (SharingPage) and the full backup/restore/projection-export surface
// (DataPage) stacked — so nothing lives on a side route. See BETA-MAP §3b.
// jsdom (not node) because SharingPage builds a share URL from window.location.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '@retired/engine-core/types';
import { baseInputs, testConfig } from '../../../packages/engine-core/test/helpers';
import { calculateHousehold } from '@retired/engine-core/retirementEngine';
import { BetaDataPage } from './pages';
import { DEFAULT_PROJECTION_EXPORT } from '../../lib/projectionExport';

const config = testConfig();
const inputs = baseInputs();
const results = calculateHousehold(inputs, config);
const scenarios: Scenario[] = [{ id: 's1', name: 'Test plan', inputs }];

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
