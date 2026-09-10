// Beta page wrappers — each reuses the stable app's full-featured panel inside
// the beta page chrome (BetaPage). This is how the beta reaches feature parity
// without forking the complex editors: the surface is new, the substance is
// shared. The Plans page (list + current-plan numbers) and dashboard are
// native beta; these wrap the rest.
//
// Issue #162 split the old combined Insights page into the five Tools-menu
// surfaces (Steering · Optimizer · Monte Carlo · Backtest · Solver). Every
// tool page features the shared ProjectStrip — the same ProjectionTimeline the
// dashboard draws — so each tool answers its question with the plan's shape
// always on screen.
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { YearlyBreakdown, RetirementInputs } from '@retired/engine-core/retirementEngine';
import { BetaPage, type VerdictChip } from './BetaPage';
import { HelpHint } from '../../design/primitives';
import { ProjectionTimeline, baseSpendAtRetirement } from '../../design/ProjectionTimeline';
import type { TimelineEvent, TimelineMarketAnchor } from '../../design/ProjectionTimeline';
import { INK, RED_DOT } from '../../design/tokens';
import { firstEmptyAge } from '../../lib/planDisplay';
import { ScheduleTable } from '../ScheduleTable';
import { EqPage } from '../EqPage';
import { StrategyExplorer, SpendingSolver } from '../OptimizeCard';
import { BacktestPanel } from '../BacktestPanel';
import { MonteCarloChart } from '../MonteCarloChart';
import { ScenarioManager } from '../ScenarioManager';
import { CompareCard } from '../CompareCard';
import { DetailsPage } from './DetailsPage';
import { SharingPage } from '../SharingPage';
import { SettingsModal } from '../SettingsModal';
import { ConnectionsPage } from '../ConnectionsPage';
import { HelpModal } from '../HelpModal';
import { PrintOptionsCard } from '../PrintOptionsCard';
import { DonateCard } from '../DonateCard';
import { DataPage } from '../DataPage';

function usePageT() {
  const { t } = useTranslation('pages');
  return t;
}

/** The featured projection timeline — one line of money over age with the
 *  three pins that matter (you, start drawing, money runs out). Derived wholly
 *  from the household breakdown so it always matches the numbers beside it.
 *  With edit handlers present the timeline is LIVE here too: the draw-age pin
 *  drags, the spend handle drags, events and market anchors edit the plan. */
export function ProjectStrip({ breakdown, currentAge, retirementAge, edit }: {
  breakdown: YearlyBreakdown[];
  currentAge: number;
  retirementAge: number;
  /** Interactive plan hooks — pass to make the timeline live (dashboard and
   *  tool pages); omit on read-only surfaces (print). */
  edit?: {
    inputs: RetirementInputs;
    onInputsChange: (next: RetirementInputs) => void;
    inflationRate: number;
  };
}) {
  const { t } = useTranslation('pages');
  const depletion = firstEmptyAge(breakdown);
  const e = edit;
  const baseSpend = e ? baseSpendAtRetirement(e.inputs, e.inflationRate, retirementAge) : undefined;
  return (
    <section>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {t('thisPlanEndToEnd')}<HelpHint topic="life-timeline" />
      </h3>
      <ProjectionTimeline
        series={[{ id: 'plan', label: t('portfolio'), color: INK, area: true, points: breakdown.map(r => ({ age: r.age, value: r.endingBalance })) }]}
        pins={[
          { age: currentAge, label: t('youPin', { age: currentAge }), place: 'below', anchor: 'start', color: INK },
          { age: retirementAge, label: t('startDrawingPin', { age: retirementAge }), color: '#475569',
            ...(e ? { onDragAge: (age: number) => e.onInputsChange({ ...e.inputs, retirementAge: Math.max(currentAge + 1, Math.min(e.inputs.maxAge - 1, age)) }) } : {}) },
          ...(depletion != null
            ? [{ age: depletion, label: t('runsOutPin', { age: depletion }), color: RED_DOT }]
            : []),
        ]}
        {...(e ? {
          spend: { points: breakdown.map(r => ({ age: r.age, value: r.spendingTarget })), baseSpend },
          onSpendChange: (today: number) => e.onInputsChange({ ...e.inputs, desiredSpending: Math.max(0, today) }),
          events: (e.inputs.events ?? []).map(ev => ({ id: ev.id, age: ev.age, amount: ev.amount, direction: ev.direction, label: ev.label })),
          onEventChange: (next: TimelineEvent) => e.onInputsChange({ ...e.inputs, events: (e.inputs.events ?? []).map(ev => (ev.id === next.id ? { ...ev, age: next.age, amount: next.amount } : ev)) }),
          anchors: (e.inputs.marketPeriods ?? []).map(p => ({ id: p.id, age: p.age, return: p.return, volatility: p.volatility })),
          onAnchorsChange: (next: TimelineMarketAnchor[]) => e.onInputsChange({ ...e.inputs, marketPeriods: next.map(a => ({ id: a.id, age: a.age, return: a.return, volatility: a.volatility })) }),
        } : {})}
      />
    </section>
  );
}

