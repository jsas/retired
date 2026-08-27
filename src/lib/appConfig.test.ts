import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_CONFIG, validateAppConfig } from './appConfig';

describe('validateAppConfig — general.promptToSaveOnSwitch', () => {
  it('defaults to true in the shipped config', () => {
    expect(DEFAULT_APP_CONFIG.general.promptToSaveOnSwitch).toBe(true);
  });

  it('round-trips a stored true', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    raw.general.promptToSaveOnSwitch = true;
    const out = validateAppConfig(raw);
    expect(out?.general.promptToSaveOnSwitch).toBe(true);
  });

  it('preserves the opt-out (false) instead of resetting it', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    raw.general.promptToSaveOnSwitch = false;
    const out = validateAppConfig(raw);
    expect(out?.general.promptToSaveOnSwitch).toBe(false);
  });

  it('back-fills true for configs saved before the field existed', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    delete raw.general.promptToSaveOnSwitch;
    const out = validateAppConfig(raw);
    expect(out?.general.promptToSaveOnSwitch).toBe(true);
    // The pre-existing sibling field survives the back-fill.
    expect(out?.general.showWelcomeOnLoad).toBe(raw.general.showWelcomeOnLoad);
  });

  it('back-fills when general has a non-boolean value', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    raw.general.promptToSaveOnSwitch = 'yes';
    const out = validateAppConfig(raw);
    expect(out?.general.promptToSaveOnSwitch).toBe(true);
  });

  it('replaces a wholly missing general block with defaults (prompt on)', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    delete raw.general;
    const out = validateAppConfig(raw);
    expect(out?.general).toEqual(DEFAULT_APP_CONFIG.general);
  });
});
