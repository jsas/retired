import { Fragment, useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, Columns3, GripVertical } from 'lucide-react';
import type { YearlyBreakdown, YearDetail } from '@retired/engine-core/retirementEngine';
import { prefKV } from '../lib/prefKv';
import {
  SCHEDULE_COLUMNS,
  SCHEDULE_COLS_PREF_KEY,
  resolveVisibleColumns,
  TOPICAL_COLUMN_SETS,
  ALWAYS_VISIBLE_IDS,
  type ScheduleColumn,
} from './scheduleColumns';
import { Check } from '../design/primitives';

interface ScheduleTableProps {
  breakdown: YearlyBreakdown[];
  retirementAge: number;
  /** Drag bounds for the retirement marker (the blue hairline row). */
  currentAge?: number;
  maxAge?: number;
  /** When set, the retirement marker row is draggable: pull it up or down the
      table to change the retirement age. Absent = read-only marker. */
  onRetirementAgeChange?: (age: number) => void;
  // Household mode: the primary person's own rows + the spouse's rows keyed by
  // the primary's age axis (calendar year), so an expanded year can show both
  // people's detail. The combined `breakdown` rows themselves carry no detail.
  primaryBreakdown?: YearlyBreakdown[];
  spouseBreakdown?: YearlyBreakdown[];
  spouseAgeOffset?: number; // inputs.currentAge - spouse.currentAge
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const TONE_CLASS: Record<ScheduleColumn['tone'], string> = {
  plain: 'text-slate-700',
  green: 'text-emerald-700',
  red: 'text-red-700',
  amber: 'text-amber-700',
  amberDark: 'text-amber-800',
  amberDeep: 'text-amber-900',
  muted: 'text-slate-600',
  strong: 'font-semibold text-slate-900',
};

function readVisibleCols(): Set<string> {
  try {
    const raw = prefKV().getItem(SCHEDULE_COLS_PREF_KEY);
    return resolveVisibleColumns(raw ? (JSON.parse(raw) as string[]) : null);
  } catch {
    return resolveVisibleColumns(null);
  }
}

// The column picker: a small checklist popover pinned to the table header.
// Age and Ending Balance are the row's identity and its bottom line, so they
// stay on; everything else is a toggle, persisted via prefKV.
function ColumnPicker({ visible, onChange }: { visible: Set<string>; onChange: (next: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggleable = SCHEDULE_COLUMNS.filter((c) => !c.alwaysVisible);
  // Reset cycles the topical sets (money flow → accounts → tax → income → …)
  // rather than toggling everything on/off: each click lands on a coherent
  // story, and the choice persists like any manual change. The current state
  // matches a set iff the toggleable picks equal it exactly; a hand-picked
  // mix matches none and the next click starts at the top of the list.
  const toggleableVisible = [...visible].filter((id) => !ALWAYS_VISIBLE_IDS.includes(id));
  const currentSet = TOPICAL_COLUMN_SETS.findIndex((s) =>
    s.ids.length === toggleableVisible.length && s.ids.every((id) => visible.has(id)),
  );
  const reset = () => {
    const next = currentSet >= 0 ? (currentSet + 1) % TOPICAL_COLUMN_SETS.length : 0;
    onChange(new Set([...TOPICAL_COLUMN_SETS[next].ids]));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
          onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-slate-600 border border-slate-300 hover:border-slate-900 hover:text-slate-900"
        title="Choose which columns the table shows"
      >
        <Columns3 size={13} />
        Columns
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 bg-white border border-slate-200 p-2">
          <button
            type="button"
            onClick={reset}
            className="w-full text-left px-2 py-1 text-[11px] font-semibold text-slate-900 hover:bg-slate-50"
            title="Cycle the topical column sets — money flow, accounts, tax, income"
          >
            Reset
          </button>
          <div className="my-1 border-t border-slate-100" />
          {toggleable.map((c) => (
            <div key={c.id} className="px-2 py-1 hover:bg-slate-50">
              <Check
                size={12}
                checked={visible.has(c.id)}
                onChange={(on) => {
                  const next = new Set(visible);
                  if (on) next.add(c.id); else next.delete(c.id);
                  onChange(next);
                }}
                label={<span className="text-[11px] text-slate-700">{c.label}</span>}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A single labelled money line inside the drill-down panel.
function Line({ label, value, hint, strong, indent }: {
  label: string; value: number; hint?: string; strong?: boolean; indent?: boolean;
}) {
  if (Math.abs(value) < 0.5) return null; // hide zero lines to reduce noise
  return (
    <div className={`flex items-baseline justify-between gap-3 ${indent ? 'pl-3' : ''}`}>
      <span className={`text-[11px] ${strong ? 'font-semibold text-slate-800' : 'text-slate-600'}`} title={hint}>
        {label}
      </span>
      <span className={`text-[11px] font-mono ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[13rem]">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

// The expanded per-year drill-down: withdrawal provenance, growth, tax, RM,
// benefits and cash events.
function YearDetailPanel({ detail, row }: { detail: YearDetail; row: YearlyBreakdown }) {
  const w = detail.withdraw;
  const totalWithdrawn = row.withdrawals;
  const registeredTotal = w.rrifMin + w.rrif + w.rrsp;
  const pct = (v: number) => (totalWithdrawn > 0 ? ` ${Math.round((v / totalWithdrawn) * 100)}%` : '');
  const hasWithdrawals = totalWithdrawn > 0.5;
  const hasContrib = detail.contrib && (detail.contrib.rrsp + detail.contrib.tfsa + detail.contrib.taxable) > 0.5;
  const hasBenefits = row.cppIncome + row.oasIncome + row.gisIncome + row.pensionIncome > 0.5;
  const hasEmployment = (row.employmentGross ?? 0) > 0.5;
  const hasTax = Math.abs(row.incomeTax) > 0.5 || detail.tax.oasClawback > 0.5 || (row.totalTaxPaid ?? 0) > 0.5;
  const rm = detail.rm;

  return (
    <div className="flex flex-wrap gap-x-8 gap-y-4 px-2 py-1">
      {hasWithdrawals && (
        <Section title={`Where the ${formatCurrency(totalWithdrawn)} came from`}>
          {w.rrifMin > 0.5 && <Line label={`RRIF minimum${pct(w.rrifMin)}`} value={w.rrifMin} hint="Mandatory RRIF minimum, forced out first. Taxed as income." />}
          {w.rrif > 0.5 && <Line label={`RRIF draw${pct(w.rrif)}`} value={w.rrif} hint="Discretionary RRIF withdrawal. Taxed as income; grossed up so after-tax covers the need." />}
          {w.rrsp > 0.5 && <Line label={`RRSP draw${pct(w.rrsp)}`} value={w.rrsp} hint="RRSP withdrawal (before RRIF conversion). Taxed as income; grossed up." />}
          {w.tfsa > 0.5 && <Line label={`TFSA${pct(w.tfsa)}`} value={w.tfsa} hint="Tax-free: $1 withdrawn = $1 of spending." />}
          {w.taxable > 0.5 && (
            <>
              <Line label={`Taxable${pct(w.taxable)}`} value={w.taxable} hint="Non-registered. Only the embedded-gain fraction is taxed." />
              {detail.tax.capitalGains > 0.5 && (
                <Line label="↳ taxable gain portion" value={detail.tax.capitalGains} indent hint="The embedded-gain part of this draw, taxed at the inclusion rate. The rest is return of capital (tax-free)." />
              )}
            </>
          )}
          {w.cash > 0.5 && <Line label={`Cash cushion${pct(w.cash)}`} value={w.cash} hint="After-tax cash reserve, used as a last resort." />}
          {(w.rdsp ?? 0) > 0.5 && (
            <>
              <Line label={`RDSP${pct(w.rdsp ?? 0)}`} value={w.rdsp ?? 0} hint="Disability-plan withdrawal. The grant/bond/growth portion is taxable; the contribution principal is a tax-free return of capital." />
              {(detail.rdsp?.taxablePortion ?? 0) > 0.5 && (
                <Line label="↳ taxable portion" value={detail.rdsp!.taxablePortion ?? 0} indent hint="The grant/bond/growth part of this draw, added to taxable income. The rest is tax-free contribution principal." />
              )}
            </>
          )}
          {w.rmDraw > 0.5 && <Line label={`Reverse mortgage${pct(w.rmDraw)}`} value={w.rmDraw} hint="Tax-free borrowing against home equity; the loan grows by this amount." />}
          {registeredTotal > 0.5 && (
            <div className="pt-1 text-[10px] text-slate-400">Registered draws are grossed up for tax.</div>
          )}
        </Section>
      )}

      {hasContrib && (
        <Section title="Contributions">
          <Line label="RRSP" value={detail.contrib!.rrsp} />
          <Line label="TFSA" value={detail.contrib!.tfsa} />
          <Line label="Taxable" value={detail.contrib!.taxable} />
          {(detail.contrib!.rdsp ?? 0) > 0.5 && <Line label="RDSP" value={detail.contrib!.rdsp ?? 0} hint="Not deductible (like a TFSA); attracts grants/bonds at lower incomes." />}
          {(detail.contrib!.fhsa ?? 0) > 0.5 && <Line label="FHSA" value={detail.contrib!.fhsa ?? 0} hint="Deductible (like an RRSP); capped by the annual and lifetime limits." />}
        </Section>
      )}

      <Section title="Growth / interest earned">
        <Line label="RRSP" value={detail.growth.rrsp} />
        <Line label="RRIF" value={detail.growth.rrif} />
        <Line label="TFSA" value={detail.growth.tfsa} />
        <Line label="Taxable" value={detail.growth.taxable} />
        <Line label="Cash cushion" value={detail.growth.cash} hint="Cash earns the lower cushion rate." />
        {(detail.growth.rdsp ?? 0) > 0.5 && <Line label="RDSP" value={detail.growth.rdsp ?? 0} hint="Tax-sheltered growth; taxable only when withdrawn." />}
        {(detail.growth.fhsa ?? 0) > 0.5 && <Line label="FHSA" value={detail.growth.fhsa ?? 0} hint="Tax-sheltered growth; transfers to the RRSP at retirement (tax-free there too)." />}
      </Section>

      {detail.rdsp && (detail.rdsp.contribution > 0.5 || detail.rdsp.grant > 0.5 || detail.rdsp.bond > 0.5) && (
        <Section title="RDSP grants & bonds">
          {detail.rdsp.contribution > 0.5 && <Line label="Your contribution" value={detail.rdsp.contribution} />}
          {detail.rdsp.grant > 0.5 && <Line label="CDSG (grant)" value={detail.rdsp.grant} hint="Canada Disability Savings Grant — matches contributions up to 300%/200% at lower incomes." />}
          {detail.rdsp.bond > 0.5 && <Line label="CDSB (bond)" value={detail.rdsp.bond} hint="Canada Disability Savings Bond — income-tested; no contribution needed." />}
          <Line label="Balance" value={detail.rdsp.balance} strong />
        </Section>
      )}

      {detail.fhsa && detail.fhsa.contribution > 0.5 && (
        <Section title="FHSA">
          <Line label="Contribution (deductible)" value={detail.fhsa.contribution} hint="Reduces this year's taxable income like an RRSP contribution." />
          <Line label="Contributed to date" value={detail.fhsa.contributionBasis} hint={`Toward the lifetime limit.`} />
          <Line label="Balance" value={detail.fhsa.balance} strong />
        </Section>
      )}

      {/* Contribution-room ledger (issue #24 / #119 T5): remaining room at year
          end for each tracked account, plus any over-contribution that overflowed
          to taxable this year. Shown only when room tracking is on. */}
      {detail.roomRemaining && (
        <Section title="Contribution room">
          {detail.roomRemaining.tfsa !== undefined && (
            <Line label="TFSA room left" value={detail.roomRemaining.tfsa} strong hint="Remaining TFSA contribution room at year end (after this year's accrual and deposits)." />
          )}
          {detail.roomRemaining.rrsp !== undefined && (
            <Line label="RRSP room left" value={detail.roomRemaining.rrsp} strong hint="Remaining RRSP contribution room at year end (after this year's accrual and deposits)." />
          )}
          {(detail.overflow?.tfsa ?? 0) > 0.5 && (
            <Line label="TFSA over-contribution" value={detail.overflow!.tfsa} hint="This much would have gone into the TFSA but ran out of room, so it was redirected to the taxable account." />
          )}
          {(detail.overflow?.rrsp ?? 0) > 0.5 && (
            <Line label="RRSP over-contribution" value={detail.overflow!.rrsp} hint="This much would have gone into the RRSP but ran out of room, so it was redirected to the taxable account." />
          )}
        </Section>
      )}

      {hasBenefits && (
        <Section title="Benefits (gross)">
          <Line label="CPP" value={row.cppIncome} />
          <Line label="OAS" value={row.oasIncome} />
          <Line label="GIS" value={row.gisIncome} hint="Tax-free." />
          <Line label="Pension" value={row.pensionIncome} />
        </Section>
      )}

      {hasEmployment && (
        <Section title="Employment income">
          <Line label="Gross pay" value={row.employmentGross ?? 0} hint="Earned income — stacks on benefits for tax, OAS clawback and GIS." />
          <Line label="Tax on it" value={row.employmentTax ?? 0} hint="The marginal tax on this pay, on top of the tax on benefits alone." />
          <Line label="After-tax (net)" value={row.employmentNet ?? 0} strong hint="Saved into the job's account, or used to top up spending first." />
        </Section>
      )}

      {hasTax && (
        <Section title="Tax on withdrawals">
          <Line label="Income tax" value={row.incomeTax} strong hint="Tax on registered draws and realized gains beyond the tax on benefits alone, plus OAS clawback." />
          <Line label="Total tax (all income)" value={row.totalTaxPaid ?? 0} hint="Tax on the year's ENTIRE income (benefits + employment + withdrawals + gains) plus OAS clawback — what a tax return would show. Charged every year taxable income is received." />
          {detail.tax.oasClawback > 0.5 && <Line label="↳ OAS clawback" value={detail.tax.oasClawback} indent hint="OAS recovery tax: net income above the threshold is clawed back at 15¢/$." />}
          <Line label="Cumulative tax" value={row.cumulativeTax} hint="Total income tax since retirement." />
        </Section>
      )}

      {rm && (
        <Section title="Reverse mortgage">
          <Line label="Interest accrued" value={rm.interestAccrued} hint="Compounds onto the loan even after the LTV ceiling stops new draws." />
          {rm.scheduledDraw > 0.5 && <Line label="Scheduled draw" value={rm.scheduledDraw} hint="Planned draw, CPI-indexed, capped by LTV headroom." />}
          {rm.topUpDraw > 0.5 && <Line label="Top-up draw" value={rm.topUpDraw} hint="Last-resort borrowing to cover the year's shortfall." />}
          <Line label="Loan balance" value={rm.loanBalance} strong />
          <Line label="Home value" value={rm.homeValue} />
        </Section>
      )}

      {detail.debts && detail.debts.some(d => d.interestAccrued > 0.5 || d.payment > 0.5 || d.balanceEnd > 0.5) && (
        <Section title="Debts">
          {detail.debts.map((d, i) => (
            <div key={i}>
              <div className="text-[11px] font-medium text-slate-600 mt-1 first:mt-0">{d.label}</div>
              <div className="pl-2">
                <Line label="Interest accrued" value={d.interestAccrued} hint="This year's interest charge, compounded onto the balance before the payment." />
                {d.payment > 0.5 && <Line label="Payment" value={d.payment} hint="Serviced out of cash flow (funded from your accounts like any other expense)." />}
                <Line label="Balance" value={d.balanceEnd} strong />
              </div>
            </div>
          ))}
        </Section>
      )}

      {detail.events.length > 0 && (
        <Section title="Cash events">
          {detail.events.map((ev, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] text-slate-600">{ev.label}</span>
              <span className={`text-[11px] font-mono ${ev.direction === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>
                {ev.direction === 'in' ? '+' : '−'}{formatCurrency(ev.amount)}
              </span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

export function ScheduleTable({ breakdown, retirementAge, currentAge, maxAge, onRetirementAgeChange, primaryBreakdown, spouseBreakdown, spouseAgeOffset = 0 }: ScheduleTableProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (age: number) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(age)) next.delete(age); else next.add(age);
      return next;
    });

  // The blue hairline row marks the start-drawing age. When the page hands us an
  // onChange, that row is draggable: press on the grip and pull up or down;
  // release and the retirement age moves to the row under the pointer, clamped
  // to the same bounds the lever uses. The listeners live on the DOCUMENT, not
  // the row — as the marker crosses to a new age React re-renders the row and
  // would otherwise drop its handlers mid-drag. A small movement threshold
  // separates a real drag from a plain click (so the row still expands).
  const canDragRetire = onRetirementAgeChange != null && currentAge != null;
  const dragLo = currentAge ?? 40, dragHi = Math.min(75, maxAge ?? 75);
  const [dragAge, setDragAge] = useState<number | null>(null);
  const dragState = useRef<{ pointerId: number; startY: number; moved: boolean; latest: number } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const ageAtClientY = (clientY: number): number | null => {
    const tbody = tableRef.current?.querySelector('tbody');
    if (!tbody) return null;
    const rows = Array.from(tbody.querySelectorAll('tr[data-age]'));
    for (const el of rows) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        return Number((el as HTMLElement).dataset.age);
      }
    }
    return null;
  };

  const endDrag = () => {
    const s = dragState.current;
    if (!s) return;
    dragState.current = null;
    const finalAge = s.latest;
    setDragAge(null);
    if (s.moved && finalAge !== retirementAge) {
      onRetirementAgeChange?.(Math.max(dragLo, Math.min(dragHi, finalAge)));
    }
  };

  const beginRetireDrag = (e: React.PointerEvent) => {
    if (!canDragRetire) return;
    e.preventDefault(); // don't let the press select text or trigger the row's click
    dragState.current = { pointerId: e.pointerId, startY: e.clientY, moved: false, latest: retirementAge };
    setDragAge(retirementAge);

    const onMove = (ev: PointerEvent) => {
      const s = dragState.current;
      if (!s || ev.pointerId !== s.pointerId) return;
      if (Math.abs(ev.clientY - s.startY) > 5) s.moved = true; // past the click threshold
      const a = ageAtClientY(ev.clientY);
      if (a != null) {
        s.latest = Math.max(dragLo, Math.min(dragHi, a));
        setDragAge(s.latest);
      }
    };
    const onUp = (ev: PointerEvent) => {
      if (dragState.current && ev.pointerId === dragState.current.pointerId) endDrag();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    // Auto-detach on unmount.
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
    // Stash cleanup so a pointercancel / re-render can't leak listeners.
    (dragState.current as any).cleanup = cleanup;
  };

  useEffect(() => () => {
    (dragState.current as any)?.cleanup?.();
  }, []);

  const effectiveRetirement = dragAge ?? retirementAge;

  // Household mode: look each row's per-person detail up by age (the combined
  // rows carry no detail — per-source numbers don't sum meaningfully).
  const household = !!(primaryBreakdown || spouseBreakdown);
  const primaryByAge = new Map((primaryBreakdown ?? []).map(r => [r.age, r]));
  const spouseByAge = new Map((spouseBreakdown ?? []).map(r => [r.age + spouseAgeOffset, r]));

  // Reverse-mortgage columns appear only when the feature produced them.
  const hasRm = breakdown.some(r => r.netHomeEquity !== undefined);
  // RDSP balance column appears only when a person has an RDSP.
  const hasRdsp = breakdown.some(r => r.rdspBalance !== undefined);
  // FHSA balance column appears only when a person has an FHSA.
  const hasFhsa = breakdown.some(r => r.fhsaBalance !== undefined);
  // Debt balance column appears only when a person carries a debt.
  const hasDebts = breakdown.some(r => r.debtBalance !== undefined);
  const anyDetail = household || breakdown.some(r => r.detail);

  // User-visible base columns (picker + prefKV), unioned with the columns the
  // profile actually uses: an account the plan holds money in, or a benefit it
  // receives, stays on screen even if the stored pref hid it — the picker only
  // governs the columns this profile could take or leave. (The feature columns
  // — RDSP/FHSA/Home Equity/Debts — already work this way: active means shown.)
  const PROFILE_CONDITIONAL_IDS = ['rrsp', 'rrif', 'tfsa', 'taxable', 'cashCushion', 'cpp', 'oas', 'gis', 'pension'];
  const activeFromProfile = new Set(
    SCHEDULE_COLUMNS
      .filter((c) => PROFILE_CONDITIONAL_IDS.includes(c.id) && breakdown.some((r) => (c.value(r) ?? 0) > 0.5))
      .map((c) => c.id),
  );
  const [visibleCols, setVisibleCols] = useState<Set<string>>(readVisibleCols);
  const updateVisibleCols = (next: Set<string>) => {
    setVisibleCols(next);
    prefKV().setItem(SCHEDULE_COLS_PREF_KEY, JSON.stringify([...next]));
  };
  const shownColumns = SCHEDULE_COLUMNS.filter((c) => visibleCols.has(c.id) || activeFromProfile.has(c.id));

  // Number of columns the detail row must span: visible base columns + the
  // expand chevron (when any row is expandable) + optional RM/RDSP/FHSA/Debt
  // columns. The chevron column was previously left out, so an expandable
  // table's detail row spanned one column too few and the panel didn't reach
  // the table's right edge.
  const colCount = shownColumns.length + (anyDetail ? 1 : 0) + (hasRm ? 1 : 0) + (hasRdsp ? 1 : 0) + (hasFhsa ? 1 : 0) + (hasDebts ? 1 : 0);

  const renderCell = (col: ScheduleColumn, row: YearlyBreakdown, isRetirement: boolean, dragAge: number | null = null) => {
    if (col.id === 'age') {
      return (
        <td key={col.id} className={`px-3 py-1.5 ${isRetirement ? 'font-bold text-blue-700' : 'text-slate-900'}`}>
          {row.age}
          {isRetirement && (
            canDragRetire
              ? <span
                  role="slider"
                  aria-label={`Start drawing — drag to change (now ${effectiveRetirement})`}
                  aria-valuemin={dragLo} aria-valuemax={dragHi} aria-valuenow={effectiveRetirement}
                  onPointerDown={beginRetireDrag}
                  title={`Drag to change the retirement age (now ${effectiveRetirement})`}
                  className="ml-1.5 inline-flex cursor-grab touch-none select-none items-center gap-1 align-middle text-blue-500 active:cursor-grabbing"
                >
                  <GripVertical size={12} aria-hidden="true" />
                  <span className="text-[10px] font-semibold">{dragAge != null ? `→ ${dragAge}` : 'drag'}</span>
                </span>
              : ' 🎯'
          )}
        </td>
      );
    }
    const v = col.value(row);
    const cls =
      col.tone === 'strong' && isRetirement
        ? 'font-semibold text-blue-700'
        : TONE_CLASS[col.tone];
    return (
      <td key={col.id} className={`px-3 py-1.5 text-right font-mono ${cls}`}>
        {v === undefined ? '—' : formatCurrency(v)}
      </td>
    );
  };

  return (
    <div className="bg-white border border-slate-200 overflow-hidden">
      <div className="flex justify-end px-2 py-1.5 border-b border-slate-100 bg-slate-50/60">
        <ColumnPicker visible={visibleCols} onChange={updateVisibleCols} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" ref={tableRef}>
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {anyDetail && <th className="w-6 px-1 py-2" title="Expand a year to see where the money came from" />}
              {shownColumns.map((c) => (
                <th
                  key={c.id}
                  className={`${c.align === 'left' ? 'text-left' : 'text-right'} px-3 py-2 font-semibold text-slate-700`}
                  title={c.title}
                >
                  {c.label}
                </th>
              ))}
              {hasRdsp && (
                <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Registered Disability Savings Plan. Growth is tax-sheltered; on withdrawal the grant/bond/growth portion is taxable (only contribution principal is tax-free).">RDSP</th>
              )}
              {hasFhsa && (
                <th className="text-right px-3 py-2 font-semibold text-slate-700" title="First Home Savings Account. Contributions are deductible; growth is tax-sheltered. Transfers to the RRSP at retirement (never drawn directly).">FHSA</th>
              )}
              {hasRm && (
                <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Home value minus reverse-mortgage loan balance. The loan compounds with interest and draws, eroding equity over time.">Home Equity</th>
              )}
              {hasDebts && (
                <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Total outstanding debt balance (mortgage, credit cards, loans, lines of credit). Interest accrues each year; payments are funded from spending.">Debts</th>
              )}
            </tr>
          </thead>
          <tbody>
            {breakdown.map((row, index) => {
              const isRetirement = row.age === effectiveRetirement;
              const isOpen = expanded.has(row.age);
              const personRows = household
                ? ([['You', primaryByAge.get(row.age)], ['Spouse', spouseByAge.get(row.age)]] as Array<[string, YearlyBreakdown | undefined]>)
                    .filter((x): x is [string, YearlyBreakdown] => !!x[1]?.detail)
                : [];
              const canExpand = household ? personRows.length > 0 : !!row.detail;
              const rowBg = index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50';
              return (
                <Fragment key={index}>
                  <tr
                    data-age={row.age}
                    className={`${rowBg} ${isRetirement ? 'border-t-2 border-blue-500' : ''} ${canExpand ? 'cursor-pointer hover:bg-blue-50/40' : ''}`}
                    onClick={canExpand ? () => toggle(row.age) : undefined}
                    title={canExpand ? (isOpen ? 'Collapse year detail' : 'Expand year detail') : undefined}
                  >
                    {anyDetail && (
                      <td className="px-1 py-1.5 text-slate-400">
                        {canExpand && !(canDragRetire && isRetirement) && (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
                      </td>
                    )}
                    {shownColumns.map((c) => renderCell(c, row, isRetirement, dragAge))}
                    {hasRdsp && (
                      <td className="px-3 py-1.5 text-right font-mono text-slate-600"
                        title={row.detail?.rdsp ? `Contribution basis ${formatCurrency(row.detail.rdsp.contributionBasis)} (tax-free); the rest is taxable on withdrawal` : undefined}>
                        {row.rdspBalance !== undefined ? formatCurrency(row.rdspBalance) : '—'}
                      </td>
                    )}
                    {hasFhsa && (
                      <td className="px-3 py-1.5 text-right font-mono text-slate-600"
                        title={row.detail?.fhsa ? `Contributed to date ${formatCurrency(row.detail.fhsa.contributionBasis)}; transfers to the RRSP at retirement` : undefined}>
                        {row.fhsaBalance !== undefined ? formatCurrency(row.fhsaBalance) : '—'}
                      </td>
                    )}
                    {hasRm && (
                      <td className={`px-3 py-1.5 text-right font-mono ${(row.netHomeEquity ?? 0) < 0 ? 'font-semibold text-rose-700' : 'text-slate-600'}`}
                        title={row.homeValue !== undefined ? `Home ${formatCurrency(row.homeValue)} − loan ${formatCurrency(row.loanBalance ?? 0)}` : undefined}>
                        {row.netHomeEquity !== undefined ? formatCurrency(row.netHomeEquity) : '—'}
                      </td>
                    )}
                    {hasDebts && (
                      <td className={`px-3 py-1.5 text-right font-mono ${(row.debtBalance ?? 0) > 0.5 ? 'text-rose-700' : 'text-slate-600'}`}
                        title={(row.debtPayments ?? 0) > 0.5 ? `Paid ${formatCurrency(row.debtPayments ?? 0)} this year` : undefined}>
                        {row.debtBalance !== undefined ? formatCurrency(row.debtBalance) : '—'}
                      </td>
                    )}
                  </tr>
                  {isOpen && canExpand && (
                    <tr className={rowBg}>
                      <td colSpan={colCount} className="px-3 py-3 border-l-2 border-blue-300 bg-blue-50/30">
                        {household ? (
                          <div className="space-y-4">
                            {personRows.map(([label, personRow]) => (
                              <div key={label}>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700 mb-1.5">
                                  {label}{personRow.age !== row.age ? ` (age ${personRow.age})` : ''}
                                </div>
                                <YearDetailPanel detail={personRow.detail!} row={personRow} />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <YearDetailPanel detail={row.detail!} row={row} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[10px] text-slate-400 border-t border-slate-100">
        Click a year to expand its inner workings — withdrawal sources, growth, tax, benefits and reverse
        mortgage.{canDragRetire && ' Drag the blue "stop working" row up or down to move the retirement age.'} Amounts
        are in nominal (future) dollars of each year: the spending target and contributions
        grow with inflation, while balances, gains and benefits are the actual dollars that year. CPP/OAS are
        shown at 2026 values unless "Index tax tables, OAS and CPP" is on in Settings → Engine.
      </p>
    </div>
  );
}
