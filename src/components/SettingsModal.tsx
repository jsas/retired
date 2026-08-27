import { useState } from 'react';
import { Plus, Trash2, RotateCcw, Save } from 'lucide-react';
import {
  type AppConfig,
  type TaxTable,
  validateAppConfig,
  resetAppConfig
} from '../lib/appConfig';

interface SettingsModalProps {
  config: AppConfig;
  onSave: (config: AppConfig) => void;
}

type Section = 'general' | 'federal' | 'provinces' | 'rrif' | 'oas' | 'cpp' | 'engine' | 'gains';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'federal', label: 'Federal Tax' },
  { id: 'provinces', label: 'Provincial Tax' },
  { id: 'rrif', label: 'RRIF Rates' },
  { id: 'oas', label: 'OAS' },
  { id: 'cpp', label: 'CPP' },
  { id: 'engine', label: 'Engine' },
  { id: 'gains', label: 'Capital Gains' }
];

const PROVINCE_NAMES: Record<string, string> = {
  ONT: 'Ontario', NL: 'Newfoundland and Labrador', PE: 'Prince Edward Island',
  NS: 'Nova Scotia', NB: 'New Brunswick', QC: 'Quebec', MB: 'Manitoba',
  SK: 'Saskatchewan', AB: 'Alberta', BC: 'British Columbia', YT: 'Yukon',
  NT: 'Northwest Territories', NU: 'Nunavut'
};

