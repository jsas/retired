import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RetirementInputs, RetirementResults, YearlyBreakdown } from '@retired/engine-core/retirementEngine';
import type { MonteCarloResults } from '@retired/engine-core/monteCarlo';
import type { PrintOptions } from '../lib/printOptions';
import { BLUE, AMBER_TEXT, MUTED, FAINT, HAIRLINE, cls } from '../design/tokens';
import { useAppLocale } from '../lib/localeContext';

// The print sheet (hidden on screen — see the `print-only` rule in index.css).
// Composes the same visual language as the app (tokens.ts / the slate+blue
// scale) via Tailwind classes; the only raw values left are SVG paint
// attributes, which read the token constants directly. No inline styles.
// Copy follows the site locale — the options card already did; the sheet
// itself used to stay English.

function fmt(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(value);
}

function fmtShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}

// Section labels: the guide's uppercase slate label (cls.sectionLabel) with a
// bottom hairline — the Panel pattern, print's container. Blue is verdict-
// only, never structure.
const SECTION_TITLE = `border-b ${cls.sectionLabel} pb-1 mb-1.5`;
// Money/figures align and compare — tabular figures, not monospace.
const NUM = 'num';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="py-0.5 pr-3 text-slate-600">{label}</td>
      <td className="py-0.5 text-right font-semibold">{value}</td>
    </tr>
  );
}

// ---------------------------------------------------------------- timeline --

const TL_W = 700;
const TL_H = 170;
const TL_PAD = { top: 10, right: 10, bottom: 20, left: 52 };

