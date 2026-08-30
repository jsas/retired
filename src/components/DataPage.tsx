import { useMemo, useRef, useState } from 'react';
import {
  Check, ClipboardCopy, Download, FileJson, FileSpreadsheet, FileText, Upload, Database,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import {
  COLUMN_GROUPS, METADATA_SECTIONS, buildExport,
  type ProjectionExportOptions, type ExportFormat, type Subject, type ColumnGroup, type MetaSection,
} from '../lib/projectionExport';
import type { RetirementInputs, RetirementResults } from '../lib/retirementEngine';
import type { AppConfig } from '../lib/appConfig';
import type { Scenario } from '../lib/types';
import { migrateInputs } from '../data/migrations';
import type { AppDb } from '../lib/planTransfer';
import { AppDatabase } from '../data/db';
import { buildTemplateCsv, parseTemplateCsv, TEMPLATE_FILENAME } from '../lib/importTemplate';
import { AI_CHATS_STORAGE_KEY } from '../lib/ai/chatStore';
import { AI_SETTINGS_STORAGE_KEY } from '../lib/aiSettings';
import { PREF_KEYS } from '../lib/prefKv';

/** Read every UI-preference kv row (issue #20) out of a backup, parsed —
 *  undefined when the row is absent or unparseable. */
function readPrefPayloads(db: AppDatabase): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let any = false;
  for (const key of PREF_KEYS) {
    const raw = db.getKv(key);
    if (raw === null) continue;
    const parsed = safeJson(raw);
    if (parsed !== undefined) { out[key] = parsed; any = true; }
  }
  return any ? out : undefined;
}

/** Parse a raw kv value, tolerating corruption (returns undefined). */
function safeJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return undefined; }
}

// What the page hands back when the user confirms a full-backup import. The
// parent applies it (App owns all scenario/config state).
export interface FullBackupSelection {
  scenarios: Scenario[];
  activeScenarioId: string;
  config?: AppConfig; // undefined when "also apply engine settings" is off
  /** Opt-in AI data carried in the backup file; applied only when the user
   *  chose to include it. Undefined when the file had none / it was excluded. */
  aiChats?: unknown;
  aiSettings?: unknown;
  /** UI preferences carried in the backup (issue #20), keyed by their kv key;
   *  applied when the user ticks the checkbox. Undefined when the file had
   *  none. */
  prefs?: Record<string, unknown>;
}

// A projection JSON (our own export format) re-imported as a new scenario.
export interface ProjectionImportRequest {
  name: string;
  inputs: RetirementInputs;
}

interface DataPageProps {
  // Projection export (the active scenario's computed plan)
  exportOptions: ProjectionExportOptions;
  onExportOptionsChange: (opts: ProjectionExportOptions) => void;
  hasSpouse: boolean;
  scenarioName: string;
  inputs: RetirementInputs;
  results: RetirementResults;
  config: AppConfig;
  // Full-backup export + import
  scenarios: Scenario[];
  activeScenarioId: string;
  onExportFull: (scenarioIds: string[], includeConfig: boolean, ai: AiBackupInclude) => void;
  onImportFull: (sel: FullBackupSelection) => void;
  onImportProjection: (req: ProjectionImportRequest) => void;
}

/** Which AI data to fold into a full backup. Both off by default — chats and
 *  API keys stay on this device unless the user explicitly packs them. */
export interface AiBackupInclude {
  chats: boolean;
  settings: boolean;
}

const FORMATS: Array<{ key: ExportFormat; label: string; icon: typeof FileJson; hint: string }> = [
  { key: 'csv', label: 'CSV', icon: FileSpreadsheet, hint: 'Flat spreadsheet — one row per person per year, detail flattened into columns' },
  { key: 'json', label: 'JSON', icon: FileJson, hint: 'Nested rows with full per-year detail objects; re-importable as a scenario' },
  { key: 'yaml', label: 'YAML', icon: FileText, hint: 'Same as JSON, human-readable YAML' },
];

// Shared bits
const SECTION = 'text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5';

