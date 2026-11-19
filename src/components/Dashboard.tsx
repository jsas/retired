// The app's UI (built on the f7 design). Built from the design system in
// src/design/ — every surface composes those primitives (per STYLEGUIDE.md /
// REQUIREMENTS §8.10) so the vocabulary stays consistent. It renders the REAL
// engine's verdict on the REAL active scenario: the verdict hero with the
// Markets dial, the contour map + the two levers, the down-market check, the
// life timeline, and the evidence row — all recomputing together off one
// engine run.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RetirementInputs, RetirementResults } from '@retired/engine-core/retirementEngine';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { getRangePrefs } from '../lib/rangePrefs';
import { VerdictHero, Panel, Fader, Footnote, HelpHint } from '../design/primitives';
import { INK, RED_DOT, cls } from '../design/tokens';
import { ProjectionTimeline, baseSpendAtRetirement } from '../design/ProjectionTimeline';
import { PageChrome, type VerdictChip } from './console/PageChrome';
import { Link } from './console/nav';
import { ContourMap } from './console/ContourMap';
import { MarketDial } from './console/MarketDial';
import { DownMarketCheck } from './console/DownMarketCheck';
import { SteeringControls, type Bands, type EqSolvedState } from './console/SteeringControls';
import { EvidenceRow } from './console/EvidenceRow';
import { firstEmptyAge, potDisplay, unsetDetailGroups, verdictChip } from '../lib/planDisplay';
import { useAppLocale } from '../lib/localeContext';
import { formatCurrency } from '../lib/locale';

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

interface DashboardProps {
  inputs: RetirementInputs;
  onInputsChange: (next: RetirementInputs) => void;
  results: RetirementResults;
  config: AppConfig;
  /** The assistant conversation, docked on the right (f7's star). */
  assistant?: ReactNode;
  /** The set-up card (the intro screen's old job) — App owns when it shows;
   *  the Dashboard only places it, above the verdict. */
  setup?: ReactNode;
  /** Steering state (bands + solver readout) for the "Adjust the plan"
   *  panel — the levers the old Steering page carried (issue #187). */
  eq?: { bands: Bands; onBandsChange: (b: Bands) => void; solved: EqSolvedState };
}

function verdict(inputs: RetirementInputs, results: RetirementResults, t: TFunction) {
  const pot = potDisplay(results.yearlyBreakdown ?? [], inputs.maxAge);
  if (pot.holds) {
    return { text: t('dash.verdictHolds', { age: inputs.maxAge }), holds: true };
  }
  const runsTo = pot.lastsTo ?? '?';
  const short = inputs.maxAge - (pot.lastsTo ?? inputs.maxAge);
  if (typeof runsTo === 'number' && short <= 0) {
    return { text: t('dash.verdictLastsTo', { runsTo }), holds: false };
  }
  return { text: t('dash.verdictShort', { runsTo, short, age: inputs.maxAge }), holds: false };
}