/** The props every tool page shares to draw the strip. */
export interface ProjectStripProps {
  breakdown: YearlyBreakdown[];
  currentAge: number;
  retirementAge: number;
  /** Live-plan hooks; forwarded to ProjectStrip's `edit`. */
  edit?: {
    inputs: RetirementInputs;
    onInputsChange: (next: RetirementInputs) => void;
    inflationRate: number;
  };
}

export function BetaSchedulePage({ chip, assistant, timeline, ...props }: ComponentProps<typeof ScheduleTable> & {
  chip: VerdictChip;
  assistant?: ReactNode;
  timeline: ProjectStripProps;
}) {
  const t = usePageT();
  return (
    <BetaPage title={t('projection')} hint="schedule-columns" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ProjectStrip {...timeline} />
        <ScheduleTable {...props} />
      </div>
    </BetaPage>
  );
}

// ── The Tools menu (issue #162): five surfaces, five pages ─────────────────

export function BetaSteeringPage({ chip, assistant, eqProps }: {
  chip: VerdictChip;
  assistant?: ReactNode;
  /** Unused on this page — kept so App can pass the same timeline props to
   *  every tool page uniformly. */
  timeline?: ProjectStripProps;
  eqProps: ComponentProps<typeof EqPage>;
}) {
  const t = usePageT();
  return (
    <BetaPage title={t('steering')} hint="levers-ranked" chip={chip} assistant={assistant}>
      {/* No separate ProjectStrip here on purpose: EqPage already features the
          same ProjectionTimeline under its controls (the `projection` prop),
          live-redrawing as you drag — the strip with a second copy under it
          would just repeat itself. */}
      <div className="pt-6">
        <EqPage {...eqProps} />
      </div>
    </BetaPage>
  );
}

export function BetaOptimizerPage({ chip, assistant, timeline, optimizeProps }: {
  chip: VerdictChip;
  assistant?: ReactNode;
  timeline: ProjectStripProps;
  optimizeProps: ComponentProps<typeof StrategyExplorer>;
}) {
  const t = usePageT();
  return (
    <BetaPage title={t('optimizer')} hint="strategy-explorer" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ProjectStrip {...timeline} />
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{t('namedVariants')}<HelpHint topic="strategy-explorer" /></h3>
          <StrategyExplorer {...optimizeProps} />
        </section>
      </div>
    </BetaPage>
  );
}

export function BetaMonteCarloPage({ chip, assistant, timeline, mcProps }: {
  chip: VerdictChip;
  assistant?: ReactNode;
  timeline: ProjectStripProps;
  mcProps: ComponentProps<typeof MonteCarloChart> | null;
}) {
  const t = usePageT();
  return (
    <BetaPage title={t('monteCarlo')} hint="monte-carlo" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ProjectStrip {...timeline} />
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{t('acrossFutures')}<HelpHint topic="monte-carlo" /></h3>
          {mcProps
            ? <MonteCarloChart {...mcProps} />
            : <p className="text-[12px] text-slate-500">{t('monteCarloNeedsVol')}</p>}
        </section>
      </div>
    </BetaPage>
  );
}

