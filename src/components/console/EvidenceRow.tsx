// The evidence row — the receipts under the map. Left: where the money sits
// across accounts at a chosen age (flat bars). Right: the key numbers grid —
// Re:score, money lasts to, left at the plan-to age, in the pot at work's
// end, and the CPP+OAS that arrives every year. Everything reads the same
// engine breakdown.
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { RetirementInputs, RetirementResults, YearlyBreakdown } from '@retired/engine-core/retirementEngine';
import { householdOutcome } from '@retired/engine-core/retirementEngine';
import { toHousehold } from '@retired/engine-core/householdTypes';
import { potDisplay, formatReScore } from '../../lib/planDisplay';
import { AccountBars, Stat } from '../../design/primitives';
import { useAppLocale } from '../../lib/localeContext';
import { formatCurrency } from '../../lib/locale';

export function EvidenceRow({ inputs, results, breakdown }: {
  inputs: RetirementInputs;
  /** Household Re:score reads the engine outcome; leftover still comes from `breakdown`. */
  results?: RetirementResults;
  breakdown: YearlyBreakdown[];
}) {
  const { t } = useTranslation('pages');
  const { t: td } = useTranslation('details');
  const { locale } = useAppLocale();
  const { currentAge, retirementAge, maxAge } = inputs;
  const [age, setAge] = useState(retirementAge);

  const rowAt = (a: number): YearlyBreakdown | undefined =>
    breakdown.find(r => r.age === a) ?? [...breakdown].reverse().find(r => r.age <= a);

  // The plan's age window moves under the slider (retire later, max age raised),
  // so the stored pick is clamped rather than trusted: a stale age would leave
  // the thumb off the track and the bars reading a year that is no longer planned.
  const at = Math.min(Math.max(age, currentAge), maxAge);
  const acc = rowAt(at);
  const accounts = acc ? [
    { label: td('rrsp'), value: acc.rrspBalance + (acc.rrifBalance ?? 0) },
    { label: td('tfsa'), value: acc.tfsaBalance, active: true },
    { label: td('taxable'), value: acc.taxableBalance + (acc.cashCushionBalance ?? 0) },
  ] : [];
  const accTotal = accounts.reduce((s, a) => s + a.value, 0);

  const atRet = rowAt(retirementAge);
  // Follow leftover in the pot (same as the life-timeline pin), not engine
  // ON_TRACK — a reverse mortgage can keep status green after the pot is empty.
  const pot = potDisplay(breakdown, maxAge);
  const holds = pot.holds;
  const depletionAge = pot.emptyAge;
  const borderline = !holds && depletionAge != null && (maxAge - depletionAge) <= 6;
  const leftAtMax = pot.leftover;

  // CPP + OAS yearly at the benefit age (first row that has any).
  const benRow = breakdown.find(r => (r.cppIncome ?? 0) + (r.oasIncome ?? 0) > 0);
  const benefits = benRow ? (benRow.cppIncome ?? 0) + (benRow.oasIncome ?? 0) : 0;
  const benAge = benRow?.age ?? inputs.cppStartAge ?? 65;

  const lastsTone = holds ? 'holds' : borderline ? 'borderline' : 'short';
  const reScore = results
    ? formatReScore(householdOutcome(results, toHousehold(inputs)), maxAge)
    : null;

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_1fr]">
      {/* per-account balances at a chosen age */}
      <div>
        <div className="mb-3">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{t('dash.whereItSits')}</h3>
            <span className="num text-[12px] text-slate-600">{t('dash.atAge', { age: at })}</span>
          </div>
          <input
            type="range"
            className="fader block w-full"
            style={{ height: 24 }}
            min={currentAge}
            max={maxAge}
            step={1}
            value={at}
            onChange={(e) => setAge(Number(e.target.value))}
            aria-label={t('dash.balanceAtAge')}
          />
          <div className="num flex justify-between text-[10px] text-slate-400">
            <span>{currentAge}</span>
            <span>{maxAge}</span>
          </div>
        </div>
        <AccountBars
          rows={accounts}
          total={accTotal}
          note={
            <Trans
              i18nKey="dash.accountSharesNote"
              ns="pages"
              values={{ amount: formatCurrency(accTotal, locale) }}
              components={{ n: <span className="num" /> }}
            />
          }
        />
      </div>

      {/* key numbers */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-6">
        {reScore != null && (
          <Stat
            label={t('dash.reScore')}
            value={`${reScore}`}
            note={t('dash.reScoreNote', { age: maxAge })}
          />
        )}
        <Stat
          label={t('dash.moneyLastsTo')}
          value={holds ? `${maxAge}+` : `${depletionAge ?? '—'}`}
          tone={lastsTone}
          note={holds ? t('dash.pastThePlan') : t('dash.beforePlanned', { age: maxAge })}
        />
        <Stat
          label={t('dash.leftAt', { age: maxAge })}
          value={leftAtMax > 0 ? formatCurrency(Math.round(leftAtMax), locale) : t('dash.nothing')}
          note={leftAtMax > 0 ? t('dash.stillInPot') : t('dash.potEmpty')}
        />
        <Stat
          label={t('dash.inPotAtEnd')}
          value={formatCurrency(Math.round(atRet?.endingBalance ?? 0), locale)}
          note={t('dash.afterSaving')}
        />
        <Stat
          label={t('dash.cppOasFrom', { age: benAge })}
          value={benefits > 0 ? formatCurrency(Math.round(benefits), locale) : '—'}
          note={t('dash.everyYearAfter')}
        />
      </div>
    </div>
  );
}