export function SettingsModal({ config, onSave }: SettingsModalProps) {
  const [draft, setDraft] = useState<AppConfig>(() => structuredClone(config));
  const [section, setSection] = useState<Section>('federal');
  const [selectedProvince, setSelectedProvince] = useState<string>('ONT');
  const [error, setError] = useState<string | null>(null);

  const update = (mutate: (c: AppConfig) => void) => {
    setDraft(prev => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
  };

  const handleSave = () => {
    if (!validateAppConfig(draft)) {
      setError('Invalid configuration: check that every bracket has a rate (rates = brackets + 1) and all values are numbers.');
      return;
    }
    onSave(draft);
  };

  const handleReset = () => {
    if (!window.confirm('Reset all settings to the built-in defaults?')) return;
    const defaults = resetAppConfig();
    setDraft(structuredClone(defaults));
    setError(null);
  };

  return (
    <div>
        {/* Section tabs */}
        <div className="flex gap-1 border-b border-neutral-200 mb-4">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t ${
                section === s.id
                  ? 'bg-blue-50 text-blue-700 border border-b-white border-neutral-200 -mb-px'
                  : 'text-slate-600 hover:bg-neutral-50'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="pb-4">
          {section === 'general' && (
            <div className="space-y-4 max-w-lg">
              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-1">Help</h3>
                <p className="text-xs text-slate-600 leading-snug">
                  RE: tired projects a Canadian retirement drawdown year by year: growth while you
                  contribute, then withdrawals across TFSA / taxable / RRSP-RRIF with federal and
                  provincial tax, CPP, OAS (clawback + GIS) and RRIF minimums. Every input in the
                  sidebar is documented on the <span className="font-medium">Help</span> page
                  (top-right <span className="font-medium">?</span> button), and the sections below
                  let you edit the tax tables and engine assumptions themselves.
                </p>
                <p className="text-xs text-slate-600 leading-snug mt-1.5">
                  All profiles and settings are stored only in this browser's local storage — nothing
                  is sent to a server. Use the sidebar's Export to back them up.
                </p>
              </div>
              <div className="border-t border-neutral-200 pt-3">
                <h3 className="text-xs font-semibold text-slate-700 mb-1.5">Welcome section</h3>
                <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.general.showWelcomeOnLoad}
                    onChange={e => update(c => { c.general.showWelcomeOnLoad = e.target.checked; })}
                    className="mt-0.5"
                  />
                  <span>
                    Show the welcome section when the site loads
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      The getting-started card reappears at the top of the main page on every visit.
                      Dismissing it still hides it for the rest of the current session.
                    </span>
                  </span>
                </label>
              </div>

              <div className="border-t border-neutral-200 pt-3">
                <h3 className="text-xs font-semibold text-slate-700 mb-1.5">Unsaved changes</h3>
                <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.general.promptToSaveOnSwitch}
                    onChange={e => update(c => { c.general.promptToSaveOnSwitch = e.target.checked; })}
                    className="mt-0.5"
                  />
                  <span>
                    Ask before switching away from a scenario with unsaved edits
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      When on, changing scenarios with unsaved edits asks whether to save first —
                      with a "don't ask again" box that turns this off. Off = switch silently.
                    </span>
                  </span>
                </label>
              </div>

              {/* Danger zone: wipes every app key from localStorage and reloads
                  to the first-run defaults. Kept out of the draft/save flow —
                  it acts immediately, on the stored data itself. */}
              <div className="border border-red-300 bg-red-50/60 rounded p-3">
                <h3 className="text-xs font-semibold text-red-800 mb-1">Danger zone</h3>
                <p className="text-[11px] text-red-700 leading-snug mb-2">
                  Erase everything: all scenarios, engine settings, panel layouts and dismissals are
                  permanently deleted from this browser, and the app restarts with factory defaults.
                  Export a backup first if you might want any of it back.
                </p>
                <button
                  onClick={() => {
                    if (!window.confirm('Erase ALL scenarios, settings and preferences from this browser? This cannot be undone.')) return;
                    if (!window.confirm('Really erase everything? The app will reload with factory defaults.')) return;
                    try {
                      for (const key of ['wealthconsole_scenarios', 'wealthconsole_config', 'wealthconsole_panel_state']) {
                        localStorage.removeItem(key);
                      }
                    } catch { /* ignore */ }
                    window.location.reload();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-semibold rounded hover:bg-red-700"
                >
                  <Trash2 size={13} /> Erase everything and reset
                </button>
              </div>
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
                    className="p-1 hover:bg-neutral-100 rounded" title="Add province"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="space-y-0.5 max-h-72 overflow-y-auto">
                  {Object.keys(draft.provinces).sort().map(code => (
                    <div key={code} className="flex items-center group">
                      <button
                        onClick={() => setSelectedProvince(code)}
                        className={`flex-1 text-left px-2 py-1 text-xs rounded ${
                          selectedProvince === code ? 'bg-blue-100 text-blue-800 font-medium' : 'hover:bg-neutral-50'
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
                        className="p-1 text-neutral-400 hover:text-red-600 opacity-0 group-hover:opacity-100"
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
                      <div className="mt-3 pt-3 border-t border-neutral-200 max-w-sm">
                        <PercentField label="Federal abatement (% of federal tax)" value={draft.qcFederalAbatement}
                          onChange={v => update(c => { c.qcFederalAbatement = v; })} />
                      </div>
                    )}
                    {selectedProvince === 'ONT' && (
                      <div className="mt-3 pt-3 border-t border-neutral-200 max-w-sm space-y-2">
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
                        className="w-full px-1.5 py-1 text-xs border border-neutral-300 rounded"
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

          {section === 'engine' && (
            <div className="space-y-3 max-w-sm">
              <PercentField label="Cash cushion annual rate (%)" value={draft.engine.cashCushionRate}
                onChange={v => update(c => { c.engine.cashCushionRate = v; })} />
              <NumberField label="RRIF conversion age" value={draft.engine.rrifConversionAge}
                onChange={v => update(c => { c.engine.rrifConversionAge = v; })} />
              <PercentField label="Inflation rate / CPI (%)" value={draft.engine.inflationRate}
                onChange={v => update(c => { c.engine.inflationRate = v; })} />
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
        <div className="flex items-center justify-between py-3 border-t border-neutral-200 mt-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-neutral-100 rounded"
          >
            <RotateCcw size={13} /> Reset to defaults
          </button>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-600">{error}</span>}
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700"
            >
              <Save size={13} /> Save settings
            </button>
          </div>
        </div>
    </div>
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
        className="w-32 px-2 py-1 text-xs border border-neutral-300 rounded text-right"
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
        className="w-32 px-2 py-1 text-xs border border-neutral-300 rounded text-right"
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
          className="w-28 px-2 py-1 text-xs border border-neutral-300 rounded text-right"
        />
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 border-b border-neutral-200">
            <th className="py-1 font-medium">Bracket threshold</th>
            <th className="py-1 font-medium">Rate above threshold</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-100">
            <td className="py-1 text-slate-500">$0</td>
            <td>
              <input
                type="number" step="0.005" min="0" max="1"
                value={table.rates[0] ?? 0}
                onChange={e => setRate(0, parseFloat(e.target.value) || 0)}
                className="w-24 px-1.5 py-1 border border-neutral-300 rounded text-right"
              />
            </td>
            <td></td>
          </tr>
          {table.brackets.map((b, i) => (
            <tr key={i} className="border-b border-neutral-100">
              <td className="py-1">
                <input
                  type="number" step="1000" min="0"
                  value={b}
                  onChange={e => setBracket(i, parseFloat(e.target.value) || 0)}
                  className="w-28 px-1.5 py-1 border border-neutral-300 rounded text-right"
                />
              </td>
              <td>
                <input
                  type="number" step="0.005" min="0" max="1"
                  value={table.rates[i + 1] ?? 0}
                  onChange={e => setRate(i + 1, parseFloat(e.target.value) || 0)}
                  className="w-24 px-1.5 py-1 border border-neutral-300 rounded text-right"
                />
              </td>
              <td>
                <button onClick={() => removeRow(i)} className="p-1 text-neutral-400 hover:text-red-600" title="Remove bracket">
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={addRow}
        className="mt-2 flex items-center gap-1 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 rounded"
      >
        <Plus size={12} /> Add bracket
      </button>
    </div>
  );
}
