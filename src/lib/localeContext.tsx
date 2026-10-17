import { createContext, useContext } from 'react';
import type { Locale } from './locale';

export const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
}>({
  locale: 'en-CA',
  setLocale: () => {},
});

export function useAppLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  return useContext(LocaleContext);
}
