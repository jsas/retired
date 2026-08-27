import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Users, Home, SlidersHorizontal, Target } from 'lucide-react';
import type { RetirementInputs } from '../lib/retirementEngine';

const formatMoney = (v: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);

/**
 * First-scenario setup wizard. A focused, step-by-step overlay that collects
 * the handful of inputs a projection can't run without — ages, balances,
 * contributions, CPP/OAS and a spending goal — each with a line of guidance,
 * then hands a complete RetirementInputs back to the caller to save as the
 * first scenario. Deliberately sparse: it gets a working plan on screen fast;
 * everything else (events, spending phases, spouse, reverse mortgage) stays in
 * the sidebar for later.
 */

// The values the wizard collects. Everything else on RetirementInputs is
// carried over from the caller's current inputs (market assumptions, province,
// withdrawal order, etc.) so the engine keeps its defaults.
export interface WizardData {
  currentAge: number;
  retirementAge: number;
  maxAge: number;
  rrspBalance: number;
  tfsaBalance: number;
  taxableBalance: number;
  cashCushionBalance: number;
  rrspContribution: number;
  tfsaContribution: number;
  taxableContribution: number;
  cppStartAge: number | null;
  cppMonthlyAmount: number;
  oasStartAge: number | null;
  oasYearsInCanada: number;
  desiredSpending: number;
}

export function wizardDataFrom(inputs: RetirementInputs): WizardData {
  return {
    currentAge: inputs.currentAge,
    retirementAge: inputs.retirementAge,
    maxAge: inputs.maxAge,
    rrspBalance: inputs.rrspBalance,
    tfsaBalance: inputs.tfsaBalance,
    taxableBalance: inputs.taxableBalance,
    cashCushionBalance: inputs.cashCushionBalance,
    rrspContribution: inputs.rrspContribution,
    tfsaContribution: inputs.tfsaContribution,
    taxableContribution: inputs.taxableContribution,
    cppStartAge: inputs.cppStartAge,
    cppMonthlyAmount: inputs.cppMonthlyAmount,
    oasStartAge: inputs.oasStartAge,
    oasYearsInCanada: inputs.oasYearsInCanada,
    desiredSpending: inputs.desiredSpending,
  };
}

/** Overlay the wizard's collected values onto a base plan, leaving every other
 *  field (market assumptions, province, events, spouse, …) untouched. */
export function applyWizardData(base: RetirementInputs, data: WizardData): RetirementInputs {
  return { ...base, ...data };
}

interface SetupWizardProps {
  /** Starting values (the app's current inputs, so defaults are sensible). */
  initial: WizardData;
  /** Finished all five steps — the caller saves the resulting plan. `addSpouse`
   *  is true when the user asked (on the review step) to set up a spouse next. */
  onComplete: (data: WizardData, opts: { addSpouse: boolean }) => void;
  /** Abandon the wizard and just go to the dashboard with whatever's there. */
  onSkip: () => void;
}

const NUM_CLS =
  'w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-sm text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
const LABEL_CLS = 'block text-[13px] font-medium text-slate-700 mb-1';
const HINT_CLS = 'text-[11px] text-slate-400 mt-0.5 leading-snug';

interface StepField {
  key: keyof WizardData;
  label: string;
  hint?: string;
  step?: number;
  min?: number;
  max?: number;
  /** When true, 0/empty means "not receiving / not set" and renders as blank. */
  nullable?: boolean;
}

interface Step {
  title: string;
  intro: string;
  fields: StepField[];
}

