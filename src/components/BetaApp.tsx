// The in-development reskin, served behind the `?beta` flag (see
// src/lib/betaSkin.ts). Built from the design system in src/design/ — every
// surface composes those primitives (per STYLEGUIDE.md / REQUIREMENTS §8.10)
// so the vocabulary stays consistent as the skin grows toward f7. It renders
// the REAL engine's verdict on the REAL active scenario and lets the two
// biggest levers — annual spending and retirement age — steer it, on the map
// and on the faders.
import type { RetirementInputs, RetirementResults } from '@retired/engine-core/retirementEngine';
import type { Scenario } from '@retired/engine-core/types';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { BETA_COOKIE_NAME } from '../lib/betaSkin';
import { AppHeader, VerdictHero, Panel, Fader, Footnote } from '../design/primitives';
import { cls } from '../design/tokens';
import { ContourMap } from './beta/ContourMap';

// The map's axis window — retire age × spending. The faders use the same
// ranges so the dot and the sliders always agree. (Spending/return ranges are
// the runaway-able ones earmarked for a Settings pref — see BETA-MAP.md §2.)
const MAP_WINDOW = { ageMin: 55, ageMax: 75, spendTop: 160000, spendBottom: 20000 };

interface BetaAppProps {
  scenarios: Scenario[];
  activeScenarioId: string;
  onScenarioChange: (id: string) => void;
  inputs: RetirementInputs;
  onInputsChange: (next: RetirementInputs) => void;
  results: RetirementResults;
  config: AppConfig;
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
  inputs, onInputsChange, results, config, hasUnsavedChanges, onSave,
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

        <Panel label="The ground your plan stands on" action={
          <span className="text-[11px] text-slate-400">drag the dot, or use the faders</span>
        }>
          <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
            <ContourMap
              inputs={inputs}
              config={config}
              window={MAP_WINDOW}
              onChange={onInputsChange}
            />

            <div className="space-y-7">
              <Fader
                label="Stop working at"
                value={inputs.retirementAge}
                min={MAP_WINDOW.ageMin} max={MAP_WINDOW.ageMax} step={1}
                format={(val) => `${val}`}
                onChange={(val) => onInputsChange({ ...inputs, retirementAge: val })}
              />
              <Fader
                label="Spend a year"
                value={inputs.desiredSpending}
                min={MAP_WINDOW.spendBottom} max={MAP_WINDOW.spendTop} step={1000}
                format={fmtMoney}
                onChange={(val) => onInputsChange({ ...inputs, desiredSpending: val })}
              />
            </div>
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
