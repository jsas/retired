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

describe('validateAppConfig — general.locale', () => {
  it('is absent in the shipped defaults (host falls back to the browser)', () => {
    expect(DEFAULT_APP_CONFIG.general.locale).toBeUndefined();
  });

  it('round-trips a stored fr-CA', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    raw.general.locale = 'fr-CA';
    const out = validateAppConfig(raw);
    expect(out?.general.locale).toBe('fr-CA');
  });

  it('leaves a missing locale undefined so the host can detect', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    delete raw.general.locale;
    const out = validateAppConfig(raw);
    expect(out?.general.locale).toBeUndefined();
  });

  it('drops an unknown locale so the host can fall back to the browser', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    raw.general.locale = 'xx-XX';
    const out = validateAppConfig(raw);
    expect(out?.general.locale).toBeUndefined();
  });
});

describe('validateAppConfig — donationCredit block', () => {
  it('ships the 2026 CRA/taxtips defaults', () => {
    expect(DEFAULT_APP_CONFIG.donationCredit.firstBand).toBe(200);
    expect(DEFAULT_APP_CONFIG.donationCredit.federal).toEqual({ firstTier: 0.14, overTier: 0.29, topTier: 0.33 });
    expect(DEFAULT_APP_CONFIG.donationCredit.claimCap).toBe(0.75);
    expect(DEFAULT_APP_CONFIG.donationCredit.qcCapExempt).toBe(true);
    expect(DEFAULT_APP_CONFIG.donationCredit.provinces.ONT).toEqual({ first: 0.0505, over: 0.1116 });
    expect(DEFAULT_APP_CONFIG.donationCredit.provinces.BC.top).toBe(0.205);
  });

  it('round-trips a stored block untouched', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    raw.donationCredit.provinces.ONT.over = 0.12;
    const out = validateAppConfig(raw);
    expect(out?.donationCredit.provinces.ONT.over).toBe(0.12);
  });

  it('back-fills the whole block for configs saved before it existed', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    delete raw.donationCredit;
    const out = validateAppConfig(raw);
    expect(out?.donationCredit).toEqual(DEFAULT_APP_CONFIG.donationCredit);
    // A pre-existing sibling block survives the back-fill.
    expect(out?.qcFederalAbatement).toBe(raw.qcFederalAbatement);
  });

  it('a partial block is replaced wholesale (all-or-nothing)', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    raw.donationCredit = { firstBand: 200 };
    const out = validateAppConfig(raw);
    expect(out?.donationCredit).toEqual(DEFAULT_APP_CONFIG.donationCredit);
  });

  it('a garbage province entry poisons the block and restores defaults', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    raw.donationCredit.provinces.NS.over = 'high';
    const out = validateAppConfig(raw);
    expect(out?.donationCredit).toEqual(DEFAULT_APP_CONFIG.donationCredit);
  });

  it('the back-fill is a deep copy: mutating it never touches the defaults', () => {
    const raw = JSON.parse(JSON.stringify(DEFAULT_APP_CONFIG));
    delete raw.donationCredit;
    const out = validateAppConfig(raw);
    out!.donationCredit.provinces.ONT.first = 0.99;
    expect(DEFAULT_APP_CONFIG.donationCredit.provinces.ONT.first).toBe(0.0505);
  });
});

