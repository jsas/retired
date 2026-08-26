import { useMemo, useState } from 'react';
import { Calculator } from 'lucide-react';
import type { RetirementInputs, RetirementResults, YearlyBreakdown } from '../lib/retirementEngine';

interface MathPageProps {
  inputs: RetirementInputs;
  results: RetirementResults;
  spouseAgeOffset: number;
}

function fmt(v: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: 'CAD', maximumFractionDigits: 0,
  }).format(v);
}
function fmt2(v: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: 'CAD', maximumFractionDigits: 2,
  }).format(v);
}

// One numbered step in the worksheet: a label, the formula in words, and the
// numbers plugged in → the result.
function Step({ n, title, note, children }: {
  n: number; title: string; note?: string; children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
      <div className="shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-slate-800">{title}</div>
        {note && <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{note}</div>}
        {children && <div className="mt-1.5">{children}</div>}
      </div>
    </div>
  );
}

// A labelled equation line: "spending target = $70,000 × 1.102 × 100% = $77,153".
function Eq({ parts, result, strong }: { parts: string; result: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 font-mono text-[11.5px]">
      <span className="text-slate-600">{parts}</span>
      <span className={strong ? 'font-bold text-slate-900' : 'text-slate-800'}>{fmt(result)}</span>
    </div>
  );
}
function Line({ label, value, indent }: { label: string; value: string | number; indent?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-[11.5px] ${indent ? 'pl-3' : ''}`}>
      <span className="text-slate-600">{label}</span>
      <span className="font-mono text-slate-800">{typeof value === 'number' ? fmt(value) : value}</span>
    </div>
  );
}

function pct(v: number): string { return `${(v * 100).toFixed(1)}%`; }

// The ordered worksheet for one decumulation year, driven entirely by the
// engine-emitted calc trace + row fields (so it always equals the table).
function YearWorksheet({ row, inputs, isCouple }: {
  row: YearlyBreakdown; inputs: RetirementInputs; isCouple: boolean;
}) {
  const d = row.detail;
  const c = d?.calc;
  if (!d || !c) {
    return <p className="text-xs text-slate-500 py-4">No calculation detail for this year (accumulation years only grow and contribute).</p>;
  }
  const w = d.withdraw;
  const order = inputs.withdrawalOrder ?? ['tfsa', 'taxable', 'rrsp'];
  let n = 0;

  return (
    <div className="bg-white border border-slate-200 rounded px-4 divide-y divide-slate-100">
      {/* 1 — spending target */}
      <Step n={++n} title="Spending target" note="Desired spending inflated to this year, scaled by any spending-phase band, plus one-time outflow events.">
        <Eq parts={`${fmt(inputs.desiredSpending)} base, grown to this year`} result={row.spendingTarget} strong />
        {d.events.filter(e => e.direction === 'out').map((e, i) => (
          <Line key={i} label={`+ ${e.label} (one-time expense)`} value={e.amount} indent />
        ))}
      </Step>

      {/* 2 — benefits */}
      <Step n={++n} title="Benefits (taxable income)" note="CPP (age-65 amount × the start-age multiplier), OAS (deferral + residency), and any DB/bridge pension.">
        <Line label={`CPP — ${fmt2(c.cppMonthlyAtStart)}/mo × 12`} value={row.cppIncome} />
        <Line label="OAS" value={row.oasIncome} />
        <Line label="Pension" value={row.pensionIncome} />
        <Eq parts="gross benefits (otherGross)" result={c.otherGross} strong />
        <Eq parts="after-tax value (netBenefits)" result={c.netBenefits} />
        <Eq parts={`portfolio must supply = ${fmt(row.spendingTarget)} − ${fmt(c.netBenefits)}`} result={c.neededAfterTax} strong />
      </Step>

      {/* 3 — RRIF minimum */}
      {(w.rrifMin > 0.5 || c.rrifMinNet > 0.5) && (
        <Step n={++n} title="Mandatory RRIF minimum" note="Forced out first once the RRIF exists; taxed as income. Any after-tax excess over the need is redeposited into taxable.">
          <Eq parts="RRIF balance × minimum rate" result={w.rrifMin} strong />
          <Line label="after-tax value" value={c.rrifMinNet} />
          {c.rrifMinExcess > 0.5 && <Line label="excess redeposited to taxable" value={c.rrifMinExcess} indent />}
          <Eq parts="remaining need" result={c.needAfterRrifMin} />
        </Step>
      )}

      {/* 4 — GIS */}
      {row.gisIncome > 0.5 && (
        <Step n={++n} title="GIS (Guaranteed Income Supplement)" note={`Tax-free; reduced 50¢ per dollar of income excluding OAS${isCouple ? ' (combined for couples)' : ''}. Recomputed after the draws so in-year income claws it back.`}>
          <Eq parts="GIS entitlement (after in-year clawback)" result={row.gisIncome} strong />
          <Eq parts="remaining need" result={c.needAfterGis} />
        </Step>
      )}

      {/* 5 — withdrawals in order */}
      {row.withdrawals > 0.5 && (
        <Step n={++n} title="Withdrawals from accounts" note={`Drawn in your configured order (${order.join(' → ')}); registered draws are grossed up so the after-tax amount covers the need.`}>
          {w.rrsp > 0.5 && <Line label="RRSP (grossed up for tax)" value={w.rrsp} />}
          {w.rrif > 0.5 && <Line label="RRIF draw (grossed up for tax)" value={w.rrif} />}
          {w.tfsa > 0.5 && <Line label="TFSA (tax-free, $1 = $1)" value={w.tfsa} />}
          {w.taxable > 0.5 && (
            <>
              <Line label="Taxable (grossed up on the gain fraction)" value={w.taxable} />
              <Line label={`embedded-gain fraction ${pct(c.gainsFraction)} → gain realized`} value={d.tax.capitalGains} indent />
            </>
          )}
          <Eq parts="total withdrawn" result={row.withdrawals} strong />
          <Eq parts="remaining need after account draws" result={c.needAfterDraws} />
        </Step>
      )}

      {/* 6 — cash cushion */}
      {w.cash > 0.5 && (
        <Step n={++n} title="Cash cushion" note="After-tax reserve, used as a last resort.">
          <Eq parts="cash draw" result={w.cash} strong />
        </Step>
      )}

      {/* 7 — RM top-up */}
      {w.rmDraw > 0.5 && (
        <Step n={++n} title="Reverse-mortgage top-up" note="Tax-free borrowing against home equity, the true last resort; grows the loan.">
          <Eq parts="borrowed (capped by LTV headroom)" result={w.rmDraw} strong />
        </Step>
      )}

      {/* 7b — unfunded gap once the portfolio is depleted */}
      {(row.shortfall ?? 0) > 0.5 && (
        <Step n={++n} title="Unfunded shortfall" note="The portfolio is depleted — benefits cover only part of this year's spending target, so this much of the goal goes unmet. The gap shrinks as later benefits (pension, CPP, OAS, GIS) begin.">
          <Eq parts={`spending target ${fmt(row.spendingTarget)} − funded by benefits & portfolio`} result={row.shortfall ?? 0} strong />
          <div className="text-[10px] text-amber-600 mt-0.5 leading-snug">
            this year's plan is underfunded — the money ran out before the spending goal was met.
          </div>
        </Step>
      )}

      {/* 8 — tax */}
      {(row.incomeTax > 0.5 || d.tax.oasClawback > 0.5 || (row.splitTransferred ?? 0) !== 0) && (
        <Step n={++n} title="Income tax" note="Tax on total income, minus the tax already counted on benefits, plus the OAS recovery tax.">
          <Line label="total net income (benefits + registered + gains×inclusion)" value={c.totalNetIncome} />
          <Line label="tax already counted on benefits alone" value={c.taxOnBenefits} indent />
          {d.tax.oasClawback > 0.5 && <Line label="+ OAS clawback (15¢/$ over the threshold)" value={d.tax.oasClawback} indent />}
          {(row.splitTransferred ?? 0) !== 0 && (
            <Line
              label={(row.splitTransferred ?? 0) > 0
                ? 'pension income split OUT to spouse (lowers your tax)'
                : 'pension income split IN from spouse (taxed to you)'}
              value={Math.abs(row.splitTransferred ?? 0)}
              indent
            />
          )}
          <Eq parts="income tax on this year's withdrawals" result={row.incomeTax} strong />
          {(row.splitTransferred ?? 0) !== 0 && (
            <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">
              includes the effect of pension-income splitting — tax here can be non-zero even with no
              withdrawals, because income was transferred {row.splitTransferred! > 0 ? 'to your spouse' : 'to you'}.
            </div>
          )}
          <Line label="cumulative tax since retirement" value={row.cumulativeTax} />
        </Step>
      )}

      {/* 9 — growth & ending */}
      <Step n={++n} title="Growth & ending balance" note="Market growth applied after withdrawals; balances roll into next year.">
        <Line label="RRSP growth" value={d.growth.rrsp} />
        <Line label="RRIF growth" value={d.growth.rrif} />
        <Line label="TFSA growth" value={d.growth.tfsa} />
        <Line label="Taxable growth" value={d.growth.taxable} />
        <Line label="Cash growth (cushion rate)" value={d.growth.cash} />
        <Eq parts="market gains" result={row.marketGains} strong />
        <Eq parts="ending balance" result={row.endingBalance} strong />
      </Step>
    </div>
  );
}

// One person's worksheet column with a small header (name + own age + year).
function PersonColumn({ title, row, inputs, isCouple, calendarYear }: {
  title: string; row: YearlyBreakdown | undefined; inputs: RetirementInputs;
  isCouple: boolean; calendarYear: number;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between mb-2 px-0.5">
        <span className="text-xs font-semibold text-slate-700">{title}</span>
        {row && <span className="text-[11px] text-slate-400">age {row.age} · {calendarYear}</span>}
      </div>
      {row ? (
        <YearWorksheet row={row} inputs={inputs} isCouple={isCouple} />
      ) : (
        <p className="text-xs text-slate-500">
          No projection row for this person in the selected calendar year — they're not yet
          at their starting age then (the projection runs to max age, so post-depletion
          years still appear, with any unfunded gap shown as a shortfall).
        </p>
      )}
    </div>
  );
}

export function MathPage({ inputs, results, spouseAgeOffset }: MathPageProps) {
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

  return (
    <div className={view === 'both' ? 'max-w-6xl' : 'max-w-3xl'}>
      <div className="flex items-center gap-2 mb-1">
        <Calculator size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">How the math works</h2>
      </div>
      <p className="text-xs text-slate-500 mb-4 leading-snug">
        Every number below is the actual value the engine used for that year — pick a year to see
        it worked through step by step, from the spending target down to the ending balance.
      </p>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {spouse && (
          <div className="flex rounded border border-slate-200 overflow-hidden">
            {(['you', 'spouse', 'both'] as const).map(p => (
              <button
                key={p}
                onClick={() => setView(p)}
                className={`px-3 py-1.5 text-xs font-medium ${view === p ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {p === 'you' ? 'You' : p === 'spouse' ? 'Spouse' : 'Side by side'}
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Year
          <select
            value={selAxisAge}
            onChange={e => setAxisAge(Number(e.target.value))}
            className="px-2 py-1.5 border border-slate-300 rounded text-xs bg-white cursor-pointer"
          >
            {axisAges.map(a => (
              <option key={a} value={a}>
                {baseYear + (a - inputs.currentAge)} (you {a}{spouse ? ` · spouse ${a - spouseAgeOffset}` : ''})
              </option>
            ))}
          </select>
        </label>
        <span className="text-[11px] text-slate-400">
          calendar year {calendarYear}
          {spouse && spouseAgeOffset !== 0 && ` · spouse is ${Math.abs(spouseAgeOffset)} yr${Math.abs(spouseAgeOffset) === 1 ? '' : 's'} ${spouseAgeOffset > 0 ? 'younger' : 'older'}`}
        </span>
      </div>

      {view === 'both' && spouse ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <PersonColumn title="You" row={youRow} inputs={inputs} isCouple calendarYear={calendarYear} />
          <PersonColumn title="Spouse" row={spouseRow} inputs={inputs} isCouple calendarYear={calendarYear} />
        </div>
      ) : view === 'spouse' && spouse ? (
        <PersonColumn title="Spouse" row={spouseRow} inputs={inputs} isCouple calendarYear={calendarYear} />
      ) : (
        <PersonColumn title="You" row={youRow} inputs={inputs} isCouple={!!spouse} calendarYear={calendarYear} />
      )}
    </div>
  );
}
