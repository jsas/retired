import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RetirementInputs, RetirementResults, YearlyBreakdown } from '@retired/engine-core/retirementEngine';
import { cls } from '../design/tokens';
import { useAppLocale } from '../lib/localeContext';

interface MathPageProps {
  inputs: RetirementInputs;
  results: RetirementResults;
  spouseAgeOffset: number;
}

function fmt(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'CAD', maximumFractionDigits: 0,
  }).format(v);
}
function fmt2(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'CAD', maximumFractionDigits: 2,
  }).format(v);
}

function acctName(id: string, t: TFunction<'math'>): string {
  const key = `acct.${id}` as const;
  const translated = t(key);
  return translated === key ? id : translated;
}

// One numbered step in the worksheet: a label, the formula in words, and the
// numbers plugged in → the result. Ink index + hairline — never a blue chip
// (blue is verdict-only) and never a boxed card (the border is the container).
function Step({ n, title, note, children }: {
  n: number; title: string; note?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 border-b border-slate-100 py-3 last:border-0">
      <span className="num mt-0.5 w-6 shrink-0 text-[11px] font-semibold text-slate-400">
        {String(n).padStart(2, '0')}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-slate-900">{title}</div>
        {note && <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{note}</div>}
        {children && <div className="mt-1.5">{children}</div>}
      </div>
    </div>
  );
}

// A labelled equation line: "spending target = $70,000 × 1.102 × 100% = $77,153".
function Eq({ parts, result, strong, locale }: { parts: string; result: number; strong?: boolean; locale: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11.5px]">
      <span className="text-slate-600">{parts}</span>
      <span className={`num ${strong ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{fmt(result, locale)}</span>
    </div>
  );
}
function Line({ label, value, indent, locale }: { label: string; value: string | number; indent?: boolean; locale: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-[11.5px] ${indent ? 'pl-3' : ''}`}>
      <span className="text-slate-600">{label}</span>
      <span className="num text-slate-800">{typeof value === 'number' ? fmt(value, locale) : value}</span>
    </div>
  );
}

function pct(v: number): string { return `${(v * 100).toFixed(1)}%`; }

