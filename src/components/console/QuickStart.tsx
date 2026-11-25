// The set-up card — the intro screen's job, done in place. The Dashboard is
// the home page, so the four numbers that used to take a whole wizard live in
// one panel at the top of it: age, retire-at, savings, spending. Change a
// number, press the button, and the verdict above re-computes on the same
// engine run as every other surface. No wizard state, no screen to finish.
//
// It shows itself only while the plan on screen isn't the user's own — the
// active plan is still a stock `Example - …` plan, or it still looks like a
// blank new plan (`looksLikeUnsetPlan`). Dismissing it is remembered
// (setupCardPrefs); Settings can force it back on every visit.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import { looksLikeUnsetPlan } from '@retired/engine-core/exampleScenarios';
import { Panel, Num } from '../../design/primitives';
import { cls } from '../../design/tokens';
import { Link } from './nav';

/** What the card asks for. Money is a yearly/total figure in dollars. */
export interface SetupAnswers {
  currentAge: number;
  retirementAge: number;
  savings: number;
  spending: number;
}

/** The card's starting values: whatever the plan on screen already says, so
 *  the four fields read as "these are your numbers — adjust them" rather than
 *  a blank form. Savings is the whole pot across the four accounts. */
export function setupPrefill(inputs: RetirementInputs): SetupAnswers {
  return {
    currentAge: inputs.currentAge,
    retirementAge: inputs.retirementAge ?? inputs.currentAge + 10,
    savings: (inputs.rrspBalance || 0) + (inputs.tfsaBalance || 0)
      + (inputs.taxableBalance || 0) + (inputs.cashCushionBalance || 0),
    spending: inputs.desiredSpending,
  };
}

/** First invalid field's message key, or null when the answers work. */
export function setupError(a: SetupAnswers): 'age' | 'retireAge' | 'savings' | 'spending' | null {
  if (!Number.isFinite(a.currentAge) || a.currentAge < 30 || a.currentAge > 100) return 'age';
  if (!Number.isFinite(a.retirementAge) || a.retirementAge < a.currentAge) return 'retireAge';
  if (!Number.isFinite(a.savings) || a.savings < 0) return 'savings';
  if (!Number.isFinite(a.spending) || a.spending < 5000) return 'spending';
  return null;
}

/** The four answers as a real plan on top of `base`: the pot lands 60/40
 *  RRSP/TFSA (the same split the old landing used — the Plans page edits the
 *  accounts individually), and the two ages win over whatever `base` held. */
export function quickStartPlan(base: RetirementInputs, a: SetupAnswers): RetirementInputs {
  const rrsp = Math.round(a.savings * 0.6);
  return {
    ...base,
    currentAge: a.currentAge,
    retirementAge: Math.max(a.retirementAge, a.currentAge),
    rrspBalance: rrsp,
    tfsaBalance: a.savings - rrsp,
    taxableBalance: 0,
    cashCushionBalance: 0,
    desiredSpending: a.spending,
  };
}

/** When the card earns its space: always on (Settings override) wins; a
 *  dismissal holds unless the plan is still somebody else's example. */
export function setupCardVisible(opts: {
  planIsExample: boolean;
  inputs: RetirementInputs;
  alwaysShow: boolean;
  dismissed: boolean;
}): boolean {
  if (opts.alwaysShow) return true;
  if (opts.dismissed) return false;
  return opts.planIsExample || looksLikeUnsetPlan(opts.inputs);
}

export function QuickStart({ planIsExample, inputs, onStart, onDismiss }: {
  /** True when the active plan is a stock example, not one the user built. */
  planIsExample: boolean;
  inputs: RetirementInputs;
  /** `asNewPlan` = the active plan is an example, so this becomes a personal
   *  copy instead of overwriting the example. */
  onStart: (answers: SetupAnswers, asNewPlan: boolean) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('start');
  const [answers, setAnswers] = useState<SetupAnswers>(() => setupPrefill(inputs));
  const error = useMemo(() => setupError(answers), [answers]);
  const set = (key: keyof SetupAnswers) => (v: number) =>
    setAnswers(prev => ({ ...prev, [key]: v }));

  return (
    <Panel label={t('label')} hint="setup-card" className="pt-6">
      <p className="mb-5 max-w-2xl text-[13.5px] leading-relaxed text-slate-600">
        {planIsExample ? t('leadExample') : t('leadUnset')}
      </p>
      <div className="grid max-w-4xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Num label={t('ageNow')} value={answers.currentAge} step={1} min={18}
          onChange={set('currentAge')} />
        <Num label={t('retireAt')} value={answers.retirementAge} step={1} min={18}
          onChange={set('retirementAge')} />
        <Num label={t('saved')} value={answers.savings} step={5000} min={0}
          onChange={set('savings')} hint={t('savedHint')} />
        <Num label={t('spend')} value={answers.spending} step={1000} min={0}
          onChange={set('spending')} />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button
          type="button"
          className={cls.primaryBtn}
          disabled={error != null}
          onClick={() => { if (!error) onStart(answers, planIsExample); }}
        >
          {t('go')}
        </button>
        <button type="button" className={cls.hairlineBtn} onClick={onDismiss}>
          {t('dismiss')}
        </button>
        <Link view="scenarios" className="text-[12.5px] text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline">
          {t('details')}
        </Link>
      </div>
      {error && (
        <p className="mt-3 text-[12px] text-slate-500" role="status">
          {t(`error.${error}`)}
        </p>
      )}
    </Panel>
  );
}
