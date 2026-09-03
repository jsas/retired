import { useMemo, useState } from 'react';
import { buildShareUrl } from '../lib/shareLink';
import { buildPlanCode, parsePlanCode } from '../lib/planTransfer';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import { cls } from '../design/tokens';
import { Panel } from '../design/primitives';

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

// The Data page's sharing half (BetaPage owns the page title — no heading
// here). A plan travels two ways, both built on the same planTransfer backend
// so either side can decode the other:
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
    <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
      {/* ---- Send this plan ---- */}
      <Panel label="Send this plan">
        <p className="mb-4 text-[12.5px] leading-relaxed text-slate-500">
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
            className={`${cls.input} num min-w-0 flex-1 py-1.5 font-mono text-xs`}
          />
          <button onClick={() => copy(url, 'link')} className={`${cls.hairlineBtn} shrink-0`}>
            {copiedWhat === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>

        {/* Plan code */}
        <div className="mt-5">
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="plan-code-out" className="text-[12px] font-medium text-slate-600">
              Plan code <span className="font-normal text-slate-400">(paste anywhere)</span>
            </label>
            <button
              onClick={() => copy(planCode, 'code')}
              className="text-[11px] text-slate-400 hover:text-slate-900 hover:underline"
            >
              {copiedWhat === 'code' ? 'Copied' : 'Copy code'}
            </button>
          </div>
          <textarea
            id="plan-code-out"
            readOnly
            value={planCode}
            onFocus={(e) => e.target.select()}
            rows={5}
            className={`${cls.input} num w-full font-mono text-[10px] leading-relaxed text-slate-600`}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            The link uses the current host and path, so it works for anyone who can reach this
            same address. The code works anywhere — paste it into the box on the right to import.
          </p>
        </div>
      </Panel>

      {/* ---- Receive a plan ---- */}
      <Panel label="Receive a plan">
        <p className="mb-4 text-[12.5px] leading-relaxed text-slate-500">
          Paste a share link or a plan code, give it a name, and it imports as a new scenario —
          your existing scenarios are untouched.
        </p>

        <textarea
          value={incoming}
          onChange={(e) => setIncoming(e.target.value)}
          placeholder="Paste a share link or plan code here…"
          rows={3}
          aria-label="Incoming plan"
          className={`${cls.input} num w-full font-mono text-xs`}
        />

        {/* Parse feedback */}
        {incoming.trim() && !parsed && (
          <p className="mt-2 text-[11.5px] text-rose-700">
            That doesn't look like a RE: tired plan — check the whole link or code was copied.
          </p>
        )}
        {parsed && (
          <div className="mt-2 border-l-2 border-emerald-600 pl-3 text-[11.5px] leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-900">Plan recognized.</span>{' '}
            Age {parsed.inputs.currentAge} → retire {parsed.inputs.retirementAge} ·{' '}
            {parsed.inputs.provinceCode} · spending ${parsed.inputs.desiredSpending?.toLocaleString() ?? '—'}/yr
            {parsed.inputs.spouse?.enabled ? ' · with spouse' : ''}
          </div>
        )}

        {/* Name + import */}
        <div className="mt-4 flex items-center gap-2">
          <input
            value={boxName}
            onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
            placeholder="Name for the imported scenario"
            aria-label="Imported scenario name"
            className={`${cls.input} min-w-0 flex-1 py-1.5 text-xs`}
          />
          <button
            onClick={submit}
            disabled={!parsed}
            className={parsed ? `${cls.primaryBtn} shrink-0` : 'shrink-0 border border-slate-200 px-4 py-2 text-sm font-medium text-slate-400'}
            title={parsed ? `Import as "${importName}"` : 'Paste a valid plan first'}
          >
            Import scenario
          </button>
        </div>
      </Panel>
    </div>
  );
}
