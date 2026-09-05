// The app's UI (built on the f7 design — the former beta, now the default).
// The old site lives behind the `?beta` flag as a reference (see
// src/lib/betaSkin.ts). Built from the design system in src/design/ — every
// surface composes those primitives (per STYLEGUIDE.md / REQUIREMENTS §8.10)
// so the vocabulary stays consistent as the skin grows toward f7. It renders
// the REAL engine's verdict on the REAL active scenario: the verdict hero with
// the Markets dial, the contour map + the two levers, the down-market check,
// the life timeline, and the evidence row — all recomputing together off one
// engine run.
import type { ReactNode } from 'react';
import type { RetirementInputs, RetirementResults } from '@retired/engine-core/retirementEngine';
import type { Scenario } from '@retired/engine-core/types';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { BETA_COOKIE_NAME } from '../lib/betaSkin';
import { getRangePrefs } from '../lib/rangePrefs';
import { VerdictHero, Panel, Fader, Footnote, HelpHint } from '../design/primitives';
import { cls, INK, RED_DOT } from '../design/tokens';
import { ProjectionTimeline, baseSpendAtRetirement } from '../design/ProjectionTimeline';
import { BetaPage, type VerdictChip } from './beta/BetaPage';
import { ContourMap } from './beta/ContourMap';
import { MarketDial } from './beta/MarketDial';
import { DownMarketCheck } from './beta/DownMarketCheck';
import { EvidenceRow } from './beta/EvidenceRow';

// The map's axis window defaults — retire age × spending. The spending axis
// reads the Settings lever-range pref (spendingMax) when set; age bounds stay
// fixed (a fixed span is part of the axis's meaning — same contract as
// rangePrefs).
const DEFAULT_MAP_WINDOW = { ageMin: 55, ageMax: 75, spendTop: 160000, spendBottom: 20000 };

