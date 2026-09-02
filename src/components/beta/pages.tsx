// Beta page wrappers — each reuses the stable app's full-featured panel inside
// the beta page chrome (BetaPage). This is how the beta reaches feature parity
// without forking the complex editors: the surface is new, the substance is
// shared. The Details page and dashboard are native beta; these wrap the rest.
//
// Issue #162 split the old combined Insights page into the five Tools-menu
// surfaces (Steering · Optimizer · Monte Carlo · Backtest · Solver). Every
// tool page features the shared ProjectStrip — the same ProjectionTimeline the
// dashboard draws — so each tool answers its question with the plan's shape
// always on screen.
import type { ComponentProps, ReactNode } from 'react';
import type { YearlyBreakdown } from '@retired/engine-core/retirementEngine';
import { BetaPage, type VerdictChip } from './BetaPage';
import { HelpHint } from '../../design/primitives';
import { ProjectionTimeline } from '../../design/ProjectionTimeline';
import { INK, RED_DOT } from '../../design/tokens';
import { ScheduleTable } from '../ScheduleTable';
import { EqPage } from '../EqPage';
import { StrategyExplorer, SpendingSolver } from '../OptimizeCard';
import { BacktestPanel } from '../BacktestPanel';
import { MonteCarloChart } from '../MonteCarloChart';
import { ScenarioManager } from '../ScenarioManager';
import { CompareCard } from '../CompareCard';
import { SharingPage } from '../SharingPage';
import { SettingsModal } from '../SettingsModal';
import { ConnectionsPage } from '../ConnectionsPage';
import { HelpModal } from '../HelpModal';
import { PrintOptionsCard } from '../PrintOptionsCard';
import { DonateCard } from '../DonateCard';
import { DataPage } from '../DataPage';

/** The featured projection timeline — one line of money over age with the
 *  three pins that matter (you, work ends, money runs out). Derived wholly
 *  from the household breakdown so it always matches the numbers beside it. */
export function ProjectStrip({ breakdown, currentAge, retirementAge }: {
  breakdown: YearlyBreakdown[];
  currentAge: number;
  retirementAge: number;
}) {
  const depletion = breakdown.find(r => r.endingBalance <= 0)?.age ?? null;
  return (
    <section>
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        This plan, end to end<HelpHint topic="life-timeline" />
      </h3>
      <ProjectionTimeline
        series={[{ id: 'plan', label: 'portfolio', color: INK, area: true, points: breakdown.map(r => ({ age: r.age, value: r.endingBalance })) }]}
        pins={[
          { age: currentAge, label: `you · ${currentAge}`, place: 'below', anchor: 'start', color: INK },
          { age: retirementAge, label: `work ends · ${retirementAge}`, color: '#475569' },
          ...(depletion != null
            ? [{ age: depletion, label: `money runs out · ${depletion}`, color: RED_DOT }]
            : []),
        ]}
      />
    </section>
  );
}

/** The props every tool page shares to draw the strip. */
export interface ProjectStripProps {
  breakdown: YearlyBreakdown[];
  currentAge: number;
  retirementAge: number;
}

export function BetaSchedulePage({ chip, assistant, timeline, ...props }: ComponentProps<typeof ScheduleTable> & {
  chip: VerdictChip;
  assistant?: ReactNode;
  timeline: ProjectStripProps;
}) {
  return (
    <BetaPage title="Projection" hint="schedule-columns" chip={chip} assistant={assistant}>
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
  return (
    <BetaPage title="Steering" hint="levers-ranked" chip={chip} assistant={assistant}>
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
  return (
    <BetaPage title="Optimizer" hint="strategy-explorer" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ProjectStrip {...timeline} />
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Named variants, scored<HelpHint topic="strategy-explorer" /></h3>
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
  return (
    <BetaPage title="Monte Carlo" hint="monte-carlo" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ProjectStrip {...timeline} />
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Across many market futures<HelpHint topic="monte-carlo" /></h3>
          {mcProps
            ? <MonteCarloChart {...mcProps} />
            : <p className="text-[12px] text-slate-500">Monte Carlo needs a volatility assumption — set one above 0% under Markets on the Details page and the fan appears.</p>}
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
  return (
    <BetaPage title="Backtest" hint="backtest" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ProjectStrip {...timeline} />
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Against history<HelpHint topic="backtest" /></h3>
          {backtestProps
            ? <BacktestPanel {...backtestProps} />
            : <p className="text-[12px] text-slate-500">The historical run is computing…</p>}
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
  return (
    <BetaPage title="Solver" hint="optimize-spending" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ProjectStrip {...timeline} />
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">How much can you safely spend<HelpHint topic="optimize-spending" /></h3>
          <SpendingSolver {...solverProps} />
        </section>
      </div>
    </BetaPage>
  );
}

export function BetaPlansPage({ chip, assistant, managerProps, compareProps }: {
  chip: VerdictChip;
  assistant?: ReactNode;
  managerProps: ComponentProps<typeof ScenarioManager>;
  compareProps: ComponentProps<typeof CompareCard>;
}) {
  return (
    <BetaPage title="Profiles" hint="scenarios" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ScenarioManager {...managerProps} />
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Compare profiles<HelpHint topic="compare" /></h3>
          <CompareCard {...compareProps} />
        </section>
      </div>
    </BetaPage>
  );
}

export function BetaDataPage({ chip, assistant, ...props }: ComponentProps<typeof SharingPage> & ComponentProps<typeof DataPage> & { chip: VerdictChip; assistant?: ReactNode }) {
  return (
    <BetaPage title="Data" hint="data-backup-restore" chip={chip} assistant={assistant}>
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
  return (
    <BetaPage title="Settings" chip={chip} assistant={assistant}>
      <div className="pt-6"><SettingsModal {...props} /></div>
    </BetaPage>
  );
}

export function BetaConnectionsPage({ chip, assistant, ...props }: ComponentProps<typeof ConnectionsPage> & { chip: VerdictChip; assistant?: ReactNode }) {
  return (
    <BetaPage title="Assistant connection" hint="assistant-local-vs-online" chip={chip} assistant={assistant}>
      <div className="pt-6"><ConnectionsPage {...props} /></div>
    </BetaPage>
  );
}

export function BetaHelpPage({ chip, assistant }: { chip: VerdictChip; assistant?: ReactNode }) {
  return (
    <BetaPage title="Help" chip={chip} assistant={assistant}>
      <div className="pt-6"><HelpModal /></div>
    </BetaPage>
  );
}

export function BetaPrintPage({ chip, assistant, ...props }: ComponentProps<typeof PrintOptionsCard> & { chip: VerdictChip; assistant?: ReactNode }) {
  return (
    <BetaPage title="Print & export" hint="print-export" chip={chip} assistant={assistant}>
      <div className="pt-6"><PrintOptionsCard {...props} /></div>
    </BetaPage>
  );
}

export function BetaDonatePage({ chip, assistant }: { chip: VerdictChip; assistant?: ReactNode }) {
  return (
    <BetaPage title="Support this app" chip={chip} assistant={assistant}>
      <div className="pt-6"><DonateCard /></div>
    </BetaPage>
  );
}
