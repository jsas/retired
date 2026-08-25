import { useRef, useState } from 'react';
import { User, PiggyBank, TrendingUp, Shield, MapPin, ArrowDownWideNarrow, ChevronUp, ChevronDown, ChevronRight, CalendarClock, Plus, Trash2, Activity, Users, Landmark, Home, X } from 'lucide-react';
import type { RetirementInputs, WithdrawalAccount, CashEvent, SpendingBand, Pension, ReverseMortgage } from '../lib/retirementEngine';
import { cppAdjustmentMultiplier } from '../lib/retirementEngine';
import type { AppConfig } from '../lib/appConfig';

interface SidebarFormProps {
  inputs: RetirementInputs;
  onChange: (inputs: RetirementInputs) => void;
  provinceCodes: string[];
  config: AppConfig;
  onClose?: () => void; // mobile drawer close (hidden on md+)
}

const ACCOUNT_LABELS: Record<WithdrawalAccount, string> = {
  tfsa: 'TFSA',
  taxable: 'Taxable',
  rrsp: 'RRSP / RRIF',
};

const INPUT_CLS = 'w-full px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 rounded text-xs text-white focus:outline-none focus:border-blue-500';
const LABEL_CLS = 'block text-[11px] text-neutral-500 mb-1';

const formatMoney = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

let eventSeq = 0;
const newEventId = () => `ev-${Date.now().toString(36)}-${(eventSeq++).toString(36)}`;
const newPensionId = () => `pen-${Date.now().toString(36)}-${(eventSeq++).toString(36)}`;

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

