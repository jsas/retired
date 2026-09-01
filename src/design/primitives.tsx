/**
 * Design primitives — the small reusable pieces the beta skin is built from.
 * Each one is a named embodiment of a rule in the style guide; pages compose
 * these rather than restyle raw elements, so the vocabulary stays consistent.
 * The living reference is StyleGuide.tsx; the prose is STYLEGUIDE.md.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BLUE, RED_DOT, AMBER_DOT, cls } from './tokens';
import { helpTopic } from '../help/topics';

/* ── VerdictHero ──────────────────────────────────────────────────────────
   The answer, first, in plain English. One uppercase eyebrow, one sentence,
   one supporting line. Nothing else competes with it on the page. */
export function VerdictHero({ eyebrow = 'The verdict', verdict, sub }: {
  eyebrow?: ReactNode;
  verdict: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <section className="border-b border-slate-200 pb-6 pt-8 md:pt-10">
      <p className={cls.sectionLabel}>{eyebrow}</p>
      <h1 className="num mt-1.5 text-[24px] font-semibold leading-snug text-slate-900 md:text-[30px]">
        {verdict}
      </h1>
      {sub && <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-500">{sub}</p>}
    </section>
  );
}

/* ── HelpHint ─────────────────────────────────────────────────────────────
   The small ? at the end of a label. Click/tap opens a flat hairline box
   (w-72) with the topic's title, the SAME body the Help page renders (never
   re-typed here — one source of truth in src/help/topics.tsx), and a link
   that deep-links into Help. Opens on click not hover (touch is first-class),
   closes on outside-tap / Esc / re-tap. `place="top"` flips it above. */
export function HelpHint({ topic: topicId, place = 'bottom', className = '' }: {
  /** Unique topic id from src/help/topics.tsx — also the Help-page anchor. */
  topic: string;
  place?: 'bottom' | 'top';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const topic = helpTopic(topicId);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!topic) return null;

  return (
    <span ref={ref} className={`relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label={`Help: ${topic.title}`}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center border border-slate-300 text-[10px] font-semibold leading-none text-slate-400 hover:border-slate-400 hover:text-slate-600 focus:outline-none focus:border-slate-500"
      >
        ?
      </button>
      {open && (
        <span
          role="dialog"
          aria-label={topic.title}
          className={`absolute left-0 z-50 block w-72 border border-slate-200 bg-white p-3 text-left ${
            place === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'
          }`}
        >
          <span className="mb-1.5 block text-[12px] font-semibold text-slate-900">{topic.title}</span>
          <span className="block">{topic.body}</span>
          <a
            href={`#/help?topic=${topic.id}`}
            className="mt-2 inline-block text-[11px] font-medium text-blue-700 hover:underline"
          >
            More in Help →
          </a>
        </span>
      )}
    </span>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────
   The only "container": a hairline rule and a label, never a card. Use for
   any grouped block that needs a name. */
export function Panel({ label, hint, action, children, className = '' }: {
  label: string;
  /** A help-topic id — renders a ? at the end of the label. */
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-b border-slate-200 py-7 ${className}`}>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className={cls.sectionLabel}>{label}{hint && <HelpHint topic={hint} />}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ── Fader ────────────────────────────────────────────────────────────────
   The one slider. A 24px hit strip for fingers whose visible track is a
   4px hairline (the thumb rides a clipped content-box). Square thumb, no
   fill to the left — the position itself is the signal. */
export function Fader({ label, help, value, min, max, step, format, onChange, hint }: {
  label: string;
  /** A help-topic id — renders a ? at the end of the label. */
  help?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="border-l-2 border-slate-200 pl-4">
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-[13px] font-medium text-slate-700">{label}{help && <HelpHint topic={help} />}</label>
        <span className="num text-[15px] font-bold text-slate-900">{format(value)}</span>
      </div>
      <input
        type="range"
        className="fader block w-full"
        style={{ height: 24 }}
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      <div className="num mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{format(min)}</span><span>{format(max)}</span>
      </div>
      {hint && <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

/* ── Chip ─────────────────────────────────────────────────────────────────
   A small stateless status pill: a square dot + plain words. Colour carries
   the verdict — blue holds, red runs out, amber borderline. */
export function Chip({ tone, title, children }: {
  tone: 'holds' | 'short' | 'borderline' | 'neutral';
  title: string;
  children?: ReactNode;
}) {
  const dot =
    tone === 'holds' ? BLUE :
    tone === 'short' ? RED_DOT :
    tone === 'borderline' ? AMBER_DOT : '#94a3b8';
  return (
    <div className="border-l-2 border-slate-200 pl-4">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2" style={{ backgroundColor: dot }} />
        <span className="text-[13px] font-medium text-slate-700">{title}</span>
      </div>
      {children && <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">{children}</p>}
    </div>
  );
}

/* ── Stat ─────────────────────────────────────────────────────────────────
   One key number: a tiny uppercase label, the figure (always tabular), and a
   one-line note. The "key numbers" grid is a row of these. */
export function Stat({ label, value, note, tone = 'neutral' }: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: 'neutral' | 'holds' | 'short' | 'borderline';
}) {
  const valueColor =
    tone === 'holds' ? 'text-blue-700' :
    tone === 'short' ? 'text-rose-700' :
    tone === 'borderline' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`num mt-0.5 text-2xl font-bold ${valueColor}`}>{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-slate-400">{note}</p>}
    </div>
  );
}

/* ── AccountBars ──────────────────────────────────────────────────────────
   Shares of the pot at a given age: a label, a flat bar (no rounding), and
   the amount. The active account reads blue, the rest slate. */
export function AccountBars({ rows, total }: {
  rows: Array<{ label: string; value: number; active?: boolean }>;
  total: number;
}) {
  const fmt = (v: number) => '$' + Math.round(v).toLocaleString('en-CA');
  return (
    <div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2.5 text-[12px]">
            <span className="w-14 text-slate-500">{r.label}</span>
            <div className="h-2 flex-1 bg-slate-100">
              <div
                className={`h-full ${r.active ? 'bg-blue-700' : 'bg-slate-400'}`}
                style={{ width: total > 0 ? `${Math.max(0, Math.min(100, (r.value / total) * 100))}%` : '0%' }}
              />
            </div>
            <span className="num w-20 text-right text-slate-700">{fmt(r.value)}</span>
          </div>
        ))}
      </div>
      {total > 0 && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
          Shares of <span className="num">{fmt(total)}</span> at that age. The mix shifts as the plan moves.
        </p>
      )}
    </div>
  );
}

/* ── Legend ───────────────────────────────────────────────────────────────
   A row of small keyed swatches explaining a chart. Square or line swatches,
   plain words, never a colour the verdict doesn't own. */
export function Legend({ items }: {
  items: Array<{ swatch: 'line-blue' | 'box-blue' | 'box-rose'; label: ReactNode }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px] text-slate-500">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {it.swatch === 'line-blue' && <span className="inline-block w-3.5 border-t-2 border-blue-700" />}
          {it.swatch === 'box-blue' && <span className="inline-block h-2.5 w-2.5 border border-blue-300 bg-blue-100" />}
          {it.swatch === 'box-rose' && <span className="inline-block h-2.5 w-2.5 border border-rose-300 bg-rose-100" />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ── Dropdown ─────────────────────────────────────────────────────────────
   A flat, hairline-bordered panel under a text button — no shadow, no arrow
   chrome. Used for the Details/Plans menus. Closes on selection. */
export function Dropdown({ label, children, wide = false }: {
  label: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {label} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div
          className={`absolute left-0 top-[calc(100%+4px)] z-50 border border-slate-200 bg-white p-2 ${wide ? 'min-w-[300px]' : 'min-w-[230px]'}`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Footnote ─────────────────────────────────────────────────────────────
   The quiet legal/privacy line at the very bottom — always visible, never
   hidden, small and low-contrast on purpose. */
export function Footnote({ children }: { children: ReactNode }) {
  return (
    <footer className="mt-8 border-t border-slate-200 pt-4 text-[11px] text-slate-400">
      {children}
    </footer>
  );
}

/* ── Dot ──────────────────────────────────────────────────────────────────
   The small square status/legend dot — the system's dots are SQUARE, not
   round. Used by legends, status indicators and the verdict chip. */
export function Dot({ color, size = 10, title }: { color: string; size?: number; title?: string }) {
  return (
    <span
      title={title}
      className="inline-block shrink-0"
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
}

/* ── Progress ─────────────────────────────────────────────────────────────
   A thin hairline track with a flat fill of `pct` percent. No rounded pill,
   no shadow, no inline-style div soup in the page — the fill's width is the
   only inline value (a computed percent, not a forked color). */
export function Progress({ pct, className = '' }: { pct: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className={`h-1 w-full border border-slate-200 bg-white ${className}`} role="progressbar"
      aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-blue-600" style={{ width: `${clamped}%` }} />
    </div>
  );
}

/* ── Modal ────────────────────────────────────────────────────────────────
   The flat overlay shell — hairline border, no shadow, no rounded card. Pages
   needing a dialog compose this instead of rolling their own shadow box.
   Closes on the backdrop tap and on Esc. */
export function Modal({ open, onClose, title, children, wide = false }: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" onClick={onClose}
        className="absolute inset-0 cursor-default bg-slate-900/30" />
      <div className={`relative w-full ${wide ? 'max-w-2xl' : 'max-w-sm'} border border-slate-200 bg-white`}>
        {title != null && (
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-[13px] font-semibold text-slate-900">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close dialog"
              className="px-1 text-slate-400 hover:text-slate-900">×</button>
          </div>
        )}
        <div className="px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ── AppHeader ────────────────────────────────────────────────────────────
   The beta chrome: brand square, the named homes (menus/actions), and the
   save control. Flat, hairline bottom border, sticky. */
export function AppHeader({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-2 px-4">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-slate-900 text-[10px] font-bold text-white">
          RE:
        </span>
        {children}
      </div>
    </header>
  );
}
