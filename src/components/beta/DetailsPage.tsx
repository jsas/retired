// The details page — the whole plan in one place. The three top-level levers
// sit at the top; the thirteen sections follow, all open in a single scroll
// under plain-name groups. The Details ▾ menu lands here scrolled to the
// tapped section (?section=…). Two-col on desktop, one-col on mobile. Every
// field edits the real plan; the verdict, map and dock recompute together.
import { useEffect, useRef } from 'react';
import type { RetirementInputs, WithdrawalAccount, SpendingBand } from '@retired/engine-core/retirementEngine';
import { Panel, Fader } from '../../design/primitives';
import { DETAILS_GROUPS, DETAILS_SECTIONS } from './detailsSections';
import { getRangePrefs } from '../../lib/rangePrefs';

const fmtMoney = (v: number) => '$' + Math.round(v).toLocaleString('en-CA');

/* Small labelled number input — flat hairline, tabular numerals. */
function Num({ label, value, onChange, step = 1000, min, suffix, hint }: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; suffix?: string; hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-slate-500">{label}</span>
      <span className="mt-0.5 flex items-baseline gap-1">
        <input
          type="number"
          className="num w-full border border-slate-300 bg-white px-2 py-1.5 text-[13px] text-slate-900 focus:border-slate-900 focus:outline-none"
          value={Number.isFinite(value) ? value : 0}
          step={step} min={min}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix && <span className="text-[11px] text-slate-400">{suffix}</span>}
      </span>
      {hint && <span className="mt-0.5 block text-[10.5px] text-slate-400">{hint}</span>}
    </label>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={`details-${id}`} className="border-b border-slate-200 py-6">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

const ACCOUNT_LABEL: Record<WithdrawalAccount, string> = { rrsp: 'RRSP', tfsa: 'TFSA', taxable: 'Taxable', rdsp: 'RDSP' };

