import { afterEach, describe, it, expect } from 'vitest';
import { i18n, I18N_NAMESPACES, setAppLanguage } from './i18n';
import { LOCALES } from './locale';

function leafKeys(obj: unknown, prefix = ''): string[] {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return [prefix];
  const entries = Object.entries(obj as Record<string, unknown>);
  if (!entries.length) return [prefix];
  return entries.flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k));
}

describe('i18n catalogs', () => {
  it('ships every namespace for both Canadian locales', () => {
    for (const lng of LOCALES) {
      for (const ns of I18N_NAMESPACES) {
        expect(i18n.hasResourceBundle(lng, ns), `${lng}/${ns}`).toBe(true);
      }
    }
  });

  it('fr-CA has every en-CA key (no silent fallback)', () => {
    for (const ns of I18N_NAMESPACES) {
      const en = i18n.getResourceBundle('en-CA', ns);
      const fr = i18n.getResourceBundle('fr-CA', ns);
      expect(en, `en-CA ${ns}`).toBeTruthy();
      expect(fr, `fr-CA ${ns}`).toBeTruthy();
      const enKeys = leafKeys(en).sort();
      const frKeys = leafKeys(fr).sort();
      expect(frKeys, ns).toEqual(enKeys);
    }
  });

  it('fr-CA help topic bodies are translated (MIT license stays English)', () => {
    const en = i18n.getResourceBundle('en-CA', 'help') as {
      topics: Record<string, { body: string }>;
    };
    const fr = i18n.getResourceBundle('fr-CA', 'help') as {
      topics: Record<string, { body: string }>;
    };
    const leftover = Object.entries(en.topics)
      .filter(([id, topic]) => id !== 'mit-license' && fr.topics[id].body === topic.body)
      .map(([id]) => id);
    expect(leftover).toEqual([]);
    expect(fr.topics['mit-license'].body).toBe(en.topics['mit-license'].body);
  });

  it('en-CA values are not empty strings', () => {
    for (const ns of I18N_NAMESPACES) {
      const bundle = i18n.getResourceBundle('en-CA', ns) as Record<string, unknown>;
      for (const key of leafKeys(bundle)) {
        const value = i18n.t(`${ns}:${key}`, { lng: 'en-CA' });
        expect(String(value).length, `${ns}:${key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('setAppLanguage', () => {
  afterEach(async () => {
    await setAppLanguage('en-CA');
  });

  it('switches the live i18n language', async () => {
    await setAppLanguage('fr-CA');
    expect(i18n.language).toBe('fr-CA');
    expect(i18n.t('common:brandTired')).toBe('tired');
    expect(i18n.t('nav:plans')).toBe('Plans');
    expect(i18n.t('settings:language.title')).toBe('Langue');
    if (typeof document !== 'undefined') {
      expect(document.documentElement.lang).toBe('fr-CA');
    }
  });
});
