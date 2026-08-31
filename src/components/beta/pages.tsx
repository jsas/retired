// Beta page wrappers — each reuses the stable app's full-featured panel inside
// the beta page chrome (BetaPage). This is how the beta reaches feature parity
// without forking the complex editors: the surface is new, the substance is
// shared. The Details page and dashboard are native beta; these wrap the rest.
import type { ComponentProps } from 'react';
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

export function BetaSchedulePage({ chip, ...props }: ComponentProps<typeof ScheduleTable> & { chip: VerdictChip }) {
  return (
    <BetaPage title="Year-by-year" chip={chip}>
      <div className="pt-6"><ScheduleTable {...props} /></div>
    </BetaPage>
  );
}

export function BetaInsightsPage({ chip, eqProps, optimizeProps, mcProps, backtestProps }: {
  chip: VerdictChip;
  eqProps: ComponentProps<typeof EqPage>;
  optimizeProps: ComponentProps<typeof OptimizeCard>;
  mcProps: ComponentProps<typeof MonteCarloChart> | null;
  backtestProps: ComponentProps<typeof BacktestPanel> | null;
}) {
  return (
    <BetaPage title="Insights" chip={chip}>
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

export function BetaPlansPage({ chip, managerProps, compareProps }: {
  chip: VerdictChip;
  managerProps: ComponentProps<typeof ScenarioManager>;
  compareProps: ComponentProps<typeof CompareCard>;
}) {
  return (
    <BetaPage title="Plans" chip={chip}>
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

export function BetaDataPage({ chip, ...props }: ComponentProps<typeof SharingPage> & { chip: VerdictChip }) {
  return (
    <BetaPage title="Data — backup, restore, share" chip={chip}>
      <div className="pt-6"><SharingPage {...props} /></div>
    </BetaPage>
  );
}

export function BetaSettingsPage({ chip, ...props }: ComponentProps<typeof SettingsModal> & { chip: VerdictChip }) {
  return (
    <BetaPage title="Settings" chip={chip}>
      <div className="pt-6"><SettingsModal {...props} /></div>
    </BetaPage>
  );
}

export function BetaConnectionsPage({ chip, ...props }: ComponentProps<typeof ConnectionsPage> & { chip: VerdictChip }) {
  return (
    <BetaPage title="Assistant connection" chip={chip}>
      <div className="pt-6"><ConnectionsPage {...props} /></div>
    </BetaPage>
  );
}

export function BetaHelpPage({ chip }: { chip: VerdictChip }) {
  return (
    <BetaPage title="Help" chip={chip}>
      <div className="pt-6"><HelpModal /></div>
    </BetaPage>
  );
}
