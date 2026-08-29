import { describe, it, expect } from 'vitest';
import { buildProgramRules } from './programRules';
import { testConfig } from '../../test/helpers';

describe('buildProgramRules', () => {
  it('renders the core benefit rules from config', () => {
    const rules = buildProgramRules(testConfig());
    for (const token of ['CPP', 'OAS', 'GIS', 'RRIF', 'TFSA', 'RRSP', 'Capital gains']) {
      expect(rules).toContain(token);
    }
    // The mechanics the model must get right.
    expect(rules).toContain('clawed back');
    expect(rules).toContain('Canadian residents');
  });

  it('quotes the config\'s own figures, not generic ones', () => {
    const config = testConfig();
    // Default 2026 TFSA limit appears; a custom value replaces it.
    expect(buildProgramRules(config)).toContain('7,000');
    config.engine.tfsaAnnualLimit = 12345;
    expect(buildProgramRules(config)).toContain('12,345');
  });

  it('reflects CPP/OAS age mechanics from config', () => {
    const config = testConfig();
    const rules = buildProgramRules(config);
    expect(rules).toContain(`${config.cpp.earliestAge}–${config.cpp.maxDeferralAge}`);
    expect(rules).toContain(`${config.oas.eligibleAge}–${config.oas.maxDeferralAge}`);
  });

  it('shows the OAS clawback threshold and GIS maximums from config', () => {
    const config = testConfig();
    const rules = buildProgramRules(config);
    expect(rules).toContain(Math.round(config.oas.clawbackThreshold).toLocaleString('en-CA'));
    expect(rules).toContain(Math.round(config.oas.gisMaxAnnualSingle).toLocaleString('en-CA'));
  });
});
