import { useEffect, useRef, useState } from 'react';
import { User, PiggyBank, TrendingUp, Shield, MapPin, ArrowDownWideNarrow, ChevronUp, ChevronDown, ChevronRight, CalendarClock, Plus, Trash2, Activity, Users, Landmark, Home, X, Briefcase, HeartHandshake } from 'lucide-react';
import type { RetirementInputs, WithdrawalAccount, CashEvent, SpendingBand, Pension, ReverseMortgage, EmploymentIncome, RdspInputs } from '../lib/retirementEngine';
import { cppAdjustmentMultiplier } from '../lib/retirementEngine';
import { baselineSpouse } from '../lib/householdTypes';
import type { AppConfig } from '../lib/appConfig';

interface SidebarFormProps {
  inputs: RetirementInputs;
  onChange: (inputs: RetirementInputs) => void;
  provinceCodes: string[];
  config: AppConfig;
  onClose?: () => void; // mobile drawer close (hidden on md+)
  // For the spouse adapter: the saved scenarios a spouse can be linked to, the
  // active plan's own id (to exclude self-references), and any host-wins /
  // resolution warnings from materializing a linked spouse.
  scenarios?: Array<{ id: string; name: string; inputs: RetirementInputs }>;
  activeScenarioId?: string;
  spouseWarnings?: string[];
  /** Persist edited person fields back into another saved scenario (the linked
   *  spouse plan) without switching to it. */
  onUpdateScenarioInputs?: (scenarioId: string, patch: Partial<RetirementInputs>) => void;
  /** Save the embedded spouse as its own standalone scenario. */
  onSaveSpouseAsScenario?: (name: string) => void;
}

const ACCOUNT_LABELS: Record<WithdrawalAccount, string> = {
  tfsa: 'TFSA',
  taxable: 'Taxable',
  rrsp: 'RRSP / RRIF',
  rdsp: 'RDSP',
};

const INPUT_CLS = 'w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500';
const LABEL_CLS = 'block text-[11px] text-neutral-500 mb-1';

const formatMoney = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

let eventSeq = 0;
const newEventId = () => `ev-${Date.now().toString(36)}-${(eventSeq++).toString(36)}`;
const newPensionId = () => `pen-${Date.now().toString(36)}-${(eventSeq++).toString(36)}`;
const newEmploymentId = () => `emp-${Date.now().toString(36)}-${(eventSeq++).toString(36)}`;

// Reusable DB/bridge-pension list editor (primary plan and spouse plan both
// render one). Compact card per pension: label, $/yr, start/end ages, indexed.
function PensionList({ pensions, onChange }: { pensions: Pension[]; onChange: (next: Pension[]) => void }) {
  const update = (i: number, patch: Partial<Pension>) =>
    onChange(pensions.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-1.5">
      {pensions.map((p, i) => (
        <div key={p.id} className="px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={p.label}
              placeholder="Label (e.g. Employer DB)"
              onChange={(e) => update(i, { label: e.target.value })}
              className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => onChange(pensions.filter((_, j) => j !== i))}
              className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-red-400"
              title="Remove pension"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              step="1000"
              value={p.annualAmount}
              title="Annual amount ($/yr, today's dollars)"
              onChange={(e) => update(i, { annualAmount: Math.max(0, parseInt(e.target.value) || 0) })}
              className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-[10px] text-neutral-500">$/yr</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={p.startAge}
              title="Start age"
              onChange={(e) => update(i, { startAge: parseInt(e.target.value) || p.startAge })}
              className="w-14 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-[10px] text-neutral-500">to</span>
            <input
              type="number"
              value={p.endAge ?? ''}
              placeholder="life"
              title="End age (blank = lifetime; set for a bridge/temporary pension)"
              onChange={(e) => update(i, { endAge: e.target.value ? parseInt(e.target.value) : null })}
              className="w-14 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
            <label className="flex items-center gap-1 text-[10px] text-neutral-400 cursor-pointer ml-auto" title="Grow with CPI (when table indexation is on)">
              <input
                type="checkbox"
                checked={p.indexedToCpi}
                onChange={(e) => update(i, { indexedToCpi: e.target.checked })}
              />
              indexed
            </label>
          </div>
        </div>
      ))}
      <button
        onClick={() => onChange([...pensions, { id: newPensionId(), label: 'Pension', annualAmount: 12000, startAge: 60, endAge: null, indexedToCpi: true }])}
        className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-neutral-400 hover:text-white hover:bg-neutral-800 rounded w-full"
      >
        <Plus size={12} /> Add pension
      </button>
    </div>
  );
}

// Reusable employment-income list editor (primary plan and spouse plan both
// render one). Compact card per job: label, $/yr, start/end ages, destination
// account, top-up and indexed toggles. Unlike a pension this is EARNED income:
// it stacks for tax, feeds OAS clawback and GIS reduction, and the after-tax
// net is either saved (destAccount) or used to top up spending first.
function EmploymentList({ employment, onChange, tfsaAnnualLimit }: {
  employment: EmploymentIncome[];
  onChange: (next: EmploymentIncome[]) => void;
  tfsaAnnualLimit: number;
}) {
  const update = (i: number, patch: Partial<EmploymentIncome>) =>
    onChange(employment.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  return (
    <div className="space-y-1.5">
      {employment.map((e, i) => (
        <div key={e.id} className="px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={e.label}
              placeholder="Label (e.g. Part-time consulting)"
              onChange={(ev) => update(i, { label: ev.target.value })}
              className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => onChange(employment.filter((_, j) => j !== i))}
              className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-red-400"
              title="Remove job"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              step="1000"
              value={e.annualAmount}
              title="Gross annual pay ($/yr, before tax, today's dollars)"
              onChange={(ev) => update(i, { annualAmount: Math.max(0, parseInt(ev.target.value) || 0) })}
              className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-[10px] text-neutral-500">$/yr</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={e.startAge}
              title="Start age"
              onChange={(ev) => update(i, { startAge: parseInt(ev.target.value) || e.startAge })}
              className="w-14 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-[10px] text-neutral-500">to</span>
            <input
              type="number"
              value={e.endAge}
              title="End age (last working year, inclusive)"
              onChange={(ev) => update(i, { endAge: parseInt(ev.target.value) || e.endAge })}
              className="w-14 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
            <select
              value={e.destAccount}
              title="Where the after-tax pay is saved"
              onChange={(ev) => update(i, { destAccount: ev.target.value as EmploymentIncome['destAccount'] })}
              className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
            >
              <option value="taxable">Taxable</option>
              <option value="tfsa">TFSA</option>
              <option value="rrsp">RRSP</option>
              <option value="cash">Cash</option>
            </select>
          </div>
          {e.destAccount === 'tfsa' && e.annualAmount > tfsaAnnualLimit && (
            <div className="text-[10px] text-amber-400 leading-snug">
              Over the {formatMoney(tfsaAnnualLimit)}/yr TFSA limit — the app doesn't track
              contribution room yet, so a taxable destination is safer unless you have the room.
            </div>
          )}
          {e.destAccount === 'rrsp' && (
            <div className="text-[10px] text-amber-400 leading-snug">
              The app doesn't track RRSP room — make sure you have the contribution room
              (18% of earned income/yr, capped) before directing pay here.
            </div>
          )}
          <div className="flex items-center gap-3 text-[10px] text-neutral-400">
            <label className="flex items-center gap-1 cursor-pointer" title="Use the after-tax pay to cover spending first (displaces withdrawals); any excess is saved">
              <input
                type="checkbox"
                checked={e.topUpSpending}
                onChange={(ev) => update(i, { topUpSpending: ev.target.checked })}
              />
              tops up spending
            </label>
            <label className="flex items-center gap-1 cursor-pointer" title="Grow with CPI (when table indexation is on)">
              <input
                type="checkbox"
                checked={e.indexedToCpi}
                onChange={(ev) => update(i, { indexedToCpi: ev.target.checked })}
              />
              indexed
            </label>
          </div>
        </div>
      ))}
      <button
        onClick={() => onChange([...employment, { id: newEmploymentId(), label: 'Part-time work', annualAmount: 15000, startAge: 65, endAge: 70, destAccount: 'taxable', topUpSpending: true, indexedToCpi: false }])}
        className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-neutral-400 hover:text-white hover:bg-neutral-800 rounded w-full"
      >
        <Plus size={12} /> Add job
      </button>
    </div>
  );
}

