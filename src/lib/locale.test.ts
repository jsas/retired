import { describe, it, expect, afterEach } from 'vitest';
import { defaultProvinceCode, detectLocale, formatCurrency, parseLocale } from './locale';

const realNavigator = globalThis.navigator;
function setLanguage(language: string | undefined) {
  Object.defineProperty(globalThis, 'navigator', {
    value: language === undefined ? {} : { language },
    configurable: true,
    writable: true,
  });
}
afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: realNavigator,
    configurable: true,
    writable: true,
  });
});

describe('parseLocale', () => {
  it('accepts the two Canadian locales', () => {
    expect(parseLocale('en-CA')).toBe('en-CA');
    expect(parseLocale('fr-CA')).toBe('fr-CA');
  });

  it('trims whitespace', () => {
    expect(parseLocale('  fr-CA  ')).toBe('fr-CA');
  });

  it('rejects anything else', () => {
    expect(parseLocale('')).toBeUndefined();
    expect(parseLocale('en-US')).toBeUndefined();
    expect(parseLocale('fr-FR')).toBeUndefined();
    expect(parseLocale('xx-XX')).toBeUndefined();
    expect(parseLocale('fr-CA<script>')).toBeUndefined();
    expect(parseLocale('fr-CA\ninjection')).toBeUndefined();
    expect(parseLocale(null)).toBeUndefined();
    expect(parseLocale(1)).toBeUndefined();
  });
});

describe('detectLocale', () => {
  it('maps French tags to fr-CA', () => {
    setLanguage('fr-CA'); expect(detectLocale()).toBe('fr-CA');
    setLanguage('fr-FR'); expect(detectLocale()).toBe('fr-CA');
    setLanguage('fr'); expect(detectLocale()).toBe('fr-CA');
  });

  it('maps everything else to en-CA', () => {
    setLanguage('en-CA'); expect(detectLocale()).toBe('en-CA');
    setLanguage('en-US'); expect(detectLocale()).toBe('en-CA');
    setLanguage('es-ES'); expect(detectLocale()).toBe('en-CA');
    setLanguage(undefined); expect(detectLocale()).toBe('en-CA');
  });
});

describe('defaultProvinceCode', () => {
  it('seeds Quebec for French, Ontario for English', () => {
    expect(defaultProvinceCode('fr-CA')).toBe('QC');
    expect(defaultProvinceCode('en-CA')).toBe('ONT');
  });
});

describe('formatCurrency', () => {
  // The point of #178: one formatter, locale-aware output. Assert shape, not
  // the exact NBSP/NNBSP characters — ICU spacing is the locale's business.
  it('renders en-CA convention: $ prefix, comma grouping', () => {
    const s = formatCurrency(1234, 'en-CA');
    expect(s).toContain('1,234');
    expect(s.startsWith('$')).toBe(true);
  });

  it('renders fr-CA convention: $ suffix, no comma grouping', () => {
    const s = formatCurrency(1234, 'fr-CA');
    expect(s).not.toContain(',');
    expect(s).toMatch(/1\s?234/);
    expect(s).toMatch(/\$\s*$/);
  });

  it('the same value formats differently per locale', () => {
    expect(formatCurrency(1234, 'fr-CA')).not.toBe(formatCurrency(1234, 'en-CA'));
  });

  it('rounds to whole dollars like every money surface needs', () => {
    expect(formatCurrency(1234.6, 'en-CA')).toContain('1,235');
  });
});
