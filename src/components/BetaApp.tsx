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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { RetirementInputs, RetirementResults } from '@retired/engine-core/retirementEngine';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { BETA_COOKIE_NAME } from '../lib/betaSkin';
import { getRangePrefs } from '../lib/rangePrefs';
import { VerdictHero, Panel, Fader, Footnote, HelpHint } from '../design/primitives';
import { INK, RED_DOT } from '../design/tokens';
import { ProjectionTimeline, baseSpendAtRetirement } from '../design/ProjectionTimeline';
import { BetaPage, type VerdictChip } from './beta/BetaPage';
import { ContourMap } from './beta/ContourMap';
import { MarketDial } from './beta/MarketDial';
import { DownMarketCheck } from './beta/DownMarketCheck';
import { EvidenceRow } from './beta/EvidenceRow';
import { firstEmptyAge, potDisplay } from '../lib/planDisplay';
import { useAppLocale } from '../lib/localeContext';

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
  inputs: RetirementInputs;
  onInputsChange: (next: RetirementInputs) => void;
  results: RetirementResults;
  config: AppConfig;
  /** The assistant conversation, docked on the right (f7's star). */
  assistant?: ReactNode;
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

export function BetaApp({
  inputs, onInputsChange, results, config, assistant,
}: BetaAppProps) {
  const { t } = useTranslation('pages');
  const { t: tHelp } = useTranslation('help');
  const { locale } = useAppLocale();
  const money = (v: number) => fmtMoney(v, locale);
  const v = verdict(inputs, results, t);
  const breakdown = results.yearlyBreakdown ?? [];
  const pot = potDisplay(breakdown, inputs.maxAge);
  // Where the investable pot hits $0 (null = leftover at the horizon).
  const lifeDepletion = firstEmptyAge(breakdown);
  const window = mapWindow({ desiredSpending: inputs.desiredSpending });
  const chip: VerdictChip = {
    tone: pot.holds ? 'holds' : (pot.emptyAge != null && inputs.maxAge - pot.emptyAge <= 6) ? 'borderline' : 'short',
    age: pot.holds ? `${inputs.maxAge}+` : `${pot.lastsTo ?? '—'}`,
    label: pot.holds ? t('holds') : t('short'),
  };
  return (
    <BetaPage chip={chip} assistant={assistant}>
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
          {t('dash.footnote')}{' '}
          <a className="underline" href="?beta">{t('dash.openOld')}</a>{' '}
          {t('dash.cookieRemembers', { cookie: BETA_COOKIE_NAME })}{' '}
          <a className="underline" href="?beta=off">{t('dash.backToApp')}</a>)
        </Footnote>
    </BetaPage>
  );
}

function fmtMoney(v: number, locale = 'en-CA') {
  return '$' + Math.round(v).toLocaleString(locale);
}
