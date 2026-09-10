// The landing — the assistant as the front door. Five plain questions build a
// starter plan, the engine shows how to make the money last as long as you, and
// two exits open — both to the dashboard, one with the assistant dock opened on
// arrival ("keep chatting"), one with it closed. Nothing leaves the browser.
// This is the f7 landing (f7-final.html) rebuilt on the real engine: minimal
// wordmark header (no app nav — this is the front door, not the app), the
// answer affordance inline under each question, and About/Help/Legal as
// permanent footnotes at the very bottom.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import type { Scenario } from '@retired/engine-core/types';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { calculateHousehold } from '@retired/engine-core/retirementEngine';
import { potDisplay } from '../../lib/planDisplay';
import { baselineInputs } from '@retired/engine-core/exampleScenarios';
import { INK, BLUE, RED_TEXT } from '../../design/tokens';
import { prefKV } from '../../lib/prefKv';
import type { View } from '../../lib/viewRoutes';
import { Link } from './nav';
import { LanguageSwitch } from '../LanguageSwitch';
import { useAppLocale } from '../../lib/localeContext';
import { i18n } from '../../lib/i18n';

interface Answer {
  currentAge?: number;
  retirementAge?: number;
  savings?: number;
  spending?: number;
  benefits?: 'usual' | 'none' | number;
}

interface Q {
  key: keyof Answer;
  ask: (a: Answer) => string;
  chips: string[];
  placeholder: string;
  parse: (text: string, a: Answer) => number | string | null;
}

