// Assistant language. The app is Canadian — English and French only.
// UI chrome stays English; this locale is for the assistant's prose.
export type Locale = 'en-CA' | 'fr-CA';

export const LOCALES: readonly Locale[] = ['en-CA', 'fr-CA'];

/** Narrow a raw string (stored config, tests) to a supported locale. */
export function parseLocale(raw: unknown): Locale | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  if (s === 'en-CA' || s === 'fr-CA') return s;
  return undefined;
}

/** Browser language → en-CA / fr-CA. Any French tag maps to fr-CA; everything else is English. */
export function detectLocale(): Locale {
  if (typeof navigator !== 'undefined' && navigator.language) {
    const primary = navigator.language.toLowerCase().split(',')[0];
    if (primary.startsWith('fr')) return 'fr-CA';
  }
  return 'en-CA';
}
