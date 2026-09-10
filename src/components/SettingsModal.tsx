import { useState, useSyncExternalStore } from 'react';
import { Plus, Trash2, RotateCcw, Save } from 'lucide-react';
import {
  type AppConfig,
  type TaxTable,
  validateAppConfig,
  defaultAppConfig
} from '@retired/engine-core/appConfig';
import { DB_STORAGE_KEY } from '../data/db';
import { AsyncOpfsBackend } from '../data/opfs';
import { AI_CHATS_STORAGE_KEY } from '../lib/ai/chatStore';
import {
  AI_SETTINGS_STORAGE_KEY, getAiSettings, subscribeAiSettings, updateAiSettings,
  resolveAiPromptSend, resolveLocalToolCapable, DEFAULT_AI_PROMPT_SEND, isLocalProvider,
  type AiPromptSend, type AiSettings,
} from '../lib/aiSettings';
import {
  assembleSystemPrompt, DEFAULT_SYSTEM_PROMPT, DEFAULT_TOOL_INSTRUCTIONS_NATIVE,
  DEFAULT_TOOL_INSTRUCTIONS_PROMPT, DEFAULT_TOOL_INSTRUCTIONS_OFF,
} from '../lib/ai/agentLoop';
import { getRangePrefs, setRangePrefs, DEFAULT_RANGE_PREFS, type RangePrefs } from '../lib/rangePrefs';
import { WEBLLM_MODELS, visibleWebLlmModels } from '../lib/ai/webLlmModels';
import { BONSAI_MODELS } from '../lib/ai/bonsaiModels';
import { HelpHint } from '../design/primitives';
import { detectLocale } from '../lib/locale';
import { useTranslation } from 'react-i18next';

interface SettingsModalProps {
  config: AppConfig;
  onSave: (config: AppConfig) => void;
}

// EVERY persisted key — "reset means reset": scenarios, engine config, the
// SQL database (localStorage mirror here; the OPFS file itself is cleared via
// AsyncOpfsBackend below), agent memories (a table inside that database), EQ
// crops, panel layouts, AI chat threads and AI model connections. The reload
// lands on factory defaults + the first-run example scenarios.
//   wealthconsole_db                — the SQLite bytes (localStorage mirror);
//                                     its kv table holds the UI preferences
//                                     (panels/print/export/welcome, EQ crops —
//                                     issue #20) and the opt-in AI payloads
//   wealthconsole.sqlite            — the SQLite file itself (OPFS)
//   wealthconsole_scenarios/_config — pre-SQLite legacy split keys
//   wealthconsole_eq                — UI preferences: EQ steering crops (the
//                                     localStorage mirror of the kv row)
//   wealthconsole_panel_state       — UI preferences: collapsed panels +
//                                     print/export options + welcome dismissal
//                                     (the localStorage mirror of the kv row)
//   retirement_ai_chats             — assistant chat threads
//   retirement_ai_settings          — model connections + AI preferences
//   wealthconsole_schedule_cols     — year-by-year table column picker
//   wealthconsole_ranges            — lever slider min/max prefs
const ERASABLE_KEYS = [
  DB_STORAGE_KEY,
  'wealthconsole_scenarios',
  'wealthconsole_config',
  'wealthconsole_eq',
  'wealthconsole_panel_state',
  'wealthconsole_schedule_cols',
  'wealthconsole_ranges',
  AI_CHATS_STORAGE_KEY,
  AI_SETTINGS_STORAGE_KEY,
];

type Section = 'general' | 'assistant' | 'levers' | 'federal' | 'provinces' | 'rrif' | 'oas' | 'cpp' | 'engine' | 'gains' | 'rdsp' | 'fhsa';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'levers', label: 'Lever Ranges' },
  { id: 'federal', label: 'Federal Tax' },
  { id: 'provinces', label: 'Provincial Tax' },
  { id: 'rrif', label: 'RRIF Rates' },
  { id: 'oas', label: 'OAS' },
  { id: 'cpp', label: 'CPP' },
  { id: 'engine', label: 'Engine' },
  { id: 'gains', label: 'Capital Gains' },
  { id: 'rdsp', label: 'RDSP' },
  { id: 'fhsa', label: 'FHSA' }
];

const PROVINCE_NAMES: Record<string, string> = {
  ONT: 'Ontario', NL: 'Newfoundland and Labrador', PE: 'Prince Edward Island',
  NS: 'Nova Scotia', NB: 'New Brunswick', QC: 'Quebec', MB: 'Manitoba',
  SK: 'Saskatchewan', AB: 'Alberta', BC: 'British Columbia', YT: 'Yukon',
  NT: 'Northwest Territories', NU: 'Nunavut'
};