const money = (v: number) => '$' + Math.round(v).toLocaleString('en-CA');
function parseMoney(t: string): number | null {
  const m = t.replace(/[$,\s]/g, '').toLowerCase();
  const mult = m.endsWith('m') ? 1_000_000 : m.endsWith('k') ? 1_000 : 1;
  const n = parseFloat(m.replace(/[mk]$/, ''));
  return Number.isFinite(n) ? n * mult : null;
}
const parseAge = (t: string) => {
  const n = parseInt(t.replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n >= 30 && n <= 100 ? n : null;
};

function questions(t: (key: string, opts?: Record<string, unknown>) => string): Q[] {
  const usual = t('chips.usual');
  const none = t('chips.none');
  return [
    {
      key: 'currentAge', chips: ['55', '60', '65'], placeholder: t('placeholder.currentAge'),
      ask: () => t('q.currentAge'),
      parse: (text) => parseAge(text),
    },
    {
      key: 'retirementAge', chips: ['60', '62', '65'], placeholder: t('placeholder.retirementAge'),
      ask: (a) => t('q.retirementAge', { age: a.currentAge }),
      parse: (text, a) => { const n = parseAge(text); return n != null && a.currentAge != null && n >= a.currentAge ? n : null; },
    },
    {
      key: 'savings', chips: ['$500k', '$850k', '$1.2M'], placeholder: t('placeholder.savings'),
      ask: () => t('q.savings'),
      parse: (text) => parseMoney(text),
    },
    {
      key: 'spending', chips: ['$60k', '$85k', '$110k'], placeholder: t('placeholder.spending'),
      ask: () => t('q.spending'),
      parse: (text) => { const n = parseMoney(text); return n != null && n >= 5000 ? n : null; },
    },
    {
      key: 'benefits', chips: [usual, none], placeholder: t('placeholder.benefits'),
      ask: () => t('q.benefits'),
      parse: (text) => {
        const s = text.trim().toLowerCase();
        if (/^(y|yes|the usual|usual|oui)/.test(s) || s === usual.toLowerCase()) return 'usual';
        if (/^(n|no|non)$/.test(s) || s === none.toLowerCase()) return 'none';
        const m = parseMoney(text);
        return m != null ? m : null;
      },
    },
  ];
}

// Build a real plan from the chat answers.
function buildPlan(a: Answer): RetirementInputs {
  const base = baselineInputs();
  const currentAge = a.currentAge ?? 55;
  const savings = a.savings ?? 0;
  const benefits = a.benefits ?? 'usual';
  return {
    ...base,
    currentAge,
    retirementAge: a.retirementAge ?? Math.max(currentAge, 65),
    // Put the savings where most people hold it: split RRSP/TFSA.
    rrspBalance: Math.round(savings * 0.6),
    tfsaBalance: Math.round(savings * 0.4),
    desiredSpending: a.spending ?? 40000,
    cppStartAge: benefits === 'none' ? null : 65,
    cppMonthlyAmount: benefits === 'none' ? 0 : typeof benefits === 'number' ? benefits / 12 / 2 : 900,
    oasStartAge: benefits === 'none' ? null : 65,
    oasYearsInCanada: benefits === 'none' ? 0 : 40,
  };
}

// The landing's first-run gate (issue #153): with any scenarios saved, the
// welcome hash opens the dashboard — the landing can never overwrite a plan.
// Pure so the behavior is testable without mounting App.
export function welcomeLandingGate(hashView: View | null, hasScenarios: boolean): View {
  if (hashView) return hashView;
  return hasScenarios ? 'projection' : 'welcome';
}

// The door-picked scenario (issue #153): onBuild drafts → one click saves the
// starter plan as the FIRST scenario, activated with clean history. The "Keep
// chatting" door vs "Go to dashboard" only differs in the dock pref (caller).
export function landingScenarioFromPlan(plan: RetirementInputs, stamp: number): Scenario {
  return { id: `scenario-${stamp.toString(36)}`, name: i18n.t('landing:planName'), inputs: plan };
}

export function LandingPage({ config, onBuild }: {
  config: AppConfig;
  /** Carries the built plan to the dashboard. The optional second arg records
   *  whether the assistant dock should be open when it arrives ("keep
   *  chatting" passes true, "go to dashboard" false). */
  onBuild: (inputs: RetirementInputs, opts?: { openAssistant?: boolean }) => void;
}) {
  const { t } = useTranslation('landing');
  const { t: tNav } = useTranslation('nav');
  const { locale, setLocale } = useAppLocale();
  const QUESTIONS = useMemo(() => questions(t), [t]);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answer>({});
  const [text, setText] = useState('');
  const [error, setError] = useState(false);

  const done = step >= QUESTIONS.length;
  const plan = useMemo(() => (done ? buildPlan(answers) : null), [done, answers]);
  const results = useMemo(() => (plan ? calculateHousehold(plan, config) : null), [plan, config]);

  const q = QUESTIONS[step];

  const submit = (raw: string) => {
    const v = q.parse(raw, answers);
    if (v == null) { setError(true); return; }
    setError(false);
    setAnswers(a => ({ ...a, [q.key]: v }));
    setText('');
    setStep(s => s + 1);
  };

  const pot = results && plan ? potDisplay(results.yearlyBreakdown ?? [], plan.maxAge) : null;
  const holds = pot?.holds ?? false;
  const lastsLabel = holds ? `${plan?.maxAge}` : `${pot?.lastsTo ?? '—'}`;

  return (
    <div className="flex min-h-screen w-full flex-col bg-white">
      {/* Minimal wordmark only — this is the landing, not the app. No nav, no
          verdict chip, no assistant: just the mark and the tagline (f7). */}
      <header className="mx-auto flex w-full max-w-2xl items-center gap-2.5 px-5 pt-7">
        <span className="flex h-6 w-6 items-center justify-center bg-slate-900 text-[9px] font-bold text-white">RE:</span>
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">tired</span>
        <span className="ml-1 text-[12px] text-slate-400">{t('tagline')}</span>
        <span className="ml-auto">
          <LanguageSwitch locale={locale} onChange={setLocale} className="text-[12px] font-medium text-slate-600 hover:text-slate-900" />
        </span>
      </header>

      {/* the conversation */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 pt-10">
        <div className="space-y-5">
        <Bubble who="re">{t('greeting')}</Bubble>

        {QUESTIONS.slice(0, step).map((qq, i) => (
          <div key={i}>
            <Bubble who="re">{qq.ask(answers)}</Bubble>
            <Bubble who="me">{formatAnswer(qq.key, answers[qq.key])}</Bubble>
          </div>
        ))}

        {!done && (
          <>
            <Bubble who="re">{q.ask(answers)}</Bubble>

            {/* the answer affordance, inline right under the question — chips
                then the composer, in the flow (not pinned to the viewport) */}
            <div className="pt-1">
              <div className="mb-3 flex flex-wrap gap-2">
                {q.chips.map(c => (
                  <button key={c} onClick={() => submit(c)}
                    className="border border-slate-300 px-4 py-1.5 text-[13.5px] text-slate-700 transition-colors hover:border-slate-900 hover:bg-slate-50">
                    {c}
                  </button>
                ))}
              </div>
              <form className="flex items-stretch gap-2" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
                <input
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={q.placeholder}
                  autoComplete="off"
                  className={`flex-1 border bg-white px-4 py-2.5 text-[15px] placeholder:text-slate-400 focus:outline-none ${error ? 'border-rose-400' : 'border-slate-300 focus:border-slate-900'}`}
                />
                <button type="submit" aria-label={t('send')}
                  className="w-11 shrink-0 bg-slate-900 text-lg font-bold text-white transition-colors hover:bg-slate-700">↑</button>
              </form>
              {error && <p className="mt-1.5 text-[12px] text-rose-600">{t('errorHint', { example: q.chips[0] })}</p>}
              <p className="mt-3 text-[11px] text-slate-400">{t('privacyNote')}</p>
            </div>
          </>
        )}

        {done && results && plan && (
          <>
            <Bubble who="re">{t('doneLead')}</Bubble>
            <div className="border-l-2 pl-4" style={{ borderColor: holds ? BLUE : RED_TEXT }}>
              <p className="num text-[17px] font-semibold" style={{ color: holds ? BLUE : RED_TEXT }}>
                {holds
                  ? t('holds', { age: lastsLabel })
                  : t('short', { age: lastsLabel, years: plan.maxAge - (pot?.lastsTo ?? plan.maxAge), maxAge: plan.maxAge })}
              </p>
              <p className="mt-1 text-[13px] text-slate-500">
                {holds ? t('holdsSub', { maxAge: plan.maxAge }) : t('shortSub')}
              </p>
            </div>

            <div className="border-l border-slate-200 pl-4 text-[13px] leading-relaxed text-slate-600">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{t('whatsNext')}</p>
              <ul className="mt-1.5 space-y-1">
                <li>{t('next1')}</li>
                <li>{t('next2')}</li>
                <li>{t('next3')}</li>
              </ul>
            </div>

            {/* the two exits — both go to the dashboard; "keep chatting" just
                opens the assistant dock on arrival */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => {
                  try { prefKV().setItem('wealthconsole_dock_open', '0'); } catch { /* storage blocked */ }
                  plan && onBuild(plan, { openAssistant: false });
                }}
                className="bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
              >
                {t('goDashboard')}
              </button>
              <button
                onClick={() => {
                  try { prefKV().setItem('wealthconsole_dock_open', '1'); } catch { /* storage blocked */ }
                  plan && onBuild(plan, { openAssistant: true });
                }}
                className="border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-900 transition-colors hover:border-slate-900"
              >
                {t('keepChatting')}
              </button>
            </div>
          </>
        )}
        </div>
      </main>

      {/* the foot of the page (§8.8): the doors, then About / Help / Legal as
          permanent footnotes at the very bottom — always visible (f7). */}
      <footer className="mt-10 border-t border-slate-200">
        <div className="mx-auto max-w-2xl px-5 pb-10 pt-6">
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] font-medium">
            <Link view="help" className="text-slate-700 underline-offset-4 hover:text-slate-900 hover:underline">{tNav('help')}</Link>
            <Link view="donate" className="text-slate-700 underline-offset-4 hover:text-slate-900 hover:underline">{tNav('supportShort')}</Link>
            <a href="https://github.com/jsas/retired" target="_blank" rel="noreferrer"
               className="text-slate-700 underline-offset-4 hover:text-slate-900 hover:underline">{tNav('openSource')}</a>
            {/* The dashboard door: carries the built plan once the questions are
                answered; before that it just opens the app on the current plan. */}
            {plan ? (
              <button
                onClick={() => onBuild(plan)}
                className="ml-auto inline-flex items-center gap-1.5 bg-slate-900 px-4 py-2 text-white transition-colors hover:bg-slate-700"
              >
                {t('goDashboardArrow')}
              </button>
            ) : (
              <Link view="projection"
                className="ml-auto inline-flex items-center gap-1.5 bg-slate-900 px-4 py-2 text-white transition-colors hover:bg-slate-700">
                {t('goDashboardArrow')}
              </Link>
            )}
          </nav>
          <div className="mt-6 space-y-3 border-t border-slate-100 pt-4 text-[11.5px] leading-relaxed text-slate-400">
            <p><strong className="font-semibold text-slate-500">{t('foot.help')}</strong> {t('foot.helpBody')}</p>
            <p><strong className="font-semibold text-slate-500">{t('foot.about')}</strong> {t('foot.aboutBody')}</p>
            <p><strong className="font-semibold text-slate-500">{t('foot.notAdvice')}</strong> {t('foot.notAdviceBody')}</p>
            <p><strong className="font-semibold text-slate-500">{t('foot.private')}</strong> {t('foot.privateBody')} <Link view="help" className="text-blue-700 hover:underline">{t('foot.legalLink')}</Link></p></div>
        </div>
      </footer>
    </div>
  );
}

function Bubble({ who, children }: { who: 're' | 'me'; children: React.ReactNode }) {
  if (who === 'me') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] border-l-2 border-slate-300 bg-slate-50 py-2.5 pl-4 pr-3 text-[15px] text-slate-800">{children}</div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: INK }}>RE</span>
      <div className="max-w-[85%] border-l-2 border-slate-900 py-2.5 pl-4 pr-3 text-[15px] text-slate-800">{children}</div>
    </div>
  );
}

function formatAnswer(key: keyof Answer, v: Answer[keyof Answer]): string {
  if (v == null) return '—';
  if (key === 'savings' || key === 'spending') return money(Number(v));
  if (key === 'benefits') {
    return v === 'usual' ? i18n.t('landing:chips.usual') : v === 'none' ? i18n.t('landing:chips.none') : money(Number(v)) + '/yr';
  }
  return String(v);
}
