// Compact bilingual language toggle (#192): both locale codes sit in one
// control — EN | FR — with the CURRENT language emphasised; one click flips
// to the other. The old full-word version ("Français"/"English") was the
// control's only label, so here the aria-label keeps naming the OTHER
// language (the Canada.ca convention) while the visible text stays compact
// enough for the header row.
import { useTranslation } from 'react-i18next';
import type { Locale } from '../lib/locale';

export function LanguageSwitch({ locale, onChange, className = '' }: {
  locale: Locale;
  onChange: (next: Locale) => void;
  className?: string;
}) {
  const { t } = useTranslation('common');
  const isFr = locale === 'fr-CA';
  // The action speaks the OTHER language; the codes speak both.
  const label = isFr ? 'English' : 'Français';
  const code = (text: string, active: boolean) => (
    <span className={active ? 'font-bold' : 'opacity-40'}>{text}</span>
  );
  return (
    <button
      type="button"
      lang={isFr ? 'en' : 'fr'}
      onClick={() => onChange(isFr ? 'en-CA' : 'fr-CA')}
      aria-label={t('language.switchTo', { language: label })}
      title={label}
      className={className}
    >
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        {code('EN', !isFr)}
        <span className="opacity-30">|</span>
        {code('FR', isFr)}
      </span>
    </button>
  );
}