// Static (print-only) rendering of the projection timeline, mirroring the
// on-screen chart: with a reverse mortgage the headline is TOTAL cash
// (portfolio + net home equity) and the portfolio/equity components show as
// secondary lines; without RM it's just the portfolio balance. Uses the
// household-combined breakdown (same rows as the on-screen ProjectionTimeline).
function TimelinePrintChart({ inputs, rows, t }: {
  inputs: RetirementInputs;
  rows: YearlyBreakdown[];
  t: TFunction<'print'>;
}) {
  if (rows.length < 2) return null;
  const minAge = rows[0].age;
  const maxAge = rows[rows.length - 1].age;
  const span = Math.max(1, maxAge - minAge);

  const hasRm = rows.some(r => r.netHomeEquity != null);
  const portfolio = rows.map(r => r.startingBalance);
  const equity = rows.map(r => (hasRm ? (r.netHomeEquity ?? 0) : 0));
  const totalCash = rows.map((r, i) => r.startingBalance + equity[i]);
  const headline = hasRm ? totalCash : portfolio;
  const maxBal = Math.max(1, ...headline, ...portfolio, ...(hasRm ? equity : []));

  // A plan with no savings degenerates: every balance is 0, the axis reads
  // $0–$1 and the line sits flat — looks broken. Say why instead.
  if (maxBal < 2) {
    return (
      <p className="border-l-2 border-slate-300 py-1 pl-3 text-[11px] text-slate-500">
        {t('sheet.emptyTimeline')}
      </p>
    );
  }

  const x = (age: number) => TL_PAD.left + ((age - minAge) / span) * (TL_W - TL_PAD.left - TL_PAD.right);
  const y = (v: number) => TL_PAD.top + (1 - v / maxBal) * (TL_H - TL_PAD.top - TL_PAD.bottom);
  const pathOf = (vals: number[]) =>
    rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r.age).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ');
  const headlinePath = pathOf(headline);
  const area = `${headlinePath} L${x(maxAge).toFixed(1)},${y(0).toFixed(1)} L${x(minAge).toFixed(1)},${y(0).toFixed(1)} Z`;

  const yTicks = [0, 0.5, 1].map(f => f * maxBal);
  const xStep = Math.max(1, Math.round(span / 10));
  const xTicks: number[] = [];
  for (let a = minAge; a <= maxAge; a += xStep) xTicks.push(a);

  return (
    <div>
      <svg viewBox={`0 0 ${TL_W} ${TL_H}`} className="h-auto w-full">
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line x1={TL_PAD.left} x2={TL_W - TL_PAD.right} y1={y(tick)} y2={y(tick)} stroke={HAIRLINE} strokeWidth="1" />
            <text x={TL_PAD.left - 5} y={y(tick) + 3} textAnchor="end" fontSize="9" fill={MUTED}>{fmtShort(tick)}</text>
          </g>
        ))}
        {xTicks.map(a => (
          <text key={a} x={x(a)} y={TL_H - 6} textAnchor="middle" fontSize="9" fill={MUTED}>{a}</text>
        ))}
        <path d={area} fill={BLUE} opacity="0.12" />
        <path d={headlinePath} fill="none" stroke={BLUE} strokeWidth="2.2" />
        {hasRm && (
          <>
            <path d={pathOf(portfolio)} fill="none" stroke={BLUE} strokeOpacity="0.45" strokeWidth="1.2" />
            <path d={pathOf(equity)} fill="none" stroke={AMBER_TEXT} strokeWidth="1.2" strokeDasharray="5 3" />
          </>
        )}
        <line
          x1={x(inputs.retirementAge)} x2={x(inputs.retirementAge)}
          y1={TL_PAD.top} y2={TL_H - TL_PAD.bottom}
          stroke={FAINT} strokeWidth="1" strokeDasharray="4 3"
        />
        <text x={x(inputs.retirementAge) + 4} y={TL_PAD.top + 9} fontSize="9" fill={MUTED}>
          {t('sheet.retireAge', { age: inputs.retirementAge })}
        </text>
      </svg>
      <div className="mt-0.5 flex gap-3.5 text-[9px] text-slate-600">
        <span className="text-blue-700">— {hasRm ? t('sheet.legendTotalCash') : t('sheet.legendPortfolio')}</span>
        {hasRm && <span className="text-blue-700/45">— {t('sheet.legendPortfolio')}</span>}
        {hasRm && <span className="text-amber-700">–– {t('sheet.legendHomeEquity')}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ monte carlo --

const MC_W = 700;
const MC_H = 190;
const MC_PAD = { top: 10, right: 10, bottom: 20, left: 52 };

// Static print rendering of the Monte Carlo percentile fan + success rate.
function MonteCarloPrintChart({ results, retirementAge, maxAge, t, locale }: {
  results: MonteCarloResults;
  retirementAge: number;
  maxAge: number;
  t: TFunction<'print'>;
  locale: string;
}) {
  const bands = results.percentileBands;
  if (bands.length < 2) return null;
  const minAge = bands[0].age;
  const bandMaxAge = bands[bands.length - 1].age;
  const span = Math.max(1, bandMaxAge - minAge);
  const maxBal = Math.max(1, ...bands.map(b => b.p90));

  // Same degenerate case as the timeline: no savings → a flat $0 fan.
  if (maxBal < 2) {
    return (
      <p className="border-l-2 border-slate-300 py-1 pl-3 text-[11px] text-slate-500">
        {t('sheet.emptyMc')}
      </p>
    );
  }

  const x = (age: number) => MC_PAD.left + ((age - minAge) / span) * (MC_W - MC_PAD.left - MC_PAD.right);
  const y = (v: number) => MC_PAD.top + (1 - v / maxBal) * (MC_H - MC_PAD.top - MC_PAD.bottom);
  const bandPath = (upper: 'p90' | 'p75', lower: 'p10' | 'p25') => {
    const top = bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(b.age).toFixed(1)},${y(b[upper]).toFixed(1)}`).join(' ');
    const bottom = [...bands].reverse().map(b => `L${x(b.age).toFixed(1)},${y(b[lower]).toFixed(1)}`).join(' ');
    return `${top} ${bottom} Z`;
  };
  const median = bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(b.age).toFixed(1)},${y(b.p50).toFixed(1)}`).join(' ');

  const yTicks = [0, 0.5, 1].map(f => f * maxBal);
  const xStep = Math.max(1, Math.round(span / 10));
  const xTicks: number[] = [];
  for (let a = minAge; a <= bandMaxAge; a += xStep) xTicks.push(a);

  return (
    <div>
      <div className="mb-1 text-[12px]">
        <Trans
          i18nKey="sheet.mcFunded"
          ns="print"
          values={{ pct: (results.successRate * 100).toFixed(1), runs: results.runs, age: maxAge }}
          components={{ strong: <strong /> }}
        />
        {' '}· {t('sheet.mcMedian')} <strong>{fmt(results.medianFinalBalance, locale)}</strong>
        {' '}· {t('sheet.mcVol', { vol: (results.volatility * 100).toFixed(1) })}
      </div>
      <svg viewBox={`0 0 ${MC_W} ${MC_H}`} className="h-auto w-full">
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line x1={MC_PAD.left} x2={MC_W - MC_PAD.right} y1={y(tick)} y2={y(tick)} stroke={HAIRLINE} strokeWidth="1" />
            <text x={MC_PAD.left - 5} y={y(tick) + 3} textAnchor="end" fontSize="9" fill={MUTED}>{fmtShort(tick)}</text>
          </g>
        ))}
        {xTicks.map(a => (
          <text key={a} x={x(a)} y={MC_H - 6} textAnchor="middle" fontSize="9" fill={MUTED}>{a}</text>
        ))}
        <path d={bandPath('p90', 'p10')} fill={BLUE} opacity="0.12" />
        <path d={bandPath('p75', 'p25')} fill={BLUE} opacity="0.22" />
        <path d={median} fill="none" stroke={BLUE} strokeWidth="1.8" />
        <line
          x1={x(retirementAge)} x2={x(retirementAge)}
          y1={MC_PAD.top} y2={MC_H - MC_PAD.bottom}
          stroke={FAINT} strokeWidth="1" strokeDasharray="4 3"
        />
        <text x={x(retirementAge) + 4} y={MC_PAD.top + 9} fontSize="9" fill={MUTED}>{t('sheet.retire')}</text>
      </svg>
      <div className="mt-0.5 flex gap-3.5 text-[9px] text-slate-600">
        <span>■ {t('sheet.p1090')}</span>
        <span className="opacity-80">■ {t('sheet.p2575')}</span>
        <span>— {t('sheet.median')}</span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- milestones --