export function DetailsPage({ inputs, onChange, section }: {
  inputs: RetirementInputs;
  onChange: (next: RetirementInputs) => void;
  section?: string | null;
}) {
  const set = (patch: Partial<RetirementInputs>) => onChange({ ...inputs, ...patch });
  const scrolled = useRef(false);

  // Scroll to the deep-linked section once (Details ▾ → ?section=…).
  useEffect(() => {
    if (!section || scrolled.current) return;
    const el = document.getElementById(`details-${section}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); scrolled.current = true; }
  }, [section]);

  const order = inputs.withdrawalOrder ?? ['tfsa', 'taxable', 'rrsp'];
  const move = (i: number, dir: -1 | 1) => {
    const next = [...order];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set({ withdrawalOrder: next });
  };

  const bands = inputs.spendingBands ?? [];
  // Lever ranges are a user preference (Settings); the faders read them here.
  const ranges = getRangePrefs();

  const visibleSections = DETAILS_SECTIONS.filter(s => {
    if (s.conditional === 'rdsp') return inputs.rdsp != null;
    if (s.conditional === 'fhsa') return inputs.fhsa != null;
    if (s.conditional === 'home') return inputs.reverseMortgage?.enabled === true;
    return true;
  });

  return (
    <div>
      {/* the three levers, on the page too */}
      <Panel label="The big three">
        <div className="grid gap-6 md:grid-cols-3">
          <Fader label="Stop working at" value={inputs.retirementAge} min={inputs.currentAge} max={75} step={1}
            format={(v) => `${v}`} onChange={(v) => set({ retirementAge: v })} />
          <Fader label="Spend a year" value={inputs.desiredSpending} min={0} max={ranges.spendingMax} step={1000}
            format={fmtMoney} onChange={(v) => set({ desiredSpending: v })} />
          <Fader label="Markets" value={Math.round(inputs.investmentReturn * 1000) / 10} min={ranges.returnMin * 100} max={ranges.returnMax * 100} step={0.1}
            format={(v) => `${v.toFixed(1)}%`} onChange={(v) => set({ investmentReturn: v / 100 })} />
        </div>
      </Panel>

      {DETAILS_GROUPS.map(group => {
        const sections = visibleSections.filter(s => s.group === group);
        if (!sections.length) return null;
        return (
          <div key={group} className="pt-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{group}</h2>
            <div className="grid gap-x-10 md:grid-cols-2">
              {sections.map(s => (
                <div key={s.id}>{renderSection(s.id, { inputs, set, order, move, bands })}</div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Render one section's editor. Each is intentionally simple — the full-featured
   editors (multi-source income, events, RDSP/FHSA wizards) live on the stable
   app's pages; this page covers the always-present core so the plan is fully
   editable in one place. */
function renderSection(id: string, ctx: {
  inputs: RetirementInputs;
  set: (p: Partial<RetirementInputs>) => void;
  order: WithdrawalAccount[];
  move: (i: number, dir: -1 | 1) => void;
  bands: SpendingBand[];
}) {
  const { inputs: inp, set, order, move, bands } = ctx;
  switch (id) {
    case 'profile':
      return (
        <Section id="profile" title="Personal Profile">
          <div className="grid grid-cols-2 gap-3">
            <Num label="Current age" value={inp.currentAge} step={1} onChange={(v) => set({ currentAge: v })} />
            <Num label="Plan to age" value={inp.maxAge} step={1} onChange={(v) => set({ maxAge: v })} />
          </div>
          <label className="block">
            <span className="text-[12px] text-slate-500">Province</span>
            <input className="mt-0.5 w-full border border-slate-300 bg-white px-2 py-1.5 text-[13px] uppercase focus:border-slate-900 focus:outline-none"
              value={inp.provinceCode} onChange={(e) => set({ provinceCode: e.target.value.toUpperCase() })} />
          </label>
        </Section>
      );
    case 'spouse':
      return (
        <Section id="spouse" title="Spouse">
          <p className="text-[12.5px] leading-relaxed text-slate-500">
            {inp.spouse?.enabled
              ? 'A partner plan is combined for household totals. Edit the partner\'s balances and benefits in the stable app\'s Spouse section for now — the combined verdict already shows here.'
              : 'No partner on this plan. Adding one combines a second plan for household totals.'}
          </p>
        </Section>
      );
    case 'accounts':
      return (
        <Section id="accounts" title="Account Balances">
          <div className="grid grid-cols-2 gap-3">
            <Num label="RRSP" value={inp.rrspBalance} onChange={(v) => set({ rrspBalance: v })} />
            <Num label="TFSA" value={inp.tfsaBalance} onChange={(v) => set({ tfsaBalance: v })} />
            <Num label="Taxable" value={inp.taxableBalance} onChange={(v) => set({ taxableBalance: v })} />
            <Num label="Cash cushion" value={inp.cashCushionBalance} onChange={(v) => set({ cashCushionBalance: v })} />
          </div>
        </Section>
      );
    case 'contributions':
      return (
        <Section id="contributions" title="Contribution Rates">
          <div className="grid grid-cols-2 gap-3">
            <Num label="RRSP / yr" value={inp.rrspContribution} onChange={(v) => set({ rrspContribution: v })} />
            <Num label="TFSA / yr" value={inp.tfsaContribution} onChange={(v) => set({ tfsaContribution: v })} />
            <Num label="Taxable / yr" value={inp.taxableContribution} onChange={(v) => set({ taxableContribution: v })} />
          </div>
        </Section>
      );
    case 'income':
      return (
        <Section id="income" title="Income">
          <p className="text-[12.5px] leading-relaxed text-slate-500">
            {(inp.income ?? []).length} source{(inp.income ?? []).length === 1 ? '' : 's'} on the plan
            {(inp.income ?? []).length > 0 ? ` — ${(inp.income ?? []).map(s => s.label || s.kind).join(', ')}` : ''}.
            Add and edit work, pensions and rentals in the stable app\'s Income section; the verdict here already counts them.
          </p>
        </Section>
      );
    case 'benefits':
      return (
        <Section id="benefits" title="Government Benefits">
          <div className="grid grid-cols-2 gap-3">
            <Num label="CPP start age" value={inp.cppStartAge ?? 65} step={1} min={60} onChange={(v) => set({ cppStartAge: v })} />
            <Num label="CPP monthly (at 65)" value={inp.cppMonthlyAmount} step={50} onChange={(v) => set({ cppMonthlyAmount: v })} />
            <Num label="OAS start age" value={inp.oasStartAge ?? 65} step={1} min={65} onChange={(v) => set({ oasStartAge: v })} />
            <Num label="OAS years in Canada" value={inp.oasYearsInCanada} step={1} onChange={(v) => set({ oasYearsInCanada: v })} />
          </div>
        </Section>
      );
    case 'events':
      return (
        <Section id="events" title="Cash Events">
          <p className="text-[12.5px] leading-relaxed text-slate-500">
            {(inp.events ?? []).length} event{(inp.events ?? []).length === 1 ? '' : 's'} on the plan
            {(inp.events ?? []).length > 0 ? ` — ${(inp.events ?? []).map(e => e.label || 'event').join(', ')}` : ''}.
            One-time and recurring in- and out-flows are edited in the stable app\'s Cash Events section.
          </p>
        </Section>
      );
    case 'spending':
      return (
        <Section id="spending" title="Spending Phases">
          <p className="text-[12px] text-slate-500">Base spending is the "Spend a year" lever above. Phases scale it by age (go-go / slow-go / no-go).</p>
          {bands.length === 0 && <p className="text-[12.5px] text-slate-400">No phases — spending stays flat.</p>}
          <div className="space-y-2">
            {bands.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <Num label="From age" value={b.fromAge} step={1} onChange={(v) => {
                  const next = [...bands]; next[i] = { ...b, fromAge: v }; set({ spendingBands: next });
                }} />
                <Num label="% of base" value={Math.round(b.pctOfBase * 100)} step={5} onChange={(v) => {
                  const next = [...bands]; next[i] = { ...b, pctOfBase: v / 100 }; set({ spendingBands: next });
                }} />
                <button className="mt-4 text-slate-400 hover:text-rose-600" aria-label="Remove phase"
                  onClick={() => set({ spendingBands: bands.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
          </div>
          <button className="mt-1 border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900"
            onClick={() => set({ spendingBands: [...bands, { fromAge: (bands[bands.length - 1]?.fromAge ?? inp.retirementAge) + 10, pctOfBase: 0.8 }] })}>
            + add a phase
          </button>
        </Section>
      );
    case 'withdrawal':
      return (
        <Section id="withdrawal" title="Withdrawal Strategy">
          <p className="text-[12px] text-slate-500">The order accounts are drawn down.</p>
          <ol className="space-y-1.5">
            {order.map((acc, i) => (
              <li key={acc} className="flex items-center gap-2 border border-slate-200 px-2 py-1.5">
                <span className="num w-5 text-[11px] text-slate-400">{i + 1}</span>
                <span className="flex-1 text-[13px] text-slate-800">{ACCOUNT_LABEL[acc]}</span>
                <button className="px-1 text-slate-400 hover:text-slate-900 disabled:opacity-30" disabled={i === 0}
                  onClick={() => move(i, -1)} aria-label="Move earlier">↑</button>
                <button className="px-1 text-slate-400 hover:text-slate-900 disabled:opacity-30" disabled={i === order.length - 1}
                  onClick={() => move(i, 1)} aria-label="Move later">↓</button>
              </li>
            ))}
          </ol>
        </Section>
      );
    case 'debts':
      return (
        <Section id="debts" title="Debts">
          <p className="text-[12.5px] leading-relaxed text-slate-500">
            Mortgages and consumer debts raise yearly withdrawals until paid off. Manage them in the stable app\'s Debts section; the verdict here already counts the payments.
          </p>
        </Section>
      );
    case 'home':
      return (
        <Section id="home" title="Home Equity">
          {inp.reverseMortgage?.enabled ? (
            <div className="grid grid-cols-2 gap-3">
              <Num label="Home value" value={inp.reverseMortgage.homeValue} step={5000} onChange={(v) => set({ reverseMortgage: { ...inp.reverseMortgage!, homeValue: v } })} />
              <Num label="Loan rate %" value={Math.round(inp.reverseMortgage.interestRate * 1000) / 10} step={0.1} onChange={(v) => set({ reverseMortgage: { ...inp.reverseMortgage!, interestRate: v / 100 } })} />
            </div>
          ) : (
            <p className="text-[12.5px] text-slate-500">No reverse mortgage on this plan.</p>
          )}
        </Section>
      );
    case 'rdsp':
      return (
        <Section id="rdsp" title="RDSP (Disability Savings)">
          <p className="text-[12.5px] text-slate-500">An RDSP is enabled on this plan. Grants, bonds and withdrawals are configured in the stable app\'s RDSP section.</p>
        </Section>
      );
    case 'fhsa':
      return (
        <Section id="fhsa" title="FHSA (First Home Savings)">
          <p className="text-[12.5px] text-slate-500">An FHSA is enabled — contributions accumulate and transfer to the RRSP at retirement. Configured in the stable app\'s FHSA section.</p>
        </Section>
      );
    default:
      return null;
  }
}