export function SettingsModal({ config, onSave }: SettingsModalProps) {
  const { t } = useTranslation('settings');
  const [draft, setDraft] = useState<AppConfig>(() => structuredClone(config));
  const [section, setSection] = useState<Section>('federal');
  const [selectedProvince, setSelectedProvince] = useState<string>('ONT');
  const [error, setError] = useState<string | null>(null);
  // Lever ranges live in prefKV (UI prefs), not the engine config — they shape
  // the sliders, not the math. Edits save immediately and the faders pick them
  // up on their next render.
  const [ranges, setRanges] = useState<RangePrefs>(getRangePrefs);
  const updateRanges = (patch: Partial<RangePrefs>) => setRanges(setRangePrefs(patch));
  const ai = useSyncExternalStore(subscribeAiSettings, getAiSettings, getAiSettings);
  const patchAi = (mutate: (s: AiSettings) => void) => {
    updateAiSettings(prev => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
  };

  const update = (mutate: (c: AppConfig) => void) => {
    setDraft(prev => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
  };

  const handleSave = () => {
    if (!validateAppConfig(draft)) {
      setError(t('invalid'));
      return;
    }
    onSave(draft);
  };

  const handleReset = () => {
    if (!window.confirm(t('resetConfirm'))) return;
    const defaults = defaultAppConfig();
    setDraft(structuredClone(defaults));
    setError(null);
  };

  // Erase every app key AND the OPFS SQLite file. Async because the file
  // removal is; the reload only fires once the bytes are gone so the app
  // can't boot from the old database.
  const handleEraseAll = async () => {
    if (!window.confirm(t('eraseConfirm1'))) return;
    if (!window.confirm(t('eraseConfirm2'))) return;
    try {
      const backend = await AsyncOpfsBackend.open();
      await backend?.clear();
    } catch { /* OPFS unavailable — the localStorage mirror is the store */ }
    try {
      for (const key of ERASABLE_KEYS) localStorage.removeItem(key);
    } catch { /* ignore */ }
    window.location.reload();
  };

  return (
    <div>
        {/* Section tabs */}
        <div className="mb-5 flex gap-4 border-b border-slate-200">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`-mb-px border-b-2 px-1 pb-2 text-xs font-medium ${
                section === s.id
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-400 hover:text-slate-900'
              }`}
            >
              {t(`sections.${s.id}`)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="pb-4">
          {section === 'general' && (
            <div className="space-y-4 max-w-lg">
              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-1">{t('language.title')}</h3>
                <p className="text-xs text-slate-600 leading-snug mb-2">{t('language.lead')}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {([
                    { value: undefined, label: t('language.followBrowser') },
                    { value: 'en-CA' as const, label: t('language.en') },
                    { value: 'fr-CA' as const, label: t('language.fr') },
                  ]).map(opt => (
                    <label key={opt.label} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="site-locale"
                        checked={(draft.general.locale ?? undefined) === opt.value}
                        onChange={() => update(c => {
                          if (opt.value === undefined) delete c.general.locale;
                          else c.general.locale = opt.value;
                        })}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-1">{t('helpHeading')}</h3>
                <p className="text-xs text-slate-600 leading-snug">{t('helpBody1')}</p>
                <p className="text-xs text-slate-600 leading-snug mt-1.5">{t('helpBody2')}</p>
              </div>
              <div className="border-t border-slate-200 pt-3">
                <h3 className="text-xs font-semibold text-slate-700 mb-1.5">{t('welcome')}</h3>
                <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.general.showWelcomeOnLoad}
                    onChange={e => update(c => { c.general.showWelcomeOnLoad = e.target.checked; })}
                    className="mt-0.5"
                  />
                  <span>
                    {t('welcomeShow')}
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      {t('welcomeHint')}
                    </span>
                  </span>
                </label>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <h3 className="text-xs font-semibold text-slate-700 mb-1.5">{t('unsaved')}</h3>
                <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.general.promptToSaveOnSwitch}
                    onChange={e => update(c => { c.general.promptToSaveOnSwitch = e.target.checked; })}
                    className="mt-0.5"
                  />
                  <span>
                    {t('unsavedAsk')}
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      {t('unsavedHint')}
                    </span>
                  </span>
                </label>
              </div>

              {/* Danger zone: wipes the SQLite database (OPFS file + localStorage
                  mirror) and every app key, then reloads to first-run defaults.
                  Kept out of the draft/save flow — it acts immediately, on the
                  stored data itself. */}
              <div className="border border-rose-200 p-3">
                <h3 className="mb-1 text-xs font-semibold text-rose-800">{t('danger')}</h3>
                <p className="mb-2 text-[11.5px] leading-relaxed text-rose-700">
                  {t('dangerBody')}
                </p>
                <button
                  onClick={handleEraseAll}
                  className="flex items-center gap-1.5 border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                >
                  <Trash2 size={13} /> {t('erase')}
                </button>
              </div>
            </div>
          )}

          {section === 'assistant' && (
            <AssistantSettings ai={ai} patchAi={patchAi} config={draft} />
          )}

          {section === 'levers' && (
            <div className="space-y-4 max-w-lg">
              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-1">{t('levers.title')}<HelpHint topic="lever-ranges" /></h3>
                <p className="text-xs text-slate-600 leading-snug">
                  {t('levers.lead')}
                </p>
              </div>
              <RangeNum label={t('levers.spendingMax')} value={ranges.spendingMax} step={10000}
                hint={t('levers.defaultMoney', { value: DEFAULT_RANGE_PREFS.spendingMax.toLocaleString() })}
                onChange={(v) => updateRanges({ spendingMax: v })} money />
              <RangeNum label={t('levers.savingsMax')} value={ranges.savingsMax} step={10000}
                hint={t('levers.defaultMoney', { value: DEFAULT_RANGE_PREFS.savingsMax.toLocaleString() })}
                onChange={(v) => updateRanges({ savingsMax: v })} money />
              <RangeNum label={t('levers.returnMin')} value={+(ranges.returnMin * 100).toFixed(2)} step={0.25}
                hint={t('levers.defaultPct', { value: (DEFAULT_RANGE_PREFS.returnMin * 100).toFixed(1) })}
                onChange={(v) => updateRanges({ returnMin: Math.max(0, v) / 100 })} />
              <RangeNum label={t('levers.returnMax')} value={+(ranges.returnMax * 100).toFixed(2)} step={0.25}
                hint={t('levers.defaultPct', { value: (DEFAULT_RANGE_PREFS.returnMax * 100).toFixed(1) })}
                onChange={(v) => updateRanges({ returnMax: Math.max(0.01, v) / 100 })} />
              <RangeNum label={t('levers.volMax')} value={+(ranges.volatilityMax * 100).toFixed(1)} step={1}
                hint={t('levers.defaultPct', { value: (DEFAULT_RANGE_PREFS.volatilityMax * 100).toFixed(0) })}
                onChange={(v) => updateRanges({ volatilityMax: Math.max(0.01, v) / 100 })} />
              <button
                onClick={() => setRanges(setRangePrefs({ ...DEFAULT_RANGE_PREFS }))}
                className="flex items-center gap-1.5 border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-900 hover:text-slate-900"
              >
                <RotateCcw size={13} /> {t('levers.back')}
              </button>
            </div>
          )}

          {section === 'federal' && (
            <TaxTableEditor
              table={draft.federal}
              onChange={t => update(c => { c.federal = t; })}
            />
          )}

          {section === 'provinces' && (
            <div className="flex gap-4">
              <div className="w-48 shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-700">{t('provinces.title')}</span>
                  <button
                    onClick={() => {
                      const code = window.prompt(t('provinces.addCode'))?.trim().toUpperCase();
                      if (!code) return;
                      if (draft.provinces[code]) { setError(t('provinces.exists', { code })); return; }
                      update(c => {
                        c.provinces[code] = { brackets: [50000], rates: [0.05, 0.1], exemption: 10000 };
                      });
                      setSelectedProvince(code);
                      setError(null);
                    }}
                    className="p-1 hover:bg-slate-100" title={t('provinces.add')}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="space-y-0.5 max-h-72 overflow-y-auto">
                  {Object.keys(draft.provinces).sort().map(code => (
                    <div key={code} className="flex items-center group">
                      <button
                        onClick={() => setSelectedProvince(code)}
                        className={`flex-1 px-2 py-1 text-left text-xs ${
                          selectedProvince === code ? 'font-semibold text-slate-900' : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {code}{PROVINCE_NAMES[code] ? ` — ${t(`provinces.names.${code}`, { defaultValue: PROVINCE_NAMES[code] })}` : ''}
                      </button>
                      <button
                        onClick={() => {
                          if (!window.confirm(t('provinces.removeConfirm', { code }))) return;
                          update(c => { delete c.provinces[code]; });
                          if (selectedProvince === code) {
                            setSelectedProvince(Object.keys(draft.provinces).find(k => k !== code) ?? '');
                          }
                        }}
                        className="p-1 text-slate-400 hover:text-rose-700 opacity-0 group-hover:opacity-100"
                        title={t('provinces.remove')}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                {draft.provinces[selectedProvince] ? (
                  <>
                    <TaxTableEditor
                      table={draft.provinces[selectedProvince]}
                      onChange={t => update(c => { c.provinces[selectedProvince] = t; })}
                    />
                    {selectedProvince === 'QC' && (
                      <div className="mt-3 max-w-sm border-t border-slate-200 pt-3">
                        <PercentField label={t('provinces.abatement')} value={draft.qcFederalAbatement}
                          onChange={v => update(c => { c.qcFederalAbatement = v; })} />
                      </div>
                    )}
                    {selectedProvince === 'ONT' && (
                      <div className="mt-3 max-w-sm space-y-2 border-t border-slate-200 pt-3">
                        <NumberField label={t('provinces.surtaxT1')} value={draft.ontarioSurtax.threshold1}
                          onChange={v => update(c => { c.ontarioSurtax.threshold1 = v; })} />
                        <PercentField label={t('provinces.surtaxR1')} value={draft.ontarioSurtax.rate1}
                          onChange={v => update(c => { c.ontarioSurtax.rate1 = v; })} />
                        <NumberField label={t('provinces.surtaxT2')} value={draft.ontarioSurtax.threshold2}
                          onChange={v => update(c => { c.ontarioSurtax.threshold2 = v; })} />
                        <PercentField label={t('provinces.surtaxR2')} value={draft.ontarioSurtax.rate2}
                          onChange={v => update(c => { c.ontarioSurtax.rate2 = v; })} />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-500">{t('provinces.select')}</p>
                )}
              </div>
            </div>
          )}

          {section === 'rrif' && (
            <div>
              <p className="text-xs text-slate-600 mb-3">
                {t('rrifLead')}
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {Object.keys(draft.rrifRates)
                  .map(Number)
                  .sort((a, b) => a - b)
                  .map(age => (
                    <div key={age} className="flex items-center gap-1">
                      <span className="text-xs text-slate-600 w-6">{age}</span>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max="1"
                        value={draft.rrifRates[String(age)]}
                        onChange={e => update(c => {
                          c.rrifRates[String(age)] = parseFloat(e.target.value) || 0;
                        })}
                        className="w-full border border-slate-300 px-1.5 py-1 text-xs focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}

          {section === 'oas' && (
            <div className="space-y-3 max-w-sm">
              <NumberField label={t('oas.base6574')} value={draft.oas.baseMonthly65to74}
                onChange={v => update(c => { c.oas.baseMonthly65to74 = v; })} step="0.01" />
              <NumberField label={t('oas.base75')} value={draft.oas.baseMonthly75plus}
                onChange={v => update(c => { c.oas.baseMonthly75plus = v; })} step="0.01" />
              <NumberField label={t('oas.deferral')} value={draft.oas.deferralBonusPerMonth}
                onChange={v => update(c => { c.oas.deferralBonusPerMonth = v; })} step="0.001" />
              <NumberField label={t('oas.eligible')} value={draft.oas.eligibleAge}
                onChange={v => update(c => { c.oas.eligibleAge = v; })} />
              <NumberField label={t('oas.maxDeferral')} value={draft.oas.maxDeferralAge}
                onChange={v => update(c => { c.oas.maxDeferralAge = v; })} />
              <NumberField label={t('oas.minResidency')} value={draft.oas.minResidencyYears}
                onChange={v => update(c => { c.oas.minResidencyYears = v; })} />
              <NumberField label={t('oas.fullResidency')} value={draft.oas.fullPensionResidencyYears}
                onChange={v => update(c => { c.oas.fullPensionResidencyYears = v; })} />
              <PercentField label={t('oas.clawbackRate')} value={draft.oas.clawbackRate}
                onChange={v => update(c => { c.oas.clawbackRate = v; })} />
              <NumberField label={t('oas.clawbackThreshold')} value={draft.oas.clawbackThreshold}
                onChange={v => update(c => { c.oas.clawbackThreshold = v; })} step="1000" />
              <NumberField label={t('oas.gisSingle')} value={draft.oas.gisMaxAnnualSingle}
                onChange={v => update(c => { c.oas.gisMaxAnnualSingle = v; })} step="1000" />
              <NumberField label={t('oas.gisCouple')} value={draft.oas.gisMaxAnnualCouple}
                onChange={v => update(c => { c.oas.gisMaxAnnualCouple = v; })} step="1000" />
              <PercentField label={t('oas.gisReduction')} value={draft.oas.gisReductionRate}
                onChange={v => update(c => { c.oas.gisReductionRate = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug">
                {t('oas.gisNote')}
              </p>
            </div>
          )}

          {section === 'cpp' && (
            <div className="space-y-3 max-w-sm">
              <NumberField label={t('cpp.standard')} value={draft.cpp.standardAge}
                onChange={v => update(c => { c.cpp.standardAge = v; })} />
              <NumberField label={t('cpp.earliest')} value={draft.cpp.earliestAge}
                onChange={v => update(c => { c.cpp.earliestAge = v; })} />
              <NumberField label={t('cpp.latest')} value={draft.cpp.maxDeferralAge}
                onChange={v => update(c => { c.cpp.maxDeferralAge = v; })} />
              <PercentField label={t('cpp.earlyPenalty')} value={draft.cpp.earlyPenaltyPerMonth}
                onChange={v => update(c => { c.cpp.earlyPenaltyPerMonth = v; })} />
              <PercentField label={t('cpp.deferralBonus')} value={draft.cpp.deferralBonusPerMonth}
                onChange={v => update(c => { c.cpp.deferralBonusPerMonth = v; })} />
              <div className="pt-2 border-t border-slate-700">
                <p className="text-[11px] text-slate-500 mb-2">{t('cpp.selfEmployedLead')}</p>
                <PercentField label={t('cpp.selfEmployedRate')} value={draft.cpp.selfEmployedRate}
                  onChange={v => update(c => { c.cpp.selfEmployedRate = v; })} />
                <NumberField label={t('cpp.ympe')} value={draft.cpp.ympe}
                  onChange={v => update(c => { c.cpp.ympe = v; })} />
                <NumberField label={t('cpp.exemption')} value={draft.cpp.basicExemption}
                  onChange={v => update(c => { c.cpp.basicExemption = v; })} />
              </div>
            </div>
          )}

          {section === 'gains' && (
            <div className="space-y-3 max-w-sm">
              <PercentField label={t('gains.inclusion')} value={draft.engine.capitalGainsInclusion}
                onChange={v => update(c => { c.engine.capitalGainsInclusion = v; })} />
              <PercentField label={t('gains.acb')} value={draft.engine.taxableAcbRatio}
                onChange={v => update(c => { c.engine.taxableAcbRatio = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug">
                {t('gains.note')}
              </p>
            </div>
          )}

          {section === 'rdsp' && (
            <div className="space-y-3 max-w-sm">
              <p className="text-[11px] text-slate-500 leading-snug">
                {t('rdsp.lead')}
              </p>
              <NumberField label={t('rdsp.grantThreshold')} value={draft.rdsp.grantThreshold}
                onChange={v => update(c => { c.rdsp.grantThreshold = v; })} step="1000" />
              <NumberField label={t('rdsp.grantAnnual')} value={draft.rdsp.grantAnnualMax}
                onChange={v => update(c => { c.rdsp.grantAnnualMax = v; })} step="100" />
              <NumberField label={t('rdsp.grantLifetime')} value={draft.rdsp.grantLifetimeMax}
                onChange={v => update(c => { c.rdsp.grantLifetimeMax = v; })} step="1000" />
              <NumberField label={t('rdsp.grantEnd')} value={draft.rdsp.grantEndAge}
                onChange={v => update(c => { c.rdsp.grantEndAge = v; })} />
              <NumberField label={t('rdsp.bondLower')} value={draft.rdsp.bondThresholdLower}
                onChange={v => update(c => { c.rdsp.bondThresholdLower = v; })} step="500" />
              <NumberField label={t('rdsp.bondUpper')} value={draft.rdsp.bondThresholdUpper}
                onChange={v => update(c => { c.rdsp.bondThresholdUpper = v; })} step="500" />
              <NumberField label={t('rdsp.bondAnnual')} value={draft.rdsp.bondAnnualMax}
                onChange={v => update(c => { c.rdsp.bondAnnualMax = v; })} step="100" />
              <NumberField label={t('rdsp.bondLifetime')} value={draft.rdsp.bondLifetimeMax}
                onChange={v => update(c => { c.rdsp.bondLifetimeMax = v; })} step="1000" />
              <NumberField label={t('rdsp.contribLifetime')} value={draft.rdsp.contributionLifetimeMax}
                onChange={v => update(c => { c.rdsp.contributionLifetimeMax = v; })} step="5000" />
              <NumberField label={t('rdsp.contribEnd')} value={draft.rdsp.contributionEndAge}
                onChange={v => update(c => { c.rdsp.contributionEndAge = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug border-t border-slate-200 pt-2">
                {t('rdsp.note')}
              </p>
            </div>
          )}

          {section === 'fhsa' && (
            <div className="space-y-3 max-w-sm">
              <NumberField label={t('fhsa.annual')} value={draft.fhsa.annualLimit}
                onChange={v => update(c => { c.fhsa.annualLimit = v; })} step="1000" />
              <NumberField label={t('fhsa.lifetime')} value={draft.fhsa.lifetimeLimit}
                onChange={v => update(c => { c.fhsa.lifetimeLimit = v; })} step="5000" />
              <NumberField label={t('fhsa.years')} value={draft.fhsa.maxYears}
                onChange={v => update(c => { c.fhsa.maxYears = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug border-t border-slate-200 pt-2">
                {t('fhsa.note')}
              </p>
            </div>
          )}

          {section === 'engine' && (
            <div className="space-y-3 max-w-sm">
              <PercentField label={t('engine.cashCushion')} value={draft.engine.cashCushionRate}
                onChange={v => update(c => { c.engine.cashCushionRate = v; })} />
              <NumberField label={t('engine.rrifAge')} value={draft.engine.rrifConversionAge}
                onChange={v => update(c => { c.engine.rrifConversionAge = v; })} />
              <PercentField label={t('engine.inflation')} value={draft.engine.inflationRate}
                onChange={v => update(c => { c.engine.inflationRate = v; })} />
              <NumberField label={t('engine.tfsaLimit')} value={draft.engine.tfsaAnnualLimit} step="500"
                onChange={v => update(c => { c.engine.tfsaAnnualLimit = v; })} />
              <NumberField label={t('engine.rrspMax')} value={draft.engine.rrspAnnualMax} step="500"
                onChange={v => update(c => { c.engine.rrspAnnualMax = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug -mt-1">
                {t('engine.roomNote')}
              </p>
              <PercentField label={t('engine.pensionSplit')} value={draft.engine.pensionSplitMaxRate}
                onChange={v => update(c => { c.engine.pensionSplitMaxRate = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug -mt-1">
                {t('engine.pensionSplitNote')}
              </p>
              <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={draft.engine.indexSpending}
                  onChange={e => update(c => { c.engine.indexSpending = e.target.checked; })}
                  className="mt-0.5"
                />
                <span>
                  {t('engine.growSpend')}
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    {t('engine.growSpendHint')}
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={draft.engine.indexTaxTables}
                  onChange={e => update(c => { c.engine.indexTaxTables = e.target.checked; })}
                  className="mt-0.5"
                />
                <span>
                  {t('engine.indexTax')}
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    {t('engine.indexTaxHint')}
                  </span>
                </span>
              </label>
              <p className="text-[11px] text-slate-500 leading-snug border-t border-slate-200 pt-2">
                {t('engine.togglesNote')}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between py-3 border-t border-slate-200 mt-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-900 hover:text-slate-900"
          >
            <RotateCcw size={13} /> {t('reset')}
          </button>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-rose-700">{error}</span>}
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
            >
              <Save size={13} /> {t('save')}
            </button>
          </div>
        </div>
    </div>
  );
}

const SEND_TOGGLE_KEYS: Array<keyof Required<AiPromptSend>> = [
  'includePersona', 'includePageLine', 'includeToolInstructions', 'includePromptCatalog',
  'includeProgramRules', 'includeScenarioName', 'includePlanDigest', 'includeChatNote',
  'sendTools', 'personaLast',
];

function AssistantSettings({ ai, patchAi, config }: {
  ai: AiSettings;
  patchAi: (mutate: (s: AiSettings) => void) => void;
  config: AppConfig;
}) {
  const { t } = useTranslation('settings');
  const send = resolveAiPromptSend(ai.promptSend);
  const connection = ai.connections.find(c => c.id === ai.activeConnectionId);
  const isLocal = connection != null && isLocalProvider(connection.provider);
  const localMeta = !isLocal || !connection
    ? undefined
    : connection.provider === 'bonsai'
      ? BONSAI_MODELS.find(m => m.id === connection.model)
      : WEBLLM_MODELS.find(m => m.id === connection.model);
  const toolCapable = !isLocal || resolveLocalToolCapable(
    localMeta?.toolCapable,
    connection ? ai.toolCapableByModel?.[connection.model] : undefined,
  );
  const toolMode: 'native' | 'prompt' | 'off' = !connection
    ? 'off'
    : !isLocal ? 'native' : toolCapable ? 'prompt' : 'off';
  const effectiveMode = send.sendTools ? toolMode : 'off';
  const toolOverride = effectiveMode === 'native' ? ai.toolInstructionsNative
    : effectiveMode === 'prompt' ? ai.toolInstructionsPrompt
    : ai.toolInstructionsOff;
  const assembled = assembleSystemPrompt({
    scenarioName: 'Active plan',
    toolMode: effectiveMode,
    send,
    basePrompt: ai.systemPromptOverride,
    config,
    locale: config.general.locale ?? detectLocale(),
    toolInstructions: toolOverride,
  });
  const setSend = (key: keyof Required<AiPromptSend>, value: boolean) => {
    patchAi(s => {
      s.promptSend = { ...resolveAiPromptSend(s.promptSend), [key]: value };
    });
  };
  const resetSend = () => patchAi(s => { s.promptSend = { ...DEFAULT_AI_PROMPT_SEND }; });

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h3 className="text-xs font-semibold text-slate-700 mb-1">
          {t('assistant.whatIsSent')}<HelpHint topic="assistant-prompts" />
        </h3>
        <p className="text-xs text-slate-600 leading-snug">
          {t('assistant.whatIsSentLead')}
        </p>
      </div>

      <div className="space-y-2">
        {SEND_TOGGLE_KEYS.map(key => (
          <label key={key} className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={send[key]}
              onChange={e => setSend(key, e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t(`assistant.send.${key}.label`)}
              <span className="block text-[11px] text-slate-500 mt-0.5">{t(`assistant.send.${key}.hint`)}</span>
            </span>
          </label>
        ))}
        <button
          onClick={resetSend}
          className="flex items-center gap-1.5 border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-900 hover:text-slate-900"
        >
          <RotateCcw size={13} /> {t('assistant.resetSend')}
        </button>
      </div>

      <div className="border border-slate-200 bg-slate-50 p-3">
        <h3 className="text-xs font-semibold text-slate-700 mb-1">{t('assistant.assembled')}</h3>
        <p className="text-[11px] text-slate-500 leading-snug mb-2">
          {t('assistant.assembledLead')}
        </p>
        {assembled.trim()
          ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-slate-700">{assembled}</pre>
          : <p className="text-xs font-medium text-slate-800">{t('assistant.emptySystem')}</p>}
      </div>

      <div className="border-t border-slate-200 pt-3">
        <h3 className="text-xs font-semibold text-slate-700 mb-1">
          {t('assistant.toolsPerModel')}<HelpHint topic="assistant-prompts" />
        </h3>
        <p className="text-xs text-slate-600 leading-snug mb-2">
          {t('assistant.toolsPerModelLead')}
        </p>
        <div className="space-y-1.5">
          {[...visibleWebLlmModels(), ...BONSAI_MODELS].map(m => {
            const value = ai.toolCapableByModel?.[m.id] ?? 'auto';
            const catalog = m.toolCapable ? 'on' : 'off';
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-slate-800 min-w-[10rem]">
                  {m.label}
                  <span className="block text-[10px] text-slate-400">
                    {t('assistant.catalogDefault', { catalog })}
                  </span>
                </span>
                {(['auto', 'on', 'off'] as const).map(opt => (
                  <label key={opt} className="flex items-center gap-1 text-[11px] text-slate-700 cursor-pointer">
                    <input
                      type="radio"
                      name={`toolcap-${m.id}`}
                      checked={value === opt}
                      onChange={() => patchAi(s => {
                        const next = { ...(s.toolCapableByModel ?? {}) };
                        if (opt === 'auto') delete next[m.id];
                        else next[m.id] = opt;
                        s.toolCapableByModel = Object.keys(next).length ? next : undefined;
                      })}
                    />
                    {t(`assistant.${opt}`)}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <PromptEditor
        title={t('assistant.personaTitle')}
        hint={t('assistant.personaHint')}
        value={ai.systemPromptOverride ?? ''}
        fallback={DEFAULT_SYSTEM_PROMPT}
        onChange={text => patchAi(s => { s.systemPromptOverride = text || undefined; })}
      />
      <PromptEditor
        title={t('assistant.toolNativeTitle')}
        hint={t('assistant.toolNativeHint')}
        value={ai.toolInstructionsNative ?? ''}
        fallback={DEFAULT_TOOL_INSTRUCTIONS_NATIVE}
        onChange={text => patchAi(s => { s.toolInstructionsNative = text || undefined; })}
      />
      <PromptEditor
        title={t('assistant.toolPromptTitle')}
        hint={t('assistant.toolPromptHint')}
        value={ai.toolInstructionsPrompt ?? ''}
        fallback={DEFAULT_TOOL_INSTRUCTIONS_PROMPT}
        onChange={text => patchAi(s => { s.toolInstructionsPrompt = text || undefined; })}
      />
      <PromptEditor
        title={t('assistant.toolOffTitle')}
        hint={t('assistant.toolOffHint')}
        value={ai.toolInstructionsOff ?? ''}
        fallback={DEFAULT_TOOL_INSTRUCTIONS_OFF}
        onChange={text => patchAi(s => { s.toolInstructionsOff = text || undefined; })}
      />
    </div>
  );
}

function PromptEditor({ title, hint, value, fallback, onChange }: {
  title: string;
  hint: string;
  value: string;
  fallback: string;
  onChange: (text: string) => void;
}) {
  const { t } = useTranslation('settings');
  const customized = value.trim().length > 0;
  const shown = customized ? value : fallback;
  return (
    <div className="border-t border-slate-200 pt-3">
      <h3 className="text-xs font-semibold text-slate-700 mb-0.5">{title}</h3>
      <p className="text-[11px] text-slate-500 leading-snug mb-1.5">{hint}</p>
      <textarea
        value={shown}
        onChange={e => onChange(e.target.value)}
        rows={8}
        className="w-full border border-slate-300 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-700 focus:border-slate-900 focus:outline-none resize-y"
      />
      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={() => onChange('')}
          className="text-[10px] font-semibold text-slate-400 hover:text-slate-900"
          title={t('assistant.resetPromptTitle')}
        >
          {t('assistant.resetPrompt')}
        </button>
        {customized && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">{t('assistant.customized')}</span>
        )}
      </div>
    </div>
  );
}

/** Lever-range editor row: label + number + a one-line default hint. */
function RangeNum({ label, value, onChange, step, hint, money }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  hint?: string;
  money?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-700">{label}</span>
      <span className="mt-0.5 flex items-baseline gap-1.5">
        {money && <span className="text-[11px] text-slate-400">$</span>}
        <input
          type="number"
          step={step ?? 1}
          min={0}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="num w-36 border border-slate-300 px-2 py-1 text-right text-xs focus:border-slate-900 focus:outline-none"
        />
      </span>
      {hint && <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

function NumberField({ label, value, onChange, step }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-700">{label}</span>
      <input
        type="number"
        step={step ?? '1'}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="num w-32 border border-slate-300 px-2 py-1 text-right text-xs focus:border-slate-900 focus:outline-none"
      />
    </label>
  );
}

/** Decimal rate stored internally; displayed and edited as a percentage. */
function PercentField({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-700">{label}</span>
      <input
        type="number"
        step="0.1"
        min="0"
        value={+(value * 100).toFixed(4)}
        onChange={e => onChange((parseFloat(e.target.value) || 0) / 100)}
        className="num w-32 border border-slate-300 px-2 py-1 text-right text-xs focus:border-slate-900 focus:outline-none"
      />
    </label>
  );
}

function TaxTableEditor({ table, onChange }: {
  table: TaxTable;
  onChange: (t: TaxTable) => void;
}) {
  const { t } = useTranslation('settings');
  const setBracket = (i: number, v: number) => {
    const brackets = [...table.brackets];
    brackets[i] = v;
    onChange({ ...table, brackets });
  };
  const setRate = (i: number, v: number) => {
    const rates = [...table.rates];
    rates[i] = v;
    onChange({ ...table, rates });
  };
  const addRow = () => {
    const last = table.brackets[table.brackets.length - 1] ?? 0;
    onChange({
      ...table,
      brackets: [...table.brackets, last + 50000],
      rates: [...table.rates, (table.rates[table.rates.length - 1] ?? 0) + 0.01]
    });
  };
  const removeRow = (i: number) => {
    // Removing bracket i merges the rate band above it into the one below.
    const brackets = table.brackets.filter((_, idx) => idx !== i);
    const rates = table.rates.filter((_, idx) => idx !== i + 1);
    onChange({ ...table, brackets, rates });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-slate-700">{t('tax.exemption')}</span>
        <input
          type="number"
          step="1000"
          value={table.exemption}
          onChange={e => onChange({ ...table, exemption: parseFloat(e.target.value) || 0 })}
          className="num w-28 border border-slate-300 px-2 py-1 text-right text-xs focus:border-slate-900 focus:outline-none"
        />
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-1 font-medium">{t('tax.bracket')}</th>
            <th className="py-1 font-medium">{t('tax.rate')}</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-100">
            <td className="py-1 text-slate-500">$0</td>
            <td>
              <input
                type="number" step="0.005" min="0" max="1"
                value={table.rates[0] ?? 0}
                onChange={e => setRate(0, parseFloat(e.target.value) || 0)}
                className="num w-24 border border-slate-300 px-1.5 py-1 text-right focus:border-slate-900 focus:outline-none"
              />
            </td>
            <td></td>
          </tr>
          {table.brackets.map((b, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-1">
                <input
                  type="number" step="1000" min="0"
                  value={b}
                  onChange={e => setBracket(i, parseFloat(e.target.value) || 0)}
                  className="num w-28 border border-slate-300 px-1.5 py-1 text-right focus:border-slate-900 focus:outline-none"
                />
              </td>
              <td>
                <input
                  type="number" step="0.005" min="0" max="1"
                  value={table.rates[i + 1] ?? 0}
                  onChange={e => setRate(i + 1, parseFloat(e.target.value) || 0)}
                  className="num w-24 border border-slate-300 px-1.5 py-1 text-right focus:border-slate-900 focus:outline-none"
                />
              </td>
              <td>
                <button onClick={() => removeRow(i)} className="p-1 text-slate-400 hover:text-rose-700" title={t('tax.remove')}>
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={addRow}
        className="mt-2 flex items-center gap-1 px-1 py-1 text-xs font-medium text-slate-500 hover:text-slate-900"
      >
        <Plus size={12} /> {t('tax.add')}
      </button>
    </div>
  );
}