// GCP-console style collapsible section: full-width header row, chevron
// rotates, content hidden when closed.
function CollapsibleSection({ id, icon, title, open, onToggle, children }: {
  id: string;
  icon: React.ReactNode;
  title: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-2 text-xs font-semibold text-neutral-400 uppercase tracking-wider py-1.5 -mx-1 px-1 rounded hover:bg-neutral-800/60 hover:text-neutral-200 transition-colors"
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-neutral-500 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        {icon}
        {title}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </section>
  );
}

export function SidebarForm({ inputs, onChange, provinceCodes, config, onClose, scenarios, activeScenarioId, spouseWarnings, onUpdateScenarioInputs, onSaveSpouseAsScenario }: SidebarFormProps) {
  const updateField = <K extends keyof RetirementInputs>(field: K, value: RetirementInputs[K]) => {
    onChange({ ...inputs, [field]: value });
  };

  const withdrawalOrder: WithdrawalAccount[] =
    Array.isArray(inputs.withdrawalOrder) && inputs.withdrawalOrder.length > 0
      ? inputs.withdrawalOrder
      : ['tfsa', 'taxable', 'rrsp'];

  const moveAccount = (index: number, direction: -1 | 1) => {
    const next = [...withdrawalOrder];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateField('withdrawalOrder', next);
  };

  const sortedBands: SpendingBand[] = Array.isArray(inputs.spendingBands)
    ? [...inputs.spendingBands].sort((a, b) => a.fromAge - b.fromAge)
    : [];

  // ---- transfer (advanced) event helpers ----
  // An event is a transfer when it carries explicit from/to endpoints. Simple
  // events use direction + account; advanced events move money account→account
  // (the RRSP meltdown) or between spouses. Encode an endpoint as a compact
  // string for the <select> value: 'external', or 'person:account'.
  type Endpoint = NonNullable<CashEvent['from']>;
  const encodeEndpoint = (e: Endpoint): string =>
    e.kind === 'external' ? 'external' : `${e.person}:${e.account}`;
  const decodeEndpoint = (s: string): Endpoint =>
    s === 'external'
      ? { kind: 'external' }
      : (() => { const [person, account] = s.split(':'); return { kind: 'account', person: person as 'primary' | 'spouse', account: account as 'rrsp' | 'tfsa' | 'taxable' | 'cash' }; })();
  const hasSpouse = inputs.spouse?.enabled === true;
  // The from/to choices available for a transfer. 'from' can be external (a
  // plain inflow) or one of a person's accounts; 'to' can be external (= the
  // year's spending) or an account.
  const endpointOptions = (allowExternal: boolean, externalLabel: string) => (
    <>
      {allowExternal && <option value="external">{externalLabel}</option>}
      <optgroup label="You">
        <option value="primary:rrsp">RRSP</option>
        <option value="primary:tfsa">TFSA</option>
        <option value="primary:taxable">Taxable</option>
        <option value="primary:cash">Cash cushion</option>
      </optgroup>
      {hasSpouse && (
        <optgroup label="Spouse">
          <option value="spouse:rrsp">Spouse RRSP</option>
          <option value="spouse:tfsa">Spouse TFSA</option>
          <option value="spouse:taxable">Spouse Taxable</option>
          <option value="spouse:cash">Spouse Cash cushion</option>
        </optgroup>
      )}
    </>
  );

  const updateSpouse = (patch: Partial<NonNullable<RetirementInputs['spouse']>>) => {
    if (!inputs.spouse) return;
    updateField('spouse', { ...inputs.spouse, ...patch });
  };

  // A person's own event list editor. `self` is the person whose events these
  // are — it only affects the transfer-seed default (which account a brand-new
  // transfer starts from), since the endpoint pickers already offer both
  // people. The events array + setter are passed in so the SAME editor serves
  // the primary (inputs.events) and the spouse (inputs.spouse.events).
  const renderEventList = (
    events: CashEvent[],
    setEvents: (next: CashEvent[]) => void,
    currentAge: number,
    retirementAge: number,
    self: 'primary' | 'spouse',
  ) => {
    const updateEventAt = (index: number, patch: Partial<CashEvent>) => {
      setEvents(events.map((ev, i) => (i === index ? { ...ev, ...patch } : ev)));
    };
    return (
      <div className="space-y-2">
        {events.map((ev, i) => (
          <div key={ev.id} className="px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded space-y-1.5">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={ev.label}
                placeholder="Label"
                onChange={(e) => updateEventAt(i, { label: e.target.value })}
                className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={() => setEvents(events.filter((_, j) => j !== i))}
                className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-red-400"
                title="Remove event"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={ev.direction}
                onChange={(e) => updateEventAt(i, { direction: e.target.value as CashEvent['direction'] })}
                className="px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
              >
                <option value="in">Inflow</option>
                <option value="out">Outflow</option>
              </select>
              <input
                type="number"
                step="1000"
                value={ev.amount}
                title="Amount ($ / occurrence)"
                onChange={(e) => updateEventAt(i, { amount: Math.max(0, parseInt(e.target.value) || 0) })}
                className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={ev.endAge != null ? 'yearly' : 'once'}
                onChange={(e) => updateEventAt(i, e.target.value === 'yearly' ? { endAge: ev.age } : { endAge: null })}
                title="One-time or yearly"
                className="px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
              >
                <option value="once">Once at</option>
                <option value="yearly">Yearly</option>
              </select>
              <input
                type="number"
                value={ev.age}
                min={currentAge}
                title={ev.endAge != null ? `Start age (≥ current age ${currentAge})` : `Age (≥ current age ${currentAge})`}
                onChange={(e) => updateEventAt(i, { age: Math.max(currentAge, parseInt(e.target.value) || currentAge) })}
                className="w-14 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
              />
              {ev.endAge != null && (
                <>
                  <span className="text-[10px] text-neutral-500">to</span>
                  <input
                    type="number"
                    value={ev.endAge}
                    title="End age (inclusive)"
                    onChange={(e) => updateEventAt(i, { endAge: Math.max(ev.age, parseInt(e.target.value) || ev.age) })}
                    className="w-14 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                  />
                </>
              )}
            </div>
            {(() => {
              const isTransfer = ev.from != null || ev.to != null;
              if (isTransfer) {
                const from = ev.from ?? { kind: 'external' as const };
                const to = ev.to ?? { kind: 'external' as const };
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-neutral-500 w-8 shrink-0">from</span>
                      <select
                        value={encodeEndpoint(from)}
                        onChange={(e) => updateEventAt(i, { from: decodeEndpoint(e.target.value) })}
                        className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                      >
                        {endpointOptions(true, 'Outside (new money)')}
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-neutral-500 w-8 shrink-0">to</span>
                      <select
                        value={encodeEndpoint(to)}
                        onChange={(e) => updateEventAt(i, { to: decodeEndpoint(e.target.value) })}
                        className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                      >
                        {endpointOptions(true, 'Spending (leaves plan)')}
                      </select>
                    </div>
                    <p className="text-[10px] text-neutral-500 leading-snug">
                      An RRSP source is taxed on withdrawal; the after-tax remainder is redeposited.
                    </p>
                    <button
                      onClick={() => updateEventAt(i, { from: undefined, to: undefined })}
                      className="text-[10px] text-blue-400 hover:text-blue-300"
                    >
                      ← back to simple inflow/outflow
                    </button>
                  </div>
                );
              }
              return (
                <div className="space-y-1.5">
                  {ev.direction === 'in' && (
                    <select
                      value={ev.account ?? 'taxable'}
                      onChange={(e) => updateEventAt(i, { account: e.target.value as CashEvent['account'] })}
                      className="w-full px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="taxable">→ Taxable account</option>
                      <option value="tfsa">→ TFSA</option>
                      <option value="rrsp">→ RRSP</option>
                      <option value="cash">→ Cash cushion</option>
                    </select>
                  )}
                  <button
                    onClick={() => updateEventAt(i, {
                      // Seed a sensible transfer from the current simple value so
                      // toggling doesn't lose the intent. `self` is whose account
                      // the default transfer starts from.
                      from: ev.direction === 'in'
                        ? { kind: 'external' }
                        : { kind: 'account', person: self, account: ev.account === 'cash' ? 'cash' : (ev.account ?? 'rrsp') },
                      to: ev.direction === 'in'
                        ? { kind: 'account', person: self, account: ev.account ?? 'taxable' }
                        : { kind: 'external' },
                    })}
                    className="text-[10px] text-blue-400 hover:text-blue-300"
                    title="Move money between accounts or spouses (e.g. an RRSP withdrawal into the TFSA)"
                  >
                    advanced: transfer between accounts…
                  </button>
                </div>
              );
            })()}
          </div>
        ))}
        <button
          onClick={() => setEvents([...events, { id: newEventId(), age: retirementAge, label: 'House sale', amount: 100000, direction: 'in', account: 'taxable' }])}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-neutral-400 hover:text-white hover:bg-neutral-800 rounded w-full"
        >
          <Plus size={12} /> Add event
        </button>
        {events.length > 0 && (
          <p className="text-[10px] text-neutral-500 leading-snug">
            Inflows land in the chosen account (they do not grow earlier years); outflows add to
            that year's spending need. Choose <em>Yearly</em> and set a start–end age range to repeat
            the same amount each year (e.g. yearly for 5 years → end age = start + 4).
          </p>
        )}
      </div>
    );
  };

  // A person's spending-phase (go-go / slow-go / no-go) editor. Parameterized by
  // the band list + setter + that person's desiredSpending so the SAME editor
  // serves the primary (inputs.spendingBands) and the spouse
  // (inputs.spouse.spendingBands).
  const renderBandList = (
    bands: SpendingBand[],
    setBands: (next: SpendingBand[]) => void,
    desiredSpending: number,
  ) => {
    const sorted = [...bands].sort((a, b) => a.fromAge - b.fromAge);
    const updateBandAt = (index: number, patch: Partial<SpendingBand>) => {
      setBands(sorted.map((b, i) => (i === index ? { ...b, ...patch } : b)));
    };
    return (
      <div className="space-y-1.5">
        {sorted.map((band, i) => (
          <div key={i} className="flex items-center gap-1.5 px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded">
            <input
              type="number"
              value={band.fromAge}
              title="From age"
              onChange={(e) => updateBandAt(i, { fromAge: parseInt(e.target.value) || band.fromAge })}
              className="w-14 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-[10px] text-neutral-500">+</span>
            <input
              type="number"
              value={Math.round(band.pctOfBase * 100)}
              title="% of desired spending"
              onChange={(e) => updateBandAt(i, { pctOfBase: Math.max(0, (parseInt(e.target.value) || 0) / 100) })}
              className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-[10px] text-neutral-500">%</span>
            <span className="text-[10px] text-neutral-400 whitespace-nowrap" title="Resulting yearly spending in today's dollars">
              = {formatMoney(desiredSpending * band.pctOfBase)}
            </span>
            <button
              onClick={() => setBands(sorted.filter((_, j) => j !== i))}
              className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-red-400"
              title="Remove phase"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          onClick={() => setBands([...sorted, { fromAge: sorted.length > 0 ? sorted[sorted.length - 1].fromAge + 10 : 75, pctOfBase: 0.85 }])}
          className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-neutral-400 hover:text-white hover:bg-neutral-800 rounded w-full"
        >
          <Plus size={12} /> Add phase
        </button>
      </div>
    );
  };

  // ---- spouse adapter (built-in vs linked scenario) ----
  // The spouse's source: 'builtin' = edited inline here (default); 'scenario'
  // = the spouse IS another saved plan, referenced by id and materialized into
  // `spouse` by the app (host wins on shared fields). Choosing a source writes
  // spouseSource; the actual spouse values for a linked scenario come from the
  // referenced plan, so the inline editors are hidden in that mode.
  const spouseSource = inputs.spouseSource ?? { kind: 'builtin' as const };
  const isLinkedSpouse = spouseSource.kind === 'scenario';
  // Scenarios this spouse can link to: all saved plans except the active one
  // (a plan can't be its own spouse).
  const linkableScenarios = (scenarios ?? []).filter(s => s.id !== activeScenarioId);

  // Stash the last-used spouse / reverse-mortgage values so toggling the
  // section off and back on restores them instead of resetting to defaults.
  // (The field is set to `undefined` when off, which would otherwise lose them.)
  const spouseStash = useRef<NonNullable<RetirementInputs['spouse']> | null>(null);
  const rmStash = useRef<ReverseMortgage | null>(null);
  const rdspStash = useRef<RdspInputs | null>(null);

  // Single source of truth for a baseline spouse (shared with the setup
  // wizard's "add a spouse" path) so the two ways of adding a spouse don't
  // drift — see householdTypes.baselineSpouse.
  const defaultSpouse = (): NonNullable<RetirementInputs['spouse']> => baselineSpouse(inputs);

  // The spouse is governed by TWO fields that must stay in sync:
  //   spouse.enabled — whether a spouse is part of the household at all
  //   spouseSource   — builtin (embedded) vs scenario (a link to another plan)
  // If they disagree the resolver can re-inject a spouse the user just turned
  // off, or the unlink can leave the projection stale. Every transition writes
  // both together via a single onChange so the memo chain sees one update.

  const setSpouseSourceBuiltin = () => {
    // Unlink: drop the scenario reference and restore the stashed embedded
    // spouse (kept when the link was made), or a fresh default if none. The
    // household keeps an enabled spouse — unlinking changes WHERE the spouse
    // comes from, not WHETHER there is one.
    const restored = spouseStash.current ?? defaultSpouse();
    onChange({
      ...inputs,
      spouseSource: { kind: 'builtin' },
      spouse: { ...restored, enabled: true },
    });
  };
  const setSpouseSourceScenario = (scenarioId: string) => {
    // Link: the referenced plan becomes the spouse. Stash the embedded spouse so
    // unlinking can restore it. The materialized spouse is supplied by the app
    // via resolveSpouseSource; here we record the link and keep the toggle on.
    if (inputs.spouse) spouseStash.current = inputs.spouse;
    onChange({
      ...inputs,
      spouseSource: { kind: 'scenario', scenarioId },
      spouse: { ...(inputs.spouse ?? spouseStash.current ?? defaultSpouse()), enabled: true },
    });
  };

  const toggleSpouse = (on: boolean) => {
    if (on) {
      const base = spouseStash.current ?? defaultSpouse();
      onChange({ ...inputs, spouse: { ...base, enabled: true } });
    } else {
      // Uncheck: stash for restore, drop the spouse AND detach any scenario
      // link. Detaching the link is essential — otherwise resolveSpouseSource
      // keeps materializing the linked plan and the spouse never goes away.
      if (inputs.spouse) spouseStash.current = inputs.spouse;
      onChange({ ...inputs, spouse: undefined, spouseSource: { kind: 'builtin' } });
    }
  };

  // ---- linked-spouse basic-number editor ----
  // When the spouse is a linked plan, show the same basic numbers the built-in
  // view edits, but fetched from the linked scenario. Edits are LOCAL (a draft)
  // until "Save to linked plan" writes them back via onUpdateScenarioInputs —
  // changing another saved plan silently on every keystroke would be surprising.
  const linkedScenarioId = spouseSource.kind === 'scenario' ? spouseSource.scenarioId : null;
  const linkedScenario = linkedScenarioId != null
    ? (scenarios ?? []).find(s => s.id === linkedScenarioId)
    : undefined;
  const [linkedDraft, setLinkedDraft] = useState<Partial<RetirementInputs> | null>(null);
  // The draft re-seeds whenever the link target or the target's saved inputs
  // change (a save round-trips through scenarios and lands back here clean).
  const linkedSeedJson = JSON.stringify(
    linkedScenario
      ? {
          currentAge: linkedScenario.inputs.currentAge,
          retirementAge: linkedScenario.inputs.retirementAge,
          rrspBalance: linkedScenario.inputs.rrspBalance,
          tfsaBalance: linkedScenario.inputs.tfsaBalance,
          taxableBalance: linkedScenario.inputs.taxableBalance,
          cashCushionBalance: linkedScenario.inputs.cashCushionBalance,
          rrspContribution: linkedScenario.inputs.rrspContribution,
          tfsaContribution: linkedScenario.inputs.tfsaContribution,
          taxableContribution: linkedScenario.inputs.taxableContribution,
          cppStartAge: linkedScenario.inputs.cppStartAge,
          cppMonthlyAmount: linkedScenario.inputs.cppMonthlyAmount,
          oasStartAge: linkedScenario.inputs.oasStartAge,
          oasYearsInCanada: linkedScenario.inputs.oasYearsInCanada,
          desiredSpending: linkedScenario.inputs.desiredSpending,
        }
      : null,
  );
  useEffect(() => {
    setLinkedDraft(linkedSeedJson ? JSON.parse(linkedSeedJson) : null);
  }, [linkedSeedJson]);
  const linkedDirty = linkedSeedJson != null && JSON.stringify(linkedDraft) !== linkedSeedJson;
  const updateLinkedDraft = (patch: Partial<RetirementInputs>) =>
    setLinkedDraft(d => (d ? { ...d, ...patch } : d));
  const saveLinkedDraft = () => {
    if (linkedScenarioId && linkedDraft && linkedDirty) {
      onUpdateScenarioInputs?.(linkedScenarioId, linkedDraft);
    }
  };

  // ---- save the built-in spouse as its own plan ----
  const [spouseSaveAsOpen, setSpouseSaveAsOpen] = useState(false);
  const [spouseSaveAsName, setSpouseSaveAsName] = useState('');
  const activeScenarioName = (scenarios ?? []).find(s => s.id === activeScenarioId)?.name;
  const openSpouseSaveAs = () => {
    setSpouseSaveAsName(`${activeScenarioName ?? 'Plan'} - Spouse`);
    setSpouseSaveAsOpen(true);
  };
  const confirmSpouseSaveAs = () => {
    const name = spouseSaveAsName.trim();
    if (!name) return;
    onSaveSpouseAsScenario?.(name);
    setSpouseSaveAsOpen(false);
  };

  const updateRm = (patch: Partial<ReverseMortgage>) => {
    if (!inputs.reverseMortgage) return;
    updateField('reverseMortgage', { ...inputs.reverseMortgage, ...patch });
  };

  const toggleRm = (on: boolean) => {
    if (on) {
      const base = rmStash.current ?? {
        enabled: true as const,
        homeValue: 800000,
        appreciationRate: 0.02,
        interestRate: 0.06,
        maxLtv: 0.55,
        drawAmount: 0,
        startAge: inputs.retirementAge,
        durationYears: undefined,
        topUp: true,
      };
      updateField('reverseMortgage', { ...base, enabled: true });
    } else {
      if (inputs.reverseMortgage) rmStash.current = inputs.reverseMortgage;
      updateField('reverseMortgage', undefined);
    }
  };

  // RDSP helpers — the primary person's plan. The spouse's RDSP edits go through
  // updateSpouse (embedded) like their other fields.
  const updateRdsp = (patch: Partial<RdspInputs>) => {
    if (!inputs.rdsp) return;
    updateField('rdsp', { ...inputs.rdsp, ...patch });
  };
  const toggleRdsp = (on: boolean) => {
    if (on) {
      const base = rdspStash.current ?? {
        enabled: true as const,
        balance: 0,
        contribution: 1500,
        familyIncome: 50000,
        contributionBasis: undefined,
        dtcEligible: true,
      };
      updateField('rdsp', { ...base, enabled: true });
    } else {
      if (inputs.rdsp) rdspStash.current = inputs.rdsp;
      updateField('rdsp', undefined);
    }
  };

  // Personal Profile + Account Balances open by default; the rest collapsed.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    profile: true,
    accounts: true,
  });
  const toggleSection = (id: string) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  const isOpen = (id: string) => openSections[id] ?? false;

  return (
    <div className="w-80 h-full bg-neutral-900/95 border-r border-neutral-800 overflow-y-auto">
      {/* Mobile-only drawer header with a close button */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 md:hidden">
        <span className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">Inputs</span>
        <button
          onClick={onClose}
          className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded"
          title="Close inputs"
        >
          <X size={16} />
        </button>
      </div>
      <div className="p-4 space-y-6">

        {/* Personal Profile */}
        <CollapsibleSection id="profile" icon={<User size={14} />} title="Personal Profile" open={isOpen('profile')} onToggle={toggleSection}>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Current Age</label>
              <input
                type="number"
                min="18"
                max="100"
                value={inputs.currentAge}
                onChange={(e) => {
                  const age = parseInt(e.target.value) || 0;
                  // Clamp any cash events that would fall before the new
                  // current age — a past event never fires, which silently
                  // drops its money, so keep them ≥ current age.
                  const events = (inputs.events ?? []).map(ev =>
                    ev.age < age ? { ...ev, age, endAge: ev.endAge != null ? Math.max(ev.endAge, age) : ev.endAge } : ev);
                  onChange({ ...inputs, currentAge: age, events });
                }}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Retirement Age</label>
              <input
                type="number"
                min="45"
                max="75"
                value={inputs.retirementAge}
                onChange={(e) => updateField('retirementAge', parseInt(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Max Age</label>
              <input
                type="number"
                min="70"
                max="120"
                value={inputs.maxAge}
                onChange={(e) => updateField('maxAge', parseInt(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Province</label>
              <select
                value={inputs.provinceCode}
                onChange={(e) => updateField('provinceCode', e.target.value)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              >
                {provinceCodes.map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
                {!provinceCodes.includes(inputs.provinceCode) && (
                  <option value={inputs.provinceCode}>{inputs.provinceCode}</option>
                )}
              </select>
            </div>
          </div>
        </CollapsibleSection>

        {/* Account Balances */}
        <CollapsibleSection id="accounts" icon={<Shield size={14} />} title="Account Balances" open={isOpen('accounts')} onToggle={toggleSection}>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">RRSP ($)</label>
              <input
                type="number"
                step="1000"
                value={inputs.rrspBalance}
                onChange={(e) => updateField('rrspBalance', parseInt(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">TFSA ($)</label>
              <input
                type="number"
                step="1000"
                value={inputs.tfsaBalance}
                onChange={(e) => updateField('tfsaBalance', parseInt(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Taxable ($)</label>
              <input
                type="number"
                step="1000"
                value={inputs.taxableBalance}
                onChange={(e) => updateField('taxableBalance', parseInt(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Cash Cushion ($)</label>
              <input
                type="number"
                step="1000"
                value={inputs.cashCushionBalance}
                onChange={(e) => updateField('cashCushionBalance', parseInt(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </CollapsibleSection>

        {/* Contribution Rates */}
        <CollapsibleSection id="contributions" icon={<PiggyBank size={14} />} title="Contribution Rates" open={isOpen('contributions')} onToggle={toggleSection}>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">RRSP Contribution ($/yr)</label>
              <input
                type="number"
                step="1000"
                value={inputs.rrspContribution ?? 0}
                onChange={(e) => updateField('rrspContribution', parseInt(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">TFSA Contribution ($/yr)</label>
              <input
                type="number"
                step="1000"
                value={inputs.tfsaContribution ?? 0}
                onChange={(e) => updateField('tfsaContribution', parseInt(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Non-Registered Contribution ($/yr)</label>
              <input
                type="number"
                step="1000"
                value={inputs.taxableContribution ?? 0}
                onChange={(e) => updateField('taxableContribution', parseInt(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </CollapsibleSection>

        {/* RDSP (Registered Disability Savings Plan) */}
        <CollapsibleSection id="rdsp" icon={<HeartHandshake size={14} />} title="RDSP (Disability Savings)" open={isOpen('rdsp')} onToggle={toggleSection}>
          <label className="flex items-center gap-2 text-[11px] text-neutral-400 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={inputs.rdsp?.enabled === true}
              onChange={(e) => toggleRdsp(e.target.checked)}
              className="mt-0.5"
            />
            <span>This person holds an RDSP (DTC-eligible beneficiary)</span>
          </label>
          {inputs.rdsp?.enabled && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-[11px] text-neutral-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inputs.rdsp.dtcEligible === true}
                  onChange={(e) => updateRdsp({ dtcEligible: e.target.checked })}
                  className="mt-0.5"
                />
                <span>Eligible for the Disability Tax Credit (required for grants/bonds)</span>
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className={LABEL_CLS}>Current balance ($)</label>
                  <input type="number" step="1000" value={inputs.rdsp.balance}
                    onChange={(e) => updateRdsp({ balance: Math.max(0, parseInt(e.target.value) || 0) })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Contribution ($/yr)</label>
                  <input type="number" step="500" value={inputs.rdsp.contribution}
                    onChange={(e) => updateRdsp({ contribution: Math.max(0, parseInt(e.target.value) || 0) })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Family income ($/yr)</label>
                  <input type="number" step="1000" value={inputs.rdsp.familyIncome}
                    onChange={(e) => updateRdsp({ familyIncome: Math.max(0, parseInt(e.target.value) || 0) })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Contribution basis ($)</label>
                  <input type="number" step="1000" value={inputs.rdsp.contributionBasis ?? inputs.rdsp.balance}
                    onChange={(e) => updateRdsp({ contributionBasis: Math.max(0, parseInt(e.target.value) || 0) })} className={INPUT_CLS} />
                </div>
              </div>
              <p className="text-[10px] text-neutral-500 leading-snug">
                Grants (CDSG) match contributions up to 300%/200% at lower incomes and bonds (CDSB) pay up to
                $1,000/yr at the lowest incomes — both to age 49; contributions to age 59. Growth is tax-sheltered.
                On withdrawal the <strong className="text-neutral-400">grant/bond/growth</strong> portion is taxable;
                only the contribution principal comes back tax-free. <em>Basis</em> is how much of the current balance
                is contributed principal (defaults to the full balance). Thresholds &amp; caps are editable in Settings.
                The 10-year AHA clawback and grant/bond carry-forward are not modelled.
              </p>
            </div>
          )}
        </CollapsibleSection>

        {/* Benefits */}
        <CollapsibleSection id="benefits" icon={<MapPin size={14} />} title="Government Benefits" open={isOpen('benefits')} onToggle={toggleSection}>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">CPP Start Age (60-70)</label>
              <input
                type="number"
                min="60"
                max="70"
                value={inputs.cppStartAge || ''}
                onChange={(e) => {
                  const val = e.target.value ? parseInt(e.target.value) : null;
                  if (val === null || (val >= 60 && val <= 70)) {
                    updateField('cppStartAge', val);
                  }
                }}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>
                {inputs.cppAdjustedAmount === false ? 'CPP Monthly at 65 ($)' : 'CPP Monthly ($)'}
              </label>
              <input
                type="number"
                min="0"
                value={inputs.cppMonthlyAmount}
                onChange={(e) => updateField('cppMonthlyAmount', parseInt(e.target.value) || 0)}
                className={INPUT_CLS}
              />
              {inputs.cppStartAge != null && (
                <p className="mt-1 text-[10px] text-neutral-500 leading-snug">
                  {inputs.cppAdjustedAmount === false ? (
                    <>
                      Adjusted for start age {inputs.cppStartAge}:{' '}
                      <span className="text-emerald-400 font-medium">
                        ${Math.round(inputs.cppMonthlyAmount * cppAdjustmentMultiplier(inputs.cppStartAge, config)).toLocaleString()}/mo
                      </span>
                      {' '}({((cppAdjustmentMultiplier(inputs.cppStartAge, config) - 1) * 100).toFixed(1)}%)
                    </>
                  ) : (
                    <>Amount used as entered (already adjusted for the start age).</>
                  )}
                </p>
              )}
            </div>
            <label className="flex items-start gap-2 text-[11px] text-neutral-400 cursor-pointer">
              <input
                type="checkbox"
                checked={inputs.cppAdjustedAmount !== false}
                onChange={(e) => updateField('cppAdjustedAmount', e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Amount is already adjusted for the start age
                <span className="block text-[10px] text-neutral-500 mt-0.5">
                  Unchecked: the engine applies the 0.6%/mo early penalty and 0.7%/mo deferral bonus
                  to your age-65 amount.
                </span>
              </span>
            </label>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">OAS Start Age (65-70)</label>
              <input
                type="number"
                min="65"
                max="70"
                value={inputs.oasStartAge || ''}
                onChange={(e) => {
                  const val = e.target.value ? parseInt(e.target.value) : null;
                  if (val === null || (val >= 65 && val <= 70)) {
                    updateField('oasStartAge', val);
                  }
                }}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Years in Canada</label>
              <input
                type="number"
                value={inputs.oasYearsInCanada}
                onChange={(e) => updateField('oasYearsInCanada', parseInt(e.target.value) || 0)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        </CollapsibleSection>

        {/* Pensions */}
        <CollapsibleSection id="pensions" icon={<Landmark size={14} />} title="Pensions" open={isOpen('pensions')} onToggle={toggleSection}>
          <PensionList pensions={inputs.pensions ?? []} onChange={(next) => updateField('pensions', next)} />
          <p className="text-[10px] text-neutral-500 leading-snug">
            Defined-benefit and bridge pensions: taxable income stacked with CPP/OAS, reducing the
            portfolio draw. Set an end age for a bridge/temporary pension; leave blank for lifetime.
            "indexed" grows with CPI when table indexation is on. A DC / LIRA lump sum is already
            modelled by your RRSP/RRIF balance, not here.
          </p>
        </CollapsibleSection>

        {/* Employment income (semi-/post-retirement work) */}
        <CollapsibleSection id="employment" icon={<Briefcase size={14} />} title="Employment Income" open={isOpen('employment')} onToggle={toggleSection}>
          <EmploymentList employment={inputs.employment ?? []} onChange={(next) => updateField('employment', next)} tfsaAnnualLimit={config.engine.tfsaAnnualLimit} />
          <p className="text-[10px] text-neutral-500 leading-snug">
            Semi- or post-retirement work: earned income taxed on top of your benefits (and counted
            for OAS clawback and GIS). With "tops up spending" the after-tax pay covers spending
            first — displacing withdrawals — and any excess is saved; otherwise the whole after-tax
            pay is saved into the chosen account. "indexed" grows with CPI when table indexation is on.
          </p>
        </CollapsibleSection>

        {/* Cash Events (one-time & recurring) */}
        <CollapsibleSection id="events" icon={<CalendarClock size={14} />} title="Cash Events" open={isOpen('events')} onToggle={toggleSection}>
          {renderEventList(
            inputs.events ?? [],
            (next) => updateField('events', next),
            inputs.currentAge,
            inputs.retirementAge,
            'primary',
          )}
        </CollapsibleSection>

        {/* Spending Phases */}
        <CollapsibleSection id="phases" icon={<Activity size={14} />} title="Spending Phases" open={isOpen('phases')} onToggle={toggleSection}>
          <div className="space-y-1.5">
            <div className="px-2.5 py-2 bg-neutral-800/50 border border-neutral-700/50 rounded space-y-1.5">
              <label className={LABEL_CLS}>Desired Spending ($/yr, today's dollars)</label>
              <input
                type="number"
                step="1000"
                value={inputs.desiredSpending}
                onChange={(e) => updateField('desiredSpending', parseInt(e.target.value) || 0)}
                className={INPUT_CLS}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-300 shrink-0">{inputs.currentAge} – {(sortedBands[0]?.fromAge ?? inputs.maxAge + 1) - 1}</span>
                <span className="text-[11px] text-neutral-200 font-medium truncate" title="Base desired spending (today's dollars)">
                  {formatMoney(inputs.desiredSpending)}/yr · 100%
                </span>
              </div>
            </div>
            {renderBandList(
              inputs.spendingBands ?? [],
              (next) => updateField('spendingBands', next),
              inputs.desiredSpending,
            )}
            <p className="text-[10px] text-neutral-500 leading-snug">
              Go-go / slow-go / no-go: from each age, spending drops to that share of desired
              spending{config.engine.indexSpending !== false
                ? ` (then grown ${(config.engine.inflationRate * 100).toFixed(1)}%/yr by CPI — the table's Spending Target shows those future dollars; turn off "Grow spending with inflation" in Settings → Engine for a flat target)`
                : ' (held flat in today\'s dollars — "Grow spending with inflation" is off in Settings → Engine)'}.
              The verdict uses retirement-year spending.
            </p>
          </div>
        </CollapsibleSection>

        {/* Spouse */}
        <CollapsibleSection id="spouse" icon={<Users size={14} />} title="Spouse" open={isOpen('spouse')} onToggle={toggleSection}>
          <label className="flex items-center gap-2 text-[11px] text-neutral-400 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={inputs.spouse?.enabled === true}
              onChange={(e) => toggleSpouse(e.target.checked)}
              className="mt-0.5"
            />
            <span>Include spouse (independent plan, combined household view)</span>
          </label>
          {inputs.spouse?.enabled && (
            <div className="space-y-3">
              {/* Spouse source: built-in (edited inline) vs a link to another
                  saved plan. The link is the source of truth; its person is
                  materialized into the spouse plan, host wins on shared fields. */}
              {linkableScenarios.length > 0 && (
                <div className="flex rounded border border-neutral-700 overflow-hidden text-[11px]">
                  <button
                    onClick={setSpouseSourceBuiltin}
                    className={`flex-1 px-2 py-1.5 font-medium ${!isLinkedSpouse ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'}`}
                  >
                    Built-in
                  </button>
                  <button
                    onClick={() => setSpouseSourceScenario(linkableScenarios[0]?.id ?? '')}
                    className={`flex-1 px-2 py-1.5 font-medium ${isLinkedSpouse ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-white'}`}
                    title="Use another saved plan as the spouse"
                  >
                    Link a plan
                  </button>
                </div>
              )}

              {isLinkedSpouse ? (
                <div className="space-y-2">
                  <div>
                    <label className={LABEL_CLS}>Spouse is this saved plan</label>
                    <select
                      value={spouseSource.kind === 'scenario' ? spouseSource.scenarioId : ''}
                      onChange={(e) => setSpouseSourceScenario(e.target.value)}
                      className={INPUT_CLS}
                    >
                      {linkableScenarios.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* The linked plan's basic numbers, fetched live from the saved
                      scenario — same fields the built-in view edits. Edits stay
                      local until "Save to linked plan" writes them back. */}
                  {linkedDraft && (
                    <>
                      <div className="grid grid-cols-3 gap-1.5">
                        <div>
                          <label className={LABEL_CLS}>Age</label>
                          <input type="number" value={linkedDraft.currentAge ?? ''}
                            onChange={(e) => updateLinkedDraft({ currentAge: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Retire</label>
                          <input type="number" value={linkedDraft.retirementAge ?? ''}
                            onChange={(e) => updateLinkedDraft({ retirementAge: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Spending $</label>
                          <input type="number" step="1000" value={linkedDraft.desiredSpending ?? ''}
                            onChange={(e) => updateLinkedDraft({ desiredSpending: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className={LABEL_CLS}>RRSP $</label>
                          <input type="number" step="1000" value={linkedDraft.rrspBalance ?? ''}
                            onChange={(e) => updateLinkedDraft({ rrspBalance: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>TFSA $</label>
                          <input type="number" step="1000" value={linkedDraft.tfsaBalance ?? ''}
                            onChange={(e) => updateLinkedDraft({ tfsaBalance: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Taxable $</label>
                          <input type="number" step="1000" value={linkedDraft.taxableBalance ?? ''}
                            onChange={(e) => updateLinkedDraft({ taxableBalance: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Cash $</label>
                          <input type="number" step="1000" value={linkedDraft.cashCushionBalance ?? ''}
                            onChange={(e) => updateLinkedDraft({ cashCushionBalance: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>RRSP contrib $/yr</label>
                          <input type="number" step="1000" value={linkedDraft.rrspContribution ?? ''}
                            onChange={(e) => updateLinkedDraft({ rrspContribution: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>TFSA contrib $/yr</label>
                          <input type="number" step="1000" value={linkedDraft.tfsaContribution ?? ''}
                            onChange={(e) => updateLinkedDraft({ tfsaContribution: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>CPP start</label>
                          <input type="number" min="60" max="70" value={linkedDraft.cppStartAge ?? ''}
                            onChange={(e) => updateLinkedDraft({ cppStartAge: e.target.value ? parseInt(e.target.value) : null })} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>CPP at 65 $/mo</label>
                          <input type="number" min="0" value={linkedDraft.cppMonthlyAmount ?? ''}
                            onChange={(e) => updateLinkedDraft({ cppMonthlyAmount: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>OAS start</label>
                          <input type="number" min="65" max="70" value={linkedDraft.oasStartAge ?? ''}
                            onChange={(e) => updateLinkedDraft({ oasStartAge: e.target.value ? parseInt(e.target.value) : null })} className={INPUT_CLS} />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Yrs in Canada</label>
                          <input type="number" value={linkedDraft.oasYearsInCanada ?? ''}
                            onChange={(e) => updateLinkedDraft({ oasYearsInCanada: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                        </div>
                      </div>
                      <button
                        onClick={saveLinkedDraft}
                        disabled={!linkedDirty || !onUpdateScenarioInputs}
                        className="w-full px-2 py-1.5 rounded text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-default"
                        title={linkedDirty ? `Write these numbers back into "${linkedScenario?.name}"` : 'No changes to save'}
                      >
                        {linkedDirty ? `Save to "${linkedScenario?.name}"` : 'Saved in the linked plan'}
                      </button>
                    </>
                  )}

                  {(spouseWarnings ?? []).length > 0 && (
                    <div className="px-2 py-1.5 bg-amber-900/30 border border-amber-700/50 rounded space-y-0.5">
                      <p className="text-[10px] font-semibold text-amber-200 leading-snug">
                        Why these are overridden: a couple shares one province, one market and one
                        planning horizon, so this plan supplies them for both partners.
                      </p>
                      {(spouseWarnings ?? []).map((w, i) => (
                        <p key={i} className="text-[10px] text-amber-300 leading-snug">⚠ {w}</p>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-neutral-500 leading-snug">
                    The linked plan's balances, ages and benefits run as the spouse. Your market
                    assumptions, province and horizon apply to the household (host wins) — any of the
                    spouse's own that differ are ignored, as warned above. Pensions, events and
                    spending phases stay on the linked plan itself.
                  </p>
                </div>
              ) : (
              <>
              <div className="grid grid-cols-3 gap-1.5">
                <div>
                  <label className={LABEL_CLS}>Age</label>
                  <input type="number" value={inputs.spouse.currentAge}
                    onChange={(e) => updateSpouse({ currentAge: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Retire</label>
                  <input type="number" value={inputs.spouse.retirementAge}
                    onChange={(e) => updateSpouse({ retirementAge: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Spending $</label>
                  <input type="number" step="1000" value={inputs.spouse.desiredSpending}
                    onChange={(e) => updateSpouse({ desiredSpending: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className={LABEL_CLS}>RRSP $</label>
                  <input type="number" step="1000" value={inputs.spouse.rrspBalance}
                    onChange={(e) => updateSpouse({ rrspBalance: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>TFSA $</label>
                  <input type="number" step="1000" value={inputs.spouse.tfsaBalance}
                    onChange={(e) => updateSpouse({ tfsaBalance: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Taxable $</label>
                  <input type="number" step="1000" value={inputs.spouse.taxableBalance}
                    onChange={(e) => updateSpouse({ taxableBalance: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Cash $</label>
                  <input type="number" step="1000" value={inputs.spouse.cashCushionBalance}
                    onChange={(e) => updateSpouse({ cashCushionBalance: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>RRSP contrib $/yr</label>
                  <input type="number" step="1000" value={inputs.spouse.rrspContribution}
                    onChange={(e) => updateSpouse({ rrspContribution: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>TFSA contrib $/yr</label>
                  <input type="number" step="1000" value={inputs.spouse.tfsaContribution}
                    onChange={(e) => updateSpouse({ tfsaContribution: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>CPP start</label>
                  <input type="number" min="60" max="70" value={inputs.spouse.cppStartAge ?? ''}
                    onChange={(e) => updateSpouse({ cppStartAge: e.target.value ? parseInt(e.target.value) : null })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>CPP at 65 $/mo</label>
                  <input type="number" min="0" value={inputs.spouse.cppMonthlyAmount}
                    onChange={(e) => updateSpouse({ cppMonthlyAmount: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>OAS start</label>
                  <input type="number" min="65" max="70" value={inputs.spouse.oasStartAge ?? ''}
                    onChange={(e) => updateSpouse({ oasStartAge: e.target.value ? parseInt(e.target.value) : null })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Yrs in Canada</label>
                  <input type="number" value={inputs.spouse.oasYearsInCanada}
                    onChange={(e) => updateSpouse({ oasYearsInCanada: parseInt(e.target.value) || 0 })} className={INPUT_CLS} />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Spouse pensions</label>
                <PensionList pensions={inputs.spouse.pensions ?? []} onChange={(next) => updateSpouse({ pensions: next })} />
              </div>
              <div>
                <label className={LABEL_CLS}>Spouse employment income</label>
                <EmploymentList employment={inputs.spouse.employment ?? []} onChange={(next) => updateSpouse({ employment: next })} tfsaAnnualLimit={config.engine.tfsaAnnualLimit} />
              </div>
              <div>
                <label className={LABEL_CLS}>Spouse cash events</label>
                {renderEventList(
                  inputs.spouse.events ?? [],
                  (next) => updateSpouse({ events: next }),
                  inputs.spouse.currentAge,
                  inputs.spouse.retirementAge,
                  'spouse',
                )}
              </div>
              <div>
                <label className={LABEL_CLS}>Spouse spending phases</label>
                {renderBandList(
                  inputs.spouse.spendingBands ?? [],
                  (next) => updateSpouse({ spendingBands: next }),
                  inputs.spouse.desiredSpending,
                )}
              </div>
              <div className="border-t border-neutral-800 pt-2">
                <label className="flex items-center gap-2 text-[11px] text-neutral-400 cursor-pointer mb-2">
                  <input
                    type="checkbox"
                    checked={inputs.spouse.rdsp?.enabled === true}
                    onChange={(e) => updateSpouse(e.target.checked
                      ? { rdsp: { enabled: true, balance: 0, contribution: 1500, familyIncome: 50000, dtcEligible: true, ...(inputs.spouse?.rdsp ?? {}) } }
                      : { rdsp: undefined })}
                    className="mt-0.5"
                  />
                  <span>Spouse holds an RDSP (DTC beneficiary)</span>
                </label>
                {inputs.spouse.rdsp?.enabled && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className={LABEL_CLS}>RDSP balance $</label>
                      <input type="number" step="1000" value={inputs.spouse.rdsp.balance}
                        onChange={(e) => updateSpouse({ rdsp: { ...inputs.spouse!.rdsp!, balance: Math.max(0, parseInt(e.target.value) || 0) } })} className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Contrib $/yr</label>
                      <input type="number" step="500" value={inputs.spouse.rdsp.contribution}
                        onChange={(e) => updateSpouse({ rdsp: { ...inputs.spouse!.rdsp!, contribution: Math.max(0, parseInt(e.target.value) || 0) } })} className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Family income $/yr</label>
                      <input type="number" step="1000" value={inputs.spouse.rdsp.familyIncome}
                        onChange={(e) => updateSpouse({ rdsp: { ...inputs.spouse!.rdsp!, familyIncome: Math.max(0, parseInt(e.target.value) || 0) } })} className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Contrib basis $</label>
                      <input type="number" step="1000" value={inputs.spouse.rdsp.contributionBasis ?? inputs.spouse.rdsp.balance}
                        onChange={(e) => updateSpouse({ rdsp: { ...inputs.spouse!.rdsp!, contributionBasis: Math.max(0, parseInt(e.target.value) || 0) } })} className={INPUT_CLS} />
                    </div>
                    <label className="col-span-2 flex items-center gap-2 text-[11px] text-neutral-400 cursor-pointer">
                      <input type="checkbox" checked={inputs.spouse.rdsp.dtcEligible === true}
                        onChange={(e) => updateSpouse({ rdsp: { ...inputs.spouse!.rdsp!, dtcEligible: e.target.checked } })} className="mt-0.5" />
                      <span>DTC-eligible (required for grants/bonds)</span>
                    </label>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-neutral-500 leading-snug">
                The spouse runs as an independent plan with the same market assumptions, province and
                max age; household totals are the two plans summed. Pension income splitting (up to
                50% of eligible pension income to the lower-taxed spouse) is applied to the reported
                household tax — see Settings → Engine.
              </p>

              {/* Save the embedded spouse as its own standalone scenario — the
                  first step toward linking instead of embedding (the spouse's
                  numbers then live in one place, editable from either plan). */}
              {onSaveSpouseAsScenario && (
                spouseSaveAsOpen ? (
                  <div className="px-2 py-2 bg-neutral-800 border border-neutral-700 rounded space-y-1.5">
                    <label className={LABEL_CLS}>Save spouse as a new plan</label>
                    <input
                      type="text"
                      value={spouseSaveAsName}
                      onChange={(e) => setSpouseSaveAsName(e.target.value)}
                      className={INPUT_CLS}
                      placeholder="Plan name"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={confirmSpouseSaveAs}
                        disabled={!spouseSaveAsName.trim()}
                        className="flex-1 px-2 py-1.5 rounded text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                      >
                        Save plan
                      </button>
                      <button
                        onClick={() => setSpouseSaveAsOpen(false)}
                        className="px-2 py-1.5 rounded text-[11px] text-neutral-400 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={openSpouseSaveAs}
                    className="w-full px-2 py-1.5 rounded text-[11px] font-medium border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500"
                    title="Create a standalone scenario from this spouse's numbers"
                  >
                    Save spouse as its own plan…
                  </button>
                )
              )}
              </>
              )}
            </div>
          )}
        </CollapsibleSection>

        {/* Withdrawal Strategy */}
        <CollapsibleSection id="withdrawal" icon={<ArrowDownWideNarrow size={14} />} title="Withdrawal Strategy" open={isOpen('withdrawal')} onToggle={toggleSection}>
          <div className="space-y-1.5">
            {withdrawalOrder.map((account, index) => (
              <div
                key={account}
                className="flex items-center justify-between px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-neutral-500 font-mono w-3">{index + 1}</span>
                  <span className="text-xs text-white">{ACCOUNT_LABELS[account]}</span>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => moveAccount(index, -1)}
                    disabled={index === 0}
                    className="p-0.5 hover:bg-neutral-700 rounded disabled:opacity-25"
                    title="Move earlier"
                  >
                    <ChevronUp size={12} className="text-neutral-400" />
                  </button>
                  <button
                    onClick={() => moveAccount(index, 1)}
                    disabled={index === withdrawalOrder.length - 1}
                    className="p-0.5 hover:bg-neutral-700 rounded disabled:opacity-25"
                    title="Move later"
                  >
                    <ChevronDown size={12} className="text-neutral-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-neutral-500 leading-snug">
            Cash cushion is always the last resort. RRSP converts to a RRIF at 71 — minimum withdrawals are taken first and count toward spending.
          </p>
        </CollapsibleSection>

        {/* Reverse Mortgage */}
        <CollapsibleSection id="rmortgage" icon={<Home size={14} />} title="Home Equity (Reverse Mtg / HELOC)" open={isOpen('rmortgage')} onToggle={toggleSection}>
          <label className="flex items-center gap-2 text-[11px] text-neutral-400 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={inputs.reverseMortgage?.enabled === true}
              onChange={(e) => toggleRm(e.target.checked)}
              className="mt-0.5"
            />
            <span>Borrow against home equity (proceeds are tax-free)</span>
          </label>
          {inputs.reverseMortgage?.enabled && (
            <div className="space-y-3">
              <div>
                <label className={LABEL_CLS}>Product type</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => updateRm({ mode: 'reverse' })}
                    className={`px-2.5 py-1.5 rounded text-[11px] border ${!((inputs.reverseMortgage.mode ?? 'reverse') === 'heloc') ? 'bg-blue-600 border-blue-500 text-white' : 'bg-neutral-800 border-neutral-700 text-neutral-400'}`}
                  >
                    Reverse mortgage
                  </button>
                  <button
                    type="button"
                    onClick={() => updateRm({
                      mode: 'heloc',
                      // Move the LTV default to the HELOC-typical 65% only if the
                      // user hasn't already set a custom ceiling (still on a default).
                      ...(((inputs.reverseMortgage?.maxLtv ?? 0.55) === 0.55) ? { maxLtv: 0.65 } : {}),
                    })}
                    className={`px-2.5 py-1.5 rounded text-[11px] border ${(inputs.reverseMortgage.mode ?? 'reverse') === 'heloc' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-neutral-800 border-neutral-700 text-neutral-400'}`}
                  >
                    HELOC
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className={LABEL_CLS}>Home value ($)</label>
                  <input type="number" step="1000" value={inputs.reverseMortgage.homeValue}
                    onChange={(e) => updateRm({ homeValue: Math.max(0, parseInt(e.target.value) || 0) })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Appreciation (%/yr)</label>
                  <input type="number" step="0.1" value={+(inputs.reverseMortgage.appreciationRate * 100).toFixed(2)}
                    onChange={(e) => updateRm({ appreciationRate: (parseFloat(e.target.value) || 0) / 100 })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Loan interest (%/yr)</label>
                  <input type="number" step="0.1" value={+(inputs.reverseMortgage.interestRate * 100).toFixed(2)}
                    onChange={(e) => updateRm({ interestRate: (parseFloat(e.target.value) || 0) / 100 })} className={INPUT_CLS} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Max loan-to-value (%)</label>
                  <input type="number" step="1" min="0" max="100" value={+((inputs.reverseMortgage.maxLtv ?? ((inputs.reverseMortgage.mode ?? 'reverse') === 'heloc' ? 0.65 : 0.55)) * 100).toFixed(0)}
                    onChange={(e) => updateRm({ maxLtv: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) / 100 })} className={INPUT_CLS} />
                </div>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-neutral-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={inputs.reverseMortgage.topUp === true}
                  onChange={(e) => updateRm({ topUp: e.target.checked })}
                  className="mt-0.5"
                />
                <span>Top up spending once accounts run out (last resort)</span>
              </label>

              <div>
                <label className="flex items-center gap-2 text-[11px] text-neutral-400 cursor-pointer mb-1.5">
                  <input
                    type="checkbox"
                    checked={(inputs.reverseMortgage.drawAmount ?? 0) > 0}
                    onChange={(e) => updateRm(e.target.checked
                      ? { drawAmount: 12000, startAge: inputs.reverseMortgage!.startAge ?? inputs.retirementAge, durationYears: inputs.reverseMortgage!.durationYears ?? 10 }
                      : { drawAmount: 0 })}
                    className="mt-0.5"
                  />
                  <span>Scheduled draws</span>
                </label>
                {(inputs.reverseMortgage.drawAmount ?? 0) > 0 && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <div>
                      <label className={LABEL_CLS}>$/yr</label>
                      <input type="number" step="1000" value={inputs.reverseMortgage.drawAmount}
                        onChange={(e) => updateRm({ drawAmount: Math.max(0, parseInt(e.target.value) || 0) })} className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>From age</label>
                      <input type="number" value={inputs.reverseMortgage.startAge ?? inputs.retirementAge}
                        onChange={(e) => updateRm({ startAge: parseInt(e.target.value) || inputs.retirementAge })} className={INPUT_CLS} />
                    </div>
                    <div>
                      <label className={LABEL_CLS}>Years</label>
                      <input type="number" value={inputs.reverseMortgage.durationYears ?? ''} placeholder="∞"
                        onChange={(e) => updateRm({ durationYears: e.target.value === '' ? undefined : Math.max(1, parseInt(e.target.value) || 1) })} className={INPUT_CLS} />
                    </div>
                  </div>
                )}
              </div>

              <p className="text-[10px] text-neutral-500 leading-snug">
                Draws are tax-free and land in the cash cushion (no effect on GIS or the OAS clawback).
                Net equity = home value − loan, shown in the year-by-year table. Scheduled draws are
                CPI-indexed like your spending target.
                {(inputs.reverseMortgage.mode ?? 'reverse') === 'heloc' ? (
                  <> <strong className="text-neutral-400">HELOC:</strong> the year's interest is paid
                  out of cash flow (added to that year's spending/expenses), so the loan doesn't compound —
                  but there is no negative-equity guarantee, so equity can fall below zero. Typical ceiling ~65%.</>
                ) : (
                  <> <strong className="text-neutral-400">Reverse mortgage:</strong> interest compounds into
                  the loan; borrowing stops once the loan reaches the max loan-to-value ceiling (lenders
                  typically cap near 55%), and the balance never exceeds it (no-negative-equity guarantee).</>
                )}
              </p>
            </div>
          )}
        </CollapsibleSection>

        {/* Market Hypotheses */}
        <CollapsibleSection id="market" icon={<TrendingUp size={14} />} title="Market Hypotheses" open={isOpen('market')} onToggle={toggleSection}>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Expected Return (%)</label>
              <input
                type="number"
                step="0.1"
                value={+(inputs.investmentReturn * 100).toFixed(4)}
                onChange={(e) => updateField('investmentReturn', (parseFloat(e.target.value) || 0) / 100)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Volatility (%/yr) — Monte Carlo</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={+((inputs.returnVolatility ?? 0) * 100).toFixed(4)}
                onChange={(e) => updateField('returnVolatility', (parseFloat(e.target.value) || 0) / 100)}
                className="w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500"
              />
              <p className="mt-1 text-[10px] text-neutral-500 leading-snug">
                Standard deviation of annual returns. 0% = deterministic. Typical equity-heavy portfolio: 15–20%.
              </p>
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
