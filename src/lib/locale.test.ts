import { describe, it, expect, afterEach } from 'vitest';
import { detectLocale, parseLocale } from './locale';

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
