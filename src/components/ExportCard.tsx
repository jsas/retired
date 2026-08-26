import { useMemo } from 'react';
import { Download, FileSpreadsheet, FileJson, FileText } from 'lucide-react';
import {
  COLUMN_GROUPS, METADATA_SECTIONS, buildExport,
  type ProjectionExportOptions, type ExportFormat, type Subject, type ColumnGroup, type MetaSection,
} from '../lib/projectionExport';
import type { RetirementInputs, RetirementResults } from '../lib/retirementEngine';
import type { AppConfig } from '../lib/appConfig';

interface ExportCardProps {
  options: ProjectionExportOptions;
  onChange: (opts: ProjectionExportOptions) => void;
  onExport: () => void;
  hasSpouse: boolean;
  /** Plan data for the live preview pane. */
  scenarioName: string;
  inputs: RetirementInputs;
  results: RetirementResults;
  config: AppConfig;
}

const FORMATS: Array<{ key: ExportFormat; label: string; icon: typeof FileJson; hint: string }> = [
  { key: 'csv', label: 'CSV', icon: FileSpreadsheet, hint: 'Flat spreadsheet — one row per person per year, detail flattened into columns' },
  { key: 'json', label: 'JSON', icon: FileJson, hint: 'Nested rows with full per-year detail objects' },
  { key: 'yaml', label: 'YAML', icon: FileText, hint: 'Same as JSON, human-readable YAML' },
];

// Export page for the year-by-year projection, with a live preview of the
// payload. Toggles are persisted by the caller via saveProjectionExportOptions.
export function ExportCard({ options, onChange, onExport, hasSpouse, scenarioName, inputs, results, config }: ExportCardProps) {
  const set = (patch: Partial<ProjectionExportOptions>) => onChange({ ...options, ...patch });
  const toggleGroup = (g: ColumnGroup) =>
    set({
      columnGroups: options.columnGroups.includes(g)
        ? options.columnGroups.filter(x => x !== g)
        : [...options.columnGroups, g],
    });
  const toggleMeta = (m: MetaSection) =>
    set({
      metadataSections: options.metadataSections.includes(m)
        ? options.metadataSections.filter(x => x !== m)
        : [...options.metadataSections, m],
    });

  const isCsv = options.format === 'csv';
  const canExport = !isCsv || options.columnGroups.length > 0;

  // Live preview of the exact payload that will be downloaded.
  const preview = useMemo(
    () => buildExport(scenarioName, inputs, results, config, options).content,
    [scenarioName, inputs, results, config, options],
  );
  const previewLines = preview.split('\n');
  const previewShown = previewLines.slice(0, 200).join('\n');
  const truncated = previewLines.length > 200;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-3">
        <Download size={18} className="text-blue-600" />
        <h2 className="text-lg font-bold text-slate-900">Export projection</h2>
      </div>

      <div className="space-y-4">
        {/* Format */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Format</div>
          <div className="flex gap-2">
            {FORMATS.map(f => (
              <button
                key={f.key}
                onClick={() => set({ format: f.key })}
                title={f.hint}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border ${
                  options.format === f.key
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <f.icon size={13} /> {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Subject (JSON/YAML, household only) */}
        {!isCsv && hasSpouse && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Subject</div>
            <div className="flex gap-2">
              {([['household', 'Household (both)'], ['you', 'You only'], ['spouse', 'Spouse only']] as Array<[Subject, string]>).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => set({ subject: key })}
                  className={`px-3 py-1.5 text-xs font-medium rounded border ${
                    options.subject === key
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* CSV columns */}
        {isCsv && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Columns to include
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 max-w-2xl">
              {COLUMN_GROUPS.map(g => (
                <label key={g.key} className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer" title={g.hint}>
                  <input
                    type="checkbox"
                    checked={options.columnGroups.includes(g.key)}
                    onChange={() => toggleGroup(g.key)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{g.label}</span>
                    <span className="block text-[10px] text-slate-400">{g.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-2">
              One row per person per year ({hasSpouse ? '"you" and "spouse"' : '"you"'}), with a calendarYear
              column to align both people. Withdrawal-source, growth and event columns come from each year's
              drill-down detail.
            </p>
          </div>
        )}

        {/* JSON/YAML options */}
        {!isCsv && (
          <div className="space-y-2.5">
            <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeDetail}
                onChange={e => set({ includeDetail: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Include per-year drill-down detail</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  Withdrawal sources, per-account growth, tax decomposition, reverse mortgage and events
                  on every year.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeMetadata}
                onChange={e => set({ includeMetadata: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Include metadata envelope</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">
                  Scenario name, generation date and the sections below, next to the projection.
                </span>
              </span>
            </label>

            {options.includeMetadata && (
              <div className="ml-6 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                {METADATA_SECTIONS.map(m => (
                  <label key={m.key} className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer" title={m.hint}>
                    <input
                      type="checkbox"
                      checked={options.metadataSections.includes(m.key)}
                      onChange={() => toggleMeta(m.key)}
                      className="mt-0.5"
                    />
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

        {/* Preview pane — the exact payload that will be downloaded. */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
            Preview
          </div>
          <pre className="max-h-72 overflow-auto rounded border border-slate-200 bg-slate-50 p-3 text-[10px] leading-relaxed text-slate-700 font-mono whitespace-pre">
            {previewShown}
            {truncated && `\n… (${previewLines.length - 200} more lines)`}
          </pre>
        </div>

        <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
          <button
            onClick={onExport}
            disabled={!canExport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title={canExport ? `Download the projection as ${options.format.toUpperCase()}` : 'Pick at least one column group'}
          >
            <Download size={13} /> Export {options.format.toUpperCase()}
          </button>
          {isCsv && options.columnGroups.length === 0 && (
            <span className="text-[11px] text-slate-500">Select at least one column group.</span>
          )}
        </div>
      </div>
    </div>
  );
}
