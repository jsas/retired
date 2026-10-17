import { Trans, useTranslation } from 'react-i18next';
import { cls } from '../design/tokens';

const DONATE_URL = 'https://github.com/sponsors/jsas';

// The Support page body (BetaPage owns the page title — no heading here):
// a few quiet paragraphs and one ink button. Kept tiny on purpose.
export function DonateCard() {
  const { t } = useTranslation('pages');
  return (
    <div className="max-w-lg">
      <div className="space-y-3 text-[13px] leading-relaxed text-slate-600">
        <p>{t('donate.p1')}</p>
        <p>{t('donate.p2')}</p>
        <p>{t('donate.p3')}</p>
        <p>{t('donate.p4')}</p>
        <p><Trans i18nKey="donate.p5" ns="pages" /></p>
      </div>
      <div className="mt-6">
        <a href={DONATE_URL} target="_blank" rel="noreferrer" className={`${cls.primaryBtn} inline-flex items-center`}>
          {t('donate.sponsor')}
        </a>
      </div>
    </div>
  );
}