const STEPS: Step[] = [
  {
    title: 'Your ages',
    intro: 'Three numbers anchor the whole projection: where you are, when you stop work, and how long to plan for.',
    fields: [
      { key: 'currentAge', label: 'Your age now', min: 18, max: 80, hint: 'The projection starts here.' },
      { key: 'retirementAge', label: 'Retire at', min: 40, max: 75, hint: 'When contributions stop and drawdown begins.' },
      { key: 'maxAge', label: 'Plan to age', min: 70, max: 105, hint: 'Plan to a long life — 90–95 is a safe default.' },
    ],
  },
  {
    title: 'Your savings',
    intro: "Today's balances, by account type. Estimates are fine — you can refine them any time.",
    fields: [
      { key: 'rrspBalance', label: 'RRSP / RRIF', step: 1000, hint: 'Registered retirement accounts (taxed on withdrawal).' },
      { key: 'tfsaBalance', label: 'TFSA', step: 1000, hint: 'Tax-free — growth and withdrawals are never taxed.' },
      { key: 'taxableBalance', label: 'Non-registered', step: 1000, hint: 'Ordinary investment accounts; only the gains are taxed.' },
      { key: 'cashCushionBalance', label: 'Cash / savings', step: 1000, hint: 'Everyday cash. Used last, as a buffer.' },
    ],
  },
  {
    title: 'Still saving?',
    intro: "If you haven't retired yet, what are you putting away each year? Skip (0) if you're already retired.",
    fields: [
      { key: 'rrspContribution', label: 'RRSP contributions $/yr', step: 1000 },
      { key: 'tfsaContribution', label: 'TFSA contributions $/yr', step: 1000 },
      { key: 'taxableContribution', label: 'Non-registered $/yr', step: 1000 },
    ],
  },
  {
    title: 'Government benefits',
    intro: "CPP and OAS are the backbone of most plans. Your My Service Canada statement has your CPP estimate — a guess works too.",
    fields: [
      { key: 'cppMonthlyAmount', label: 'CPP $/month at 65', step: 50, hint: 'The age-65 amount; the engine adjusts for your start age.' },
      { key: 'cppStartAge', label: 'CPP start age (blank = none)', min: 60, max: 70, nullable: true, hint: 'Earlier is smaller, later is larger.' },
      { key: 'oasStartAge', label: 'OAS start age (blank = none)', min: 65, max: 70, nullable: true, hint: 'Usually 65.' },
      { key: 'oasYearsInCanada', label: 'Years in Canada since 18', min: 0, max: 50, hint: 'Sets your OAS fraction (40+ years = full).' },
    ],
  },
  {
    title: 'Your spending goal',
    intro: 'How much after-tax income do you want each year in retirement, in today\'s dollars? This is the number the plan tries to sustain.',
    fields: [
      { key: 'desiredSpending', label: 'Spending $/yr', step: 1000, hint: 'After tax, today\'s dollars. The engine grows it with inflation.' },
    ],
  },
];