export function DataPage(props: DataPageProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Database size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Data</h2>
      </div>

      <div className="space-y-10">
        <ProjectionExportSection {...props} />
        <FullBackupSection {...props} />
        <ImportSection {...props} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1 · Projection export — the computed year-by-year numbers, with the FULL
//     file shown (copyable), an editable filename, and a download button.
// ---------------------------------------------------------------------------
function ProjectionExportSection({
  exportOptions: options, onExportOptionsChange: onChange, hasSpouse,
  scenarioName, inputs, results, config,
}: DataPageProps) {
  const set = (patch: Partial<ProjectionExportOptions>) => onChange({ ...options, ...patch });
  const toggleGroup = (g: ColumnGroup) =>
    set({ columnGroups: options.columnGroups.includes(g) ? options.columnGroups.filter(x => x !== g) : [...options.columnGroups, g] });
  const toggleMeta = (m: MetaSection) =>
    set({ metadataSections: options.metadataSections.includes(m) ? options.metadataSections.filter(x => x !== m) : [...options.metadataSections, m] });

  const isCsv = options.format === 'csv';
  const canExport = !isCsv || options.columnGroups.length > 0;

  // The exact payload the buttons act on.
  const payload = useMemo(
    () => buildExport(scenarioName, inputs, results, config, options),
    [scenarioName, inputs, results, config, options],
  );

  // Editable filename (without extension); a default derived from the scenario.
  const defaultBase = `retirement-projection-${scenarioName.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}`;
  const [baseName, setBaseName] = useState(defaultBase);
  const [nameTouched, setNameTouched] = useState(false);
  const fileBase = (nameTouched ? baseName : defaultBase) || defaultBase;

  const [copied, setCopied] = useState(false);
  // The full file preview is long; keep it folded until asked for so the
  // export/backup controls below stay within reach without scrolling.
  const [contentsOpen, setContentsOpen] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(payload.content).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => { /* clipboard blocked — the file text is selectable below */ },
    );
  };
  const download = () => {
    const blob = new Blob([payload.content], { type: payload.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileBase}.${payload.extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <div className={SECTION}>Export projection</div>
      <p className="text-[11px] text-slate-500 leading-snug mb-3">
        The computed year-by-year numbers for <span className="font-medium text-slate-700">{scenarioName}</span>,
        in the shape you choose below. JSON can be re-imported as a scenario further down this page.
      </p>

      <div className="space-y-4">
        {/* Format */}
        <div className="flex gap-2">
          {FORMATS.map(f => (
            <button
              key={f.key}
              onClick={() => set({ format: f.key })}
              title={f.hint}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border ${
                options.format === f.key ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <f.icon size={13} /> {f.label}
            </button>
          ))}
        </div>

        {/* Subject (JSON/YAML, household only) */}
        {!isCsv && hasSpouse && (
          <div className="flex gap-2">
            {([['household', 'Household (both)'], ['you', 'You only'], ['spouse', 'Spouse only']] as Array<[Subject, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => set({ subject: key })}
                className={`px-3 py-1.5 text-xs font-medium rounded border ${
                  options.subject === key ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* CSV columns */}
        {isCsv && (
          <div>
            <div className={SECTION}>Columns to include</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 max-w-3xl">
              {COLUMN_GROUPS.map(g => (
                <label key={g.key} className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer" title={g.hint}>
                  <input type="checkbox" checked={options.columnGroups.includes(g.key)} onChange={() => toggleGroup(g.key)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{g.label}</span>
                    <span className="block text-[10px] text-slate-400">{g.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* JSON/YAML options */}
        {!isCsv && (
          <div className="space-y-2.5">
            <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input type="checkbox" checked={options.includeDetail} onChange={e => set({ includeDetail: e.target.checked })} className="mt-0.5" />
              <span>
                <span className="font-medium">Include per-year drill-down detail</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">Withdrawal sources, per-account growth, tax decomposition, reverse mortgage and events on every year.</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input type="checkbox" checked={options.includeMetadata} onChange={e => set({ includeMetadata: e.target.checked })} className="mt-0.5" />
              <span>
                <span className="font-medium">Include metadata envelope</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">Scenario name, generation date and the sections below, next to the projection.</span>
              </span>
            </label>
            {options.includeMetadata && (
              <div className="ml-6 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                {METADATA_SECTIONS.map(m => (
                  <label key={m.key} className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer" title={m.hint}>
                    <input type="checkbox" checked={options.metadataSections.includes(m.key)} onChange={() => toggleMeta(m.key)} className="mt-0.5" />
                    <span>
                      <span className="font-medium">{m.label}</span>
                      <span className="block text-[10px] text-slate-400">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* The FULL file, copyable — this is exactly what download writes.
            Collapsed by default: it's long, and the export controls below are
            the part the user usually wants. */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <button
              onClick={() => setContentsOpen(o => !o)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-800"
              title={contentsOpen ? 'Hide the file preview' : 'Show the file preview'}
            >
              {contentsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              File contents
              {!contentsOpen && (
                <span className="normal-case font-normal text-slate-400">
                  ({payload.content.split('\n').length.toLocaleString()} lines)
                </span>
              )}
            </button>
            <button onClick={copy} className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 hover:underline">
              {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
              {copied ? 'Copied' : 'Copy to clipboard'}
            </button>
          </div>
          {contentsOpen && (
            <pre className="max-h-[28rem] overflow-auto rounded border border-slate-200 bg-slate-50 p-3 text-[10px] leading-relaxed text-slate-700 font-mono whitespace-pre">{payload.content}</pre>
          )}
        </div>

        {/* Filename + actions */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
          <label className="text-[11px] text-slate-500" htmlFor="export-filename">Filename</label>
          <input
            id="export-filename"
            value={fileBase}
            onChange={(e) => { setBaseName(e.target.value); setNameTouched(true); }}
            className="w-72 max-w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-700 focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-slate-400">.{payload.extension}</span>
          <div className="flex-1" />
          <button
            onClick={copy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            {copied ? <Check size={13} /> : <ClipboardCopy size={13} />} Copy
          </button>
          <button
            onClick={download}
            disabled={!canExport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title={canExport ? `Download ${fileBase}.${payload.extension}` : 'Pick at least one column group'}
          >
            <Download size={13} /> Save
          </button>
        </div>
        {isCsv && options.columnGroups.length === 0 && (
          <p className="text-[11px] text-slate-500">Select at least one column group.</p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2 · Full backup — every scenario (choose which) + engine settings, as JSON.
// ---------------------------------------------------------------------------
function FullBackupSection({ scenarios, activeScenarioId, onExportFull }: DataPageProps) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(scenarios.map(s => s.id)));
  const [includeConfig, setIncludeConfig] = useState(true);
  const [includeChats, setIncludeChats] = useState(false);
  const [includeAiSettings, setIncludeAiSettings] = useState(false);

  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section>
      <div className={SECTION}>Export full backup</div>
      <p className="text-[11px] text-slate-500 leading-snug mb-3">
        The raw scenario inputs (not computed numbers) — for moving your plans to another machine or
        keeping a snapshot. Downloads a real <span className="font-medium text-slate-700">SQLite database
        file</span> (.sqlite): the same format the app stores locally, openable by any SQLite tool. Choose
        which scenarios to include; the active one is pre-selected.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 max-w-3xl mb-3">
        {scenarios.map(s => (
          <label key={s.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} />
            <span className="font-medium truncate">{s.name}</span>
            {s.id === activeScenarioId && <span className="text-[10px] text-blue-600">active</span>}
          </label>
        ))}
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer sm:col-span-2 mt-1 pt-2 border-t border-slate-100">
          <input type="checkbox" checked={includeConfig} onChange={e => setIncludeConfig(e.target.checked)} />
          <span><span className="font-medium">Include engine settings</span>
          <span className="block text-[10px] text-slate-400">Inflation, RRIF conversion age, tax tables and other engine config</span></span>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer sm:col-span-2">
          <input type="checkbox" checked={includeChats} onChange={e => setIncludeChats(e.target.checked)} />
          <span><span className="font-medium">Include AI chats</span>
          <span className="block text-[10px] text-slate-400">The assistant conversation transcripts saved on this device</span></span>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer sm:col-span-2">
          <input type="checkbox" checked={includeAiSettings} onChange={e => setIncludeAiSettings(e.target.checked)} />
          <span><span className="font-medium">Include AI connections &amp; model settings</span>
          <span className="block text-[10px] text-amber-600">Includes any API keys stored for cloud providers — pack this only into a backup you keep private</span></span>
        </label>
      </div>
      <button
        onClick={() => onExportFull([...checked], includeConfig, { chats: includeChats, settings: includeAiSettings })}
        disabled={checked.size === 0 && !includeConfig && !includeChats && !includeAiSettings}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download size={13} /> Save backup
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3 · Import — a full backup (choose what to apply) or a projection JSON.
// ---------------------------------------------------------------------------
type ParsedFile =
  | { kind: 'backup'; db: AppDb; aiChats?: unknown; aiSettings?: unknown; prefs?: Record<string, unknown> }
  | { kind: 'partial'; config?: AppConfig; aiChats?: unknown; aiSettings?: unknown; prefs?: Record<string, unknown> }
  | { kind: 'projection'; name: string; inputs: RetirementInputs };

function ImportSection({ onImportFull, onImportProjection }: DataPageProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');

  // Backup choices
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [includeConfig, setIncludeConfig] = useState(true);
  // AI data packed in the file (checked by default when present)
  const [applyChats, setApplyChats] = useState(false);
  const [applyAiSettings, setApplyAiSettings] = useState(false);
  // UI preferences packed in the file (issue #20; checked by default when present)
  const [applyPrefs, setApplyPrefs] = useState(false);
  // Projection choice
  const [projName, setProjName] = useState('');

  const reset = () => { setParsed(null); setError(null); setFileName(''); if (fileRef.current) fileRef.current.value = ''; };

  const readFile = (file: File) => {
    setFileName(file.name);
    setError(null);
    // CSV import template: flat key,value rows a spreadsheet user filled in.
    if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
      file.text().then(text => {
        try {
          const { name, inputs, warnings } = parseTemplateCsv(text);
          setParsed({ kind: 'projection', name, inputs });
          setProjName(name);
          if (warnings.length > 0) setError(`Imported with notes: ${warnings.join(' ')}`);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'That CSV could not be read.');
          setParsed(null);
        }
      });
      return;
    }
    // SQLite backup (the format "save a backup to disk" writes now): open the
    // bytes with sql.js and read the store back out.
    if (/\.sqlite3?$/.test(file.name) || file.type === 'application/vnd.sqlite3') {
      file.arrayBuffer().then(async buf => {
        try {
          const db = await AppDatabase.open(new Uint8Array(buf));
          const doc = db.toDoc();
          // AI data rides in the kv table when the backup was made with it;
          // read the raw values (validated on apply) before closing.
          const aiChatsRaw = db.getKv(AI_CHATS_STORAGE_KEY);
          const aiSettingsRaw = db.getKv(AI_SETTINGS_STORAGE_KEY);
          const prefs = readPrefPayloads(db);
          if (!doc) {
            // No scenarios — but a backup that lost its scenarios (e.g. saved
            // after the store was wiped by a crash/quota eviction) can still
            // carry engine settings and AI data worth recovering.
            const salvage = db.salvageableContents();
            db.close();
            if (salvage?.kind === 'config') {
              setParsed({
                kind: 'partial',
                config: salvage.config,
                aiChats: aiChatsRaw ? safeJson(aiChatsRaw) : undefined,
                aiSettings: aiSettingsRaw ? safeJson(aiSettingsRaw) : undefined,
                prefs,
              });
              setIncludeConfig(true);
              setApplyChats(aiChatsRaw !== null);
              setApplyAiSettings(aiSettingsRaw !== null);
              setApplyPrefs(prefs !== undefined);
            } else if (salvage?.kind === 'ai-only') {
              setParsed({
                kind: 'partial',
                aiChats: aiChatsRaw ? safeJson(aiChatsRaw) : undefined,
                aiSettings: aiSettingsRaw ? safeJson(aiSettingsRaw) : undefined,
                prefs,
              });
              setIncludeConfig(false);
              setApplyChats(aiChatsRaw !== null);
              setApplyAiSettings(aiSettingsRaw !== null);
              setApplyPrefs(prefs !== undefined);
            } else {
              setError('That SQLite file is not a RE: tired backup.');
              setParsed(null);
            }
            return;
          }
          db.close();
          const aiChats = aiChatsRaw ? safeJson(aiChatsRaw) : undefined;
          const aiSettings = aiSettingsRaw ? safeJson(aiSettingsRaw) : undefined;
          // A backup whose config blob is absent/unreadable still imports its
          // scenarios — the doc carries defaults + a warning (issue D-07).
          if (doc.configWarning) setError(doc.configWarning);
          setParsed({
            kind: 'backup',
            db: {
              version: doc.version,
              exportedAt: '',
              scenarios: doc.scenarios,
              activeScenarioId: doc.activeScenarioId,
              config: doc.config,
            },
            aiChats,
            aiSettings,
            prefs,
          });
          setChecked(new Set(doc.scenarios.map(s => s.id)));
          setIncludeConfig(true);
          setApplyChats(aiChats !== undefined);
          setApplyAiSettings(aiSettings !== undefined);
          setApplyPrefs(prefs !== undefined);
        } catch {
          setError('That file could not be opened as a SQLite database.');
          setParsed(null);
        }
      });
      return;
    }
    file.text().then(text => {
      let obj: unknown;
      try { obj = JSON.parse(text); } catch { setError('That file is not valid JSON.'); setParsed(null); return; }
      if (!obj || typeof obj !== 'object') { setError('That JSON is not a RE: tired file.'); setParsed(null); return; }
      const rec = obj as Record<string, unknown>;

      // Full backup: has a scenarios array. Migrate each scenario's inputs so
      // older backups (legacy pensions[]/employment[]) fold into the income[]
      // register rather than reaching the engine in a stale shape.
      if (Array.isArray(rec.scenarios)) {
        const scenarios = (rec.scenarios as Scenario[])
          .filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && s.inputs)
          .map(s => ({ ...s, inputs: migrateInputs(s.inputs as unknown as Record<string, unknown>) }));
        if (scenarios.length === 0) { setError('That backup has no usable scenarios.'); setParsed(null); return; }
        const db = rec as unknown as AppDb;
        const activeId = scenarios.some(s => s.id === db.activeScenarioId) ? db.activeScenarioId : scenarios[0].id;
        setParsed({ kind: 'backup', db: { ...db, scenarios, activeScenarioId: activeId } });
        setChecked(new Set(scenarios.map(s => s.id)));
        setIncludeConfig(!!rec.config);
        return;
      }

      // Projection export: has metadata.profile (the inputs we embed). We
      // rebuild inputs from profile + options (options carries withdrawal
      // order, spending bands, pensions, events, reverse mortgage), then
      // migrate so anything older fills forward.
      const meta = rec.metadata as Record<string, unknown> | undefined;
      const profile = meta?.profile as Record<string, unknown> | undefined;
      if (profile && typeof profile.currentAge === 'number') {
        const opts = (meta?.options ?? {}) as Record<string, unknown>;
        const inputs = migrateInputs(profileToInputs(profile, opts) as unknown as Record<string, unknown>);
        const name = typeof meta?.scenario === 'string' && meta.scenario.trim() ? meta.scenario.trim() : 'Imported projection';
        setParsed({ kind: 'projection', name, inputs });
        setProjName(name);
        return;
      }

      setError('That JSON is neither a full backup nor a projection export from this app.');
      setParsed(null);
    });
  };

  // Rebuild a RetirementInputs from a projection export's metadata.profile +
  // metadata.options. Balances/benefits come from profile; strategy options
  // (withdrawal order, spending bands, pensions, events, reverse mortgage)
  // come from options so the imported scenario behaves like the exported one.
  const profileToInputs = (p: Record<string, unknown>, opts: Record<string, unknown>): RetirementInputs => {
    const bal = (p.balances ?? {}) as Record<string, number>;
    const cpp = (p.cpp ?? {}) as Record<string, number>;
    const oas = (p.oas ?? {}) as Record<string, number>;
    const sp = p.spouse as Record<string, unknown> | undefined;
    const spBal = (sp?.balances ?? {}) as Record<string, number>;
    const spCpp = (sp?.cpp ?? {}) as Record<string, number>;
    const spOas = (sp?.oas ?? {}) as Record<string, number>;
    return {
      currentAge: p.currentAge as number,
      retirementAge: (p.retirementAge as number) ?? 65,
      maxAge: (p.maxAge as number) ?? 95,
      provinceCode: (p.provinceCode as string) ?? 'ONT',
      desiredSpending: (p.desiredSpending as number) ?? 60000,
      investmentReturn: (p.investmentReturn as number) ?? 0.05,
      returnVolatility: (p.returnVolatility as number) ?? 0.15,
      rrspBalance: bal.rrsp ?? 0, tfsaBalance: bal.tfsa ?? 0,
      taxableBalance: bal.taxable ?? 0, cashCushionBalance: bal.cashCushion ?? 0,
      cppStartAge: cpp.startAge ?? 65, cppMonthlyAmount: cpp.monthlyAmount ?? 0,
      oasStartAge: oas.startAge ?? 65, oasYearsInCanada: oas.yearsInCanada ?? 40,
      withdrawalOrder: (opts.withdrawalOrder as RetirementInputs['withdrawalOrder']) ?? ['taxable', 'rrsp', 'tfsa'],
      ...(opts.spendingBands ? { spendingBands: opts.spendingBands } : {}),
      // The income register travels whole. (A legacy export that embedded a
      // `pensions` option instead has no income field here; such old exports
      // predate the register and lose their pension option on import — accepted
      // per the no-legacy cutover.)
      ...(opts.income ? { income: opts.income } : {}),
      ...(opts.events ? { events: opts.events } : {}),
      ...(opts.reverseMortgage ? { reverseMortgage: opts.reverseMortgage } : {}),
      ...(sp ? {
        spouse: {
          enabled: true,
          currentAge: (sp.currentAge as number) ?? 65,
          retirementAge: (sp.retirementAge as number) ?? 65,
          desiredSpending: (sp.desiredSpending as number) ?? 0,
          rrspBalance: spBal.rrsp ?? 0, tfsaBalance: spBal.tfsa ?? 0,
          taxableBalance: spBal.taxable ?? 0, cashCushionBalance: spBal.cashCushion ?? 0,
          cppStartAge: spCpp.startAge ?? 65, cppMonthlyAmount: spCpp.monthlyAmount ?? 0,
          oasStartAge: spOas.startAge ?? 65, oasYearsInCanada: spOas.yearsInCanada ?? 40,
          withdrawalOrder: (opts.withdrawalOrder as RetirementInputs['withdrawalOrder']) ?? ['taxable', 'rrsp', 'tfsa'],
        },
      } : {}),
    } as RetirementInputs;
  };

  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const confirmBackup = () => {
    if (parsed?.kind !== 'backup') return;
    const chosen = parsed.db.scenarios.filter(s => checked.has(s.id));
    if (chosen.length === 0 && !includeConfig) return;
    const activeId = chosen.some(s => s.id === parsed.db.activeScenarioId) ? parsed.db.activeScenarioId : (chosen[0]?.id ?? parsed.db.activeScenarioId);
    onImportFull({
      scenarios: chosen,
      activeScenarioId: activeId,
      config: includeConfig ? parsed.db.config : undefined,
      aiChats: applyChats ? parsed.aiChats : undefined,
      aiSettings: applyAiSettings ? parsed.aiSettings : undefined,
      prefs: applyPrefs ? parsed.prefs : undefined,
    });
    reset();
  };

  const confirmProjection = () => {
    if (parsed?.kind !== 'projection') return;
    onImportProjection({ name: projName.trim() || parsed.name, inputs: parsed.inputs });
    reset();
  };

  // Partial backup: no scenarios survived in the file, so the current scenario
  // list must not be touched — only the config and/or AI payloads the user
  // ticks get applied. handleImportFull already treats an empty scenarios
  // array as "keep the current list", so reuse the same import channel rather
  // than a special-case apply. The user-facing copy below is what promises the
  // no-touch; that contract lives on the applier.
  const confirmPartial = () => {
    if (parsed?.kind !== 'partial') return;
    onImportFull({
      scenarios: [],
      activeScenarioId: '',
      config: includeConfig && parsed.config ? parsed.config : undefined,
      aiChats: applyChats ? parsed.aiChats : undefined,
      aiSettings: applyAiSettings ? parsed.aiSettings : undefined,
      prefs: applyPrefs ? parsed.prefs : undefined,
    });
    reset();
  };

  return (
    <section>
      <div className={SECTION}>Import</div>
      <p className="text-[11px] text-slate-500 leading-snug mb-3">
        Load a file from this app — a <span className="font-medium text-slate-700">SQLite backup</span> (.sqlite, or a
        legacy JSON backup) with scenarios + settings, or a <span className="font-medium text-slate-700">projection
        JSON</span> (re-imported as a scenario). You choose what gets applied before anything changes.
      </p>
      <p className="text-[11px] text-slate-500 leading-snug mb-3">
        Bringing numbers in from a spreadsheet? Download the{' '}
        <button
          onClick={() => {
            const blob = new Blob([buildTemplateCsv()], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = TEMPLATE_FILENAME;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="text-blue-600 hover:underline font-medium"
        >
          CSV import template
        </button>
        , fill in the value column (blank = default; leave all <code className="text-[10px]">spouse.*</code> rows
        blank for a single plan), then choose the file below — it imports as a new scenario.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          <Upload size={13} /> Choose file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json,.sqlite,.sqlite3,application/vnd.sqlite3,.csv,text/csv"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); }}
        />
        {fileName && <span className="text-[11px] text-slate-500">{fileName}</span>}
      </div>

      {error && <p className="text-[11px] text-rose-600 mb-3">{error}</p>}

      {/* Backup preview + chooser */}
      {parsed?.kind === 'backup' && (
        <div className="rounded border border-slate-200 bg-white p-3 max-w-3xl">
          <div className="text-xs font-semibold text-slate-800 mb-2">
            Full backup — {parsed.db.scenarios.length} scenario{parsed.db.scenarios.length === 1 ? '' : 's'}
            {parsed.db.exportedAt ? ` · exported ${parsed.db.exportedAt.split('T')[0]}` : ''}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mb-3">
            {parsed.db.scenarios.map(s => (
              <label key={s.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} />
                <span className="truncate">{s.name}</span>
                {s.id === parsed.db.activeScenarioId && <span className="text-[10px] text-blue-600">active</span>}
              </label>
            ))}
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer sm:col-span-2 mt-1 pt-2 border-t border-slate-100">
              <input type="checkbox" checked={includeConfig} onChange={e => setIncludeConfig(e.target.checked)} />
              <span className="font-medium">Also apply engine settings from the file</span>
            </label>
            {parsed.aiChats !== undefined && (
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer sm:col-span-2">
                <input type="checkbox" checked={applyChats} onChange={e => setApplyChats(e.target.checked)} />
                <span className="font-medium">Replace AI chats with the ones in the file</span>
              </label>
            )}
            {parsed.aiSettings !== undefined && (
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer sm:col-span-2">
                <input type="checkbox" checked={applyAiSettings} onChange={e => setApplyAiSettings(e.target.checked)} />
                <span>
                  <span className="font-medium">Replace AI connections &amp; model settings with the file's</span>
                  <span className="block text-[10px] text-amber-600">This brings in the API keys saved in that backup</span>
                </span>
              </label>
            )}
            {parsed.prefs !== undefined && (
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer sm:col-span-2">
                <input type="checkbox" checked={applyPrefs} onChange={e => setApplyPrefs(e.target.checked)} />
                <span>
                  <span className="font-medium">Also apply UI preferences from the file</span>
                  <span className="block text-[10px] text-slate-400">Panel layout, print &amp; export options, welcome setting, steering crops</span>
                </span>
              </label>
            )}
          </div>
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 mb-3">
            Importing <span className="font-medium">replaces</span> your current scenarios{includeConfig ? ' and settings' : ''} with the ones selected above.
          </p>
          <div className="flex gap-2">
            <button
              onClick={confirmBackup}
              disabled={checked.size === 0 && !includeConfig}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check size={13} /> Apply import
            </button>
            <button onClick={reset} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
          </div>
        </div>
      )}

      {/* Partial backup — no scenarios survived, settings/AI data did */}
      {parsed?.kind === 'partial' && (
        <div className="rounded border border-slate-200 bg-white p-3 max-w-3xl">
          <div className="text-xs font-semibold text-slate-800 mb-2">Partial backup — no scenarios inside</div>
          <p className="text-[11px] text-slate-500 leading-snug mb-3">
            This backup's scenario list is empty (it was likely saved after the browser cleared the app's stored
            plans — recovery tip: if an AI chat in this file discussed your numbers, its plan checkpoints may still
            hold them). What's left can still be restored:
          </p>
          <div className="grid grid-cols-1 gap-y-1.5 mb-3">
            {parsed.config !== undefined && (
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={includeConfig} onChange={e => setIncludeConfig(e.target.checked)} />
                <span className="font-medium">Apply engine settings from the file</span>
              </label>
            )}
            {parsed.aiChats !== undefined && (
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={applyChats} onChange={e => setApplyChats(e.target.checked)} />
                <span className="font-medium">Replace AI chats with the ones in the file</span>
              </label>
            )}
            {parsed.aiSettings !== undefined && (
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={applyAiSettings} onChange={e => setApplyAiSettings(e.target.checked)} />
                <span>
                  <span className="font-medium">Replace AI connections &amp; model settings with the file's</span>
                  <span className="block text-[10px] text-amber-600">This brings in the API keys saved in that backup</span>
                </span>
              </label>
            )}
          </div>
          <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 mb-3">
            Your current scenarios are <span className="font-medium">not touched</span> — only what you tick above is applied.
          </p>
          <div className="flex gap-2">
            <button
              onClick={confirmPartial}
              disabled={(!includeConfig || parsed.config === undefined) && !applyChats && !applyAiSettings}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check size={13} /> Apply import
            </button>
            <button onClick={reset} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
          </div>
        </div>
      )}

      {/* Projection preview + name */}
      {parsed?.kind === 'projection' && (
        <div className="rounded border border-slate-200 bg-white p-3 max-w-3xl">
          <div className="text-xs font-semibold text-slate-800 mb-1">Projection export — imports as a new scenario</div>
          <p className="text-[11px] text-slate-500 mb-3">
            Age {parsed.inputs.currentAge} → retire {parsed.inputs.retirementAge} · {parsed.inputs.provinceCode} ·
            spending ${parsed.inputs.desiredSpending?.toLocaleString() ?? '—'}/yr{parsed.inputs.spouse?.enabled ? ' · with spouse' : ''}
          </p>
          <div className="flex items-center gap-2">
            <input
              value={projName}
              onChange={e => setProjName(e.target.value)}
              placeholder="Name for the new scenario"
              className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-700 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={confirmProjection}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 shrink-0"
            >
              <Check size={13} /> Import scenario
            </button>
            <button onClick={reset} className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