// The ordered worksheet for one decumulation year, driven entirely by the
// engine-emitted calc trace + row fields (so it always equals the table).
function YearWorksheet({ row, inputs, isCouple, t, locale }: {
  row: YearlyBreakdown; inputs: RetirementInputs; isCouple: boolean;
  t: TFunction<'math'>; locale: string;
}) {
  const d = row.detail;
  const c = d?.calc;
  if (!d || !c) {
    return <p className="text-xs text-slate-500 py-4">{t('noDetail')}</p>;
  }
  const w = d.withdraw;
  const order = (inputs.withdrawalOrder ?? ['tfsa', 'taxable', 'rrsp']).map(id => acctName(id, t));
  let n = 0;

  return (
    <div>
      {/* 1 — spending target */}
      <Step n={++n} title={t('spendingTarget')} note={t('spendingTargetNote')}>
        <Eq parts={t('baseGrown', { amount: fmt(inputs.desiredSpending, locale) })} result={row.spendingTarget} strong locale={locale} />
        {d.events.filter(e => e.direction === 'out').map((e, i) => (
          <Line key={i} label={t('oneTimeExpense', { label: e.label })} value={e.amount} indent locale={locale} />
        ))}
      </Step>

      {/* 2 — benefits */}
      <Step n={++n} title={t('benefits')} note={t('benefitsNote')}>
        <Line label={t('cppLine', { amount: fmt2(c.cppMonthlyAtStart, locale) })} value={row.cppIncome} locale={locale} />
        <Line label={t('oas')} value={row.oasIncome} locale={locale} />
        <Line label={t('pension')} value={row.pensionIncome} locale={locale} />
        <Eq parts={t('grossBenefits')} result={c.otherGross} strong locale={locale} />
        <Eq parts={t('netBenefits')} result={c.netBenefits} locale={locale} />
        {(row.employmentGross ?? 0) > 0.5 && (
          <>
            <Line label={t('employmentGross')} value={row.employmentGross ?? 0} locale={locale} />
            <Line label={t('employmentTax')} value={row.employmentTax ?? 0} indent locale={locale} />
            <Line label={t('afterTaxValue')} value={row.employmentNet ?? 0} indent locale={locale} />
          </>
        )}
        <Eq parts={(row.employmentGross ?? 0) > 0.5
          ? t('portfolioMustSupplyJob', { target: fmt(row.spendingTarget, locale), benefits: fmt(c.netBenefits, locale) })
          : t('portfolioMustSupply', { target: fmt(row.spendingTarget, locale), benefits: fmt(c.netBenefits, locale) })} result={c.neededAfterTax} strong locale={locale} />
      </Step>

      {/* 3 — RRIF minimum */}
      {(w.rrifMin > 0.5 || c.rrifMinNet > 0.5) && (
        <Step n={++n} title={t('rrifMin')} note={t('rrifMinNote')}>
          <Eq parts={t('rrifMinEq')} result={w.rrifMin} strong locale={locale} />
          <Line label={t('afterTaxValue')} value={c.rrifMinNet} locale={locale} />
          {c.rrifMinExcess > 0.5 && <Line label={t('rrifMinExcess')} value={c.rrifMinExcess} indent locale={locale} />}
          <Eq parts={t('remainingNeed')} result={c.needAfterRrifMin} locale={locale} />
        </Step>
      )}

      {/* 4 — GIS */}
      {row.gisIncome > 0.5 && (
        <Step n={++n} title={t('gis')} note={t('gisNote', { couple: isCouple ? t('gisCouple') : '' })}>
          <Eq parts={t('gisEq')} result={row.gisIncome} strong locale={locale} />
          <Eq parts={t('remainingNeed')} result={c.needAfterGis} locale={locale} />
        </Step>
      )}

      {/* 5 — withdrawals in order */}
      {row.withdrawals > 0.5 && (
        <Step n={++n} title={t('withdrawals')} note={t('withdrawalsNote', { order: order.join(' → ') })}>
          {w.rrsp > 0.5 && <Line label={t('rrspGrossed')} value={w.rrsp} locale={locale} />}
          {w.rrif > 0.5 && <Line label={t('rrifGrossed')} value={w.rrif} locale={locale} />}
          {w.tfsa > 0.5 && <Line label={t('tfsaFree')} value={w.tfsa} locale={locale} />}
          {w.taxable > 0.5 && (
            <>
              <Line label={t('taxableGrossed')} value={w.taxable} locale={locale} />
              <Line label={t('gainRealized', { pct: pct(c.gainsFraction) })} value={d.tax.capitalGains} indent locale={locale} />
            </>
          )}
          {(w.rdsp ?? 0) > 0.5 && (
            <>
              <Line label={t('rdspDraw')} value={w.rdsp ?? 0} locale={locale} />
              <Line label={t('rdspTaxable', { pct: pct(d.rdsp?.taxableFraction ?? 0) })} value={d.rdsp?.taxablePortion ?? 0} indent locale={locale} />
            </>
          )}
          <Eq parts={t('totalWithdrawn')} result={row.withdrawals} strong locale={locale} />
          <Eq parts={t('needAfterDraws')} result={c.needAfterDraws} locale={locale} />
        </Step>
      )}

      {/* 6 — cash cushion */}
      {w.cash > 0.5 && (
        <Step n={++n} title={t('cashCushion')} note={t('cashCushionNote')}>
          <Eq parts={t('cashDraw')} result={w.cash} strong locale={locale} />
        </Step>
      )}

      {/* 7 — RM top-up */}
      {w.rmDraw > 0.5 && (
        <Step n={++n} title={t('rmTopUp')} note={t('rmTopUpNote')}>
          <Eq parts={t('rmBorrowed')} result={w.rmDraw} strong locale={locale} />
        </Step>
      )}

      {/* 7a — transfer events (the RRSP meltdown & friends). Each shows the
          full path: gross out of the source, the tax on a registered source,
          and the after-tax net landing in the destination — so a meltdown
          doesn't look like money vanishing. */}
      {(c.transfers ?? []).length > 0 && (
        <Step n={++n} title={t('transfers')} note={t('transfersNote')}>
          {(c.transfers ?? []).map((xfer, i) => (
            <div key={i} className="mb-1.5 last:mb-0">
              <div className="text-[11.5px] font-semibold text-slate-700">{t('transferTitle', { label: xfer.label, from: acctName(xfer.from, t), to: acctName(xfer.to, t) })}</div>
              <Line label={t('grossOut', { from: acctName(xfer.from, t) })} value={xfer.gross} indent locale={locale} />
              {xfer.tax > 0.5 && <Line label={t('taxOnWithdrawal', { from: acctName(xfer.from, t) })} value={xfer.tax} indent locale={locale} />}
              <Line label={t('netRedeposited', { to: acctName(xfer.to, t) })} value={xfer.net} indent locale={locale} />
            </div>
          ))}
        </Step>
      )}

      {/* 7d — inflows landing this year. The engine already adds each inflow
          into the deposit accumulators, so rendering BOTH the event line and a
          per-account deposit line would count the same dollars twice — the
          event lines (which carry the label and destination) are the truthful
          display; the per-account deposit lines are dropped. The redeposit side
          of a transfer is shown in the Transfers step above, not here. */}
      {d.events.some(e => e.direction === 'in') && (
        <Step n={++n} title={t('deposits')} note={t('depositsNote')}>
          {d.events.filter(e => e.direction === 'in').map((e, i) => (
            <Line key={`ev-${i}`} label={t('inflow', { label: e.label, to: e.to ? t('inflowTo', { to: acctName(e.to, t) }) : '' })} value={e.amount} locale={locale} />
          ))}
        </Step>
      )}

      {/* 7b — unfunded gap once the portfolio is depleted */}
      {(row.shortfall ?? 0) > 0.5 && (
        <Step n={++n} title={t('shortfall')} note={t('shortfallNote')}>
          <Eq parts={t('shortfallEq', { amount: fmt(row.spendingTarget, locale) })} result={row.shortfall ?? 0} strong locale={locale} />
          <div className="mt-0.5 text-[10px] leading-snug text-rose-700">
            {t('shortfallWarn')}
          </div>
        </Step>
      )}

      {/* 8 — tax */}
      {(row.incomeTax > 0.5 || d.tax.oasClawback > 0.5 || (row.splitTransferred ?? 0) !== 0) && (
        <Step n={++n} title={t('incomeTax')} note={t('incomeTaxNote')}>
          <Line label={t('totalNetIncome')} value={c.totalNetIncome} locale={locale} />
          <Line label={t('taxOnBenefits')} value={c.taxOnBenefits} indent locale={locale} />
          {d.tax.oasClawback > 0.5 && <Line label={t('oasClawback')} value={d.tax.oasClawback} indent locale={locale} />}
          {(row.splitTransferred ?? 0) !== 0 && (
            <Line
              label={(row.splitTransferred ?? 0) > 0 ? t('splitOut') : t('splitIn')}
              value={Math.abs(row.splitTransferred ?? 0)}
              indent
              locale={locale}
            />
          )}
          <Eq parts={t('taxOnWithdrawals')} result={row.incomeTax} strong locale={locale} />
          <Line label={t('totalTaxAll')} value={row.totalTaxPaid ?? 0} locale={locale} />
          <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">
            {t('taxFoot')}
          </div>
          {(row.splitTransferred ?? 0) !== 0 && (
            <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">
              {(row.splitTransferred ?? 0) > 0 ? t('splitFootOut') : t('splitFootIn')}
            </div>
          )}
          <Line label={t('cumulativeTax')} value={row.cumulativeTax} locale={locale} />
        </Step>
      )}

      {/* 9 — growth & ending */}
      <Step n={++n} title={t('growth')} note={t('growthNote')}>
        <Line label={t('rrspGrowth')} value={d.growth.rrsp} locale={locale} />
        <Line label={t('rrifGrowth')} value={d.growth.rrif} locale={locale} />
        <Line label={t('tfsaGrowth')} value={d.growth.tfsa} locale={locale} />
        <Line label={t('taxableGrowth')} value={d.growth.taxable} locale={locale} />
        <Line label={t('cashGrowth')} value={d.growth.cash} locale={locale} />
        {(d.growth.rdsp ?? 0) > 0.5 && <Line label={t('rdspGrowth')} value={d.growth.rdsp ?? 0} locale={locale} />}
        {(d.growth.fhsa ?? 0) > 0.5 && <Line label={t('fhsaGrowth')} value={d.growth.fhsa ?? 0} locale={locale} />}
        <Eq parts={t('marketGains')} result={row.marketGains} strong locale={locale} />
        <Eq parts={t('endingBalance')} result={row.endingBalance} strong locale={locale} />
      </Step>
    </div>
  );
}

