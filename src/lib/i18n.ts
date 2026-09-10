// Site locale. Canadian English / French only. UI chrome, help, print and
// settings copy live in src/locales/{en-CA,fr-CA}/*.json. The assistant's
// prose still follows the same locale via the system-prompt line.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Locale } from './locale';
import { LOCALES } from './locale';

import enCommon from '../locales/en-CA/common.json';
import enNav from '../locales/en-CA/nav.json';
import enLanding from '../locales/en-CA/landing.json';
import enHelp from '../locales/en-CA/help.json';
import enPages from '../locales/en-CA/pages.json';
import enPrint from '../locales/en-CA/print.json';
import enSettings from '../locales/en-CA/settings.json';
import enDetails from '../locales/en-CA/details.json';

import frCommon from '../locales/fr-CA/common.json';
import frNav from '../locales/fr-CA/nav.json';
import frLanding from '../locales/fr-CA/landing.json';
import frHelp from '../locales/fr-CA/help.json';
import frPages from '../locales/fr-CA/pages.json';
import frPrint from '../locales/fr-CA/print.json';
import frSettings from '../locales/fr-CA/settings.json';
import frDetails from '../locales/fr-CA/details.json';

export const I18N_NAMESPACES = [
  'common', 'nav', 'landing', 'help', 'pages', 'print', 'settings', 'details',
] as const;

const resources = {
  'en-CA': {
    common: enCommon, nav: enNav, landing: enLanding, help: enHelp,
    pages: enPages, print: enPrint, settings: enSettings, details: enDetails,
  },
  'fr-CA': {
    common: frCommon, nav: frNav, landing: frLanding, help: frHelp,
    pages: frPages, print: frPrint, settings: frSettings, details: frDetails,
  },
} as const;

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: 'en-CA',
    // No silent English fallback — a missing fr-CA key must show the key so
    // it cannot ship unnoticed. en-CA is complete; tests assert that.
    fallbackLng: false,
    supportedLngs: [...LOCALES],
    ns: [...I18N_NAMESPACES],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    parseMissingKeyHandler: (key) => {
      if (typeof console !== 'undefined') console.error(`[i18n] missing key: ${key}`);
      return key;
    },
  });
}

export { i18n };

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  const title = i18n.t('common:documentTitle', { lng: locale });
  if (title && title !== 'documentTitle') document.title = title;
}

export async function setAppLanguage(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
  applyDocumentLocale(locale);
}
