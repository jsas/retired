// The in-development reskin, served behind the `?beta` flag (see
// src/lib/betaSkin.ts). Built from the design system in src/design/ — every
// surface composes those primitives (per STYLEGUIDE.md / REQUIREMENTS §8.10)
// so the vocabulary stays consistent as the skin grows toward f7. It renders
// the REAL engine's verdict on the REAL active scenario and lets the two
// biggest levers — annual spending and retirement age — steer it.
import type { RetirementInputs, RetirementResults } from '@retired/engine-core/retirementEngine';
import type { Scenario } from '@retired/engine-core/types';
import { BETA_COOKIE_NAME } from '../lib/betaSkin';
import { AppHeader, VerdictHero, Panel, Fader, Footnote } from '../design/primitives';
import { cls } from '../design/tokens';

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

function verdict(inputs: RetirementInputs, results: RetirementResults) {
  if (results.status === 'ON_TRACK') {
    return { text: `Your money lasts to ${inputs.maxAge}.`, holds: true };
  }
  const runsTo = results.depletionAge ?? '?';
  const short = inputs.maxAge - (results.depletionAge ?? inputs.maxAge);
  return { text: `Your money runs out at ${runsTo} — ${short} years short of ${inputs.maxAge}.`, holds: false };
}

export function BetaApp({
  scenarios, activeScenarioId, onScenarioChange,
  inputs, onInputsChange, results, hasUnsavedChanges, onSave,
}: BetaAppProps) {
  const v = verdict(inputs, results);
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-800">
      <AppHeader>
        <select
          className="min-w-0 max-w-[40vw] cursor-pointer appearance-none border-b border-transparent bg-transparent py-1 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-900"
          value={activeScenarioId}
          onChange={(e) => onScenarioChange(e.target.value)}
          aria-label="Active scenario"
        >
          {scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex-1" />
        <button
          className={hasUnsavedChanges ? cls.primaryBtn : 'px-3 py-1.5 text-xs font-medium text-slate-400'}
          onClick={onSave}
          disabled={!hasUnsavedChanges}
        >
          Save{hasUnsavedChanges ? ' · unsaved' : 'd'}
        </button>
      </AppHeader>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4">
        <VerdictHero
          verdict={v.text}
          sub={
            v.holds
              ? `Spending ${fmtMoney(inputs.desiredSpending)} a year from ${inputs.retirementAge}.`
              : `Cut spending or work longer below. Currently: ${fmtMoney(inputs.desiredSpending)} a year from ${inputs.retirementAge}.`
          }
        />

        <Panel label="The two levers">
          <div className="grid gap-6 md:grid-cols-2">
            <Fader
              label="Spend a year"
              value={inputs.desiredSpending}
              min={20000} max={200000} step={1000}
              format={fmtMoney}
              onChange={(val) => onInputsChange({ ...inputs, desiredSpending: val })}
            />
            <Fader
              label="Stop working at"
              value={inputs.retirementAge}
              min={inputs.currentAge} max={80} step={1}
              format={(val) => `${val}`}
              onChange={(val) => onInputsChange({ ...inputs, retirementAge: val })}
            />
          </div>
        </Panel>

        <Footnote>
          Beta reskin · {BETA_COOKIE_NAME} cookie · full app still at every other route — <a className="underline" href="?beta=off">leave beta</a>
        </Footnote>
      </main>
    </div>
  );
}

function fmtMoney(v: number) {
  return '$' + Math.round(v).toLocaleString('en-CA');
}
