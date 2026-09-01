import type { RetirementInputs, RetirementResults, YearlyBreakdown } from '@retired/engine-core/retirementEngine';
import type { MonteCarloResults } from '@retired/engine-core/monteCarlo';
import type { PrintOptions } from '../lib/printOptions';
import { BLUE, AMBER_TEXT, MUTED, FAINT, HAIRLINE } from '../design/tokens';

// The print sheet (hidden on screen — see the `print-only` rule in index.css).
// Composes the same visual language as the app (tokens.ts / the slate+blue
// scale) via Tailwind classes; the only raw values left are SVG paint
// attributes, which read the token constants directly. No inline styles.

function fmt(value: number): string {
  return new Intl.NumberFormat('en-CA', {
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

// Uppercase blue section label — the print twin of cls.sectionLabel (blue
// carries it here because print is monochrome-adjacent and the label must
// still read as structure).
const SECTION_TITLE = 'text-[11px] font-bold uppercase tracking-[0.05em] text-blue-700 mb-1';
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
function TimelinePrintChart({ inputs, rows }: {
  inputs: RetirementInputs;
  rows: YearlyBreakdown[];
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
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={TL_PAD.left} x2={TL_W - TL_PAD.right} y1={y(t)} y2={y(t)} stroke={HAIRLINE} strokeWidth="1" />
            <text x={TL_PAD.left - 5} y={y(t) + 3} textAnchor="end" fontSize="9" fill={MUTED}>{fmtShort(t)}</text>
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
          retire {inputs.retirementAge}
        </text>
      </svg>
      <div className="mt-0.5 flex gap-3.5 text-[9px] text-slate-600">
        <span className="text-blue-700">— {hasRm ? 'total cash (portfolio + home equity)' : 'portfolio'}</span>
        {hasRm && <span className="text-blue-700/45">— portfolio</span>}
        {hasRm && <span className="text-amber-700">–– net home equity</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ monte carlo --

const MC_W = 700;
const MC_H = 190;
const MC_PAD = { top: 10, right: 10, bottom: 20, left: 52 };

// Static print rendering of the Monte Carlo percentile fan + success rate.
function MonteCarloPrintChart({ results, retirementAge, maxAge }: {
  results: MonteCarloResults;
  retirementAge: number;
  maxAge: number;
}) {
  const bands = results.percentileBands;
  if (bands.length < 2) return null;
  const minAge = bands[0].age;
  const bandMaxAge = bands[bands.length - 1].age;
  const span = Math.max(1, bandMaxAge - minAge);
  const maxBal = Math.max(1, ...bands.map(b => b.p90));

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
        <strong>{(results.successRate * 100).toFixed(1)}%</strong> of {results.runs} runs funded to age {maxAge}
        {' '}· median final balance <strong>{fmt(results.medianFinalBalance)}</strong>
        {' '}· {(results.volatility * 100).toFixed(1)}% volatility, fat-tailed (Student-t)
      </div>
      <svg viewBox={`0 0 ${MC_W} ${MC_H}`} className="h-auto w-full">
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={MC_PAD.left} x2={MC_W - MC_PAD.right} y1={y(t)} y2={y(t)} stroke={HAIRLINE} strokeWidth="1" />
            <text x={MC_PAD.left - 5} y={y(t) + 3} textAnchor="end" fontSize="9" fill={MUTED}>{fmtShort(t)}</text>
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
        <text x={x(retirementAge) + 4} y={MC_PAD.top + 9} fontSize="9" fill={MUTED}>retire</text>
      </svg>
      <div className="mt-0.5 flex gap-3.5 text-[9px] text-slate-600">
        <span>■ 10th–90th percentile</span>
        <span className="opacity-80">■ 25th–75th percentile</span>
        <span>— median</span>
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
function buildMilestones(inputs: RetirementInputs, rrifConversionAge: number): Milestone[] {
  const list: Milestone[] = [];

  list.push({
    age: inputs.retirementAge,
    label: 'Retirement',
    detail: `contributions stop; withdrawals begin toward ${fmt(inputs.desiredSpending)}/yr spending (today's $)`
  });

  if (inputs.cppStartAge != null) {
    list.push({
      age: inputs.cppStartAge,
      label: 'CPP starts',
      detail: `${fmt(inputs.cppMonthlyAmount * 12)}/yr at age 65 basis${inputs.cppStartAge !== 65 ? ` (adjusted for age ${inputs.cppStartAge})` : ''}`
    });
  }
  if (inputs.oasStartAge != null) {
    list.push({
      age: inputs.oasStartAge,
      label: 'OAS starts',
      detail: inputs.oasStartAge !== 65 ? `deferred to ${inputs.oasStartAge} (+0.6%/month past 65)` : 'standard age 65'
    });
  }
  list.push({
    age: rrifConversionAge,
    label: 'RRIF conversion',
    detail: 'RRSP converts to RRIF; mandatory minimum withdrawals begin'
  });

  for (const band of [...(inputs.spendingBands ?? [])].sort((a, b) => a.fromAge - b.fromAge)) {
    list.push({
      age: band.fromAge,
      label: `Spending → ${Math.round(band.pctOfBase * 100)}%`,
      detail: `${fmt(inputs.desiredSpending * band.pctOfBase)}/yr (today's $) from age ${band.fromAge}`
    });
  }

  for (const ev of inputs.events ?? []) {
    list.push({
      age: ev.age,
      label: ev.direction === 'in' ? `${ev.label} (inflow)` : `${ev.label} (expense)`,
      detail: `${ev.direction === 'in' ? '+' : '−'}${fmt(ev.amount)} one-time`
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
function detailLine(row: YearlyBreakdown): string | null {
  const d = row.detail;
  if (!d) return null;
  const w = d.withdraw;
  const parts: string[] = [];
  const src: string[] = [];
  if (w.rrifMin > 0.5) src.push(`RRIF min ${fmtShort(w.rrifMin)}`);
  if (w.rrif > 0.5) src.push(`RRIF ${fmtShort(w.rrif)}`);
  if (w.rrsp > 0.5) src.push(`RRSP ${fmtShort(w.rrsp)}`);
  if (w.tfsa > 0.5) src.push(`TFSA ${fmtShort(w.tfsa)}`);
  if (w.taxable > 0.5) {
    src.push(`taxable ${fmtShort(w.taxable)}${d.tax.capitalGains > 0.5 ? ` (${fmtShort(d.tax.capitalGains)} gain)` : ''}`);
  }
  if (w.cash > 0.5) src.push(`cash ${fmtShort(w.cash)}`);
  if (w.rmDraw > 0.5) src.push(`rev. mortgage ${fmtShort(w.rmDraw)}`);
  if (src.length > 0) parts.push(`from: ${src.join(' + ')}`);

  const g = d.growth;
  const growth: string[] = [];
  if (g.rrsp > 0.5) growth.push(`RRSP ${fmtShort(g.rrsp)}`);
  if (g.rrif > 0.5) growth.push(`RRIF ${fmtShort(g.rrif)}`);
  if (g.tfsa > 0.5) growth.push(`TFSA ${fmtShort(g.tfsa)}`);
  if (g.taxable > 0.5) growth.push(`taxable ${fmtShort(g.taxable)}`);
  if (g.cash > 0.5) growth.push(`cash ${fmtShort(g.cash)}`);
  if (growth.length > 0) parts.push(`growth: ${growth.join(', ')}`);

  if (d.tax.oasClawback > 0.5) parts.push(`OAS clawback ${fmtShort(d.tax.oasClawback)}`);
  if (d.rm) {
    parts.push(`RM loan ${fmtShort(d.rm.loanBalance)} (interest ${fmtShort(d.rm.interestAccrued)})`);
  }
  for (const ev of d.events) {
    parts.push(`${ev.label} ${ev.direction === 'in' ? '+' : '−'}${fmtShort(ev.amount)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

// The full year-by-year table with per-year drill-down lines, for the print
// option. Renders per person when a spouse is enabled.
function DetailedTablePrint({ results, spouseAgeOffset }: {
  results: RetirementResults;
  spouseAgeOffset: number;
}) {
  const people: Array<{ label: string; rows: YearlyBreakdown[] }> = [
    { label: results.spouse ? 'You' : '', rows: results.yearlyBreakdown },
  ];
  if (results.spouse) people.push({ label: 'Spouse', rows: results.spouse.yearlyBreakdown });

  const money = (v: number) => fmtShort(v);
  // RM columns appear only when the feature produced them (matches ScheduleTable).
  const hasRm = people.some(p => p.rows.some(r => r.netHomeEquity !== undefined));
  // RDSP column appears only when a person has an RDSP (matches ScheduleTable).
  const hasRdsp = people.some(p => p.rows.some(r => r.rdspBalance !== undefined));
  // FHSA column appears only when a person has an FHSA (matches ScheduleTable).
  const hasFhsa = people.some(p => p.rows.some(r => r.fhsaBalance !== undefined));
  const colSpan = 17 + (hasRm ? 1 : 0) + (hasRdsp ? 1 : 0) + (hasFhsa ? 1 : 0);
  return (
    <div className="mt-3.5">
      <div className={SECTION_TITLE}>Detailed year-by-year</div>
      {people.map(person => (
        <div key={person.label || 'single'} className="mb-2.5">
          {person.label && (
            <div className="mb-0.5 mt-1.5 text-[11px] font-bold text-blue-700">{person.label}</div>
          )}
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${HEAD_CELL} text-left`}>Age</th>
                <th className={HEAD_CELL}>Start</th>
                <th className={HEAD_CELL}>Contrib.</th>
                <th className={HEAD_CELL}>Gains</th>
                <th className={HEAD_CELL}>Target</th>
                <th className={HEAD_CELL}>Withdrawn</th>
                <th className={HEAD_CELL}>Tax</th>
                <th className={HEAD_CELL}>CPP</th>
                <th className={HEAD_CELL}>OAS</th>
                <th className={HEAD_CELL}>GIS</th>
                <th className={HEAD_CELL}>Pension</th>
                <th className={HEAD_CELL}>End</th>
                <th className={HEAD_CELL}>RRSP</th>
                <th className={HEAD_CELL}>RRIF</th>
                <th className={HEAD_CELL}>TFSA</th>
                <th className={HEAD_CELL}>Taxable</th>
                <th className={HEAD_CELL}>Cash</th>
                {hasRdsp && <th className={HEAD_CELL} title="Registered Disability Savings Plan. Growth is tax-sheltered; on withdrawal the grant/bond/growth portion is taxable (only contribution principal is tax-free).">RDSP</th>}
                {hasFhsa && <th className={HEAD_CELL} title="First Home Savings Account. Contributions are deductible; growth is tax-sheltered. Transfers to the RRSP at retirement.">FHSA</th>}
                {hasRm && <th className={HEAD_CELL}>Home eq.</th>}
              </tr>
            </thead>
            <tbody>
              {person.rows.map((row, i) => {
                const detail = detailLine(row);
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
                        title={row.detail?.rdsp ? `Contribution basis ${fmtShort(row.detail.rdsp.contributionBasis)} (tax-free); the rest is taxable on withdrawal` : undefined}>
                        {row.rdspBalance !== undefined ? money(row.rdspBalance) : '—'}
                      </td>
                    )}
                    {hasFhsa && (
                      <td className={`${CELL} ${NUM}`}
                        title={row.detail?.fhsa ? `Contributed to date ${fmtShort(row.detail.fhsa.contributionBasis)}; transfers to the RRSP at retirement` : undefined}>
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
        Nominal (future) dollars of each year. Spouse years are their own ages
        {spouseAgeOffset !== 0 ? ` (spouse is ${Math.abs(spouseAgeOffset)} year${Math.abs(spouseAgeOffset) === 1 ? '' : 's'} ${spouseAgeOffset > 0 ? 'younger' : 'older'})` : ''}.
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
  const spouseAgeOffset = inputs.currentAge - (inputs.spouse?.currentAge ?? inputs.currentAge);
  const spouse = results.spouse;
  const rmOn = inputs.reverseMortgage?.enabled === true;
  // Debts shown only when at least one carries a balance (matches the input UI).
  const debts = (inputs.debts ?? []).filter(d => d.balance > 0.5);
  const debtsOn = debts.length > 0;
  const totalDebtBalance = debts.reduce((s, d) => s + d.balance, 0);
  const totalDebtMonthly = debts.reduce((s, d) => s + Math.max(0, d.monthlyPayment), 0);
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const milestones = options.includeMilestones ? buildMilestones(inputs, rrifConversionAge) : [];

  return (
    <div className="print-only p-2 text-slate-900">
      {/* The wordmark: square ink block, same as the on-screen header — no
          radius, and blue-700 (not the old blue-600) for the rule under it. */}
      <div className="mb-2.5 flex items-center gap-2 border-b-2 border-blue-700 pb-1.5">
        <div className="flex h-[22px] w-[22px] items-center justify-center bg-slate-900 text-[9px] font-bold text-white">RE:</div>
        <div>
          <div className="text-[15px] font-bold">RE: tired — Retirement Plan Summary</div>
          <div className="text-[11px] text-slate-500">{scenarioName} · generated {today}</div>
        </div>
      </div>

      <div className="flex gap-6">
        <div className="flex-1">
          <div className={SECTION_TITLE}>Profile</div>
          <table className="border-collapse text-[12px]">
            <tbody>
              <Row label="Current age" value={String(inputs.currentAge)} />
              <Row label="Retirement age" value={String(inputs.retirementAge)} />
              <Row label="Projection to age" value={String(inputs.maxAge)} />
              <Row label="Province" value={inputs.provinceCode} />
              <Row label="Desired spending (today's $)" value={fmt(inputs.desiredSpending)} />
              {spouse && <Row label="Spouse" value={`age ${inputs.spouse?.currentAge}, ret. ${inputs.spouse?.retirementAge}`} />}
            </tbody>
          </table>
        </div>

        <div className="flex-1">
          <div className={SECTION_TITLE}>Savings</div>
          <table className="border-collapse text-[12px]">
            <tbody>
              <Row label="RRSP" value={fmt(inputs.rrspBalance)} />
              <Row label="TFSA" value={fmt(inputs.tfsaBalance)} />
              <Row label="Taxable" value={fmt(inputs.taxableBalance)} />
              <Row label="Cash cushion" value={fmt(inputs.cashCushionBalance)} />
              <Row label="Total" value={fmt(inputs.rrspBalance + inputs.tfsaBalance + inputs.taxableBalance + inputs.cashCushionBalance)} />
              {rmOn && (
                <Row label="Home (reverse mtg.)" value={fmt(inputs.reverseMortgage!.homeValue)} />
              )}
              {debtsOn && (
                <Row
                  label={`Debts (${debts.length})`}
                  value={`${fmt(totalDebtBalance)} · ${fmt(totalDebtMonthly)}/mo`}
                />
              )}
            </tbody>
          </table>
        </div>

        <div className="flex-1">
          <div className={SECTION_TITLE}>Verdict</div>
          <table className="border-collapse text-[12px]">
            <tbody>
              <Row label="Status" value={results.status.replace('_', ' ')} />
              <Row label="Wealth at retirement" value={fmt(results.totalNetWorthAtRetirement + (spouse?.totalNetWorthAtRetirement ?? 0))} />
              <Row label="Money lasts until" value={results.depletionAge ? `age ${results.depletionAge}` : `age ${inputs.maxAge}+`} />
              <Row label="Withdrawal rate" value={`${(results.withdrawalRate * 100).toFixed(1)}%`} />
              <Row label="Expected return" value={`${(inputs.investmentReturn * 100).toFixed(1)}%`} />
            </tbody>
          </table>
        </div>
      </div>

      {options.includeTimeline && (
        <div className="mt-3.5 break-inside-avoid">
          <div className={SECTION_TITLE}>
            {rmOn
              ? 'Projection timeline — household portfolio & home equity by age'
              : 'Projection timeline — household portfolio by age'}
          </div>
          <TimelinePrintChart inputs={inputs} rows={householdBreakdown} />
        </div>
      )}

      {options.includeMonteCarlo && mcResults && (
        <div className="mt-3.5 break-inside-avoid">
          <div className={SECTION_TITLE}>Monte Carlo simulation</div>
          <MonteCarloPrintChart results={mcResults} retirementAge={inputs.retirementAge} maxAge={inputs.maxAge} />
        </div>
      )}

      {options.includeMilestones && milestones.length > 0 && (
        <div className="mt-3.5 break-inside-avoid">
          <div className={SECTION_TITLE}>Major spending milestones &amp; changes</div>
          <table className="w-full border-collapse text-[11px]">
            <tbody>
              {milestones.map((m, i) => (
                <tr key={i} className={i === 0 ? '' : 'border-t border-slate-200'}>
                  <td className="w-[60px] whitespace-nowrap py-0.5 pr-3 font-bold">Age {m.age}</td>
                  <td className="whitespace-nowrap py-0.5 pr-3 font-semibold">{m.label}</td>
                  <td className="py-0.5 text-slate-600">{m.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {options.includeDetailedTable && (
        <DetailedTablePrint results={results} spouseAgeOffset={spouseAgeOffset} />
      )}

      <div className="mt-3 text-[11px] leading-snug text-slate-500">
        CPP from age {inputs.cppStartAge ?? '—'} · OAS from {inputs.oasStartAge ?? '—'} ·
        inflation-adjusted spending · Canadian federal + {inputs.provinceCode} provincial tax.
        {' '}Estimates only — not financial advice.
      </div>
    </div>
  );
}