interface Milestone {
  age: number;
  label: string;
  detail: string;
}

// Major spending-relevant milestones in age order: retirement, benefit start
// ages, RRIF conversion, spending-phase changes and one-time cash events.
function buildMilestones(inputs: RetirementInputs, rrifConversionAge: number, t: TFunction<'print'>, locale: string): Milestone[] {
  const list: Milestone[] = [];

  list.push({
    age: inputs.retirementAge,
    label: t('sheet.retirement'),
    detail: t('sheet.retirementDetail', { amount: fmt(inputs.desiredSpending, locale) }),
  });

  if (inputs.cppStartAge != null) {
    const amount = fmt(inputs.cppMonthlyAmount * 12, locale);
    list.push({
      age: inputs.cppStartAge,
      label: t('sheet.cppStarts'),
      detail: inputs.cppStartAge !== 65
        ? t('sheet.cppDetailAdjusted', { amount, age: inputs.cppStartAge })
        : t('sheet.cppDetail', { amount }),
    });
  }
  if (inputs.oasStartAge != null) {
    list.push({
      age: inputs.oasStartAge,
      label: t('sheet.oasStarts'),
      detail: inputs.oasStartAge !== 65
        ? t('sheet.oasDeferred', { age: inputs.oasStartAge })
        : t('sheet.oasStandard'),
    });
  }
  list.push({
    age: rrifConversionAge,
    label: t('sheet.rrifConversion'),
    detail: t('sheet.rrifDetail'),
  });

  for (const band of [...(inputs.spendingBands ?? [])].sort((a, b) => a.fromAge - b.fromAge)) {
    list.push({
      age: band.fromAge,
      label: t('sheet.spendingBand', { pct: Math.round(band.pctOfBase * 100) }),
      detail: t('sheet.spendingBandDetail', { amount: fmt(inputs.desiredSpending * band.pctOfBase, locale), age: band.fromAge }),
    });
  }

  for (const ev of inputs.events ?? []) {
    list.push({
      age: ev.age,
      label: ev.direction === 'in' ? t('sheet.inflow', { label: ev.label }) : t('sheet.expense', { label: ev.label }),
      detail: t('sheet.oneTime', { sign: ev.direction === 'in' ? '+' : '−', amount: fmt(ev.amount, locale) }),
    });
  }

  return list.sort((a, b) => a.age - b.age);
}

