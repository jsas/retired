// Canada.ca-style language toggle: the control names the OTHER language.
import { useTranslation } from 'react-i18next';
import type { Locale } from '../lib/locale';

export function LanguageSwitch({ locale, onChange, className = '' }: {
  locale: Locale;
  onChange: (next: Locale) => void;
  className?: string;
}) {
  const { t } = useTranslation('common');
  const next: Locale = locale === 'en-CA' ? 'fr-CA' : 'en-CA';
  const label = locale === 'en-CA' ? 'Français' : 'English';
  const lang = locale === 'en-CA' ? 'fr' : 'en';
  return (
    <button
      type="button"
      lang={lang}
      onClick={() => onChange(next)}
      aria-label={t('language.switchTo', { language: label })}
      className={className}
    >
      {label}
    </button>
  );
}