// Compose the map's axis window: the spending axis ends where the lever-range
// pref says the fader may reach, and never below the plan's own spending (a
// dot above the axis would drag off-pad). Exported for the window test.
export function mapWindow({ desiredSpending }: { desiredSpending: number }) {
  const { spendingMax } = getRangePrefs();
  return {
    ...DEFAULT_MAP_WINDOW,
    spendTop: Math.max(spendingMax, desiredSpending),
  };
}

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
  /** The assistant conversation, docked on the right (f7's star). */
  assistant?: ReactNode;
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
  inputs, onInputsChange, results, config, hasUnsavedChanges, onSave, assistant,
}: BetaAppProps) {
  const v = verdict(inputs, results);
  const breakdown = results.yearlyBreakdown ?? [];
  // Where the money runs out (null = outlasts the plan) — drives the timeline pin.
  const lifeDepletion = breakdown.find(r => r.endingBalance <= 0)?.age ?? null;
  const window = mapWindow({ desiredSpending: inputs.desiredSpending });
  const chip: VerdictChip = {
    tone: v.holds ? 'holds' : (results.depletionAge != null && inputs.maxAge - results.depletionAge <= 6) ? 'borderline' : 'short',
    age: v.holds ? `${inputs.maxAge}+` : `${results.depletionAge ?? '—'}`,
    label: v.holds ? 'the plan holds' : 'runs short',
  };
  return (
    <BetaPage chip={chip} assistant={assistant} actions={
      <>
        <select
          className="min-w-0 max-w-[30vw] cursor-pointer appearance-none border-b border-transparent bg-transparent py-1 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-900"
          value={activeScenarioId}
          onChange={(e) => onScenarioChange(e.target.value)}
          aria-label="Active scenario"
        >
          {scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button
          className={hasUnsavedChanges ? cls.primaryBtn : 'px-3 py-1.5 text-xs font-medium text-slate-400'}
          onClick={onSave}
          disabled={!hasUnsavedChanges}
        >
          Save{hasUnsavedChanges ? ' · unsaved' : 'd'}
        </button>
      </>
    }>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0 flex-1">
            <VerdictHero
              eyebrow={<>The verdict <HelpHint topic="verdict" /></>}
              verdict={v.text}
              sub={
                v.holds
                  ? `Spending ${fmtMoney(inputs.desiredSpending)} a year from ${inputs.retirementAge}.`
                  : `Cut spending or work longer below. Currently: ${fmtMoney(inputs.desiredSpending)} a year from ${inputs.retirementAge}.`
              }
            />
          </div>
          <div className="pb-7">
            <MarketDial
              value={inputs.investmentReturn}
              onChange={(val) => onInputsChange({ ...inputs, investmentReturn: val })}
            />
          </div>
        </div>

        <Panel label="The ground your plan stands on" hint="contour-map" action={
          <span className="text-[11px] text-slate-400">drag the dot, or use the faders</span>
        }>
          <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
            <ContourMap
              inputs={inputs}
              config={config}
              window={window}
              onChange={onInputsChange}
            />

            <div className="space-y-7">
              <Fader
                label="Start Drawing"
                value={inputs.retirementAge}
                min={window.ageMin} max={window.ageMax} step={1}
                format={(val) => `${val}`}
                onChange={(val) => onInputsChange({ ...inputs, retirementAge: val })}
              />
              <Fader
                label="After Tax Spending"
                value={inputs.desiredSpending}
                min={window.spendBottom} max={window.spendTop} step={1000}
                format={fmtMoney}
                onChange={(val) => onInputsChange({ ...inputs, desiredSpending: val })}
              />
              <DownMarketCheck inputs={inputs} config={config} />
            </div>
          </div>
        </Panel>

        <Panel label="Your life on one line — this exact plan" hint="life-timeline">
          <ProjectionTimeline
            series={[{ id: 'plan', label: 'portfolio', color: INK, area: true, points: breakdown.map(r => ({ age: r.age, value: r.endingBalance })) }]}
            pins={[
              { age: inputs.currentAge, label: `you · ${inputs.currentAge}`, place: 'below', anchor: 'start', color: INK },
              { age: inputs.retirementAge, label: `start drawing · ${inputs.retirementAge}`, color: '#475569',
                onDragAge: (age) => onInputsChange({ ...inputs, retirementAge: Math.max(inputs.currentAge + 1, Math.min(inputs.maxAge - 1, age)) }) },
              ...(lifeDepletion != null
                ? [{ age: lifeDepletion, label: `money runs out · ${lifeDepletion}`, color: RED_DOT }]
                : []),
            ]}
            /* The interactive layers (old-site parity, restyled): the spend
               strip with its base handle, the cash-event diamonds, and the
               market strip. Drags write through onInputsChange and re-simulate
               live — same contract as every fader. */
            spend={{ points: breakdown.map(r => ({ age: r.age, value: r.spendingTarget })), baseSpend: baseSpendAtRetirement(inputs, config.engine.inflationRate, inputs.retirementAge) }}
            onSpendChange={(today) => onInputsChange({ ...inputs, desiredSpending: today })}
            events={(inputs.events ?? []).map(ev => ({ id: ev.id, age: ev.age, amount: ev.amount, direction: ev.direction, label: ev.label }))}
            onEventChange={(next) => onInputsChange({ ...inputs, events: (inputs.events ?? []).map(ev => (ev.id === next.id ? { ...ev, age: next.age, amount: next.amount } : ev)) })}
            anchors={(inputs.marketPeriods ?? []).map(p => ({ id: p.id, age: p.age, return: p.return, volatility: p.volatility }))}
            onAnchorsChange={(next) => onInputsChange({ ...inputs, marketPeriods: next.map(a => ({ id: a.id, age: a.age, return: a.return, volatility: a.volatility })) })}
          />
        </Panel>

        <Panel label="The receipts" hint="evidence-row">
          <EvidenceRow inputs={inputs} results={results} breakdown={breakdown} />
        </Panel>

        <Footnote>
          Everything here is live — drag the dot or move a fader and the verdict, the bands, the life line, the accounts and the down-market check recompute together. Year-by-year receipts, the levers, the odds, the history and the solver live under the Tools menu. · The old site stays up as a reference for a while — <a className="underline" href="?beta">open it</a> ({BETA_COOKIE_NAME} cookie remembers; <a className="underline" href="?beta=off">back to the app</a>)
        </Footnote>
    </BetaPage>
  );
}

function fmtMoney(v: number) {
  return '$' + Math.round(v).toLocaleString('en-CA');
}