export function SetupWizard({ initial, onComplete, onSkip }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(initial);
  // Review-step offers. `wantsSpouse` flips the CTA to "Create & add spouse";
  // `ownsHome` surfaces the reverse-mortgage pointer. Neither blocks completion.
  const [wantsSpouse, setWantsSpouse] = useState(false);
  const [ownsHome, setOwnsHome] = useState<boolean | null>(null);

  const set = <K extends keyof WizardData>(key: K, value: WizardData[K]) =>
    setData(d => ({ ...d, [key]: value }));

  const REVIEW = STEPS.length; // index of the summary step (after the inputs)
  const isReview = step === REVIEW;
  const totalSteps = STEPS.length + 1;
  const current = isReview ? null : STEPS[step];
  const isLast = isReview;

  const next = () => {
    if (isLast) onComplete(data, { addSpouse: wantsSpouse });
    else setStep(s => s + 1);
  };
  const back = () => setStep(s => Math.max(0, s - 1));

  const totalSavings = data.rrspBalance + data.tfsaBalance + data.taxableBalance + data.cashCushionBalance;

  return (
    <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-lg shadow-sm p-6">
      {/* Progress */}
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">
          Step {step + 1} of {totalSteps}
        </p>
        <button onClick={onSkip} className="text-[11px] text-slate-400 hover:text-slate-600">
          Skip setup
        </button>
      </div>
      <div className="h-1 bg-slate-100 rounded-full mb-5 overflow-hidden">
        <div
          className="h-full bg-blue-600 rounded-full transition-all"
          style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
        />
      </div>

      {isReview ? (
        <>
          <h3 className="text-lg font-bold text-slate-900 mb-1">Review your plan</h3>
          <p className="text-[13px] text-slate-600 leading-relaxed mb-4">
            Here's what you're starting with. Anything look off? Use Back to change it.
          </p>

          {/* Summary of what they entered */}
          <dl className="mb-5 rounded-md border border-slate-200 divide-y divide-slate-100 text-[13px]">
            <div className="flex justify-between px-3 py-2">
              <dt className="text-slate-500">Ages</dt>
              <dd className="font-medium text-slate-900">{data.currentAge} → retire {data.retirementAge} → plan to {data.maxAge}</dd>
            </div>
            <div className="flex justify-between px-3 py-2">
              <dt className="text-slate-500">Total savings</dt>
              <dd className="font-medium text-slate-900">{formatMoney(totalSavings)}</dd>
            </div>
            {(data.rrspContribution + data.tfsaContribution + data.taxableContribution) > 0 && (
              <div className="flex justify-between px-3 py-2">
                <dt className="text-slate-500">Saving per year</dt>
                <dd className="font-medium text-slate-900">{formatMoney(data.rrspContribution + data.tfsaContribution + data.taxableContribution)}</dd>
              </div>
            )}
            <div className="flex justify-between px-3 py-2">
              <dt className="text-slate-500">CPP / OAS</dt>
              <dd className="font-medium text-slate-900">
                {data.cppStartAge != null ? `${formatMoney(data.cppMonthlyAmount)}/mo at ${data.cppStartAge}` : 'no CPP'}
                {' · '}
                {data.oasStartAge != null ? `OAS at ${data.oasStartAge}` : 'no OAS'}
              </dd>
            </div>
            <div className="flex justify-between px-3 py-2">
              <dt className="text-slate-500">Spending goal</dt>
              <dd className="font-medium text-slate-900">{formatMoney(data.desiredSpending)}/yr</dd>
            </div>
          </dl>

          {/* Optional next steps — all skippable, none block creating the plan. */}
          <div className="space-y-3 mb-2">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={wantsSpouse} onChange={e => setWantsSpouse(e.target.checked)} className="mt-0.5" />
              <span className="text-[13px] text-slate-700">
                <span className="inline-flex items-center gap-1 font-medium text-slate-900"><Users size={13} /> Add a spouse or partner</span>
                <span className="block text-[11px] text-slate-500">Plan together — their accounts, benefits and spending run alongside yours.</span>
              </span>
            </label>

            <div>
              <span className="flex items-start gap-2.5">
                <Home size={13} className="mt-1 shrink-0 text-slate-500" />
                <span className="text-[13px] text-slate-700">
                  <span className="font-medium text-slate-900">Do you own your home?</span>
                  <span className="ml-2 inline-flex gap-2">
                    <button onClick={() => setOwnsHome(true)} className={`px-2 py-0.5 rounded border text-[11px] ${ownsHome === true ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 text-slate-600'}`}>Yes</button>
                    <button onClick={() => setOwnsHome(false)} className={`px-2 py-0.5 rounded border text-[11px] ${ownsHome === false ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 text-slate-600'}`}>No</button>
                  </span>
                  {ownsHome === true && (
                    <span className="block text-[11px] text-slate-500 mt-1">
                      You can explore a reverse mortgage later — under <em>Reverse Mortgage</em> in the sidebar — to tap home equity tax-free if you need it.
                    </span>
                  )}
                </span>
              </span>
            </div>

            {/* The power tools, in one line each. */}
            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2.5 space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Once your plan is in</p>
              <p className="flex items-center gap-2 text-[12px] text-slate-600"><SlidersHorizontal size={13} className="text-blue-600 shrink-0" /> <span><strong>Steering</strong> — drag the plan and watch the success rate move.</span></p>
              <p className="flex items-center gap-2 text-[12px] text-slate-600"><Target size={13} className="text-blue-600 shrink-0" /> <span><strong>Optimize</strong> — ranks CPP/OAS timing and withdrawal order for you.</span></p>
            </div>
          </div>
        </>
      ) : (
        <>
          <h3 className="text-lg font-bold text-slate-900 mb-1">{current!.title}</h3>
          <p className="text-[13px] text-slate-600 leading-relaxed mb-5">{current!.intro}</p>

          <div className="space-y-4">
            {current!.fields.map(f => (
              <div key={f.key}>
                <label className={LABEL_CLS}>{f.label}</label>
                <input
                  type="number"
                  className={NUM_CLS}
                  step={f.step ?? 1}
                  min={f.min}
                  max={f.max}
                  value={f.nullable && data[f.key] == null ? '' : (data[f.key] as number | null) ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (f.nullable && raw === '') {
                      set(f.key, null as never);
                      return;
                    }
                    const n = parseInt(raw, 10);
                    set(f.key, (Number.isFinite(n) ? n : 0) as never);
                  }}
                />
                {f.hint && <p className={HINT_CLS}>{f.hint}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex items-center justify-between mt-7">
        <button
          onClick={back}
          disabled={step === 0}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-default"
        >
          <ArrowLeft size={15} /> Back
        </button>
        <button
          onClick={next}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-md hover:bg-blue-700"
        >
          {isLast
            ? (wantsSpouse ? <>Create &amp; add spouse <Users size={15} /></> : <>Create my plan <Check size={15} /></>)
            : <>Next <ArrowRight size={15} /></>}
        </button>
      </div>
    </div>
  );
}