export function Dashboard({
  inputs, onInputsChange, results, config, assistant, eq, setup,
}: DashboardProps) {
  const { t } = useTranslation('pages');
  const { t: tHelp } = useTranslation('help');
  const { locale } = useAppLocale();
  const money = (v: number) => formatCurrency(v, locale);
  const v = verdict(inputs, results, t);
  const breakdown = results.yearlyBreakdown ?? [];
  const pot = potDisplay(breakdown, inputs.maxAge);
  // Where the investable pot hits $0 (null = leftover at the horizon).
  const lifeDepletion = firstEmptyAge(breakdown);
  const window = mapWindow({ desiredSpending: inputs.desiredSpending });
  const chip: VerdictChip = verdictChip(pot, inputs.maxAge, {
    holds: t('holds'), short: t('short'), borderline: t('borderline'),
  });
  return (
    <PageChrome chip={chip} assistant={assistant}>
      {setup}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0 flex-1">
            <VerdictHero
              eyebrow={<>{tHelp('verdict')} <HelpHint topic="verdict" /></>}
              verdict={v.text}
              sub={
                v.holds
                  ? t('dash.subHolds', { spend: money(inputs.desiredSpending), age: inputs.retirementAge })
                  : t('dash.subShort', { spend: money(inputs.desiredSpending), age: inputs.retirementAge })
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

        {/* The way to the rest of the plan. The four numbers above are the
            whole interface until this line says otherwise, so it names what
            the plan is missing and hands over a button — one rule, one
            sentence, one control, and nothing at all once the registers are
            full. Hidden while the set-up card is up: same message, same
            reader, one CTA per screen. */}
        {!setup && <DetailsRow inputs={inputs} />}

        <Panel label={t('dash.ground')} hint="contour-map" action={
          <span className="text-[11px] text-slate-400">{t('dash.dragDot')}</span>
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
                label={t('dash.startDrawing')}
                value={inputs.retirementAge}
                min={window.ageMin} max={window.ageMax} step={1}
                format={(val) => `${val}`}
                onChange={(val) => onInputsChange({ ...inputs, retirementAge: val })}
              />
              <Fader
                label={t('dash.afterTaxSpending')}
                value={inputs.desiredSpending}
                min={window.spendBottom} max={window.spendTop} step={1000}
                format={money}
                onChange={(val) => onInputsChange({ ...inputs, desiredSpending: val })}
              />
              <DownMarketCheck inputs={inputs} config={config} />
            </div>
          </div>
        </Panel>

        {/* The steering levers, folded in from the old Steering page
            (issue #187): every knob, the age × spending pad, and the live
            outcome readouts — the life timeline below is the single visual
            that answers each drag. */}
        {eq && (
          <Panel label={t('dash.adjust')} hint="levers-ranked">
            <SteeringControls
              inputs={inputs}
              config={config}
              onChange={onInputsChange}
              bands={eq.bands}
              onBandsChange={eq.onBandsChange}
              solved={eq.solved}
            />
          </Panel>
        )}

        <Panel label={t('dash.lifeLine')} hint="life-timeline">
          <ProjectionTimeline
            series={[{ id: 'plan', label: t('portfolio'), color: INK, area: true, points: breakdown.map(r => ({ age: r.age, value: r.endingBalance })) }]}
            pins={[
              { age: inputs.currentAge, label: t('youPin', { age: inputs.currentAge }), place: 'below', anchor: 'start', color: INK },
              { age: inputs.retirementAge, label: t('startDrawingPin', { age: inputs.retirementAge }), color: '#475569',
                onDragAge: (age) => onInputsChange({ ...inputs, retirementAge: Math.max(inputs.currentAge + 1, Math.min(inputs.maxAge - 1, age)) }) },
              ...(lifeDepletion != null
                ? [{ age: lifeDepletion, label: t('runsOutPin', { age: lifeDepletion }), color: RED_DOT }]
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

        <Panel label={t('dash.receipts')} hint="evidence-row">
          <EvidenceRow inputs={inputs} results={results} breakdown={breakdown} />
        </Panel>

        <Footnote>
          {t('dash.footnote')}
        </Footnote>
    </PageChrome>
  );
}

/** One line under the verdict: what this plan has never been told, and the
 *  way to tell it. Sits at the fold under the verdict number, which is the
 *  only prominence it needs. */
function DetailsRow({ inputs }: { inputs: RetirementInputs }) {
  const { t } = useTranslation('pages');
  const unset = unsetDetailGroups(inputs);
  const shown = unset.slice(0, 3).map(g => t(`dash.group.${g}`));
  const extra = unset.length - shown.length;
  const groups = `${shown.join(', ')}${extra > 0 ? t('dash.detailsMore', { n: extra }) : ''}`;
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-slate-200 pt-5">
      <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-slate-600">
        {unset.length > 0 ? t('dash.detailsMissing', { groups }) : t('dash.detailsComplete')}
      </p>
      <Link
        view="scenarios"
        className={unset.length > 0 ? cls.primaryBtn : cls.hairlineBtn}
      >
        {unset.length > 0 ? t('dash.detailsCta') : t('dash.detailsCtaComplete')}
      </Link>
    </div>
  );
}
