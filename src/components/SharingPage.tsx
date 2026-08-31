import { useMemo, useState } from 'react';
import { Check, ClipboardCopy, Link2, Share2, Upload } from 'lucide-react';
import { buildShareUrl } from '../lib/shareLink';
import { buildPlanCode, parsePlanCode } from '../lib/planTransfer';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';

export interface SharingImportRequest {
  inputs: RetirementInputs;
  name: string;
}

interface SharingPageProps {
  /** The active scenario's current (possibly unsaved) inputs and name. */
  inputs: RetirementInputs;
  scenarioName: string;
  /** Import a received plan as a new scenario. */
  onImport: (req: SharingImportRequest) => void;
}

// Sharing page. A plan travels two ways, both built on the same planTransfer
// backend so either side can decode the other:
//   - Share link  — the plan code in a URL fragment; one click for the receiver
//   - Plan code   — the same payload as pasteable text, for chat/email/notes
// Receiving is the reverse: paste a link or a code, give the plan a name, and
// it lands as a new scenario.
export function SharingPage({ inputs, scenarioName, onImport }: SharingPageProps) {
  // ---- Outgoing ----
  const url = useMemo(() => buildShareUrl(inputs, scenarioName), [inputs, scenarioName]);
  const planCode = useMemo(() => buildPlanCode(inputs, scenarioName), [inputs, scenarioName]);
  const [copiedWhat, setCopiedWhat] = useState<null | 'link' | 'code'>(null);

  const copy = (text: string, what: 'link' | 'code') => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopiedWhat(what);
        setTimeout(() => setCopiedWhat(null), 2000);
      },
      () => { /* clipboard blocked — the text is selectable in the boxes below */ },
    );
  };

  // ---- Incoming ----
  const [incoming, setIncoming] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);

  // Accept a full URL, a bare #plan=… fragment, or a bare plan code.
  const parsed = useMemo(() => {
    const text = incoming.trim();
    if (!text) return null;
    const planIdx = text.indexOf('#plan=');
    const code = planIdx >= 0 ? text.slice(planIdx + '#plan='.length) : text;
    return parsePlanCode(code);
  }, [incoming]);

  // The box shows the sender's name until the user types their own.
  const boxName = nameTouched ? name : (parsed?.name ?? '');
  const importName = boxName.trim() || 'Shared plan';

  const submit = () => {
    if (!parsed) return;
    onImport({ inputs: parsed.inputs, name: importName });
    setIncoming('');
    setName('');
    setNameTouched(false);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Share2 size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Sharing</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl">
        {/* ---- Send this plan ---- */}
        <section>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
            Send this plan
          </div>
          <p className="text-[11px] text-slate-500 leading-snug mb-3">
            <span className="font-medium text-slate-700">{scenarioName}</span> is encoded directly
            in the link and the code (after the <code>#</code>) — nothing is uploaded. Whoever
            receives it gets a copy as a new scenario.
          </p>

          {/* Share link */}
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              aria-label="Share link"
              className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs text-slate-700 font-mono focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => copy(url, 'link')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 shrink-0"
            >
              {copiedWhat === 'link' ? <Check size={13} /> : <Link2 size={13} />}
              {copiedWhat === 'link' ? 'Copied' : 'Copy link'}
            </button>
          </div>

          {/* Plan code */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="plan-code-out" className="text-[11px] font-medium text-slate-600">
                Plan code <span className="font-normal text-slate-400">(paste anywhere)</span>
              </label>
              <button
                onClick={() => copy(planCode, 'code')}
                className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
              >
                {copiedWhat === 'code' ? <Check size={12} /> : <ClipboardCopy size={12} />}
                {copiedWhat === 'code' ? 'Copied' : 'Copy code'}
              </button>
            </div>
            <textarea
              id="plan-code-out"
              readOnly
              value={planCode}
              onFocus={(e) => e.target.select()}
              rows={5}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded text-[10px] text-slate-600 font-mono break-all focus:outline-none focus:border-blue-500"
            />
            <p className="mt-2 text-[11px] text-slate-400 leading-snug">
              The link uses the current host and path, so it works for anyone who can reach this
              same address. The code works anywhere — paste it into the box on the right to import.
            </p>
          </div>
        </section>

        {/* ---- Receive a plan ---- */}
        <section>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
            Receive a plan
          </div>
          <p className="text-[11px] text-slate-500 leading-snug mb-3">
            Paste a share link or a plan code, give it a name, and it imports as a new scenario —
            your existing scenarios are untouched.
          </p>

          <textarea
            value={incoming}
            onChange={(e) => setIncoming(e.target.value)}
            placeholder="Paste a share link or plan code here…"
            rows={3}
            aria-label="Incoming plan"
            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-700 font-mono focus:outline-none focus:border-blue-500"
          />

          {/* Parse feedback */}
          {incoming.trim() && !parsed && (
            <p className="mt-1.5 text-[11px] text-rose-600">
              That doesn't look like a RE: tired plan — check the whole link or code was copied.
            </p>
          )}
          {parsed && (
            <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-900">
              <span className="font-semibold">Plan recognized.</span>{' '}
              Age {parsed.inputs.currentAge} → retire {parsed.inputs.retirementAge} ·{' '}
              {parsed.inputs.provinceCode} · spending ${parsed.inputs.desiredSpending?.toLocaleString() ?? '—'}/yr
              {parsed.inputs.spouse?.enabled ? ' · with spouse' : ''}
            </div>
          )}

          {/* Name + import */}
          <div className="mt-3 flex items-center gap-2">
            <input
              value={boxName}
              onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
              placeholder="Name for the imported scenario"
              aria-label="Imported scenario name"
              className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-700 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={submit}
              disabled={!parsed}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              title={parsed ? `Import as "${importName}"` : 'Paste a valid plan first'}
            >
              <Upload size={13} /> Import scenario
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