export function SidebarForm({ inputs, onChange, provinceCodes, config, onClose }: SidebarFormProps) {
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

  const updateBand = (index: number, patch: Partial<SpendingBand>) => {
    const next = sortedBands.map((b, i) => (i === index ? { ...b, ...patch } : b));
    updateField('spendingBands', next);
  };

  const updateEvent = (index: number, patch: Partial<CashEvent>) => {
    const next = (inputs.events ?? []).map((ev, i) => (i === index ? { ...ev, ...patch } : ev));
    updateField('events', next);
  };

  const updateSpouse = (patch: Partial<NonNullable<RetirementInputs['spouse']>>) => {
    if (!inputs.spouse) return;
    updateField('spouse', { ...inputs.spouse, ...patch });
  };

  const updateRm = (patch: Partial<ReverseMortgage>) => {
    if (!inputs.reverseMortgage) return;
    updateField('reverseMortgage', { ...inputs.reverseMortgage, ...patch });
  };

  // Stash the last-used spouse / reverse-mortgage values so toggling the
  // section off and back on restores them instead of resetting to defaults.
  // (The field is set to `undefined` when off, which would otherwise lose them.)
  const spouseStash = useRef<NonNullable<RetirementInputs['spouse']> | null>(null);
  const rmStash = useRef<ReverseMortgage | null>(null);

  const toggleSpouse = (on: boolean) => {
    if (on) {
      const base = spouseStash.current ?? {
        enabled: true as const,
        currentAge: inputs.currentAge, retirementAge: inputs.retirementAge,
        rrspBalance: 0, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 900,
        oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 30000,
      };
      updateField('spouse', { ...base, enabled: true });
    } else {
      if (inputs.spouse) spouseStash.current = inputs.spouse;
      updateField('spouse', undefined);
    }
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
                onChange={(e) => updateField('currentAge', parseInt(e.target.value) || 0)}
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

        {/* Cash Events (one-time & recurring) */}
        <CollapsibleSection id="events" icon={<CalendarClock size={14} />} title="Cash Events" open={isOpen('events')} onToggle={toggleSection}>
          <div className="space-y-2">
            {(inputs.events ?? []).map((ev, i) => (
              <div key={ev.id} className="px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={ev.label}
                    placeholder="Label"
                    onChange={(e) => updateEvent(i, { label: e.target.value })}
                    className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={() => updateField('events', (inputs.events ?? []).filter((_, j) => j !== i))}
                    className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-red-400"
                    title="Remove event"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={ev.direction}
                    onChange={(e) => updateEvent(i, { direction: e.target.value as CashEvent['direction'] })}
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
                    onChange={(e) => updateEvent(i, { amount: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={ev.endAge != null ? 'yearly' : 'once'}
                    onChange={(e) => updateEvent(i, e.target.value === 'yearly' ? { endAge: ev.age } : { endAge: null })}
                    title="One-time or yearly"
                    className="px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="once">Once at</option>
                    <option value="yearly">Yearly</option>
                  </select>
                  <input
                    type="number"
                    value={ev.age}
                    title={ev.endAge != null ? 'Start age' : 'Age'}
                    onChange={(e) => updateEvent(i, { age: parseInt(e.target.value) || ev.age })}
                    className="w-14 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                  />
                  {ev.endAge != null && (
                    <>
                      <span className="text-[10px] text-neutral-500">to</span>
                      <input
                        type="number"
                        value={ev.endAge}
                        title="End age (inclusive)"
                        onChange={(e) => updateEvent(i, { endAge: Math.max(ev.age, parseInt(e.target.value) || ev.age) })}
                        className="w-14 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                      />
                    </>
                  )}
                </div>
                {ev.direction === 'in' && (
                  <select
                    value={ev.account ?? 'taxable'}
                    onChange={(e) => updateEvent(i, { account: e.target.value as CashEvent['account'] })}
                    className="w-full px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="taxable">→ Taxable account</option>
                    <option value="tfsa">→ TFSA</option>
                    <option value="rrsp">→ RRSP</option>
                    <option value="cash">→ Cash cushion</option>
                  </select>
                )}
              </div>
            ))}
            <button
              onClick={() => updateField('events', [...(inputs.events ?? []), { id: newEventId(), age: inputs.retirementAge, label: 'House sale', amount: 100000, direction: 'in', account: 'taxable' }])}
              className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-neutral-400 hover:text-white hover:bg-neutral-800 rounded w-full"
            >
              <Plus size={12} /> Add event
            </button>
            {(inputs.events ?? []).length > 0 && (
              <p className="text-[10px] text-neutral-500 leading-snug">
                Inflows land in the chosen account (they do not grow earlier years); outflows add to
                that year's spending need. Choose <em>Yearly</em> and set a start–end age range to repeat
                the same amount each year (e.g. yearly for 5 years → end age = start + 4).
              </p>
            )}
          </div>
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
            {sortedBands.map((band, i) => (
              <div key={i} className="flex items-center gap-1.5 px-2 py-1.5 bg-neutral-800 border border-neutral-700 rounded">
                <input
                  type="number"
                  value={band.fromAge}
                  title="From age"
                  onChange={(e) => updateBand(i, { fromAge: parseInt(e.target.value) || band.fromAge })}
                  className="w-14 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                />
                <span className="text-[10px] text-neutral-500">+</span>
                <input
                  type="number"
                  value={Math.round(band.pctOfBase * 100)}
                  title="% of desired spending"
                  onChange={(e) => updateBand(i, { pctOfBase: Math.max(0, (parseInt(e.target.value) || 0) / 100) })}
                  className="flex-1 min-w-0 px-1.5 py-1 bg-neutral-900 border border-neutral-700 rounded text-[11px] text-white focus:outline-none focus:border-blue-500"
                />
                <span className="text-[10px] text-neutral-500">%</span>
                <span className="text-[10px] text-neutral-400 whitespace-nowrap" title="Resulting yearly spending in today's dollars">
                  = {formatMoney(inputs.desiredSpending * band.pctOfBase)}
                </span>
                <button
                  onClick={() => updateField('spendingBands', sortedBands.filter((_, j) => j !== i))}
                  className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-red-400"
                  title="Remove phase"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={() => updateField('spendingBands', [...sortedBands, { fromAge: sortedBands.length > 0 ? sortedBands[sortedBands.length - 1].fromAge + 10 : 75, pctOfBase: 0.85 }])}
              className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-neutral-400 hover:text-white hover:bg-neutral-800 rounded w-full"
            >
              <Plus size={12} /> Add phase
            </button>
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
              <p className="text-[10px] text-neutral-500 leading-snug">
                The spouse runs as an independent plan with the same market assumptions, province and
                max age; household totals are the two plans summed. Pension income splitting (up to
                50% of eligible pension income to the lower-taxed spouse) is applied to the reported
                household tax — see Settings → Engine.
              </p>
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
        <CollapsibleSection id="rmortgage" icon={<Home size={14} />} title="Reverse Mortgage" open={isOpen('rmortgage')} onToggle={toggleSection}>
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
                  <input type="number" step="1" min="0" max="100" value={+((inputs.reverseMortgage.maxLtv ?? 0.55) * 100).toFixed(0)}
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
                The loan compounds at the interest rate against the home; net equity = home value − loan,
                shown in the year-by-year table. Borrowing stops once the loan reaches the max
                loan-to-value ceiling (lenders typically cap near 55%). Scheduled draws are CPI-indexed
                like your spending target.
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
