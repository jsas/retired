import type { RetirementInputs, RetirementResults, YearlyBreakdown } from '../lib/retirementEngine';
import type { MonteCarloResults } from '../lib/monteCarlo';
import type { PrintOptions } from '../lib/printOptions';

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '2px 12px 2px 0', color: '#475569' }}>{label}</td>
      <td style={{ fontWeight: 600, textAlign: 'right' }}>{value}</td>
    </tr>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.05em', color: '#2563eb', marginBottom: '4px'
};

// ---------------------------------------------------------------- timeline --

const TL_W = 700;
const TL_H = 170;
const TL_PAD = { top: 10, right: 10, bottom: 20, left: 52 };

// Static (print-only) rendering of the projection timeline: total balance by
// age with a retirement-age marker. Drawn from yearlyBreakdown, so it matches
// the on-screen chart without its drag handles.
function TimelinePrintChart({ inputs, results }: {
  inputs: RetirementInputs;
  results: RetirementResults;
}) {
  const rows = results.yearlyBreakdown;
  if (rows.length < 2) return null;
  const spouse = results.spouse;
  const minAge = rows[0].age;
  const maxAge = rows[rows.length - 1].age;
  const span = Math.max(1, maxAge - minAge);
  const total = rows.map((r, i) => r.endingBalance + (spouse?.yearlyBreakdown[i]?.endingBalance ?? 0));
  const maxBal = Math.max(1, ...total);

  const x = (age: number) => TL_PAD.left + ((age - minAge) / span) * (TL_W - TL_PAD.left - TL_PAD.right);
  const y = (v: number) => TL_PAD.top + (1 - v / maxBal) * (TL_H - TL_PAD.top - TL_PAD.bottom);
  const line = rows.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(r.age).toFixed(1)},${y(total[i]).toFixed(1)}`).join(' ');
  const area = `${line} L${x(maxAge).toFixed(1)},${y(0).toFixed(1)} L${x(minAge).toFixed(1)},${y(0).toFixed(1)} Z`;

  const yTicks = [0, 0.5, 1].map(f => f * maxBal);
  const xStep = Math.max(1, Math.round(span / 10));
  const xTicks: number[] = [];
  for (let a = minAge; a <= maxAge; a += xStep) xTicks.push(a);

  return (
    <svg viewBox={`0 0 ${TL_W} ${TL_H}`} style={{ width: '100%', height: 'auto' }}>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={TL_PAD.left} x2={TL_W - TL_PAD.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
          <text x={TL_PAD.left - 5} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#64748b">{fmtShort(t)}</text>
        </g>
      ))}
      {xTicks.map(a => (
        <text key={a} x={x(a)} y={TL_H - 6} textAnchor="middle" fontSize="9" fill="#64748b">{a}</text>
      ))}
      <path d={area} fill="#3b82f6" opacity="0.12" />
      <path d={line} fill="none" stroke="#1d4ed8" strokeWidth="1.8" />
      <line
        x1={x(inputs.retirementAge)} x2={x(inputs.retirementAge)}
        y1={TL_PAD.top} y2={TL_H - TL_PAD.bottom}
        stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3"
      />
      <text x={x(inputs.retirementAge) + 4} y={TL_PAD.top + 9} fontSize="9" fill="#64748b">
        retire {inputs.retirementAge}
      </text>
    </svg>
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
      <div style={{ fontSize: '12px', marginBottom: '4px' }}>
        <strong>{(results.successRate * 100).toFixed(1)}%</strong> of {results.runs} runs funded to age {maxAge}
        {' '}· median final balance <strong>{fmt(results.medianFinalBalance)}</strong>
        {' '}· {(results.volatility * 100).toFixed(1)}% volatility, fat-tailed (Student-t)
      </div>
      <svg viewBox={`0 0 ${MC_W} ${MC_H}`} style={{ width: '100%', height: 'auto' }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={MC_PAD.left} x2={MC_W - MC_PAD.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={MC_PAD.left - 5} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#64748b">{fmtShort(t)}</text>
          </g>
        ))}
        {xTicks.map(a => (
          <text key={a} x={x(a)} y={MC_H - 6} textAnchor="middle" fontSize="9" fill="#64748b">{a}</text>
        ))}
        <path d={bandPath('p90', 'p10')} fill="#3b82f6" opacity="0.12" />
        <path d={bandPath('p75', 'p25')} fill="#3b82f6" opacity="0.22" />
        <path d={median} fill="none" stroke="#1d4ed8" strokeWidth="1.8" />
        <line
          x1={x(retirementAge)} x2={x(retirementAge)}
          y1={MC_PAD.top} y2={MC_H - MC_PAD.bottom}
          stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3"
        />
        <text x={x(retirementAge) + 4} y={MC_PAD.top + 9} fontSize="9" fill="#64748b">retire</text>
      </svg>
      <div style={{ display: 'flex', gap: '14px', fontSize: '9px', color: '#475569', marginTop: '2px' }}>
        <span>■ 10th–90th percentile</span>
        <span style={{ opacity: 0.8 }}>■ 25th–75th percentile</span>
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

const CELL: React.CSSProperties = {
  padding: '2px 6px', textAlign: 'right', fontFamily: 'monospace',
  fontSize: '9.5px', whiteSpace: 'nowrap', color: '#334155'
};
const HEAD_CELL: React.CSSProperties = {
  ...CELL, fontFamily: 'inherit', fontWeight: 700, color: '#475569',
  borderBottom: '1px solid #cbd5e1', padding: '3px 6px'
};

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
  return (
    <div style={{ marginTop: '14px' }}>
      <div style={sectionTitle}>Detailed year-by-year</div>
      {people.map(person => (
        <div key={person.label || 'single'} style={{ marginBottom: '10px' }}>
          {person.label && (
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#1d4ed8', margin: '6px 0 2px' }}>{person.label}</div>
          )}
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...HEAD_CELL, textAlign: 'left' }}>Age</th>
                <th style={HEAD_CELL}>Start</th>
                <th style={HEAD_CELL}>Contrib.</th>
                <th style={HEAD_CELL}>Gains</th>
                <th style={HEAD_CELL}>Target</th>
                <th style={HEAD_CELL}>Withdrawn</th>
                <th style={HEAD_CELL}>Tax</th>
                <th style={HEAD_CELL}>CPP</th>
                <th style={HEAD_CELL}>OAS</th>
                <th style={HEAD_CELL}>GIS</th>
                <th style={HEAD_CELL}>Pension</th>
                <th style={HEAD_CELL}>End</th>
                <th style={HEAD_CELL}>RRSP</th>
                <th style={HEAD_CELL}>RRIF</th>
                <th style={HEAD_CELL}>TFSA</th>
                <th style={HEAD_CELL}>Taxable</th>
                <th style={HEAD_CELL}>Cash</th>
              </tr>
            </thead>
            <tbody>
              {person.rows.map((row, i) => {
                const detail = detailLine(row);
                return [
                  <tr key={`r${i}`} style={{ borderTop: '1px solid #e2e8f0', background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    <td style={{ ...CELL, textAlign: 'left', fontWeight: 600 }}>{row.age}</td>
                    <td style={CELL}>{money(row.startingBalance)}</td>
                    <td style={CELL}>{money(row.contributions)}</td>
                    <td style={CELL}>{money(row.marketGains)}</td>
                    <td style={CELL}>{money(row.spendingTarget)}</td>
                    <td style={CELL}>{money(row.withdrawals)}</td>
                    <td style={CELL}>{money(row.incomeTax)}</td>
                    <td style={CELL}>{money(row.cppIncome)}</td>
                    <td style={CELL}>{money(row.oasIncome)}</td>
                    <td style={CELL}>{money(row.gisIncome)}</td>
                    <td style={CELL}>{money(row.pensionIncome)}</td>
                    <td style={{ ...CELL, fontWeight: 700 }}>{money(row.endingBalance)}</td>
                    <td style={CELL}>{money(row.rrspBalance)}</td>
                    <td style={CELL}>{money(row.rrifBalance)}</td>
                    <td style={CELL}>{money(row.tfsaBalance)}</td>
                    <td style={CELL}>{money(row.taxableBalance)}</td>
                    <td style={CELL}>{money(row.cashCushionBalance)}</td>
                  </tr>,
                  detail ? (
                    <tr key={`d${i}`} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                      <td colSpan={17} style={{ padding: '0 6px 2px 18px', fontSize: '8.5px', color: '#64748b' }}>
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
      <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '2px' }}>
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
export function PrintSummary({ scenarioName, inputs, results, options, mcResults, rrifConversionAge }: {
  scenarioName: string;
  inputs: RetirementInputs;
  results: RetirementResults;
  options: PrintOptions;
  mcResults: MonteCarloResults | null;
  rrifConversionAge: number;
}) {
  const spouseAgeOffset = inputs.currentAge - (inputs.spouse?.currentAge ?? inputs.currentAge);
  const spouse = results.spouse;
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const milestones = options.includeMilestones ? buildMilestones(inputs, rrifConversionAge) : [];

  return (
    <div className="print-only" style={{ fontFamily: 'system-ui, sans-serif', color: '#0f172a', padding: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '2px solid #2563eb', paddingBottom: '6px', marginBottom: '10px' }}>
        <div style={{ width: '22px', height: '22px', background: '#2563eb', borderRadius: '4px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '9px' }}>RE:</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>RE: tired — Retirement Plan Summary</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>{scenarioName} · generated {today}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px' }}>
        <div style={{ flex: 1 }}>
          <div style={sectionTitle}>Profile</div>
          <table style={{ fontSize: '12px', borderCollapse: 'collapse' }}>
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

        <div style={{ flex: 1 }}>
          <div style={sectionTitle}>Savings</div>
          <table style={{ fontSize: '12px', borderCollapse: 'collapse' }}>
            <tbody>
              <Row label="RRSP" value={fmt(inputs.rrspBalance)} />
              <Row label="TFSA" value={fmt(inputs.tfsaBalance)} />
              <Row label="Taxable" value={fmt(inputs.taxableBalance)} />
              <Row label="Cash cushion" value={fmt(inputs.cashCushionBalance)} />
              <Row label="Total" value={fmt(inputs.rrspBalance + inputs.tfsaBalance + inputs.taxableBalance + inputs.cashCushionBalance)} />
            </tbody>
          </table>
        </div>

        <div style={{ flex: 1 }}>
          <div style={sectionTitle}>Verdict</div>
          <table style={{ fontSize: '12px', borderCollapse: 'collapse' }}>
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
        <div style={{ marginTop: '14px', breakInside: 'avoid' }}>
          <div style={sectionTitle}>Projection timeline — household balance by age</div>
          <TimelinePrintChart inputs={inputs} results={results} />
        </div>
      )}

      {options.includeMonteCarlo && mcResults && (
        <div style={{ marginTop: '14px', breakInside: 'avoid' }}>
          <div style={sectionTitle}>Monte Carlo simulation</div>
          <MonteCarloPrintChart results={mcResults} retirementAge={inputs.retirementAge} maxAge={inputs.maxAge} />
        </div>
      )}

      {options.includeMilestones && milestones.length > 0 && (
        <div style={{ marginTop: '14px', breakInside: 'avoid' }}>
          <div style={sectionTitle}>Major spending milestones &amp; changes</div>
          <table style={{ fontSize: '11px', borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {milestones.map((m, i) => (
                <tr key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid #e2e8f0' }}>
                  <td style={{ padding: '3px 12px 3px 0', fontWeight: 700, whiteSpace: 'nowrap', width: '60px' }}>Age {m.age}</td>
                  <td style={{ padding: '3px 12px 3px 0', fontWeight: 600, whiteSpace: 'nowrap' }}>{m.label}</td>
                  <td style={{ padding: '3px 0', color: '#475569' }}>{m.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {options.includeDetailedTable && (
        <DetailedTablePrint results={results} spouseAgeOffset={spouseAgeOffset} />
      )}

      <div style={{ marginTop: '12px', fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
        CPP from age {inputs.cppStartAge ?? '—'} · OAS from {inputs.oasStartAge ?? '—'} ·
        inflation-adjusted spending · Canadian federal + {inputs.provinceCode} provincial tax.
        {' '}Estimates only — not financial advice.
      </div>
    </div>
  );
}
