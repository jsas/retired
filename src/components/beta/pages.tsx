// Beta page wrappers — each reuses the stable app's full-featured panel inside
// the beta page chrome (BetaPage). This is how the beta reaches feature parity
// without forking the complex editors: the surface is new, the substance is
// shared. The Details page and dashboard are native beta; these wrap the rest.
import type { ComponentProps, ReactNode } from 'react';
import { BetaPage, type VerdictChip } from './BetaPage';
import { ScheduleTable } from '../ScheduleTable';
import { EqPage } from '../EqPage';
import { OptimizeCard } from '../OptimizeCard';
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

export function BetaSchedulePage({ chip, assistant, ...props }: ComponentProps<typeof ScheduleTable> & { chip: VerdictChip; assistant?: ReactNode }) {
  return (
    <BetaPage title="Year-by-year" chip={chip} assistant={assistant}>
      <div className="pt-6"><ScheduleTable {...props} /></div>
    </BetaPage>
  );
}

export function BetaInsightsPage({ chip, assistant, eqProps, optimizeProps, mcProps, backtestProps }: {
  chip: VerdictChip;
  assistant?: ReactNode;
  eqProps: ComponentProps<typeof EqPage>;
  optimizeProps: ComponentProps<typeof OptimizeCard>;
  mcProps: ComponentProps<typeof MonteCarloChart> | null;
  backtestProps: ComponentProps<typeof BacktestPanel> | null;
}) {
  return (
    <BetaPage title="Insights" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">The levers, ranked</h3>
          <EqPage {...eqProps} />
        </section>
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">How much can you safely spend</h3>
          <OptimizeCard {...optimizeProps} />
        </section>
        {mcProps && (
          <section>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Across many market futures</h3>
            <MonteCarloChart {...mcProps} />
          </section>
        )}
        {backtestProps && (
          <section>
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Against history</h3>
            <BacktestPanel {...backtestProps} />
          </section>
        )}
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
    <BetaPage title="Plans" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <ScenarioManager {...managerProps} />
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Compare plans</h3>
          <CompareCard {...compareProps} />
        </section>
      </div>
    </BetaPage>
  );
}

export function BetaDataPage({ chip, assistant, ...props }: ComponentProps<typeof SharingPage> & { chip: VerdictChip; assistant?: ReactNode }) {
  return (
    <BetaPage title="Data — backup, restore, share" chip={chip} assistant={assistant}>
      <div className="pt-6"><SharingPage {...props} /></div>
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
    <BetaPage title="Assistant connection" chip={chip} assistant={assistant}>
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
    <BetaPage title="Print & export" chip={chip} assistant={assistant}>
      <div className="pt-6 max-w-2xl"><PrintOptionsCard {...props} /></div>
    </BetaPage>
  );
}

export function BetaDonatePage({ chip, assistant }: { chip: VerdictChip; assistant?: ReactNode }) {
  return (
    <BetaPage title="Support this app" chip={chip} assistant={assistant}>
      <div className="pt-6 max-w-2xl"><DonateCard /></div>
    </BetaPage>
  );
}

export function BetaExportPage({ chip, assistant, ...props }: ComponentProps<typeof DataPage> & { chip: VerdictChip; assistant?: ReactNode }) {
  return (
    <BetaPage title="Data — backup, restore, share" chip={chip} assistant={assistant}>
      <div className="pt-6"><DataPage {...props} /></div>
    </BetaPage>
  );
}
