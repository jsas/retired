import { useMemo, useState } from 'react';
import { X, Sparkles, Copy, Check, ClipboardPaste, Lightbulb, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { RetirementInputs } from '../lib/retirementEngine';
import type { AppConfig } from '../lib/appConfig';
import { runStrategies, type StrategyReport } from '../lib/strategies';
import { buildAgentPrompt, parseAgentResult } from '../lib/agentIngest';

function fmt(v: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(v);
}

interface OptimizeCardProps {
  inputs: RetirementInputs;
  config: AppConfig;
  onApply: (patch: Partial<RetirementInputs>) => void;
  onClose: () => void;
}

export function OptimizeCard({ inputs, config, onApply, onClose }: OptimizeCardProps) {
  const report: StrategyReport = useMemo(() => runStrategies(inputs, config), [inputs, config]);
  const [tab, setTab] = useState<'strategies' | 'agent'>('strategies');

  // Agent tab state
  const [promptCopied, setPromptCopied] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [ingest, setIngest] = useState<ReturnType<typeof parseAgentResult> | null>(null);

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
            {(['strategies', 'agent'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-2.5 py-1 text-xs font-medium rounded ${tab === t ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {t === 'strategies' ? 'Strategy Explorer' : 'Ask an AI'}
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
              className="w-full h-40 px-2.5 py-2 bg-white border border-slate-300 rounded text-[10px] font-mono text-slate-700 focus:outline-none focus:border-blue-500"
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