// One person's worksheet column with a small header (name + own age + year).
function PersonColumn({ title, row, inputs, isCouple, calendarYear, t, locale }: {
  title: string; row: YearlyBreakdown | undefined; inputs: RetirementInputs;
  isCouple: boolean; calendarYear: number; t: TFunction<'math'>; locale: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between border-b border-slate-200 pb-1">
        <span className={cls.sectionLabel}>{title}</span>
        {row && <span className="num text-[11px] text-slate-400">{t('ageYear', { age: row.age, year: calendarYear })}</span>}
      </div>
      {row ? (
        <YearWorksheet row={row} inputs={inputs} isCouple={isCouple} t={t} locale={locale} />
      ) : (
        <p className="text-xs text-slate-500">{t('noRow')}</p>
      )}
    </div>
  );
}

export function MathPage({ inputs, results, spouseAgeOffset }: MathPageProps) {
  const { locale } = useAppLocale();
  const { i18n } = useTranslation();
  const t = i18n.getFixedT(locale, 'math');
  const spouse = results.spouse;
  const [view, setView] = useState<'you' | 'spouse' | 'both'>('you');

  const baseYear = new Date().getFullYear();
  const youRows = results.yearlyBreakdown;
  const spouseRows = spouse?.yearlyBreakdown ?? [];

  // The selectable axis is the CALENDAR YEAR (via the primary's age), so the
  // same year stays selected when switching person or opening side-by-side.
  const axisAges = useMemo(() => youRows.map(r => r.age), [youRows]);
  const [axisAge, setAxisAge] = useState<number | null>(null);
  const selAxisAge = axisAge != null && axisAges.includes(axisAge) ? axisAge : (axisAges[0] ?? inputs.currentAge);
  const calendarYear = baseYear + (selAxisAge - inputs.currentAge);

  // Each person's row at this calendar year (spouse is offset by the age gap).
  const youRow = youRows.find(r => r.age === selAxisAge) ?? youRows[0];
  const spouseAgeAtYear = selAxisAge - spouseAgeOffset;
  const spouseRow = spouseRows.find(r => r.age === spouseAgeAtYear);
  const n = Math.abs(spouseAgeOffset);

  return (
    <div>
      <p className="mb-4 text-[13.5px] leading-relaxed text-slate-500">
        {t('lead')}
      </p>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {spouse && (
          <div className="flex border border-slate-200">
            {(['you', 'spouse', 'both'] as const).map(p => (
              <button
                key={p}
                onClick={() => setView(p)}
                className={`px-3 py-1.5 text-xs font-medium ${view === p ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {p === 'you' ? t('you') : p === 'spouse' ? t('spouse') : t('sideBySide')}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-600">
          {t('yearLabel')}
          <select
            value={selAxisAge}
            onChange={e => setAxisAge(Number(e.target.value))}
            className="cursor-pointer border border-slate-300 bg-white px-2 py-1.5 text-xs"
          >
            {axisAges.map(a => (
              <option key={a} value={a}>
                {baseYear + (a - inputs.currentAge)} ({t('youAge', { age: a })}{spouse ? ` · ${t('spouseAge', { age: a - spouseAgeOffset })}` : ''})
              </option>
            ))}
          </select>
        </label>
        <span className="text-[11px] text-slate-400">
          {t('calendarYear', { year: calendarYear })}
          {spouse && spouseAgeOffset !== 0 && t('spouseOffset', {
            n,
            unit: t('yearUnit', { count: n }),
            rel: spouseAgeOffset > 0 ? t('younger') : t('older'),
          })}
        </span>
      </div>

      {view === 'both' && spouse ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <PersonColumn title={t('you')} row={youRow} inputs={inputs} isCouple calendarYear={calendarYear} t={t} locale={locale} />
          <PersonColumn title={t('spouse')} row={spouseRow} inputs={inputs} isCouple calendarYear={calendarYear} t={t} locale={locale} />
        </div>
      ) : view === 'spouse' && spouse ? (
        <PersonColumn title={t('spouse')} row={spouseRow} inputs={inputs} isCouple calendarYear={calendarYear} t={t} locale={locale} />
      ) : (
        <PersonColumn title={t('you')} row={youRow} inputs={inputs} isCouple={!!spouse} calendarYear={calendarYear} t={t} locale={locale} />
      )}
    </div>
  );
}
