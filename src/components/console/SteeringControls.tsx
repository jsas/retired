// The steering controls, at home on the Dashboard (issue #187 — the Steering
// page folded into it). A goals-level equalizer over the plan: every control
// is a styleguide fader, and the dashboard's own life timeline below is the
// single visual that answers every drag — the old Steering page drew a second
// copy under these controls, which just repeated itself, so it's gone. (The
// retirement-age × spending pad was here too; it duplicated the contour map
// and the age/spending faders, so it was removed.)
//
// Bands (min–max crops) still exist under the hood — they bound what the
// faders may be set to — but the faders render plain: no per-control band
// chrome. Values clamp into their band (clampToBand). The success-rate
// readout is scored against one seeded batch of futures so it stays stable
// while dragging.
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useAppLocale } from '../../lib/localeContext';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { Fader } from '../../design/primitives';
import { rangePrefsOverride } from '../../lib/rangePrefs';
import {
  AXES, axisValue, withAxis, clampToBand, deterministicOutcome, reconcileControl,
  type EqAxis, type Band,
} from '@retired/engine-core/eqConstraints';

const fmtMoney = (v: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

/** Live solver state handed down from App. */
export interface EqSolvedState {
  successRate: number | null;
  solving: boolean;
}

export type Bands = Record<EqAxis, Band>;

export interface SteeringControlsProps {
  inputs: RetirementInputs;
  config: AppConfig;
  onChange: (inputs: RetirementInputs) => void;
  bands: Bands;
  onBandsChange: (b: Bands) => void;
  solved: EqSolvedState;
}

// ---------------------------------------------------------------------------
// RangeFader — the styleguide's one slider (Fader), fed by the band system.
// The min–max crop edges are gone: bands still bound what a control may be
// set to, but each control reads as a plain fader — label, value, hairline
// track, square thumb, the axis ends below.
// ---------------------------------------------------------------------------
function RangeFader({ axis, inputs, band, onChange }: {
  axis: EqAxis;
  inputs: RetirementInputs;
  band: Band;
  onChange: (inputs: RetirementInputs) => void;
}) {
  const { t } = useTranslation('pages');
  const spec = AXES[axis];
  const value = axisValue(inputs, axis);
  // Reconcile for DISPLAY so a stale crop (edges outside the track, or framing
  // out the value) never renders a stuck knob; the page effect persists it back.
  const rc = reconcileControl(axis, inputs, band, rangePrefsOverride());
  // The range actually RENDERED: the axis, floored at the plan's logical min
  // (retirement ≥ current age, savings ≥ locked RRSP+TFSA) and grown in
  // whole-axis steps when the value exceeds the axis max.
  const range = rc.range;

  // The knob moves inside the band (it can't be dragged outside the allowed
  // crop even though the track shows the full range).
  const setValue = (raw: number) => onChange(withAxis(inputs, axis, clampToBand(axis, band, raw)));

  return (
    <Fader
      label={t(`eq.axes.${axis}`)}
      value={value}
      min={range.min} max={range.max} step={spec.step}
      format={spec.format}
      onChange={setValue}
    />
  );
}

// ---------------------------------------------------------------------------
// ReadoutCard — a pure readout of a live plan outcome (not a knob, no goals).
// `tone` marks the verdict: good=blue (the system's ok), warn=amber, bad=rose,
// neutral=ink. Left-rule instead of a tinted box.
// ---------------------------------------------------------------------------
function ReadoutCard({ label, value, tone, solving }: {
  label: string;
  value: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  solving?: boolean;
}) {
  const { t } = useTranslation('pages');
  const edge = tone === 'good' ? 'border-l-blue-700'
    : tone === 'warn' ? 'border-l-amber-500'
    : tone === 'bad' ? 'border-l-rose-500'
    : 'border-l-slate-300';
  const valueColor = tone === 'good' ? 'text-blue-700'
    : tone === 'warn' ? 'text-amber-700'
    : tone === 'bad' ? 'text-rose-700'
    : 'text-slate-900';

  return (
    <div className={`border border-slate-200 border-l-2 px-2.5 py-1.5 ${edge}`}>
      <div className="text-[9px] uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className={`num flex items-center gap-1 text-[13px] font-semibold ${valueColor}`}>
        {solving && <Loader2 size={12} className="animate-spin text-slate-400" aria-label={t('eq.calculating')} />}
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The controls block, rendered inside the Dashboard's "Adjust the plan" panel.
// ---------------------------------------------------------------------------
export function SteeringControls({ inputs, config, onChange, bands, onBandsChange, solved }: SteeringControlsProps) {
  const { t } = useTranslation('pages');
  const { locale } = useAppLocale();
  const o = deterministicOutcome(inputs, config);

  // RECONCILE every control to a sane state (crop edges inside the rendered
  // range, value inside its crop) whenever the plan or a crop changes. This
  // undoes any stale persisted crop — e.g. a min edge clamped up past the knob
  // that left it unable to drag left. Batched, and only writes when something
  // actually changed — so no render loop.
  useEffect(() => {
    let bandChanged = false;
    const nextBands = { ...bands };
    for (const axis of Object.keys(AXES) as EqAxis[]) {
      const r = reconcileControl(axis, inputs, bands[axis], rangePrefsOverride());
      if (r.band.min !== bands[axis].min || r.band.max !== bands[axis].max) {
        nextBands[axis] = r.band;
        bandChanged = true;
      }
    }
    if (bandChanged) onBandsChange(nextBands);
  }, [inputs, bands, onBandsChange]);

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3 leading-snug max-w-2xl">
        {t('eq.lead')}
      </p>

      {/* sliders flow 1→2→3 columns so more fit above the fold. Annual
          spending and retirement age are NOT here (#192) — the contour
          panel above owns those two axes (its dot, the Start Drawing and
          After Tax Spending faders), so repeating them was noise. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        <RangeFader axis="investmentReturn" inputs={inputs} band={bands.investmentReturn} onChange={onChange} />
        <RangeFader axis="annualSavings" inputs={inputs} band={bands.annualSavings} onChange={onChange} />
        <RangeFader axis="maxAge" inputs={inputs} band={bands.maxAge} onChange={onChange} />
        <RangeFader axis="returnVolatility" inputs={inputs} band={bands.returnVolatility} onChange={onChange} />
        <RangeFader axis="cppStartAge" inputs={inputs} band={bands.cppStartAge} onChange={onChange} />
        <RangeFader axis="oasStartAge" inputs={inputs} band={bands.oasStartAge} onChange={onChange} />
      </div>
      {/* live outcome readouts — pure readouts, no goals/steppers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        <ReadoutCard label={t('eq.status')} value={o.status === 'ON_TRACK' ? t('eq.onTrack') : t('eq.shortfall')} tone={o.status === 'ON_TRACK' ? 'good' : 'bad'} />
        <ReadoutCard label={t('eq.moneyLastsTo')} value={`${o.depletionAge ?? inputs.maxAge}${o.depletionAge === null ? '+' : ''}`} tone={o.depletionAge === null ? 'good' : 'bad'} />
        <ReadoutCard
          label={t('eq.successRate')}
          value={solved.successRate == null ? '—' : `${(solved.successRate * 100).toFixed(0)}%`}
          solving={solved.solving}
          tone={solved.successRate == null ? 'neutral' : solved.successRate >= 0.9 ? 'good' : solved.successRate >= 0.75 ? 'warn' : 'bad'}
        />
        <ReadoutCard label={t('eq.leftAtEnd')} value={fmtMoney(o.endingBalance, locale)} tone={o.endingBalance > 0 ? 'good' : 'neutral'} />
      </div>
    </div>
  );
}
