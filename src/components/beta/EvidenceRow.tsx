// The evidence row — the receipts under the map. Left: where the money sits
// across accounts at a chosen age (flat bars). Right: the key numbers grid —
// money lasts to, left at the plan-to age, in the pot at work's end, and the
// CPP+OAS that arrives every year. Everything reads the same engine breakdown.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RetirementInputs, RetirementResults, YearlyBreakdown } from '@retired/engine-core/retirementEngine';
import { potDisplay } from '../../lib/planDisplay';
import { AccountBars, Stat } from '../../design/primitives';
import { useAppLocale } from '../../lib/localeContext';

export function EvidenceRow({ inputs, breakdown }: {
  inputs: RetirementInputs;
  /** Unused — leftover is read from `breakdown` so it matches the life-timeline pin. */
  results?: RetirementResults;
  breakdown: YearlyBreakdown[];
}) {
  const { t } = useTranslation('pages');
  const { t: td } = useTranslation('details');
  const { locale } = useAppLocale();
  const fmt = (v: number) => '$' + Math.round(v).toLocaleString(locale);
  const { currentAge, retirementAge, maxAge } = inputs;
  const [age, setAge] = useState(retirementAge);

  const rowAt = (a: number): YearlyBreakdown | undefined =>
    breakdown.find(r => r.age === a) ?? [...breakdown].reverse().find(r => r.age <= a);

  const acc = rowAt(age);
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

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_1fr]">
      {/* per-account balances at a chosen age */}
      <div>
        <div className="mb-3 flex items-baseline gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{t('dash.whereItSits')}</h3>
          <select
            className="num cursor-pointer appearance-none border-b border-transparent bg-transparent text-[12px] text-slate-600 hover:border-slate-300"
            value={age}
            onChange={(e) => setAge(Number(e.target.value))}
            aria-label={t('dash.balanceAtAge')}
          >
            {Array.from({ length: maxAge - currentAge + 1 }, (_, i) => currentAge + i).map(a => (
              <option key={a} value={a}>{t('dash.atAge', { age: a })}</option>
            ))}
          </select>
        </div>
        <AccountBars rows={accounts} total={accTotal} />
      </div>

      {/* key numbers */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-6">
        <Stat
          label={t('dash.moneyLastsTo')}
          value={holds ? `${maxAge}+` : `${depletionAge ?? '—'}`}
          tone={lastsTone}
          note={holds ? t('dash.pastThePlan') : t('dash.beforePlanned', { age: maxAge })}
        />
        <Stat
          label={t('dash.leftAt', { age: maxAge })}
          value={leftAtMax > 0 ? fmt(leftAtMax) : t('dash.nothing')}
          note={leftAtMax > 0 ? t('dash.stillInPot') : t('dash.potEmpty')}
        />
        <Stat
          label={t('dash.inPotAtEnd')}
          value={fmt(atRet?.endingBalance ?? 0)}
          note={t('dash.afterSaving')}
        />
        <Stat
          label={t('dash.cppOasFrom', { age: benAge })}
          value={benefits > 0 ? fmt(benefits) : '—'}
          note={t('dash.everyYearAfter')}
        />
      </div>
    </div>
  );
}