// ---------------------------------------------------------- detailed table --

// Right-aligned tabular figures on a hairline grid; heads carry the strong
// hairline. Zebra rows come from the conditional odd/even classes below.
const CELL = 'px-1.5 py-0.5 text-right whitespace-nowrap text-[9.5px] text-slate-700';
const HEAD_CELL = 'border-b border-slate-300 px-1.5 py-[3px] text-right whitespace-nowrap font-bold text-slate-600';

// One-line drill-down summary for a year's detail (print can't expand rows, so
// the same sections render as a compact inline list under the year's row).
function detailLine(row: YearlyBreakdown, t: TFunction<'print'>): string | null {
  const d = row.detail;
  if (!d) return null;
  const w = d.withdraw;
  const parts: string[] = [];
  const src: string[] = [];
  if (w.rrifMin > 0.5) src.push(`${t('sheet.acctRrifMin')} ${fmtShort(w.rrifMin)}`);
  if (w.rrif > 0.5) src.push(`${t('sheet.acctRrif')} ${fmtShort(w.rrif)}`);
  if (w.rrsp > 0.5) src.push(`${t('sheet.acctRrsp')} ${fmtShort(w.rrsp)}`);
  if (w.tfsa > 0.5) src.push(`${t('sheet.acctTfsa')} ${fmtShort(w.tfsa)}`);
  if (w.taxable > 0.5) {
    src.push(`${t('sheet.acctTaxable')} ${fmtShort(w.taxable)}${d.tax.capitalGains > 0.5 ? ` (${t('sheet.gain', { amount: fmtShort(d.tax.capitalGains) })})` : ''}`);
  }
  if (w.cash > 0.5) src.push(`${t('sheet.acctCash')} ${fmtShort(w.cash)}`);
  if (w.rmDraw > 0.5) src.push(`${t('sheet.acctRm')} ${fmtShort(w.rmDraw)}`);
  if (src.length > 0) parts.push(`${t('sheet.from')}: ${src.join(' + ')}`);

  const g = d.growth;
  const growth: string[] = [];
  if (g.rrsp > 0.5) growth.push(`${t('sheet.acctRrsp')} ${fmtShort(g.rrsp)}`);
  if (g.rrif > 0.5) growth.push(`${t('sheet.acctRrif')} ${fmtShort(g.rrif)}`);
  if (g.tfsa > 0.5) growth.push(`${t('sheet.acctTfsa')} ${fmtShort(g.tfsa)}`);
  if (g.taxable > 0.5) growth.push(`${t('sheet.acctTaxable')} ${fmtShort(g.taxable)}`);
  if (g.cash > 0.5) growth.push(`${t('sheet.acctCash')} ${fmtShort(g.cash)}`);
  if (growth.length > 0) parts.push(`${t('sheet.growth')}: ${growth.join(', ')}`);

  if (d.tax.oasClawback > 0.5) parts.push(t('sheet.oasClawback', { amount: fmtShort(d.tax.oasClawback) }));
  if (d.rm) {
    parts.push(t('sheet.rmLoan', { loan: fmtShort(d.rm.loanBalance), interest: fmtShort(d.rm.interestAccrued) }));
  }
  for (const ev of d.events) {
    parts.push(`${ev.label} ${ev.direction === 'in' ? '+' : '−'}${fmtShort(ev.amount)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

// The full year-by-year table with per-year drill-down lines, for the print
// option. Renders per person when a spouse is enabled.
function DetailedTablePrint({ results, spouseAgeOffset, t }: {
  results: RetirementResults;
  spouseAgeOffset: number;
  t: TFunction<'print'>;
}) {
  const people: Array<{ label: string; rows: YearlyBreakdown[] }> = [
    { label: results.spouse ? t('sheet.you') : '', rows: results.yearlyBreakdown },
  ];
  if (results.spouse) people.push({ label: t('sheet.spouse'), rows: results.spouse.yearlyBreakdown });

  const money = (v: number) => fmtShort(v);
  // RM columns appear only when the feature produced them (matches ScheduleTable).
  const hasRm = people.some(p => p.rows.some(r => r.netHomeEquity !== undefined));
  // RDSP column appears only when a person has an RDSP (matches ScheduleTable).
  const hasRdsp = people.some(p => p.rows.some(r => r.rdspBalance !== undefined));
  // FHSA column appears only when a person has an FHSA (matches ScheduleTable).
  const hasFhsa = people.some(p => p.rows.some(r => r.fhsaBalance !== undefined));
  const colSpan = 17 + (hasRm ? 1 : 0) + (hasRdsp ? 1 : 0) + (hasFhsa ? 1 : 0);
  const n = Math.abs(spouseAgeOffset);
  return (
    <div className="mt-3.5">
      <div className={SECTION_TITLE}>{t('sheet.detailed')}</div>
      {people.map(person => (
        <div key={person.label || 'single'} className="mb-2.5">
          {person.label && (
            <div className="mb-0.5 mt-1.5 text-[11px] font-bold text-slate-900">{person.label}</div>
          )}
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${HEAD_CELL} text-left`}>{t('sheet.colAge')}</th>
                <th className={HEAD_CELL}>{t('sheet.colStart')}</th>
                <th className={HEAD_CELL}>{t('sheet.colContrib')}</th>
                <th className={HEAD_CELL}>{t('sheet.colGains')}</th>
                <th className={HEAD_CELL}>{t('sheet.colTarget')}</th>
                <th className={HEAD_CELL}>{t('sheet.colWithdrawn')}</th>
                <th className={HEAD_CELL}>{t('sheet.colTax')}</th>
                <th className={HEAD_CELL}>{t('sheet.colCpp')}</th>
                <th className={HEAD_CELL}>{t('sheet.colOas')}</th>
                <th className={HEAD_CELL}>{t('sheet.colGis')}</th>
                <th className={HEAD_CELL}>{t('sheet.colPension')}</th>
                <th className={HEAD_CELL}>{t('sheet.colEnd')}</th>
                <th className={HEAD_CELL}>{t('sheet.colRrsp')}</th>
                <th className={HEAD_CELL}>{t('sheet.colRrif')}</th>
                <th className={HEAD_CELL}>{t('sheet.colTfsa')}</th>
                <th className={HEAD_CELL}>{t('sheet.colTaxable')}</th>
                <th className={HEAD_CELL}>{t('sheet.colCash')}</th>
                {hasRdsp && <th className={HEAD_CELL} title={t('sheet.rdspTitle')}>{t('sheet.colRdsp')}</th>}
                {hasFhsa && <th className={HEAD_CELL} title={t('sheet.fhsaTitle')}>{t('sheet.colFhsa')}</th>}
                {hasRm && <th className={HEAD_CELL}>{t('sheet.colHomeEq')}</th>}
              </tr>
            </thead>
            <tbody>
              {person.rows.map((row, i) => {
                const detail = detailLine(row, t);
                const zebra = i % 2 === 0 ? 'bg-white' : 'bg-slate-50';
                return [
                  <tr key={`r${i}`} className={`border-t border-slate-200 ${zebra}`}>
                    <td className={`${CELL} ${NUM} text-left font-semibold`}>{row.age}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.startingBalance)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.contributions)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.marketGains)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.spendingTarget)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.withdrawals)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.incomeTax)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.cppIncome)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.oasIncome)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.gisIncome)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.pensionIncome)}</td>
                    <td className={`${CELL} ${NUM} font-bold`}>{money(row.endingBalance)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.rrspBalance)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.rrifBalance)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.tfsaBalance)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.taxableBalance)}</td>
                    <td className={`${CELL} ${NUM}`}>{money(row.cashCushionBalance)}</td>
                    {hasRdsp && (
                      <td className={`${CELL} ${NUM}`}
                        title={row.detail?.rdsp ? t('sheet.rdspCell', { amount: fmtShort(row.detail.rdsp.contributionBasis) }) : undefined}>
                        {row.rdspBalance !== undefined ? money(row.rdspBalance) : '—'}
                      </td>
                    )}
                    {hasFhsa && (
                      <td className={`${CELL} ${NUM}`}
                        title={row.detail?.fhsa ? t('sheet.fhsaCell', { amount: fmtShort(row.detail.fhsa.contributionBasis) }) : undefined}>
                        {row.fhsaBalance !== undefined ? money(row.fhsaBalance) : '—'}
                      </td>
                    )}
                    {hasRm && (
                      <td className={`${CELL} ${NUM} ${(row.netHomeEquity ?? 0) < 0 ? 'font-semibold text-rose-700' : ''}`}>
                        {row.netHomeEquity !== undefined ? money(row.netHomeEquity) : '—'}
                      </td>
                    )}
                  </tr>,
                  detail ? (
                    <tr key={`d${i}`} className={zebra}>
                      <td colSpan={colSpan} className="px-1.5 pb-0.5 pl-4 text-[8.5px] text-slate-500">
                        {detail}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      ))}
      <div className="mt-0.5 text-[9px] text-slate-400">
        {spouseAgeOffset !== 0
          ? t('sheet.spouseNoteOffset', {
              n,
              unit: t('sheet.year', { count: n }),
              rel: spouseAgeOffset > 0 ? t('sheet.younger') : t('sheet.older'),
            })
          : t('sheet.spouseNote')}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- main --

