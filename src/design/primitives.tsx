/**
 * Design primitives — the small reusable pieces the beta skin is built from.
 * Each one is a named embodiment of a rule in the style guide; pages compose
 * these rather than restyle raw elements, so the vocabulary stays consistent.
 */
import type { ReactNode } from 'react';
import { BLUE, RED_DOT, AMBER_DOT, cls } from './tokens';

/* ── Fader ────────────────────────────────────────────────────────────────
   The one slider. A 24px hit strip for fingers whose visible track is a
   4px hairline (the thumb rides a clipped content-box). Square thumb, no
   fill to the left — the position itself is the signal. */
export function Fader({ label, value, min, max, step, format, onChange, hint }: {
  label: string;
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
        <label className="text-[13px] font-medium text-slate-700">{label}</label>
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

/* ── VerdictHero ──────────────────────────────────────────────────────────
   The answer, first, in plain English. One uppercase eyebrow, one sentence,
   one supporting line. Nothing else competes with it on the page. */
export function VerdictHero({ eyebrow = 'The verdict', verdict, sub }: {
  eyebrow?: string;
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

/* ── Panel ────────────────────────────────────────────────────────────────
   The only "container": a hairline rule and a label, never a card. Use for
   any grouped block that needs a name. */
export function Panel({ label, action, children, className = '' }: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-b border-slate-200 py-7 ${className}`}>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className={cls.sectionLabel}>{label}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
