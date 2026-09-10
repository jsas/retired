import { useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { buildShareUrl } from '../lib/shareLink';
import { buildPlanCode, parsePlanCode } from '../lib/planTransfer';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import { cls } from '../design/tokens';
import { Panel } from '../design/primitives';
import { useAppLocale } from '../lib/localeContext';

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
  const { t } = useTranslation('pages');
  const { t: tc } = useTranslation('common');
  const { locale } = useAppLocale();
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
  const importName = boxName.trim() || t('share.defaultName');

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
      <Panel label={t('share.send')}>
        <p className="mb-4 text-[12.5px] leading-relaxed text-slate-500">
          <Trans
            i18nKey="share.sendLead"
            ns="pages"
            values={{ name: scenarioName }}
            components={{ strong: <span className="font-medium text-slate-700" /> }}
          />
        </p>

        {/* Share link */}
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            aria-label={t('share.shareLink')}
            className={`${cls.input} num min-w-0 flex-1 py-1.5 font-mono text-xs`}
          />
          <button onClick={() => copy(url, 'link')} className={`${cls.hairlineBtn} shrink-0`}>
            {copiedWhat === 'link' ? tc('copied') : t('share.copyLink')}
          </button>
        </div>

        {/* Plan code */}
        <div className="mt-5">
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="plan-code-out" className="text-[12px] font-medium text-slate-600">
              {t('share.planCode')} <span className="font-normal text-slate-400">{t('share.pasteAnywhere')}</span>
            </label>
            <button
              onClick={() => copy(planCode, 'code')}
              className="text-[11px] text-slate-400 hover:text-slate-900 hover:underline"
            >
              {copiedWhat === 'code' ? tc('copied') : t('share.copyCode')}
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
            {t('share.codeFoot')}
          </p>
        </div>
      </Panel>

      {/* ---- Receive a plan ---- */}
      <Panel label={t('share.receive')}>
        <p className="mb-4 text-[12.5px] leading-relaxed text-slate-500">
          {t('share.receiveLead')}
        </p>

        <textarea
          value={incoming}
          onChange={(e) => setIncoming(e.target.value)}
          placeholder={t('share.placeholder')}
          rows={3}
          aria-label={t('share.incoming')}
          className={`${cls.input} num w-full font-mono text-xs`}
        />

        {/* Parse feedback */}
        {incoming.trim() && !parsed && (
          <p className="mt-2 text-[11.5px] text-rose-700">
            {t('share.badPlan')}
          </p>
        )}
        {parsed && (
          <div className="mt-2 border-l-2 border-emerald-600 pl-3 text-[11.5px] leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-900">{t('share.recognized')}</span>{' '}
            {t('share.recognizedMeta', {
              age: parsed.inputs.currentAge,
              retire: parsed.inputs.retirementAge,
              province: parsed.inputs.provinceCode,
              spend: parsed.inputs.desiredSpending?.toLocaleString(locale) ?? '—',
            })}
            {parsed.inputs.spouse?.enabled ? t('share.withSpouse') : ''}
          </div>
        )}

        {/* Name + import */}
        <div className="mt-4 flex items-center gap-2">
          <input
            value={boxName}
            onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
            placeholder={t('share.namePlaceholder')}
            aria-label={t('share.nameAria')}
            className={`${cls.input} min-w-0 flex-1 py-1.5 text-xs`}
          />
          <button
            onClick={submit}
            disabled={!parsed}
            className={parsed ? `${cls.primaryBtn} shrink-0` : 'shrink-0 border border-slate-200 px-4 py-2 text-sm font-medium text-slate-400'}
            title={parsed ? t('share.importTitle', { name: importName }) : t('share.importDisabled')}
          >
            {t('share.importBtn')}
          </button>
        </div>
      </Panel>
    </div>
  );
}
