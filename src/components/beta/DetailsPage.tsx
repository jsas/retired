// The details page — the whole plan in one place. The three top-level levers
// sit at the top; the thirteen sections follow, all open in a single scroll
// under plain-name groups. The Details ▾ menu lands here scrolled to the
// tapped section (?section=…). Two-col on desktop, one-col on mobile. Every
// field edits the real plan; the verdict, map and dock recompute together.
import { useEffect, useRef } from 'react';
import type { RetirementInputs, WithdrawalAccount, SpendingBand, CashEvent, IncomeSource, IncomeKind, Debt, MarketPeriod } from '@retired/engine-core/retirementEngine';
import { Panel, Fader, HelpHint, Check } from '../../design/primitives';
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
          value={Number.isFinite(value) ? value : ''}
          step={step} min={min}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
        />
        {suffix && <span className="text-[11px] text-slate-400">{suffix}</span>}
      </span>
      {hint && <span className="mt-0.5 block text-[10.5px] text-slate-400">{hint}</span>}
    </label>
  );
}

/* A small labelled text input, same flat hairline. */
function Txt({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-slate-500">{label}</span>
      <input
        type="text"
        className="mt-0.5 w-full border border-slate-300 bg-white px-2 py-1.5 text-[13px] text-slate-900 focus:border-slate-900 focus:outline-none"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/* A small labelled select, same flat hairline. */
function Sel<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-slate-500">{label}</span>
      <select
        className="mt-0.5 w-full border border-slate-300 bg-white px-2 py-1.5 text-[13px] text-slate-900 focus:border-slate-900 focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

const uid = () => Math.random().toString(36).slice(2, 9);
const INCOME_KIND_LABEL: Record<IncomeKind, string> = {
  employment: 'Employment', pension: 'Pension (DB/bridge)', selfEmployment: 'Self-employment', rental: 'Rental',
};
const DEBT_KIND_LABEL: Record<Debt['kind'], string> = {
  mortgage: 'Mortgage', creditCard: 'Credit card', loan: 'Loan', lineOfCredit: 'Line of credit', other: 'Other',
};

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={`details-${id}`} className="border-b border-slate-200 py-6">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{title}{hint && <HelpHint topic={hint} />}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

const ACCOUNT_LABEL: Record<WithdrawalAccount, string> = { rrsp: 'RRSP', tfsa: 'TFSA', taxable: 'Taxable', rdsp: 'RDSP' };

function defaultSpouse(primaryAge: number) {
  return {
    enabled: true,
    currentAge: primaryAge,
    retirementAge: primaryAge + 5,
    rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
    cppStartAge: 65 as number | null, cppMonthlyAmount: 0,
    oasStartAge: 65 as number | null, oasYearsInCanada: 40,
    desiredSpending: 0,
  };
}

export function DetailsPage({ inputs, onChange, section, provinceCodes }: {
  inputs: RetirementInputs;
  onChange: (next: RetirementInputs) => void;
  section?: string | null;
  /** The engine config's configured province codes — Province is a choice
   *  among these, not free text (mirrors the stable app's SidebarForm). */
  provinceCodes?: string[];
}) {
  const set = (patch: Partial<RetirementInputs>) => onChange({ ...inputs, ...patch });
  const provinces = provinceCodes && provinceCodes.length ? provinceCodes : null;
  const provinceKnown = !provinces || provinces.includes(inputs.provinceCode);
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
          <Fader label="Start Drawing" value={inputs.retirementAge} min={inputs.currentAge} max={75} step={1}
            format={(v) => `${v}`} onChange={(v) => set({ retirementAge: v })} />
          <Fader label="After Tax Spending" help="desired-spending" value={inputs.desiredSpending} min={0} max={ranges.spendingMax} step={1000}
            format={fmtMoney} onChange={(v) => set({ desiredSpending: v })} />
          <Fader label="Markets" help="expected-return" value={Math.round(inputs.investmentReturn * 1000) / 10} min={ranges.returnMin * 100} max={ranges.returnMax * 100} step={0.1}
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
                <div key={s.id}>{renderSection(s.id, { inputs, set, order, move, bands, provinces, provinceKnown })}</div>
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
  provinces: readonly string[] | null;
  provinceKnown: boolean;
}) {
  const { inputs: inp, set, order, move, bands, provinces, provinceKnown } = ctx;
  switch (id) {
    case 'profile':
      return (
        <Section id="profile" title="Personal Profile" hint="current-retirement-max-age">
          <div className="grid grid-cols-2 gap-3">
            <Num label="Current age" value={inp.currentAge} step={1} onChange={(v) => set({ currentAge: v })} />
            <Num label="Plan to age" value={inp.maxAge} step={1} onChange={(v) => set({ maxAge: v })} />
          </div>
          <label className="block">
            <span className="text-[12px] text-slate-500">Province</span>
            <select className="mt-0.5 w-full cursor-pointer border border-slate-300 bg-white px-2 py-1.5 text-[13px] focus:border-slate-900 focus:outline-none"
              value={inp.provinceCode} onChange={(e) => set({ provinceCode: e.target.value.toUpperCase() })}>
              {provinces && provinces.map(code => (
                <option key={code} value={code}>{code}</option>
              ))}
              {/* a plan from a share link / backup may carry a code the current
                  config doesn't list — keep it selectable rather than silently
                  rewriting the plan */}
              {!provinceKnown && <option value={inp.provinceCode}>{inp.provinceCode}</option>}
            </select>
          </label>
        </Section>
      );
    case 'spouse': {
      const sp = inp.spouse;
      const enabled = sp?.enabled === true;
      const setSpouse = (patch: Partial<NonNullable<typeof sp>>) =>
        set({ spouse: { ...(sp ?? defaultSpouse(inp.currentAge)), enabled: true, ...patch } });
      return (
        <Section id="spouse" title="Spouse" hint="include-spouse">
          <div className="flex items-center gap-1">
            <Check checked={enabled}
              onChange={(on) => {
                if (on) set({ spouse: { ...(sp ?? defaultSpouse(inp.currentAge)), enabled: true } });
                else set({ spouse: { ...(sp ?? defaultSpouse(inp.currentAge)), enabled: false } });
              }}
              label="Include a partner" />
            <HelpHint topic="include-spouse" />
          </div>
          {enabled && sp && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Num label="Partner age" value={sp.currentAge} step={1} onChange={(v) => setSpouse({ currentAge: v })} />
                <Num label="Retires at" value={sp.retirementAge} step={1} onChange={(v) => setSpouse({ retirementAge: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Num label="RRSP" value={sp.rrspBalance} onChange={(v) => setSpouse({ rrspBalance: v })} />
                <Num label="TFSA" value={sp.tfsaBalance} onChange={(v) => setSpouse({ tfsaBalance: v })} />
                <Num label="Taxable" value={sp.taxableBalance} onChange={(v) => setSpouse({ taxableBalance: v })} />
                <Num label="Cash cushion" value={sp.cashCushionBalance} onChange={(v) => setSpouse({ cashCushionBalance: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Num label="CPP start age" value={sp.cppStartAge ?? 65} step={1} min={60} onChange={(v) => setSpouse({ cppStartAge: v })} />
                <Num label="CPP monthly (at 65)" value={sp.cppMonthlyAmount} step={50} onChange={(v) => setSpouse({ cppMonthlyAmount: v })} />
                <Num label="OAS start age" value={sp.oasStartAge ?? 65} step={1} min={65} onChange={(v) => setSpouse({ oasStartAge: v })} />
                <Num label="OAS years in Canada" value={sp.oasYearsInCanada} step={1} onChange={(v) => setSpouse({ oasYearsInCanada: v })} />
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Contributions, income, events and phases for the partner are full-parity fields — the combined verdict already counts them.
              </p>
            </div>
          )}
        </Section>
      );
    }
    case 'accounts':
      return (
        <Section id="accounts" title="Account Balances" hint="rrsp">
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
        <Section id="contributions" title="Contribution Rates" hint="contributions">
          <div className="grid grid-cols-2 gap-3">
            <Num label="RRSP / yr" value={inp.rrspContribution} onChange={(v) => set({ rrspContribution: v })} />
            <Num label="TFSA / yr" value={inp.tfsaContribution} onChange={(v) => set({ tfsaContribution: v })} />
            <Num label="Taxable / yr" value={inp.taxableContribution} onChange={(v) => set({ taxableContribution: v })} />
          </div>
        </Section>
      );
    case 'income': {
      const list = inp.income ?? [];
      const add = () => set({ income: [...list, { id: uid(), label: '', kind: 'employment' as IncomeKind, annualAmount: 0, startAge: inp.currentAge, endAge: inp.retirementAge, indexedToCpi: true }] });
      const upd = (i: number, patch: Partial<IncomeSource>) => {
        const next = [...list]; next[i] = { ...list[i], ...patch }; set({ income: next });
      };
      return (
        <Section id="income" title="Income" hint="income">
          {list.length === 0 && <p className="text-[12.5px] text-slate-400">No income on the plan yet.</p>}
          <div className="space-y-2">
            {list.map((s, i) => (
              <div key={s.id} className="space-y-2 border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1"><Txt label="Name" value={s.label} placeholder="e.g. Day job, DB pension, rental" onChange={(v) => upd(i, { label: v })} /></div>
                  <button type="button" className="mt-4 px-1 text-slate-400 hover:text-rose-600" aria-label={`Remove ${s.label || 'income'}`}
                    onClick={() => set({ income: list.filter((_, j) => j !== i) })}>×</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Sel label="Kind" value={s.kind} onChange={(v) => upd(i, { kind: v })}
                    options={(Object.keys(INCOME_KIND_LABEL) as IncomeKind[]).map(k => ({ value: k, label: INCOME_KIND_LABEL[k] }))} />
                  <Num label="$ a year" value={s.annualAmount} step={1000} onChange={(v) => upd(i, { annualAmount: v })} />
                  <Num label="From age" value={s.startAge} step={1} onChange={(v) => upd(i, { startAge: v })} />
                  <Num label="To age (blank = forever)" value={s.endAge ?? 0} step={1} onChange={(v) => upd(i, { endAge: v <= 0 ? null : v })} />
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="mt-2 border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900" onClick={add}>
            + add income
          </button>
        </Section>
      );
    }
    case 'benefits':
      return (
        <Section id="benefits" title="Government Benefits" hint="cpp-start-age">
          <div className="grid grid-cols-2 gap-3">
            <Num label="CPP start age" value={inp.cppStartAge ?? 65} step={1} min={60} onChange={(v) => set({ cppStartAge: v })} />
            <Num label="CPP monthly (at 65)" value={inp.cppMonthlyAmount} step={50} onChange={(v) => set({ cppMonthlyAmount: v })} />
            <Num label="OAS start age" value={inp.oasStartAge ?? 65} step={1} min={65} onChange={(v) => set({ oasStartAge: v })} />
            <Num label="OAS years in Canada" value={inp.oasYearsInCanada} step={1} onChange={(v) => set({ oasYearsInCanada: v })} />
          </div>
        </Section>
      );
    case 'events': {
      const list = inp.events ?? [];
      const add = (direction: 'in' | 'out') => set({ events: [...list, { id: uid(), age: inp.retirementAge, label: '', amount: 0, direction }] });
      const upd = (i: number, patch: Partial<CashEvent>) => {
        const next = [...list]; next[i] = { ...list[i], ...patch }; set({ events: next });
      };
      return (
        <Section id="events" title="Cash Events" hint="cash-events">
          {list.length === 0 && <p className="text-[12.5px] text-slate-400">No one-time or recurring flows on the plan.</p>}
          <div className="space-y-2">
            {list.map((e, i) => (
              <div key={e.id} className="space-y-2 border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1"><Txt label="Name" value={e.label} placeholder="e.g. Inheritance, renovation, gift" onChange={(v) => upd(i, { label: v })} /></div>
                  <button type="button" className="mt-4 px-1 text-slate-400 hover:text-rose-600" aria-label={`Remove ${e.label || 'event'}`}
                    onClick={() => set({ events: list.filter((_, j) => j !== i) })}>×</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Sel label="Direction" value={e.direction} onChange={(v) => upd(i, { direction: v })}
                    options={[{ value: 'in' as const, label: 'Inflow' }, { value: 'out' as const, label: 'Outflow' }]} />
                  <Num label="$ amount" value={e.amount} step={1000} onChange={(v) => upd(i, { amount: v })} />
                  <Num label="At age" value={e.age} step={1} onChange={(v) => upd(i, { age: v })} />
                  <Num label="Repeat to age (blank = once)" value={e.endAge ?? 0} step={1} onChange={(v) => upd(i, { endAge: v <= 0 ? null : v })} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900" onClick={() => add('in')}>+ add inflow</button>
            <button type="button" className="border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900" onClick={() => add('out')}>+ add outflow</button>
          </div>
        </Section>
      );
    }
    case 'spending':
      return (
        <Section id="spending" title="Spending Phases" hint="spending-phases">
          <p className="text-[12px] text-slate-500">Base spending is the "After Tax Spending" lever above. Phases scale it by age (go-go / slow-go / no-go).</p>
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
    case 'markets': {
      // The flat hypothesis: expected return plus volatility. Without
      // volatility Monte Carlo can't run (MC refuses at 0), so this is the
      // unlock for the Analysis section of Insights.
      const periods = inp.marketPeriods ?? [];
      const setPeriods = (next: MarketPeriod[]) =>
        set({ marketPeriods: next.length ? next.sort((a, b) => a.age - b.age) : undefined });
      const upd = (i: number, patch: Partial<MarketPeriod>) => {
        const next = [...periods]; next[i] = { ...periods[i], ...patch }; setPeriods(next);
      };
      return (
        <Section id="markets" title="Markets" hint="expected-return">
          <div className="grid grid-cols-2 gap-3">
            <Num label="Volatility (σ)" value={Math.round((inp.returnVolatility ?? 0) * 1000) / 10} step={0.5} min={0}
              hint="Drives Monte Carlo — set above 0 or the analysis can’t run."
              onChange={(v) => set({ returnVolatility: Math.max(0, v / 100) })} />
          </div>
          <p className="text-[12px] text-slate-500">
            Return anchors override the flat “Markets” lever from an age on — the curve interpolates between them. Leave empty to use the flat rate all the way.
          </p>
          <div className="space-y-2">
            {periods.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2 border border-slate-200 p-2">
                <Num label="From age" value={p.age} step={1} onChange={(v) => upd(i, { age: v })} />
                <Num label="Return %" value={Math.round(p.return * 1000) / 10} step={0.5} onChange={(v) => upd(i, { return: v / 100 })} />
                <Num label="Vol % (blank = flat)" value={p.volatility != null ? Math.round(p.volatility * 1000) / 10 : NaN} step={0.5} min={0}
                  onChange={(v) => upd(i, { volatility: Number.isFinite(v) ? Math.max(0, v / 100) : undefined })} />
                <button type="button" className="mt-4 px-1 text-slate-400 hover:text-rose-600" aria-label={`Remove anchor at age ${p.age}`}
                  onClick={() => setPeriods(periods.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
          <button type="button" className="mt-1 border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900"
            onClick={() => setPeriods([...periods, { id: uid(), age: (periods[periods.length - 1]?.age ?? inp.retirementAge) + 10, return: inp.investmentReturn }])}>
            + add an anchor
          </button>
        </Section>
      );
    }
    case 'withdrawal':
      return (
        <Section id="withdrawal" title="Withdrawal Strategy" hint="withdrawal-order">
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
    case 'debts': {
      const list = inp.debts ?? [];
      const add = () => set({ debts: [...list, { id: uid(), label: '', kind: 'mortgage' as Debt['kind'], balance: 0, interestRate: 0.05, monthlyPayment: 0 }] });
      const upd = (i: number, patch: Partial<Debt>) => {
        const next = [...list]; next[i] = { ...list[i], ...patch }; set({ debts: next });
      };
      return (
        <Section id="debts" title="Debts" hint="debts">
          {list.length === 0 && <p className="text-[12.5px] text-slate-400">No debts on the plan.</p>}
          <div className="space-y-2">
            {list.map((d, i) => (
              <div key={d.id} className="space-y-2 border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1"><Txt label="Name" value={d.label} placeholder="e.g. Mortgage, car loan" onChange={(v) => upd(i, { label: v })} /></div>
                  <button type="button" className="mt-4 px-1 text-slate-400 hover:text-rose-600" aria-label={`Remove ${d.label || 'debt'}`}
                    onClick={() => set({ debts: list.filter((_, j) => j !== i) })}>×</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Sel label="Kind" value={d.kind} onChange={(v) => upd(i, { kind: v })}
                    options={(Object.keys(DEBT_KIND_LABEL) as Debt['kind'][]).map(k => ({ value: k, label: DEBT_KIND_LABEL[k] }))} />
                  <Num label="Balance" value={d.balance} step={1000} onChange={(v) => upd(i, { balance: v })} />
                  <Num label="Rate %" value={Math.round(d.interestRate * 1000) / 10} step={0.1} onChange={(v) => upd(i, { interestRate: v / 100 })} />
                  <Num label="Monthly payment" value={d.monthlyPayment} step={50} onChange={(v) => upd(i, { monthlyPayment: v })} />
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="mt-2 border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900" onClick={add}>
            + add a debt
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Payments are added to yearly withdrawals until each debt is paid off.
          </p>
        </Section>
      );
    }
    case 'home':
      return (
        <Section id="home" title="Home Equity" hint="home-equity">
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
        <Section id="rdsp" title="RDSP (Disability Savings)" hint="rdsp">
          <p className="text-[12.5px] text-slate-500">An RDSP is enabled on this plan. Grants, bonds and withdrawals are configured in the stable app\'s RDSP section.</p>
        </Section>
      );
    case 'fhsa':
      return (
        <Section id="fhsa" title="FHSA (First Home Savings)" hint="fhsa">
          <p className="text-[12.5px] text-slate-500">An FHSA is enabled — contributions accumulate and transfer to the RRSP at retirement. Configured in the stable app\'s FHSA section.</p>
        </Section>
      );
    default:
      return null;
  }
}
