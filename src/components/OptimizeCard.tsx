import { useMemo, useState } from 'react';
import { X, Sparkles, Copy, Check, ClipboardPaste, Lightbulb, ArrowUpRight, ArrowDownRight, CircleHelp } from 'lucide-react';
import type { RetirementInputs, RetirementResults } from '../lib/retirementEngine';
import type { MonteCarloResults } from '../lib/monteCarlo';
import type { AppConfig } from '../lib/appConfig';
import { runStrategies, type StrategyReport } from '../lib/strategies';
import { buildAgentPrompt, parseAgentResult } from '../lib/agentIngest';
import { QA_PRESETS, buildQAPrompt } from '../lib/agentQA';

function fmt(v: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);
}

interface OptimizeCardProps {
  inputs: RetirementInputs;
  config: AppConfig;
  results: RetirementResults;
  mcResults?: MonteCarloResults | null;
  onApply: (patch: Partial<RetirementInputs>) => void;
  onClose: () => void;
}

export function OptimizeCard({ inputs, config, results, mcResults, onApply, onClose }: OptimizeCardProps) {
  const report: StrategyReport = useMemo(() => runStrategies(inputs, config), [inputs, config]);
  const [tab, setTab] = useState<'strategies' | 'agent' | 'qa'>('strategies');

  // Agent tab state
  const [promptCopied, setPromptCopied] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [ingest, setIngest] = useState<ReturnType<typeof parseAgentResult> | null>(null);

  // Q&A tab state
  const [presetId, setPresetId] = useState(QA_PRESETS[0].id);
  const [customQuestion, setCustomQuestion] = useState('');
  const [qaCopied, setQaCopied] = useState(false);
  const preset = QA_PRESETS.find(p => p.id === presetId) ?? QA_PRESETS[0];
  const qaPrompt = useMemo(
    () => buildQAPrompt(inputs, { results, mcResults }, preset, customQuestion),
    [inputs, results, mcResults, preset, customQuestion],
  );

  const copyQaPrompt = () => {
    navigator.clipboard.writeText(qaPrompt).then(
      () => { setQaCopied(true); setTimeout(() => setQaCopied(false), 2000); },
      () => window.prompt('Copy this prompt:', qaPrompt),
    );
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(buildAgentPrompt(inputs)).then(
      () => { setPromptCopied(true); setTimeout(() => setPromptCopied(false), 2000); },
      () => window.prompt('Copy this prompt:', buildAgentPrompt(inputs)),
    );
  };

  const handleValidate = () => {
    setIngest(parseAgentResult(pasteText, inputs));
  };

  const handleApply = () => {
    if (ingest?.ok && ingest.patch) {
      onApply(ingest.patch);
      setPasteText('');
      setIngest(null);
    }
  };

  return (
    <div className="mb-4 bg-white border border-slate-200 rounded">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">Optimize</h3>
          {/* Tabs */}
          <div className="flex gap-1 ml-3">
            {(['strategies', 'agent', 'qa'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-2.5 py-1 text-xs font-medium rounded ${tab === t ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {t === 'strategies' ? 'Strategy Explorer' : t === 'agent' ? 'Tune inputs' : 'Ask a question'}
              </button>
            ))}
          </div>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded" title="Close">
          <X size={15} className="text-slate-500" />
        </button>
      </div>

      {tab === 'strategies' && (
        <div className="p-4">
          {/* Suggested actions */}
          <div className="mb-4 border border-blue-100 bg-blue-50/60 rounded p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-800 mb-1.5">
              <Lightbulb size={13} /> Suggested course of action
            </div>
            <ul className="space-y-1">
              {report.suggestedActions.map((a, i) => (
                <li key={i} className="text-xs text-slate-700 leading-snug">• {a}</li>
              ))}
            </ul>
          </div>

          {/* Strategy table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="py-1.5 pr-3 font-semibold">Strategy</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Sustainable spending</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">vs current</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Lifetime tax</th>
                  <th className="py-1.5 pr-3 font-semibold text-right" title="Cumulative Guaranteed Income Supplement received over the plan — RRSP/RRIF withdrawals and pensions claw it back 50¢/$, TFSA does not.">Lifetime GIS</th>
                  <th className="py-1.5 pr-3 font-semibold text-right">Ending balance</th>
                  <th className="py-1.5 font-semibold text-right">Apply</th>
                </tr>
              </thead>
              <tbody>
                <StrategyRow r={report.baseline} isBaseline onApply={onApply} />
                {report.strategies.map(s => (
                  <StrategyRow key={s.id} r={s} onApply={onApply} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-slate-500 leading-snug">
            Each row replays the full projection with one change and binary-searches the highest flat
            yearly spending that survives to max age — deterministic, no randomness. "Apply" writes that
            lever into your inputs (unsaved until you click Save).
          </p>
        </div>
      )}

      {tab === 'agent' && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Prompt side */}
          <div>
            <div className="text-xs font-semibold text-slate-800 mb-1.5">1 · Copy the prompt</div>
            <p className="text-[11px] text-slate-500 mb-2 leading-snug">
              A self-contained prompt describing your plan, the levers and the exact JSON format to reply
              with. Paste it into any AI (ChatGPT, Claude, …).
            </p>
            <textarea
              readOnly
              value={buildAgentPrompt(inputs)}
              onFocus={e => e.target.select()}
              className="w-full h-56 px-2.5 py-2 bg-slate-50 border border-slate-300 rounded text-[10px] font-mono text-slate-600 focus:outline-none"
            />
            <button
              onClick={copyPrompt}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700"
            >
              {promptCopied ? <Check size={13} /> : <Copy size={13} />}
              {promptCopied ? 'Copied' : 'Copy prompt'}
            </button>
          </div>

          {/* Ingest side */}
          <div>
            <div className="text-xs font-semibold text-slate-800 mb-1.5">2 · Paste the AI's JSON reply</div>
            <p className="text-[11px] text-slate-500 mb-2 leading-snug">
              Paste the model's JSON below. It's validated field-by-field — unknown fields are ignored and
              out-of-range values rejected with reasons — then applied to your inputs.
            </p>
            <textarea
              value={pasteText}
              onChange={e => { setPasteText(e.target.value); setIngest(null); }}
              placeholder='{"cppStartAge":70, "oasStartAge":70, ...}'
              className="w-full h-56 px-2.5 py-2 bg-white border border-slate-300 rounded text-[10px] font-mono text-slate-700 focus:outline-none focus:border-blue-500"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={handleValidate}
                disabled={!pasteText.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 text-slate-700 text-xs font-semibold rounded hover:bg-slate-50 disabled:opacity-40"
              >
                <ClipboardPaste size={13} /> Validate
              </button>
              {ingest?.ok && (
                <button
                  onClick={handleApply}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700"
                >
                  <Check size={13} /> Apply {ingest.applied.length} change{ingest.applied.length === 1 ? '' : 's'}
                </button>
              )}
            </div>

            {ingest && (
              <div className="mt-3 text-[11px] leading-snug space-y-1">
                {ingest.error && <div className="text-red-600">✕ {ingest.error}</div>}
                {ingest.applied.length > 0 && (
                  <div className="text-emerald-700">
                    ✓ Will apply: {ingest.applied.join('; ')}
                  </div>
                )}
                {ingest.warnings.map((w, i) => (
                  <div key={i} className="text-amber-700">⚠ {w}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'qa' && (
        <div className="p-4">
          <div className="flex items-start gap-2 mb-3">
            <CircleHelp size={15} className="text-slate-500 mt-0.5 shrink-0" />
            <p className="text-[11px] text-slate-500 leading-snug">
              Pick a question (or write your own) and copy a self-contained prompt — it embeds your plan
              <em> and the computed results</em>, so the AI answers from the real numbers instead of
              guessing. Paste it into any AI (ChatGPT, Claude, …) and read the reply. Nothing is sent
              anywhere by this app, and nothing is written back to your inputs.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[240px_1fr] gap-4">
            {/* Preset list */}
            <div className="space-y-1">
              {QA_PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPresetId(p.id)}
                  className={`w-full text-left px-2.5 py-1.5 rounded border text-xs ${presetId === p.id
                    ? 'border-blue-300 bg-blue-50 text-blue-800'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                >
                  <div className="font-medium">{p.title}</div>
                  <div className={`text-[10px] ${presetId === p.id ? 'text-blue-600' : 'text-slate-500'}`}>{p.blurb}</div>
                </button>
              ))}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mt-2 mb-1">
                  …or your own question
                </label>
                <textarea
                  value={customQuestion}
                  onChange={e => setCustomQuestion(e.target.value)}
                  placeholder="Type a custom question; it replaces the preset."
                  className="w-full h-16 px-2 py-1.5 bg-white border border-slate-300 rounded text-[11px] text-slate-700 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Prompt output */}
            <div>
              <div className="text-xs font-semibold text-slate-800 mb-1.5">
                Prompt{customQuestion.trim() ? ' (custom question)' : ` — ${preset.title}`}
              </div>
              <textarea
                readOnly
                value={qaPrompt}
                onFocus={e => e.target.select()}
                className="w-full h-72 px-2.5 py-2 bg-slate-50 border border-slate-300 rounded text-[10px] font-mono text-slate-600 focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={copyQaPrompt}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700"
                >
                  {qaCopied ? <Check size={13} /> : <Copy size={13} />}
                  {qaCopied ? 'Copied' : 'Copy prompt'}
                </button>
                <span className="text-[10px] text-slate-400">
                  ~{Math.round(qaPrompt.length / 4).toLocaleString()} tokens
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StrategyRow({ r, isBaseline = false, onApply }: {
  r: StrategyReport['baseline'];
  isBaseline?: boolean;
  onApply: (patch: Partial<RetirementInputs>) => void;
}) {
  const up = r.deltaSpending > 0;
  const down = r.deltaSpending < 0;
  return (
    <tr className={`border-b border-slate-100 ${isBaseline ? 'bg-slate-50' : ''}`}>
      <td className="py-1.5 pr-3">
        <div className="font-medium text-slate-800">{r.name}</div>
        <div className="text-[10px] text-slate-500">{r.description}</div>
      </td>
      <td className="py-1.5 pr-3 text-right text-slate-800">{fmt(r.sustainableSpending)}</td>
      <td className={`py-1.5 pr-3 text-right font-medium ${up ? 'text-emerald-600' : down ? 'text-red-600' : 'text-slate-400'}`}>
        {isBaseline ? '—' : (
          <span className="inline-flex items-center gap-0.5 justify-end">
            {up && <ArrowUpRight size={11} />}
            {down && <ArrowDownRight size={11} />}
            {fmt(Math.abs(r.deltaSpending))}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-right text-slate-700">{fmt(r.lifetimeTax)}</td>
      <td className="py-1.5 pr-3 text-right text-slate-700">{r.lifetimeGis > 0 ? fmt(r.lifetimeGis) : '—'}</td>
      <td className={`py-1.5 pr-3 text-right ${r.survived ? 'text-slate-700' : 'text-red-600 font-medium'}`}>
        {r.survived ? fmt(r.endingBalance) : `out at ${r.depletionAge}`}
      </td>
      <td className="py-1.5 text-right">
        {!isBaseline && (
          <button
            onClick={() => onApply(r.patch)}
            className="px-2 py-0.5 text-[11px] font-medium text-blue-600 border border-blue-200 rounded hover:bg-blue-50"
          >
            Apply
          </button>
        )}
      </td>
    </tr>
  );
}
