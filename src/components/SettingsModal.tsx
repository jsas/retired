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
                <h3 className="text-xs font-semibold text-slate-700 mb-1">Lever ranges<HelpHint topic="lever-ranges" /></h3>
                <p className="text-xs text-slate-600 leading-snug">
                  The sliders for spending, savings, expected return and volatility only span the
                  range below. Widen one if your plan lives past the default edge — these are
                  preferences, not engine settings, so they save the moment you change them.
                  Retirement age, plan-to age, CPP and OAS start ages keep fixed spans; a fixed
                  span is part of their meaning.
                </p>
              </div>
              <RangeNum label="Spending slider max" value={ranges.spendingMax} step={10000}
                hint={`Default ${DEFAULT_RANGE_PREFS.spendingMax.toLocaleString('en-CA')}`}
                onChange={(v) => updateRanges({ spendingMax: v })} money />
              <RangeNum label="Annual savings slider max" value={ranges.savingsMax} step={10000}
                hint={`Default ${DEFAULT_RANGE_PREFS.savingsMax.toLocaleString('en-CA')}`}
                onChange={(v) => updateRanges({ savingsMax: v })} money />
              <RangeNum label="Expected return slider min" value={+(ranges.returnMin * 100).toFixed(2)} step={0.25}
                hint={`% a year · default ${(DEFAULT_RANGE_PREFS.returnMin * 100).toFixed(1)}%`}
                onChange={(v) => updateRanges({ returnMin: Math.max(0, v) / 100 })} />
              <RangeNum label="Expected return slider max" value={+(ranges.returnMax * 100).toFixed(2)} step={0.25}
                hint={`% a year · default ${(DEFAULT_RANGE_PREFS.returnMax * 100).toFixed(1)}%`}
                onChange={(v) => updateRanges({ returnMax: Math.max(0.01, v) / 100 })} />
              <RangeNum label="Volatility slider max" value={+(ranges.volatilityMax * 100).toFixed(1)} step={1}
                hint={`% a year · default ${(DEFAULT_RANGE_PREFS.volatilityMax * 100).toFixed(0)}%`}
                onChange={(v) => updateRanges({ volatilityMax: Math.max(0.01, v) / 100 })} />
              <button
                onClick={() => setRanges(setRangePrefs({ ...DEFAULT_RANGE_PREFS }))}
                className="flex items-center gap-1.5 border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-900 hover:text-slate-900"
              >
                <RotateCcw size={13} /> Back to the default ranges
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
                  <span className="text-xs font-semibold text-slate-700">Provinces</span>
                  <button
                    onClick={() => {
                      const code = window.prompt('Province code (e.g. ONT):')?.trim().toUpperCase();
                      if (!code) return;
                      if (draft.provinces[code]) { setError(`Province ${code} already exists`); return; }
                      update(c => {
                        c.provinces[code] = { brackets: [50000], rates: [0.05, 0.1], exemption: 10000 };
                      });
                      setSelectedProvince(code);
                      setError(null);
                    }}
                    className="p-1 hover:bg-slate-100" title="Add province"
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
                        {code}{PROVINCE_NAMES[code] ? ` — ${PROVINCE_NAMES[code]}` : ''}
                      </button>
                      <button
                        onClick={() => {
                          if (!window.confirm(`Remove province ${code}?`)) return;
                          update(c => { delete c.provinces[code]; });
                          if (selectedProvince === code) {
                            setSelectedProvince(Object.keys(draft.provinces).find(k => k !== code) ?? '');
                          }
                        }}
                        className="p-1 text-slate-400 hover:text-rose-700 opacity-0 group-hover:opacity-100"
                        title="Remove province"
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
                        <PercentField label="Federal abatement (% of federal tax)" value={draft.qcFederalAbatement}
                          onChange={v => update(c => { c.qcFederalAbatement = v; })} />
                      </div>
                    )}
                    {selectedProvince === 'ONT' && (
                      <div className="mt-3 max-w-sm space-y-2 border-t border-slate-200 pt-3">
                        <NumberField label="Surtax threshold 1 ($ of ON tax)" value={draft.ontarioSurtax.threshold1}
                          onChange={v => update(c => { c.ontarioSurtax.threshold1 = v; })} />
                        <PercentField label="Surtax rate 1 (%)" value={draft.ontarioSurtax.rate1}
                          onChange={v => update(c => { c.ontarioSurtax.rate1 = v; })} />
                        <NumberField label="Surtax threshold 2 ($ of ON tax)" value={draft.ontarioSurtax.threshold2}
                          onChange={v => update(c => { c.ontarioSurtax.threshold2 = v; })} />
                        <PercentField label="Surtax rate 2 (%)" value={draft.ontarioSurtax.rate2}
                          onChange={v => update(c => { c.ontarioSurtax.rate2 = v; })} />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Select a province to edit.</p>
                )}
              </div>
            </div>
          )}

          {section === 'rrif' && (
            <div>
              <p className="text-xs text-slate-600 mb-3">
                CRA minimum withdrawal rate by age (applied to the RRIF balance each year).
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
              <NumberField label="Base monthly (age 65–74)" value={draft.oas.baseMonthly65to74}
                onChange={v => update(c => { c.oas.baseMonthly65to74 = v; })} step="0.01" />
              <NumberField label="Base monthly (75+, after 10% bump)" value={draft.oas.baseMonthly75plus}
                onChange={v => update(c => { c.oas.baseMonthly75plus = v; })} step="0.01" />
              <NumberField label="Deferral bonus per month past 65" value={draft.oas.deferralBonusPerMonth}
                onChange={v => update(c => { c.oas.deferralBonusPerMonth = v; })} step="0.001" />
              <NumberField label="Eligible age" value={draft.oas.eligibleAge}
                onChange={v => update(c => { c.oas.eligibleAge = v; })} />
              <NumberField label="Max deferral age" value={draft.oas.maxDeferralAge}
                onChange={v => update(c => { c.oas.maxDeferralAge = v; })} />
              <NumberField label="Min residency years" value={draft.oas.minResidencyYears}
                onChange={v => update(c => { c.oas.minResidencyYears = v; })} />
              <NumberField label="Full-pension residency years" value={draft.oas.fullPensionResidencyYears}
                onChange={v => update(c => { c.oas.fullPensionResidencyYears = v; })} />
              <PercentField label="Clawback rate (%)" value={draft.oas.clawbackRate}
                onChange={v => update(c => { c.oas.clawbackRate = v; })} />
              <NumberField label="Clawback income threshold ($/yr)" value={draft.oas.clawbackThreshold}
                onChange={v => update(c => { c.oas.clawbackThreshold = v; })} step="1000" />
              <NumberField label="GIS max annual — single ($/yr)" value={draft.oas.gisMaxAnnualSingle}
                onChange={v => update(c => { c.oas.gisMaxAnnualSingle = v; })} step="1000" />
              <NumberField label="GIS max annual — couple, per spouse ($/yr)" value={draft.oas.gisMaxAnnualCouple}
                onChange={v => update(c => { c.oas.gisMaxAnnualCouple = v; })} step="1000" />
              <PercentField label="GIS reduction rate (% per $ of non-OAS income)" value={draft.oas.gisReductionRate}
                onChange={v => update(c => { c.oas.gisReductionRate = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug">
                With a spouse enabled, each spouse's GIS is assessed on <em>combined</em> non-OAS income at the
                couple rate when both receive OAS (single rate when only one does) — CRA's couple rules.
              </p>
            </div>
          )}

          {section === 'cpp' && (
            <div className="space-y-3 max-w-sm">
              <NumberField label="Standard (unadjusted) age" value={draft.cpp.standardAge}
                onChange={v => update(c => { c.cpp.standardAge = v; })} />
              <NumberField label="Earliest start age" value={draft.cpp.earliestAge}
                onChange={v => update(c => { c.cpp.earliestAge = v; })} />
              <NumberField label="Latest start age" value={draft.cpp.maxDeferralAge}
                onChange={v => update(c => { c.cpp.maxDeferralAge = v; })} />
              <PercentField label="Early penalty (%/month before standard age)" value={draft.cpp.earlyPenaltyPerMonth}
                onChange={v => update(c => { c.cpp.earlyPenaltyPerMonth = v; })} />
              <PercentField label="Deferral bonus (%/month after standard age)" value={draft.cpp.deferralBonusPerMonth}
                onChange={v => update(c => { c.cpp.deferralBonusPerMonth = v; })} />
              <div className="pt-2 border-t border-slate-700">
                <p className="text-[11px] text-slate-500 mb-2">Self-employed CPP contribution (both sides) — a deduction from taxable self-employment income.</p>
                <PercentField label="Combined employee+employer rate" value={draft.cpp.selfEmployedRate}
                  onChange={v => update(c => { c.cpp.selfEmployedRate = v; })} />
                <NumberField label="YMPE (max pensionable earnings)" value={draft.cpp.ympe}
                  onChange={v => update(c => { c.cpp.ympe = v; })} />
                <NumberField label="Basic exemption" value={draft.cpp.basicExemption}
                  onChange={v => update(c => { c.cpp.basicExemption = v; })} />
              </div>
            </div>
          )}

          {section === 'gains' && (
            <div className="space-y-3 max-w-sm">
              <PercentField label="Capital gains inclusion rate (%)" value={draft.engine.capitalGainsInclusion}
                onChange={v => update(c => { c.engine.capitalGainsInclusion = v; })} />
              <PercentField label="Taxable account starting ACB (% of balance)" value={draft.engine.taxableAcbRatio}
                onChange={v => update(c => { c.engine.taxableAcbRatio = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug">
                100% = the whole taxable balance is principal (no embedded gains). Lower it if the
                account has grown — e.g. 60% means 40¢ of every dollar withdrawn is a taxable gain.
                Contributions raise the ACB; growth does not.
              </p>
            </div>
          )}

          {section === 'rdsp' && (
            <div className="space-y-3 max-w-sm">
              <p className="text-[11px] text-slate-500 leading-snug">
                Canada Disability Savings Grant (CDSG) matches contributions; the Bond (CDSB) is
                income-tested and needs no contribution. Both stop at the end-age; contributions have a
                lifetime cap. On withdrawal the grant/bond/growth portion is taxable. 2026 values.
              </p>
              <NumberField label="Grant income threshold ($/yr)" value={draft.rdsp.grantThreshold}
                onChange={v => update(c => { c.rdsp.grantThreshold = v; })} step="1000" />
              <NumberField label="Grant annual max ($)" value={draft.rdsp.grantAnnualMax}
                onChange={v => update(c => { c.rdsp.grantAnnualMax = v; })} step="100" />
              <NumberField label="Grant lifetime max ($)" value={draft.rdsp.grantLifetimeMax}
                onChange={v => update(c => { c.rdsp.grantLifetimeMax = v; })} step="1000" />
              <NumberField label="Grant/bond end age" value={draft.rdsp.grantEndAge}
                onChange={v => update(c => { c.rdsp.grantEndAge = v; })} />
              <NumberField label="Bond lower threshold ($)" value={draft.rdsp.bondThresholdLower}
                onChange={v => update(c => { c.rdsp.bondThresholdLower = v; })} step="500" />
              <NumberField label="Bond upper threshold ($)" value={draft.rdsp.bondThresholdUpper}
                onChange={v => update(c => { c.rdsp.bondThresholdUpper = v; })} step="500" />
              <NumberField label="Bond annual max ($)" value={draft.rdsp.bondAnnualMax}
                onChange={v => update(c => { c.rdsp.bondAnnualMax = v; })} step="100" />
              <NumberField label="Bond lifetime max ($)" value={draft.rdsp.bondLifetimeMax}
                onChange={v => update(c => { c.rdsp.bondLifetimeMax = v; })} step="1000" />
              <NumberField label="Contribution lifetime max ($)" value={draft.rdsp.contributionLifetimeMax}
                onChange={v => update(c => { c.rdsp.contributionLifetimeMax = v; })} step="5000" />
              <NumberField label="Contribution end age" value={draft.rdsp.contributionEndAge}
                onChange={v => update(c => { c.rdsp.contributionEndAge = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug border-t border-slate-200 pt-2">
                Family income at/below the grant threshold earns 300% on the first $500 + 200% on the next
                $1,000 contributed; above it, 100% on the first $1,000. The bond pays in full at/below the
                lower threshold, phases out linearly to $0 at the upper. The 10-year AHA clawback and the
                grant/bond carry-forward are not modelled.
              </p>
            </div>
          )}

          {section === 'fhsa' && (
            <div className="space-y-3 max-w-sm">
              <NumberField label="Annual contribution limit ($/yr)" value={draft.fhsa.annualLimit}
                onChange={v => update(c => { c.fhsa.annualLimit = v; })} step="1000" />
              <NumberField label="Lifetime contribution limit ($)" value={draft.fhsa.lifetimeLimit}
                onChange={v => update(c => { c.fhsa.lifetimeLimit = v; })} step="5000" />
              <NumberField label="Plan life (years)" value={draft.fhsa.maxYears}
                onChange={v => update(c => { c.fhsa.maxYears = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug border-t border-slate-200 pt-2">
                FHSA contributions are deductible (like an RRSP), grow tax-sheltered, and are capped by
                the annual and lifetime limits. The plan can stay open for a limited number of years
                from when it was opened. On retirement the balance transfers to the RRSP (no RRSP room
                needed). A qualifying first-home withdrawal (tax-free) is not modelled.
              </p>
            </div>
          )}

          {section === 'engine' && (
            <div className="space-y-3 max-w-sm">
              <PercentField label="Cash cushion annual rate (%)" value={draft.engine.cashCushionRate}
                onChange={v => update(c => { c.engine.cashCushionRate = v; })} />
              <NumberField label="RRIF conversion age" value={draft.engine.rrifConversionAge}
                onChange={v => update(c => { c.engine.rrifConversionAge = v; })} />
              <PercentField label="Inflation rate / CPI (%)" value={draft.engine.inflationRate}
                onChange={v => update(c => { c.engine.inflationRate = v; })} />
              <NumberField label="TFSA annual limit ($/yr)" value={draft.engine.tfsaAnnualLimit} step="500"
                onChange={v => update(c => { c.engine.tfsaAnnualLimit = v; })} />
              <NumberField label="RRSP annual maximum ($/yr)" value={draft.engine.rrspAnnualMax} step="500"
                onChange={v => update(c => { c.engine.rrspAnnualMax = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug -mt-1">
                Used only when a scenario tracks contribution room (TFSA/RRSP room set on the sidebar).
                Each year TFSA room grows by this limit; RRSP room grows by 18% of earned income up to
                this maximum (minus any pension adjustment). When "Index tax tables" is on, both grow
                with CPI like the real CRA limits.
              </p>
              <PercentField label="Max pension income split (%)" value={draft.engine.pensionSplitMaxRate}
                onChange={v => update(c => { c.engine.pensionSplitMaxRate = v; })} />
              <p className="text-[11px] text-slate-500 leading-snug -mt-1">
                Couples only: up to this share of each spouse's eligible pension income (RRIF/RRSP draws
                and DB pensions — not CPP/OAS) is reallocated to the lower-taxed spouse to cut household
                tax. CRA's maximum is 50%; set 0 to disable. Only reported tax changes — GIS and the
                withdrawal plan are unaffected.
              </p>
              <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={draft.engine.indexSpending}
                  onChange={e => update(c => { c.engine.indexSpending = e.target.checked; })}
                  className="mt-0.5"
                />
                <span>
                  Grow spending with inflation each year
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    On: the Spending Target column rises with CPI — a $60k lifestyle entered today needs
                    ~$89k of income 20 years out at 2%. Off: the target stays flat in today's dollars
                    (a level-spending / real-terms plan).
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
                  Index tax tables, OAS and CPP to inflation each year
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    Brackets, basic personal amounts, the OAS clawback threshold and benefit amounts all
                    grow with CPI — closer to reality (CRA indexes them), but results are then in
                    inflated future dollars.
                  </span>
                </span>
              </label>
              <p className="text-[11px] text-slate-500 leading-snug border-t border-slate-200 pt-2">
                These two toggles are independent. <strong>Grow spending</strong> controls whether your
                spending target inflates; <strong>Index tax tables</strong> controls whether the tax system
                and benefits inflate. The CPI rate above drives both. For a fully "today's dollars"
                (real-terms) plan, turn spending growth off; for nominal, leave it on.
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

const SEND_TOGGLES: Array<{ key: keyof Required<AiPromptSend>; label: string; hint: string }> = [
  { key: 'includePersona', label: 'Persona', hint: 'The base voice (built-in or your override).' },
  { key: 'includePageLine', label: 'Current page', hint: 'One line naming the page you are on.' },
  { key: 'includeToolInstructions', label: 'Tool instructions', hint: 'How to use tools / what to do when tools are off.' },
  { key: 'includePromptCatalog', label: 'Tool catalog (local)', hint: 'The TOOL_CALL: list of every tool. Local models only.' },
  { key: 'includeProgramRules', label: 'Program rules', hint: 'Live CPP/OAS/GIS/RRIF/limit figures from engine settings.' },
  { key: 'includeScenarioName', label: 'Active plan name', hint: 'The active scenario is "…".' },
  { key: 'includePlanDigest', label: 'Plan digest (local)', hint: 'Pinned summary of ages, balances, projection. Local models only.' },
  { key: 'includeChatNote', label: 'Per-chat note', hint: '“Additional instructions for this chat” from the composer.' },
  { key: 'sendTools', label: 'Send tools', hint: 'Advertise and execute tools. Off = chat only, even on a capable model.' },
  { key: 'personaLast', label: 'Persona last', hint: 'Put the persona after the mechanics so a small model honors a custom override.' },
];

function AssistantSettings({ ai, patchAi, config }: {
  ai: AiSettings;
  patchAi: (mutate: (s: AiSettings) => void) => void;
  config: AppConfig;
}) {
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
          What is sent<HelpHint topic="assistant-prompts" />
        </h3>
        <p className="text-xs text-slate-600 leading-snug">
          Every request to the model is assembled from the pieces below. Uncheck one to drop
          it. Edits save immediately (same as lever ranges) and apply to the next message in
          every chat. Per-chat notes still live on the composer.
        </p>
      </div>

      <div className="space-y-2">
        {SEND_TOGGLES.map(t => (
          <label key={t.key} className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={send[t.key]}
              onChange={e => setSend(t.key, e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t.label}
              <span className="block text-[11px] text-slate-500 mt-0.5">{t.hint}</span>
            </span>
          </label>
        ))}
        <button
          onClick={resetSend}
          className="flex items-center gap-1.5 border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-900 hover:text-slate-900"
        >
          <RotateCcw size={13} /> Back to default send flags
        </button>
      </div>

      <div className="border border-slate-200 bg-slate-50 p-3">
        <h3 className="text-xs font-semibold text-slate-700 mb-1">Assembled system (this request)</h3>
        <p className="text-[11px] text-slate-500 leading-snug mb-2">
          Exactly what the next message will put in the system slot. Empty means
          nothing — no blank system role, and the local engine drops its previous
          system from cache. Chat history still goes as user/assistant turns.
        </p>
        {assembled.trim()
          ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-slate-700">{assembled}</pre>
          : <p className="text-xs font-medium text-slate-800">(empty — no system message)</p>}
      </div>

      <div className="border-t border-slate-200 pt-3">
        <h3 className="text-xs font-semibold text-slate-700 mb-1">
          Tools per local model<HelpHint topic="assistant-prompts" />
        </h3>
        <p className="text-xs text-slate-600 leading-snug mb-2">
          The catalog decides the default: Qwen 1.7B and Bonsai 1.7B are questions-only; 4B and up run tools.
          Force a model on or off here for testing — Auto restores the catalog. Cloud
          models always use tools unless Send tools is unchecked above.
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
                    catalog default: tools {catalog}
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
                    {opt === 'auto' ? 'Auto' : opt === 'on' ? 'On' : 'Off'}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <PromptEditor
        title="Persona (all chats)"
        hint="Replaces the built-in planner voice when non-empty. Leave blank to use the default."
        value={ai.systemPromptOverride ?? ''}
        fallback={DEFAULT_SYSTEM_PROMPT}
        onChange={text => patchAi(s => { s.systemPromptOverride = text || undefined; })}
      />
      <PromptEditor
        title="Tool instructions — native (cloud)"
        hint="How a function-calling model should use the tools. Sent only when Tool instructions is on and the model is cloud."
        value={ai.toolInstructionsNative ?? ''}
        fallback={DEFAULT_TOOL_INSTRUCTIONS_NATIVE}
        onChange={text => patchAi(s => { s.toolInstructionsNative = text || undefined; })}
      />
      <PromptEditor
        title="Tool instructions — local (prompt protocol)"
        hint="How a chat-only local model should use TOOL_CALL. The catalog of tools is a separate toggle."
        value={ai.toolInstructionsPrompt ?? ''}
        fallback={DEFAULT_TOOL_INSTRUCTIONS_PROMPT}
        onChange={text => patchAi(s => { s.toolInstructionsPrompt = text || undefined; })}
      />
      <PromptEditor
        title="Instructions when tools are off"
        hint="Used when this model’s tools are off (catalog default or your override), or when Send tools is unchecked."
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
          title="Restore the built-in default"
        >
          Reset to default
        </button>
        {customized && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">customized</span>
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
        <span className="text-xs font-semibold text-slate-700">Basic personal exemption</span>
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
            <th className="py-1 font-medium">Bracket threshold</th>
            <th className="py-1 font-medium">Rate above threshold</th>
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
                <button onClick={() => removeRow(i)} className="p-1 text-slate-400 hover:text-rose-700" title="Remove bracket">
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
        <Plus size={12} /> Add bracket
      </button>
    </div>
  );
}