export function BetaBacktestPage({ chip, assistant, timeline, backtestProps }: {
  chip: VerdictChip;
  assistant?: ReactNode;
  timeline: ProjectStripProps;
  backtestProps: ComponentProps<typeof BacktestPanel> | null;
}) {
  const t = usePageT();
  return (
    <BetaPage title={t('backtest')} hint="backtest" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ProjectStrip {...timeline} />
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{t('againstHistory')}<HelpHint topic="backtest" /></h3>
          {backtestProps
            ? <BacktestPanel {...backtestProps} />
            : <p className="text-[12px] text-slate-500">{t('backtestComputing')}</p>}
        </section>
      </div>
    </BetaPage>
  );
}

export function BetaSolverPage({ chip, assistant, timeline, solverProps }: {
  chip: VerdictChip;
  assistant?: ReactNode;
  timeline: ProjectStripProps;
  solverProps: ComponentProps<typeof SpendingSolver>;
}) {
  const t = usePageT();
  return (
    <BetaPage title={t('solver')} hint="optimize-spending" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ProjectStrip {...timeline} />
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{t('howMuchSpend')}<HelpHint topic="optimize-spending" /></h3>
          <SpendingSolver {...solverProps} />
        </section>
      </div>
    </BetaPage>
  );
}

export function BetaPlansPage({ chip, assistant, managerProps, compareProps, detailsProps }: {
  chip: VerdictChip;
  assistant?: ReactNode;
  managerProps: ComponentProps<typeof ScenarioManager>;
  compareProps: ComponentProps<typeof CompareCard>;
  detailsProps: ComponentProps<typeof DetailsPage>;
}) {
  const t = usePageT();
  return (
    <BetaPage title={t('plans')} hint="scenarios" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ScenarioManager {...managerProps} />
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{t('thisPlan')}<HelpHint topic="scenarios" /></h3>
          <DetailsPage {...detailsProps} />
        </section>
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{t('comparePlans')}<HelpHint topic="compare" /></h3>
          <CompareCard {...compareProps} />
        </section>
      </div>
    </BetaPage>
  );
}

export function BetaDataPage({ chip, assistant, ...props }: ComponentProps<typeof SharingPage> & ComponentProps<typeof DataPage> & { chip: VerdictChip; assistant?: ReactNode }) {
  const t = usePageT();
  return (
    <BetaPage title={t('data')} hint="data-backup-restore" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        {/* share a plan — link/code, in and out */}
        <SharingPage {...props} />
        {/* backup, restore, projection export — the full file surface */}
        <DataPage {...props} />
      </div>
    </BetaPage>
  );
}

export function BetaSettingsPage({ chip, assistant, ...props }: ComponentProps<typeof SettingsModal> & { chip: VerdictChip; assistant?: ReactNode }) {
  const t = usePageT();
  return (
    <BetaPage title={t('settings')} chip={chip} assistant={assistant}>
      <div className="pt-6"><SettingsModal {...props} /></div>
    </BetaPage>
  );
}

export function BetaConnectionsPage({ chip, assistant, ...props }: ComponentProps<typeof ConnectionsPage> & { chip: VerdictChip; assistant?: ReactNode }) {
  const t = usePageT();
  return (
    <BetaPage title={t('models')} hint="assistant-local-vs-online" chip={chip} assistant={assistant}>
      <div className="pt-6"><ConnectionsPage {...props} /></div>
    </BetaPage>
  );
}

export function BetaHelpPage({ chip, assistant }: { chip: VerdictChip; assistant?: ReactNode }) {
  const t = usePageT();
  return (
    <BetaPage title={t('help')} chip={chip} assistant={assistant}>
      <div className="pt-6"><HelpModal /></div>
    </BetaPage>
  );
}

export function BetaPrintPage({ chip, assistant, ...props }: ComponentProps<typeof PrintOptionsCard> & { chip: VerdictChip; assistant?: ReactNode }) {
  const t = usePageT();
  return (
    <BetaPage title={t('print')} hint="print-export" chip={chip} assistant={assistant}>
      <div className="pt-6"><PrintOptionsCard {...props} /></div>
    </BetaPage>
  );
}

export function BetaDonatePage({ chip, assistant }: { chip: VerdictChip; assistant?: ReactNode }) {
  const t = usePageT();
  return (
    <BetaPage title={t('support')} chip={chip} assistant={assistant}>
      <div className="pt-6"><DonateCard /></div>
    </BetaPage>
  );
}
