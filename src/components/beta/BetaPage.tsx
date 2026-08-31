// The shared beta page chrome — brand header, the named homes (Details ▾,
// Plans ▾, Schedule, Insights, Data, style guide), and the persistent verdict
// chip. Every beta page sits inside this so navigation and the answer are
// always one glance away. Flat, hairline, sticky.
import type { ReactNode } from 'react';
import { Link } from './nav';
import { Dropdown } from '../../design/primitives';
import { BLUE, RED_DOT, AMBER_DOT, cls } from '../../design/tokens';
import { DETAILS_SECTIONS } from './detailsSections';

export interface VerdictChip {
  tone: 'holds' | 'short' | 'borderline' | 'checking';
  age: string;
  label: string;
}

function chipDot(tone: VerdictChip['tone']) {
  return tone === 'holds' ? BLUE : tone === 'short' ? RED_DOT : tone === 'borderline' ? AMBER_DOT : '#94a3b8';
}

export function BetaPage({ title, chip, actions, children }: {
  title?: string;
  chip: VerdictChip;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-800">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-1 px-4">
          <Link view="projection" className="flex h-6 w-6 shrink-0 items-center justify-center bg-slate-900 text-[10px] font-bold text-white" aria-label="Dashboard">
            RE:
          </Link>

          <Dropdown label="Details" wide>
            <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              The full plan — every section one click away
            </p>
            <div className="grid grid-cols-2 gap-px">
              {DETAILS_SECTIONS.map(s => (
                <Link key={s.id} view="details" section={s.id} className="px-2 py-1.5 text-[12.5px] text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                  {s.label}
                </Link>
              ))}
            </div>
            <p className="border-t border-slate-100 px-2 pt-1.5 text-[10.5px] text-slate-400">
              The map steers the two biggest of these. The rest live here.
            </p>
          </Dropdown>

          <Link view="math" className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Schedule</Link>
          <Link view="eq" className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Insights</Link>
          <Link view="scenarios" className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Plans</Link>
          <Link view="data" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Data</Link>
          <Link view="settings" className="hidden px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 md:block">Settings</Link>

          <div className="flex-1" />
          {actions}

          {/* the persistent verdict chip */}
          <Link view="projection" className="flex items-center gap-2 border-l border-slate-200 pl-3" aria-label="Back to the verdict">
            <span className="inline-block h-2.5 w-2.5" style={{ backgroundColor: chipDot(chip.tone) }} />
            <span className="num text-[14px] font-bold text-slate-900">{chip.age}</span>
            <span className="hidden text-[9px] uppercase tracking-wider text-slate-400 sm:block">{chip.label}</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16">
        {title && (
          <div className="border-b border-slate-200 pb-4 pt-8">
            <p className={cls.sectionLabel}>{title}</p>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
