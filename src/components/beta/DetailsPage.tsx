// The plan editor — the whole plan in one place. Lives on the Plans page
// under the list of saved plans. The three top-level levers sit at the top;
// the thirteen sections follow in a single column so the page flows on a
// phone as well as a desktop. A ?section=… deep-link (legacy #/details or
// #/plan) scrolls to the tapped section. Every field edits the real plan;
// the verdict, map and dock recompute together.
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { RetirementInputs, WithdrawalAccount, SpendingBand, CashEvent, IncomeSource, IncomeKind, Debt, MarketPeriod } from '@retired/engine-core/retirementEngine';
import type { Scenario } from '@retired/engine-core/types';
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
const INCOME_KINDS: IncomeKind[] = ['employment', 'pension', 'selfEmployment', 'rental'];
const DEBT_KINDS: Debt['kind'][] = ['mortgage', 'creditCard', 'loan', 'lineOfCredit', 'other'];

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={`details-${id}`} className="border-b border-slate-200 py-6">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{title}{hint && <HelpHint topic={hint} />}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function DetailsPage({ inputs, onChange, section, provinceCodes, scenarios, activeScenarioId, spouseWarnings, onCreateSpousePlan, onOpenPlan }: {
  inputs: RetirementInputs;
  onChange: (next: RetirementInputs) => void;
  section?: string | null;
  /** The engine config's configured province codes — Province is a choice
   *  among these, not free text (mirrors the stable app's SidebarForm). */
  provinceCodes?: string[];
  /** Other saved plans a partner can be linked to. Absent in tests that don't
   *  exercise the spouse section. */
  scenarios?: Scenario[];
  activeScenarioId?: string;
  spouseWarnings?: string[];
  onCreateSpousePlan?: (name?: string) => string;
  onOpenPlan?: (id: string) => void;
}) {
  const set = (patch: Partial<RetirementInputs>) => onChange({ ...inputs, ...patch });
  const provinces = provinceCodes && provinceCodes.length ? provinceCodes : null;
  const provinceKnown = !provinces || provinces.includes(inputs.provinceCode);
  const scrolled = useRef(false);

  // Scroll to the deep-linked section once (#/plan?section=…, or the
  // legacy #/details?section=… which folds here).
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
  const { t } = useTranslation('details');

  // The conditional sections are no longer gated on existing data — the
  // enable toggle lives INSIDE each section, so they always render.
  const visibleSections = DETAILS_SECTIONS;

  return (
    <div>
      {/* the three levers, on the page too */}
      <Panel label={t('bigThree')}>
        <div className="grid gap-6 md:grid-cols-3">
          <Fader label={t('startDrawing')} value={inputs.retirementAge} min={inputs.currentAge} max={75} step={1}
            format={(v) => `${v}`} onChange={(v) => set({ retirementAge: v })} />
          <Fader label={t('afterTaxSpending')} help="desired-spending" value={inputs.desiredSpending} min={0} max={ranges.spendingMax} step={1000}
            format={fmtMoney} onChange={(v) => set({ desiredSpending: v })} />
          <Fader label={t('markets')} help="expected-return" value={Math.round(inputs.investmentReturn * 1000) / 10} min={ranges.returnMin * 100} max={ranges.returnMax * 100} step={0.1}
            format={(v) => `${v.toFixed(1)}%`} onChange={(v) => set({ investmentReturn: v / 100 })} />
        </div>
      </Panel>

      {DETAILS_GROUPS.map(group => {
        const sections = visibleSections.filter(s => s.group === group);
        if (!sections.length) return null;
        return (
          <div key={group} className="pt-6">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t(`groups.${group}`)}</h2>
            <div className="flex max-w-xl flex-col">
              {sections.map(s => (
                <div key={s.id}><DetailsSection id={s.id} inputs={inputs} set={set} order={order} move={move} bands={bands} provinces={provinces} provinceKnown={provinceKnown} scenarios={scenarios} activeScenarioId={activeScenarioId} spouseWarnings={spouseWarnings} onCreateSpousePlan={onCreateSpousePlan} onOpenPlan={onOpenPlan} /></div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Render one section's editor. Every register edits in place — including the
   conditional ones (RDSP / FHSA / Home Equity), whose enable toggles live
   inside the section body. */
function DetailsSection({ id, inputs: inp, set, order, move, bands, provinces, provinceKnown, scenarios, activeScenarioId, spouseWarnings, onCreateSpousePlan, onOpenPlan }: {
  id: string;
  inputs: RetirementInputs;
  set: (p: Partial<RetirementInputs>) => void;
  order: WithdrawalAccount[];
  move: (i: number, dir: -1 | 1) => void;
  bands: SpendingBand[];
  provinces: readonly string[] | null;
  provinceKnown: boolean;
  scenarios?: Scenario[];
  activeScenarioId?: string;
  spouseWarnings?: string[];
  onCreateSpousePlan?: (name?: string) => string;
  onOpenPlan?: (id: string) => void;
}) {
  const { t } = useTranslation('details');
  switch (id) {
    case 'profile':
      return (
        <Section id="profile" title={t('sections.profile')} hint="current-retirement-max-age">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Num label={t('currentAge')} value={inp.currentAge} step={1} onChange={(v) => set({ currentAge: v })} />
            <Num label={t('planToAge')} value={inp.maxAge} step={1} onChange={(v) => set({ maxAge: v })} />
          </div>
          <label className="block">
            <span className="text-[12px] text-slate-500">{t('province')}</span>
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
      const linkable = (scenarios ?? []).filter(s => s.id !== activeScenarioId);
      const linkedId = inp.spouseSource?.kind === 'scenario' ? inp.spouseSource.scenarioId : '';
      const linked = linkedId ? linkable.find(s => s.id === linkedId) : undefined;
      const link = (scenarioId: string) =>
        set({ spouse: undefined, spouseSource: { kind: 'scenario', scenarioId } });
      const unlink = () => set({ spouse: undefined, spouseSource: undefined });
      return (
        <Section id="spouse" title={t('sections.spouse')} hint="include-spouse">
          <p className="text-[12px] text-slate-500">
            {t('spouseLead')}
          </p>
          {linkable.length > 0 ? (
            <label className="block">
              <span className="text-[12px] text-slate-500">{t('linkedPlan')}</span>
              <select
                className="mt-0.5 w-full cursor-pointer border border-slate-300 bg-white px-2 py-1.5 text-[13px] focus:border-slate-900 focus:outline-none"
                value={linkedId}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) unlink();
                  else link(v);
                }}
              >
                <option value="">{t('noPartner')}</option>
                {linkable.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-[12px] text-slate-500">{t('noOtherPlans')}</p>
          )}
          {linked && (
            <div className="flex flex-wrap gap-2">
              <button type="button"
                className="border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900"
                onClick={() => onOpenPlan?.(linked.id)}>
                {t('openPlan', { name: linked.name })}
              </button>
              <button type="button"
                className="border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900"
                onClick={unlink}>
                {t('unlink')}
              </button>
            </div>
          )}
          {!linked && onCreateSpousePlan && (
            <button type="button"
              className="border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900"
              onClick={() => onCreateSpousePlan()}>
              {t('createPartner')}
            </button>
          )}
          {(spouseWarnings ?? []).length > 0 && (
            <div className="space-y-1 border border-amber-200 bg-amber-50 px-2 py-1.5">
              {(spouseWarnings ?? []).map((w, i) => (
                <p key={i} className="text-[12px] text-amber-800">{w}</p>
              ))}
            </div>
          )}
        </Section>
      );
    }
    case 'accounts':
      return (
        <Section id="accounts" title={t('sections.accounts')} hint="rrsp">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Num label={t('rrsp')} value={inp.rrspBalance} onChange={(v) => set({ rrspBalance: v })} />
            <Num label={t('tfsa')} value={inp.tfsaBalance} onChange={(v) => set({ tfsaBalance: v })} />
            <Num label={t('taxable')} value={inp.taxableBalance} onChange={(v) => set({ taxableBalance: v })} />
            <Num label={t('cashCushion')} value={inp.cashCushionBalance} onChange={(v) => set({ cashCushionBalance: v })} />
          </div>
        </Section>
      );
    case 'contributions':
      return (
        <Section id="contributions" title={t('sections.contributions')} hint="contributions">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Num label={t('rrspYr')} value={inp.rrspContribution} onChange={(v) => set({ rrspContribution: v })} />
            <Num label={t('tfsaYr')} value={inp.tfsaContribution} onChange={(v) => set({ tfsaContribution: v })} />
            <Num label={t('taxableYr')} value={inp.taxableContribution} onChange={(v) => set({ taxableContribution: v })} />
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
        <Section id="income" title={t('sections.income')} hint="income">
          {list.length === 0 && <p className="text-[12.5px] text-slate-400">{t('noIncome')}</p>}
          <div className="space-y-2">
            {list.map((s, i) => (
              <div key={s.id} className="space-y-2 border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1"><Txt label={t('name')} value={s.label} placeholder={t('incomePlaceholder')} onChange={(v) => upd(i, { label: v })} /></div>
                  <button type="button" className="mt-4 px-1 text-slate-400 hover:text-rose-600" aria-label={t('removeIncome', { name: s.label || t('sections.income') })}
                    onClick={() => set({ income: list.filter((_, j) => j !== i) })}>×</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Sel label={t('kind')} value={s.kind} onChange={(v) => upd(i, { kind: v })}
                    options={INCOME_KINDS.map(k => ({ value: k, label: t(`incomeKinds.${k}`) }))} />
                  <Num label={t('amountYear')} value={s.annualAmount} step={1000} onChange={(v) => upd(i, { annualAmount: v })} />
                  <Num label={t('fromAge')} value={s.startAge} step={1} onChange={(v) => upd(i, { startAge: v })} />
                  <Num label={t('toAgeForever')} value={s.endAge ?? 0} step={1} onChange={(v) => upd(i, { endAge: v <= 0 ? null : v })} />
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="mt-2 border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900" onClick={add}>
            {t('addIncome')}
          </button>
        </Section>
      );
    }
    case 'benefits':
      return (
        <Section id="benefits" title={t('sections.benefits')} hint="cpp-start-age">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Num label={t('cppStartAge')} value={inp.cppStartAge ?? 65} step={1} min={60} onChange={(v) => set({ cppStartAge: v })} />
            <Num label={t('cppMonthly')} value={inp.cppMonthlyAmount} step={50} onChange={(v) => set({ cppMonthlyAmount: v })} />
            <Num label={t('oasStartAge')} value={inp.oasStartAge ?? 65} step={1} min={65} onChange={(v) => set({ oasStartAge: v })} />
            <Num label={t('oasYears')} value={inp.oasYearsInCanada} step={1} onChange={(v) => set({ oasYearsInCanada: v })} />
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
        <Section id="events" title={t('sections.events')} hint="cash-events">
          {list.length === 0 && <p className="text-[12.5px] text-slate-400">{t('noEvents')}</p>}
          <div className="space-y-2">
            {list.map((e, i) => (
              <div key={e.id} className="space-y-2 border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1"><Txt label={t('name')} value={e.label} placeholder={t('eventPlaceholder')} onChange={(v) => upd(i, { label: v })} /></div>
                  <button type="button" className="mt-4 px-1 text-slate-400 hover:text-rose-600" aria-label={t('removeEvent', { name: e.label || t('sections.events') })}
                    onClick={() => set({ events: list.filter((_, j) => j !== i) })}>×</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Sel label={t('direction')} value={e.direction} onChange={(v) => upd(i, { direction: v })}
                    options={[{ value: 'in' as const, label: t('inflow') }, { value: 'out' as const, label: t('outflow') }]} />
                  <Num label={t('amount')} value={e.amount} step={1000} onChange={(v) => upd(i, { amount: v })} />
                  <Num label={t('atAge')} value={e.age} step={1} onChange={(v) => upd(i, { age: v })} />
                  <Num label={t('repeatToAge')} value={e.endAge ?? 0} step={1} onChange={(v) => upd(i, { endAge: v <= 0 ? null : v })} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900" onClick={() => add('in')}>{t('addInflow')}</button>
            <button type="button" className="border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900" onClick={() => add('out')}>{t('addOutflow')}</button>
          </div>
        </Section>
      );
    }
    case 'spending':
      return (
        <Section id="spending" title={t('sections.spending')} hint="spending-phases">
          <p className="text-[12px] text-slate-500">{t('spendingLead')}</p>
          {bands.length === 0 && <p className="text-[12.5px] text-slate-400">{t('noPhases')}</p>}
          <div className="space-y-2">
            {bands.map((b, i) => {
              const base = inp.desiredSpending;
              const dollars = Math.round(base * b.pctOfBase);
              const setBand = (patch: Partial<SpendingBand>) => {
                const next = [...bands]; next[i] = { ...b, ...patch }; set({ spendingBands: next });
              };
              return (
                <div key={i} className="flex items-end gap-2">
                  <Num label={t('fromAge')} value={b.fromAge} step={1} onChange={(v) => setBand({ fromAge: v })} />
                  <Num label={t('amountOfBase')} value={dollars} step={1000} min={0} onChange={(v) => {
                    if (!Number.isFinite(v) || !(base > 0)) return;
                    setBand({ pctOfBase: v / base });
                  }} />
                  <Num label={t('pctOfBase')} value={Math.round(b.pctOfBase * 100)} step={5} min={0} onChange={(v) => {
                    if (!Number.isFinite(v)) return;
                    setBand({ pctOfBase: v / 100 });
                  }} />
                  <button className="mb-1.5 text-slate-400 hover:text-rose-600" aria-label={t('removePhase')}
                    onClick={() => set({ spendingBands: bands.filter((_, j) => j !== i) })}>×</button>
                </div>
              );
            })}
          </div>
          <button className="mt-1 border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900"
            onClick={() => set({ spendingBands: [...bands, { fromAge: (bands[bands.length - 1]?.fromAge ?? inp.retirementAge) + 10, pctOfBase: 0.8 }] })}>
            {t('addPhase')}
          </button>
        </Section>
      );
    case 'markets': {
      // The flat hypothesis: expected return plus volatility. Without
      // volatility Monte Carlo can't run (MC refuses at 0), so this is the
      // unlock for the Monte Carlo and Solver pages in the Tools menu.
      const periods = inp.marketPeriods ?? [];
      const setPeriods = (next: MarketPeriod[]) =>
        set({ marketPeriods: next.length ? next.sort((a, b) => a.age - b.age) : undefined });
      const upd = (i: number, patch: Partial<MarketPeriod>) => {
        const next = [...periods]; next[i] = { ...periods[i], ...patch }; setPeriods(next);
      };
      return (
        <Section id="markets" title={t('sections.markets')} hint="expected-return">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Num label={t('volatility')} value={Math.round((inp.returnVolatility ?? 0) * 1000) / 10} step={0.5} min={0}
              hint={t('volHint')}
              onChange={(v) => set({ returnVolatility: Math.max(0, v / 100) })} />
          </div>
          <p className="text-[12px] text-slate-500">
            {t('returnAnchors')}
          </p>
          <div className="space-y-2">
            {periods.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2 border border-slate-200 p-2">
                <Num label={t('fromAge')} value={p.age} step={1} onChange={(v) => upd(i, { age: v })} />
                <Num label={t('returnPct')} value={Math.round(p.return * 1000) / 10} step={0.5} onChange={(v) => upd(i, { return: v / 100 })} />
                <Num label={t('volPct')} value={p.volatility != null ? Math.round(p.volatility * 1000) / 10 : NaN} step={0.5} min={0}
                  onChange={(v) => upd(i, { volatility: Number.isFinite(v) ? Math.max(0, v / 100) : undefined })} />
                <button type="button" className="mt-4 px-1 text-slate-400 hover:text-rose-600" aria-label={t('removeAnchor', { age: p.age })}
                  onClick={() => setPeriods(periods.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
          <button type="button" className="mt-1 border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900"
            onClick={() => setPeriods([...periods, { id: uid(), age: (periods[periods.length - 1]?.age ?? inp.retirementAge) + 10, return: inp.investmentReturn }])}>
            {t('addAnchor')}
          </button>
        </Section>
      );
    }
    case 'withdrawal':
      return (
        <Section id="withdrawal" title={t('sections.withdrawal')} hint="withdrawal-order">
          <p className="text-[12px] text-slate-500">{t('withdrawalLead')}</p>
          <ol className="space-y-1.5">
            {order.map((acc, i) => (
              <li key={acc} className="flex items-center gap-2 border border-slate-200 px-2 py-1.5">
                <span className="num w-5 text-[11px] text-slate-400">{i + 1}</span>
                <span className="flex-1 text-[13px] text-slate-800">{t(acc)}</span>
                <button className="px-1 text-slate-400 hover:text-slate-900 disabled:opacity-30" disabled={i === 0}
                  onClick={() => move(i, -1)} aria-label={t('moveEarlier')}>↑</button>
                <button className="px-1 text-slate-400 hover:text-slate-900 disabled:opacity-30" disabled={i === order.length - 1}
                  onClick={() => move(i, 1)} aria-label={t('moveLater')}>↓</button>
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
        <Section id="debts" title={t('sections.debts')} hint="debts">
          {list.length === 0 && <p className="text-[12.5px] text-slate-400">{t('noDebts')}</p>}
          <div className="space-y-2">
            {list.map((d, i) => (
              <div key={d.id} className="space-y-2 border border-slate-200 p-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1"><Txt label={t('name')} value={d.label} placeholder={t('debtPlaceholder')} onChange={(v) => upd(i, { label: v })} /></div>
                  <button type="button" className="mt-4 px-1 text-slate-400 hover:text-rose-600" aria-label={t('removeDebt', { name: d.label || t('sections.debts') })}
                    onClick={() => set({ debts: list.filter((_, j) => j !== i) })}>×</button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Sel label={t('kind')} value={d.kind} onChange={(v) => upd(i, { kind: v })}
                    options={DEBT_KINDS.map(k => ({ value: k, label: t(`debtKinds.${k}`) }))} />
                  <Num label={t('balance')} value={d.balance} step={1000} onChange={(v) => upd(i, { balance: v })} />
                  <Num label={t('ratePct')} value={Math.round(d.interestRate * 1000) / 10} step={0.1} onChange={(v) => upd(i, { interestRate: v / 100 })} />
                  <Num label={t('monthlyPayment')} value={d.monthlyPayment} step={50} onChange={(v) => upd(i, { monthlyPayment: v })} />
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="mt-2 border border-slate-300 px-2 py-1 text-[11.5px] text-slate-600 hover:border-slate-900" onClick={add}>
            {t('addDebt')}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            {t('debtsNote')}
          </p>
        </Section>
      );
    }
    case 'home': {
      const rm = inp.reverseMortgage;
      const enabled = rm?.enabled === true;
      const base = rm ?? { enabled: false, homeValue: 0, appreciationRate: 0.02, interestRate: 0.065 };
      const setRm = (patch: Partial<NonNullable<typeof rm>>) =>
        set({ reverseMortgage: { ...base, ...patch } });
      const hasSchedule = (rm?.drawAmount ?? 0) > 0;
      return (
        <Section id="home" title={t('sections.home')} hint="home-equity">
          <Check checked={enabled} onChange={(on) => setRm({ enabled: on })} label={t('borrowHome')} />
          {enabled && rm && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Sel label={t('product')} value={rm.mode ?? 'reverse'} onChange={(v) => setRm({ mode: v })}
                  options={[
                    { value: 'reverse', label: t('reverseMortgage') },
                    { value: 'heloc', label: t('heloc') },
                  ]} />
                <Num label={t('homeValue')} value={rm.homeValue} step={10000} onChange={(v) => setRm({ homeValue: v })} />
                <Num label={t('appreciation')} value={Math.round(rm.appreciationRate * 1000) / 10} step={0.5}
                  onChange={(v) => setRm({ appreciationRate: v / 100 })} />
                <Num label={t('loanRate')} value={Math.round(rm.interestRate * 1000) / 10} step={0.1}
                  onChange={(v) => setRm({ interestRate: Math.max(0, v / 100) })} />
                <Num label={t('maxLtv')} value={Math.round((rm.maxLtv ?? 0.55) * 100)} step={5} min={0}
                  hint={t('maxLtvHint')}
                  onChange={(v) => setRm({ maxLtv: Math.max(0, v / 100) })} />
              </div>
              <Check checked={hasSchedule} onChange={(on) => on
                ? setRm({ drawAmount: rm.drawAmount && rm.drawAmount > 0 ? rm.drawAmount : 1000,
                          startAge: rm.startAge ?? inp.currentAge,
                          durationYears: rm.durationYears ?? 10 })
                : setRm({ drawAmount: undefined, startAge: undefined, durationYears: undefined })}
                label={t('scheduledDraws')} />
              {hasSchedule && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Num label={t('drawPerYear')} value={rm.drawAmount ?? 0} onChange={(v) => setRm({ drawAmount: v })} />
                  <Num label={t('fromAge')} value={rm.startAge ?? inp.currentAge} step={1} onChange={(v) => setRm({ startAge: v })} />
                  <Num label={t('forYears')} value={rm.durationYears ?? 10} step={1} onChange={(v) => setRm({ durationYears: v })} />
                </div>
              )}
              <Check checked={rm.topUp === true} onChange={(v) => setRm({ topUp: v })}
                label={t('lastResort')} />
            </div>
          )}
        </Section>
      );
    }
    case 'rdsp': {
      const rd = inp.rdsp;
      const enabled = rd?.enabled === true;
      const base = rd ?? { enabled: false, balance: 0, contribution: 0, familyIncome: 0, dtcEligible: true };
      const setRd = (patch: Partial<NonNullable<typeof rd>>) =>
        set({ rdsp: { ...base, ...patch } });
      return (
        <Section id="rdsp" title={t('sections.rdsp')} hint="rdsp">
          <Check checked={enabled} onChange={(on) => setRd({ enabled: on })} label={t('enabled')} />
          {enabled && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Num label={t('balance')} value={rd!.balance} onChange={(v) => setRd({ balance: v })} />
                <Num label={t('contributionYr')} value={rd!.contribution} onChange={(v) => setRd({ contribution: v })} />
                <Num label={t('familyIncome')} value={rd!.familyIncome} onChange={(v) => setRd({ familyIncome: v })}
                  hint={t('familyIncomeHint')} />
              </div>
              <Check checked={rd!.dtcEligible} onChange={(v) => setRd({ dtcEligible: v })}
                size={12} label={t('dtcEligible')} />
            </div>
          )}
        </Section>
      );
    }
    case 'fhsa': {
      const fh = inp.fhsa;
      const enabled = fh?.enabled === true;
      const base = fh ?? { enabled: false, balance: 0, contribution: 0 };
      const setFh = (patch: Partial<NonNullable<typeof fh>>) =>
        set({ fhsa: { ...base, ...patch } });
      return (
        <Section id="fhsa" title={t('sections.fhsa')} hint="fhsa">
          <Check checked={enabled} onChange={(on) => setFh({ enabled: on })} label={t('enabled')} />
          {enabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Num label={t('balance')} value={fh!.balance} onChange={(v) => setFh({ balance: v })} />
              <Num label={t('contributionYr')} value={fh!.contribution} onChange={(v) => setFh({ contribution: v })} />
              <Num label={t('openedAtAge')} value={fh!.openAge ?? NaN} step={1}
                hint={t('openedHint')}
                onChange={(v) => setFh({ openAge: Number.isFinite(v) ? v : undefined })} />
            </div>
          )}
        </Section>
      );
    }
    default:
      return null;
  }
}
