// The landing — the assistant as the front door. Five plain questions build a
// starter plan, the engine answers "does your money outlast you?", and two
// doors open: the dashboard, or keep editing the details. Nothing leaves the
// browser. This is the f7 landing (f7-final.html) rebuilt on the real engine.
import { useMemo, useState } from 'react';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { calculateHousehold } from '@retired/engine-core/retirementEngine';
import { baselineInputs } from '@retired/engine-core/exampleScenarios';
import { INK, BLUE, RED_TEXT } from '../../design/tokens';
import { Link } from './nav';

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

const QUESTIONS: Q[] = [
  {
    key: 'currentAge', chips: ['55', '60', '65'], placeholder: 'e.g. 55',
    ask: () => 'First — how old are you right now?',
    parse: (t) => parseAge(t),
  },
  {
    key: 'retirementAge', chips: ['60', '62', '65'], placeholder: 'e.g. 65',
    ask: (a) => `When would you like to stop working? (You're ${a.currentAge} now.)`,
    parse: (t, a) => { const n = parseAge(t); return n != null && a.currentAge != null && n >= a.currentAge ? n : null; },
  },
  {
    key: 'savings', chips: ['$500k', '$850k', '$1.2M'], placeholder: 'e.g. 850k',
    ask: () => 'Roughly how much have you saved all together — RRSP, TFSA, investments, everything? A round number is fine.',
    parse: (t) => parseMoney(t),
  },
  {
    key: 'spending', chips: ['$60k', '$85k', '$110k'], placeholder: 'e.g. 85k',
    ask: () => 'Once you stop working, how much do you want to spend each year? What would a good year cost?',
    parse: (t) => { const n = parseMoney(t); return n != null && n >= 5000 ? n : null; },
  },
  {
    key: 'benefits', chips: ['Yes, the usual', 'No'], placeholder: 'yes / no / an amount',
    ask: () => 'Last one. Will you get CPP and OAS — the government benefits? Most people do.',
    parse: (t) => {
      const s = t.trim().toLowerCase();
      if (/^(y|yes|the usual|usual)/.test(s)) return 'usual';
      if (/^(n|no)/.test(s)) return 'none';
      const m = parseMoney(t);
      return m != null ? m : null;
    },
  },
];

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

export function LandingPage({ config, onBuild }: {
  config: AppConfig;
  onBuild: (inputs: RetirementInputs) => void;
}) {
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

  const holds = results?.status === 'ON_TRACK';
  const lastsLabel = holds ? `${plan?.maxAge}` : `${results?.depletionAge ?? '—'}`;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 pb-40 pt-10">
      {/* brand */}
      <div className="flex items-baseline gap-2">
        <span className="flex h-6 w-6 items-center justify-center bg-slate-900 text-[9px] font-bold text-white">RE:</span>
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">tired</span>
        <span className="text-[12px] text-slate-400">— knows if your money outlasts you</span>
      </div>

      {/* the conversation */}
      <div className="mt-10 space-y-5">
        <Bubble who="re">
          Hi. I'm RE — I can tell you whether your money will outlast you. It takes about five
          questions, and nothing you say leaves this browser.
        </Bubble>

        {QUESTIONS.slice(0, step).map((qq, i) => (
          <div key={i}>
            <Bubble who="re">{qq.ask(answers)}</Bubble>
            <Bubble who="me">{formatAnswer(qq.key, answers[qq.key])}</Bubble>
          </div>
        ))}

        {!done && <Bubble who="re">{q.ask(answers)}</Bubble>}

        {done && results && plan && (
          <>
            <Bubble who="re">
              That's everything I need. Here's your answer:
            </Bubble>
            <div className="border-l-2 pl-4" style={{ borderColor: holds ? BLUE : RED_TEXT }}>
              <p className="num text-[17px] font-semibold" style={{ color: holds ? BLUE : RED_TEXT }}>
                {holds
                  ? <>Your money lasts until you're {lastsLabel}.</>
                  : <>Your money runs out at {lastsLabel} — {plan.maxAge - (results.depletionAge ?? plan.maxAge)} years short of {plan.maxAge}.</>}
              </p>
              <p className="mt-1 text-[13px] text-slate-500">
                {holds
                  ? `On those numbers the plan holds${results.depletionAge == null ? ` — there's money left at ${plan.maxAge}` : ''}.`
                  : 'Two ways to fix that from here — the dashboard lets you drag the levers, the details let you tune everything.'}
              </p>
            </div>

            {/* the two doors */}
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => plan && onBuild(plan)}
                className="group border-l-2 border-slate-900 bg-slate-900 py-3.5 pl-4 pr-4 text-left text-white hover:bg-slate-800"
              >
                <span className="block text-sm font-medium">Open the dashboard →</span>
                <span className="block text-xs text-slate-400 group-hover:text-slate-300">
                  The whole plan on a map — drag the levers and watch the answer change.
                </span>
              </button>
              <Link view="details" className="block border border-slate-300 py-3.5 pl-4 pr-4 hover:border-slate-900">
                <span className="block text-sm font-medium text-slate-900">Tune the details</span>
                <span className="block text-xs text-slate-400">
                  Every input in one place — benefits, accounts, phases, withdrawal order.
                </span>
              </Link>
            </div>
          </>
        )}
      </div>

      {/* composer */}
      {!done && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white px-5 pb-5 pt-4">
          <div className="mx-auto max-w-2xl">
            <div className="mb-3 flex flex-wrap gap-2">
              {q.chips.map(c => (
                <button key={c} onClick={() => submit(c)}
                  className="border border-slate-300 px-4 py-1.5 text-[13.5px] text-slate-700 hover:border-slate-900">
                  {c}
                </button>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={q.placeholder}
                className={`flex-1 border px-4 py-2.5 text-[15px] focus:outline-none ${error ? 'border-rose-400' : 'border-slate-300 focus:border-slate-900'}`}
              />
              <button type="submit" className="w-11 bg-slate-900 text-white" aria-label="send">↑</button>
            </form>
            {error && <p className="mt-1.5 text-[12px] text-rose-600">Just a number is fine — try "{q.chips[0]}".</p>}
            <p className="mt-2 text-[11px] text-slate-400">Nothing is sent anywhere — this all happens in your browser.</p>
          </div>
        </div>
      )}
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
  if (key === 'benefits') return v === 'usual' ? 'Yes, the usual' : v === 'none' ? 'No' : money(Number(v)) + '/yr';
  return String(v);
}
