// The in-development reskin, served behind the `?beta` flag (see
// src/lib/betaSkin.ts). Deliberately dumb for now: it renders the REAL engine's
// verdict on the REAL active scenario and lets the two biggest levers — annual
// spending and retirement age — steer it, following the finalist designs'
// taste: verdict first, plain English, flat hairline squares, no cards.
// Everything else (save, scenarios, config, the whole 17-route app) stays in
// the stable App; this shell will grow toward parity as the skin develops,
// then get promoted (main.tsx flips the default and this flag retires).
import type { RetirementInputs, RetirementResults } from '../lib/retirementEngine';
import type { Scenario } from '../lib/types';
import { BETA_COOKIE_NAME } from '../lib/betaSkin';

interface BetaAppProps {
  scenarios: Scenario[];
  activeScenarioId: string;
  onScenarioChange: (id: string) => void;
  inputs: RetirementInputs;
  onInputsChange: (next: RetirementInputs) => void;
  results: RetirementResults;
  hasUnsavedChanges: boolean;
  onSave: () => void;
}

function verdictLine(inputs: RetirementInputs, results: RetirementResults) {
  if (results.status === 'ON_TRACK') {
    return `Your money lasts to ${inputs.maxAge}.`;
  }
  const runsTo = results.depletionAge ?? '?';
  const short = inputs.maxAge - (results.depletionAge ?? inputs.maxAge);
  return `Your money runs out at ${runsTo} — ${short} years short of ${inputs.maxAge}.`;
}

function Lever({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[12px] text-slate-500">
        {label}
        <span className="num text-[15px] font-semibold text-slate-900">{format(value)}</span>
      </span>
      {/* 24px hit strip for fingers; visible track is the clipped 4px content box */}
      <input
        type="range"
        className="block w-full cursor-pointer"
        style={{ height: 24, padding: '10px 0', background: '#e2e8f0', backgroundClip: 'content-box' }}
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function BetaApp({
  scenarios, activeScenarioId, onScenarioChange,
  inputs, onInputsChange, results, hasUnsavedChanges, onSave,
}: BetaAppProps) {
  return (
    <div className="flex min-h-screen flex-col bg-[#fbfbfa] text-slate-900">
      {/* header — brand, scenario picker, save; square, hairline, no cards */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-2 px-4">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-slate-900 text-[10px] font-bold text-white">RE:</span>
          <select
            className="min-w-0 max-w-[40vw] cursor-pointer appearance-none border-b border-transparent bg-transparent py-1 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-900"
            value={activeScenarioId}
            onChange={(e) => onScenarioChange(e.target.value)}
          >
            {scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="flex-1" />
          <button
            className={`px-3 py-1.5 text-xs font-medium ${hasUnsavedChanges ? 'bg-slate-900 text-white hover:bg-slate-700' : 'text-slate-400'}`}
            onClick={onSave}
            disabled={!hasUnsavedChanges}
          >
            Save{hasUnsavedChanges ? ' · unsaved' : 'd'}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {/* verdict — the answer, first, in plain English */}
        <p className="num text-[22px] font-semibold leading-snug md:text-[28px]">
          {verdictLine(inputs, results)}
        </p>
        <p className="mt-1 text-[13px] text-slate-500">
          {results.status === 'ON_TRACK'
            ? `Spending ${fmtMoney(inputs.desiredSpending)} a year from ${inputs.retirementAge}.`
            : `Cut spending or work longer below. Currently: ${fmtMoney(inputs.desiredSpending)} a year from ${inputs.retirementAge}.`}
        </p>

        {/* the two big levers */}
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Lever
            label="Yearly spending after retirement"
            value={inputs.desiredSpending}
            min={20000} max={200000} step={1000}
            format={fmtMoney}
            onChange={(v) => onInputsChange({ ...inputs, desiredSpending: v })}
          />
          <Lever
            label="Retirement age"
            value={inputs.retirementAge}
            min={inputs.currentAge} max={80} step={1}
            format={(v) => `${v}`}
            onChange={(v) => onInputsChange({ ...inputs, retirementAge: v })}
          />
        </div>

        <p className="mt-10 text-[11px] text-slate-400">
          Beta reskin · {BETA_COOKIE_NAME} cookie · full app still at every other route — <a className="underline" href="?beta=off">leave beta</a>
        </p>
      </main>
    </div>
  );
}

function fmtMoney(v: number) {
  return '$' + Math.round(v).toLocaleString('en-CA');
}
