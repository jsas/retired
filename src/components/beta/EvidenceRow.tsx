// The evidence row — the receipts under the map. Left: where the money sits
// across accounts at a chosen age (flat bars). Right: the key numbers grid —
// money lasts to, left at the plan-to age, in the pot at work's end, and the
// CPP+OAS that arrives every year. Everything reads the same engine breakdown.
import { useState } from 'react';
import type { RetirementInputs, RetirementResults, YearlyBreakdown } from '@retired/engine-core/retirementEngine';
import { AccountBars, Stat } from '../../design/primitives';

const fmt = (v: number) => '$' + Math.round(v).toLocaleString('en-CA');

export function EvidenceRow({ inputs, results, breakdown }: {
  inputs: RetirementInputs;
  results: RetirementResults;
  breakdown: YearlyBreakdown[];
}) {
  const { currentAge, retirementAge, maxAge } = inputs;
  const [age, setAge] = useState(retirementAge);

  const rowAt = (a: number): YearlyBreakdown | undefined =>
    breakdown.find(r => r.age === a) ?? [...breakdown].reverse().find(r => r.age <= a);

  const acc = rowAt(age);
  const accounts = acc ? [
    { label: 'RRSP', value: acc.rrspBalance + (acc.rrifBalance ?? 0) },
    { label: 'TFSA', value: acc.tfsaBalance, active: true },
    { label: 'Taxable', value: acc.taxableBalance + (acc.cashCushionBalance ?? 0) },
  ] : [];
  const accTotal = accounts.reduce((s, a) => s + a.value, 0);

  const atRet = rowAt(retirementAge);
  const depletionAge = results.depletionAge;
  const holds = results.status === 'ON_TRACK';
  const borderline = !holds && depletionAge != null && (maxAge - depletionAge) <= 6;
  const lastRow = breakdown[breakdown.length - 1];
  const leftAtMax = holds ? (lastRow?.endingBalance ?? 0) : 0;

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
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Where it sits, over time</h3>
          <select
            className="num cursor-pointer appearance-none border-b border-transparent bg-transparent text-[12px] text-slate-600 hover:border-slate-300"
            value={age}
            onChange={(e) => setAge(Number(e.target.value))}
            aria-label="Balance at age"
          >
            {Array.from({ length: maxAge - currentAge + 1 }, (_, i) => currentAge + i).map(a => (
              <option key={a} value={a}>at age {a}</option>
            ))}
          </select>
        </div>
        <AccountBars rows={accounts} total={accTotal} />
      </div>

      {/* key numbers */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-6">
        <Stat
          label="Money lasts to"
          value={holds ? `${maxAge}+` : `${depletionAge ?? '—'}`}
          tone={lastsTone}
          note={holds ? 'past the plan' : `before the ${maxAge} planned`}
        />
        <Stat
          label={`Left at ${maxAge}`}
          value={leftAtMax > 0 ? fmt(leftAtMax) : 'nothing'}
          note={leftAtMax > 0 ? 'still in the pot' : 'the pot is empty'}
        />
        <Stat
          label="In the pot at work's end"
          value={fmt(atRet?.endingBalance ?? 0)}
          note="after the saving years"
        />
        <Stat
          label={`CPP + OAS from ${benAge}`}
          value={benefits > 0 ? fmt(benefits) : '—'}
          note="every year after that"
        />
      </div>
    </div>
  );
}