// Rendered only when printing (see the `print-only` rule in index.css). A
// compact plan summary: inputs, verdict, depletion — plus optional sections
// chosen in the print-options card (timeline chart, Monte Carlo fan,
// milestones table).
export function PrintSummary({ scenarioName, inputs, results, householdBreakdown, options, mcResults, rrifConversionAge }: {
  scenarioName: string;
  inputs: RetirementInputs;
  results: RetirementResults;
  householdBreakdown: YearlyBreakdown[];
  options: PrintOptions;
  mcResults: MonteCarloResults | null;
  rrifConversionAge: number;
}) {
  const { t } = useTranslation('print');
  const { locale } = useAppLocale();
  const spouseAgeOffset = inputs.currentAge - (inputs.spouse?.currentAge ?? inputs.currentAge);
  const spouse = results.spouse;
  const rmOn = inputs.reverseMortgage?.enabled === true;
  // Debts shown only when at least one carries a balance (matches the input UI).
  const debts = (inputs.debts ?? []).filter(d => d.balance > 0.5);
  const debtsOn = debts.length > 0;
  const totalDebtBalance = debts.reduce((s, d) => s + d.balance, 0);
  const totalDebtMonthly = debts.reduce((s, d) => s + Math.max(0, d.monthlyPayment), 0);
  const today = new Date().toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  const milestones = options.includeMilestones ? buildMilestones(inputs, rrifConversionAge, t, locale) : [];
  const statusLabel = results.status === 'ON_TRACK' ? t('sheet.onTrack') : t('sheet.shortfall');

  return (
    <div className="print-only p-2 text-slate-900">
      {/* The wordmark: square ink block, same as the on-screen header. The
          rule under it is INK — structure, not the verdict accent. */}
      <div className="mb-3 flex items-center gap-2 border-b-2 border-slate-900 pb-1.5">
        <div className="flex h-[22px] w-[22px] items-center justify-center bg-slate-900 text-[9px] font-bold text-white">RE:</div>
        <div>
          <div className="text-[15px] font-bold">{t('sheet.title')}</div>
          <div className="text-[11px] text-slate-500">{t('sheet.generated', { name: scenarioName, date: today })}</div>
        </div>
      </div>

      {/* Verdict first (guide principle 1): the answer leads the sheet. */}
      <div className="flex gap-6">
        <div className="flex-1">
          <div className={SECTION_TITLE}>{t('sheet.verdict')}</div>
          <table className="border-collapse text-[12px]">
            <tbody>
              <Row label={t('sheet.status')} value={statusLabel} />
              <Row label={t('sheet.wealth')} value={fmt(results.totalNetWorthAtRetirement + (spouse?.totalNetWorthAtRetirement ?? 0), locale)} />
              <Row label={t('sheet.lastsUntil')} value={results.depletionAge ? t('sheet.age', { age: results.depletionAge }) : t('sheet.agePlus', { age: inputs.maxAge })} />
              <Row label={t('sheet.withdrawal')} value={`${(results.withdrawalRate * 100).toFixed(1)}%`} />
              <Row label={t('sheet.expectedReturn')} value={`${(inputs.investmentReturn * 100).toFixed(1)}%`} />
            </tbody>
          </table>
        </div>

        <div className="flex-1">
          <div className={SECTION_TITLE}>{t('sheet.profile')}</div>
          <table className="border-collapse text-[12px]">
            <tbody>
              <Row label={t('sheet.currentAge')} value={String(inputs.currentAge)} />
              <Row label={t('sheet.retirementAge')} value={String(inputs.retirementAge)} />
              <Row label={t('sheet.projectionTo')} value={String(inputs.maxAge)} />
              <Row label={t('sheet.province')} value={inputs.provinceCode} />
              <Row label={t('sheet.desiredSpending')} value={fmt(inputs.desiredSpending, locale)} />
              {spouse && <Row label={t('sheet.spouse')} value={t('sheet.spouseValue', { age: inputs.spouse?.currentAge, ret: inputs.spouse?.retirementAge })} />}
            </tbody>
          </table>
        </div>

        <div className="flex-1">
          <div className={SECTION_TITLE}>{t('sheet.savings')}</div>
          <table className="border-collapse text-[12px]">
            <tbody>
              <Row label={t('sheet.rrsp')} value={fmt(inputs.rrspBalance, locale)} />
              <Row label={t('sheet.tfsa')} value={fmt(inputs.tfsaBalance, locale)} />
              <Row label={t('sheet.taxable')} value={fmt(inputs.taxableBalance, locale)} />
              <Row label={t('sheet.cashCushion')} value={fmt(inputs.cashCushionBalance, locale)} />
              <Row label={t('sheet.total')} value={fmt(inputs.rrspBalance + inputs.tfsaBalance + inputs.taxableBalance + inputs.cashCushionBalance, locale)} />
              {rmOn && (
                <Row label={t('sheet.homeRm')} value={fmt(inputs.reverseMortgage!.homeValue, locale)} />
              )}
              {debtsOn && (
                <Row
                  label={t('sheet.debts', { count: debts.length })}
                  value={t('sheet.debtsValue', { balance: fmt(totalDebtBalance, locale), monthly: fmt(totalDebtMonthly, locale) })}
                />
              )}
            </tbody>
          </table>
        </div>
      </div>

      {options.includeTimeline && (
        <div className="mt-3.5 break-inside-avoid">
          <div className={SECTION_TITLE}>
            {rmOn ? t('sheet.timelineTitleRm') : t('sheet.timelineTitle')}
          </div>
          <TimelinePrintChart inputs={inputs} rows={householdBreakdown} t={t} />
        </div>
      )}

      {options.includeMonteCarlo && mcResults && (
        <div className="mt-3.5 break-inside-avoid">
          <div className={SECTION_TITLE}>{t('sheet.mcTitle')}</div>
          <MonteCarloPrintChart results={mcResults} retirementAge={inputs.retirementAge} maxAge={inputs.maxAge} t={t} locale={locale} />
        </div>
      )}

      {options.includeMilestones && milestones.length > 0 && (
        <div className="mt-3.5 break-inside-avoid">
          <div className={SECTION_TITLE}>{t('sheet.milestonesTitle')}</div>
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              {milestones.map((m, i) => (
                <tr key={i} className={i === 0 ? '' : 'border-t border-slate-200'}>
                  <td className="w-[60px] whitespace-nowrap py-0.5 pr-3 font-bold">{t('sheet.ageRow', { age: m.age })}</td>
                  <td className="whitespace-nowrap py-0.5 pr-3 font-semibold">{m.label}</td>
                  <td className="py-0.5 text-slate-600">{m.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {options.includeDetailedTable && (
        <DetailedTablePrint results={results} spouseAgeOffset={spouseAgeOffset} t={t} />
      )}

      <div className="mt-3 text-[11px] leading-snug text-slate-500">
        {t('sheet.footer', {
          cpp: inputs.cppStartAge ?? '—',
          oas: inputs.oasStartAge ?? '—',
          province: inputs.provinceCode,
        })}
      </div>
    </div>
  );
}
