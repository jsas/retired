import { useState, useMemo, useEffect, useRef } from 'react';
import { FileSpreadsheet, Share2, Printer, Sparkles } from 'lucide-react';
import { TopHeader } from './components/TopHeader';
import { SidebarForm } from './components/SidebarForm';
import { MetricCards } from './components/MetricCards';
import { ScheduleTable } from './components/ScheduleTable';
import { ScenarioManager, type ScenarioManagerHandle } from './components/ScenarioManager';
import { calculateRetirement, type RetirementInputs } from './lib/retirementEngine';
import { loadScenarioState, saveScenarioState, type Scenario } from './lib/scenarioStorage';
import { loadAppConfig, saveAppConfig, type AppConfig } from './lib/appConfig';
import { exportAppDb, parseAppDb, persistAppDb } from './lib/appDb';
import { SettingsModal } from './components/SettingsModal';
import { HelpModal } from './components/HelpModal';
import { MonteCarloChart } from './components/MonteCarloChart';
import { TimelineChart } from './components/TimelineChart';
import { BacktestPanel } from './components/BacktestPanel';
import { CollapsiblePanel } from './components/CollapsiblePanel';
import { ShareCard } from './components/ShareCard';
import { OptimizeCard } from './components/OptimizeCard';
import { WelcomeCard, isWelcomeDismissed } from './components/WelcomeCard';
import { PrintOptionsCard } from './components/PrintOptionsCard';
import { DonateCard } from './components/DonateCard';
import { loadPrintOptions, savePrintOptions, type PrintOptions } from './lib/printOptions';
import type { MonteCarloResults } from './lib/monteCarlo';
import { runBacktest, type BacktestResult } from './lib/historicalReturns';

type View = 'projection' | 'settings' | 'help';
import { buildShareUrl, consumePlanFromHash } from './lib/shareLink';
import { PrintSummary } from './components/PrintSummary';
import type { MonteCarloRequest } from './lib/monteCarlo';

// First-run scenarios: three realistic, mutually distinct starting points that
// each exercise different engine features (spouse plans, spending bands,
// one-time events, CPP deferral). Only used when localStorage is empty.
const buildDefaultScenarios = (): Scenario[] => [
  {
    id: 'scenario-1',
    name: 'Early retirement — couple',
    inputs: {
      currentAge: 45,
      retirementAge: 55,
      maxAge: 95,
      rrspBalance: 320000,
      tfsaBalance: 140000,
      taxableBalance: 90000,
      cashCushionBalance: 30000,
      rrspContribution: 24000,
      tfsaContribution: 14000,
      taxableContribution: 6000,
      annualWithdrawal: 70000,
      investmentReturn: 0.06,
      returnVolatility: 0.15,
      provinceCode: 'ONT',
      cppStartAge: 65,
      cppMonthlyAmount: 1000,
      cppAdjustedAmount: false,
      oasStartAge: 65,
      oasYearsInCanada: 40,
      desiredSpending: 70000,
      successFactor: 1.0,
      withdrawalOrder: ['taxable', 'rrsp', 'tfsa'],
      spendingBands: [
        { fromAge: 75, pctOfBase: 0.85 },
        { fromAge: 85, pctOfBase: 0.7 },
      ],
      spouse: {
        enabled: true,
        currentAge: 43,
        retirementAge: 55,
        rrspBalance: 240000,
        tfsaBalance: 110000,
        taxableBalance: 40000,
        cashCushionBalance: 20000,
        rrspContribution: 18000,
        tfsaContribution: 7000,
        taxableContribution: 0,
        cppStartAge: 65,
        cppMonthlyAmount: 850,
        oasStartAge: 65,
        oasYearsInCanada: 40,
        desiredSpending: 30000,
        withdrawalOrder: ['taxable', 'rrsp', 'tfsa'],
      },
    },
  },
  {
    id: 'scenario-2',
    name: 'Retire at 60 — single',
    inputs: {
      currentAge: 55,
      retirementAge: 60,
      maxAge: 95,
      rrspBalance: 600000,
      tfsaBalance: 120000,
      taxableBalance: 80000,
      cashCushionBalance: 40000,
      rrspContribution: 20000,
      tfsaContribution: 7000,
      taxableContribution: 0,
      annualWithdrawal: 52000,
      investmentReturn: 0.05,
      returnVolatility: 0.12,
      provinceCode: 'BC',
      cppStartAge: 70,
      cppMonthlyAmount: 1250,
      cppAdjustedAmount: false,
      oasStartAge: 65,
      oasYearsInCanada: 40,
      desiredSpending: 52000,
      successFactor: 1.0,
      withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
      events: [
        { id: 'evt-downsize', age: 68, label: 'Downsize home', amount: 250000, direction: 'in', account: 'taxable' },
        { id: 'evt-car', age: 63, label: 'Replace car', amount: 35000, direction: 'out' },
      ],
    },
  },
  {
    id: 'scenario-3',
    name: 'Semi-retirement glide path',
    inputs: {
      currentAge: 52,
      retirementAge: 60,
      maxAge: 90,
      rrspBalance: 260000,
      tfsaBalance: 110000,
      taxableBalance: 40000,
      cashCushionBalance: 15000,
      rrspContribution: 14000,
      tfsaContribution: 7000,
      taxableContribution: 2000,
      annualWithdrawal: 36000,
      investmentReturn: 0.045,
      returnVolatility: 0.10,
      provinceCode: 'ONT',
      cppStartAge: 65,
      cppMonthlyAmount: 900,
      cppAdjustedAmount: false,
      oasStartAge: 65,
      oasYearsInCanada: 35,
      desiredSpending: 36000,
      successFactor: 0.9,
      withdrawalOrder: ['taxable', 'tfsa', 'rrsp'],
      spendingBands: [
        { fromAge: 70, pctOfBase: 0.9 },
        { fromAge: 80, pctOfBase: 0.75 },
      ],
    },
  },
];

const getInitialState = () => {
  const stored = loadScenarioState();
  if (stored) {
    return { scenarios: stored.scenarios, activeScenarioId: stored.activeScenarioId };
  }
  const scenarios = buildDefaultScenarios();
  return { scenarios, activeScenarioId: scenarios[0].id };
};

function App() {
  const [initialState] = useState(getInitialState);

  const [scenarios, setScenarios] = useState<Scenario[]>(initialState.scenarios);
  const [activeScenarioId, setActiveScenarioId] = useState<string>(initialState.activeScenarioId);
  const [config, setConfig] = useState<AppConfig>(loadAppConfig);
  const [view, setView] = useState<View>('projection');
  const [mcRequest, setMcRequest] = useState<MonteCarloRequest | null>(null);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const mcPanelRef = useRef<HTMLDivElement>(null);

  // Bring the Monte Carlo panel into view when a new run starts — it mounts
  // below the fold, so without this the run looks like it went nowhere.
  useEffect(() => {
    if (mcRequest) {
      mcPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [mcRequest]);
  const [showShare, setShowShare] = useState(false);
  const [showOptimize, setShowOptimize] = useState(false);
  // Welcome card: visible until dismissed, or always when the General settings
  // toggle asks for it on every load.
  const [showWelcome, setShowWelcome] = useState(
    () => loadAppConfig().general.showWelcomeOnLoad || !isWelcomeDismissed()
  );
  // Print options card visibility (options state itself lives below `inputs`).
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const [showDonate, setShowDonate] = useState(false);
  const scenarioManagerRef = useRef<ScenarioManagerHandle>(null);
  const activeScenario = scenarios.find(s => s.id === activeScenarioId)!;

  const [inputs, setInputs] = useState<RetirementInputs>(
    () => JSON.parse(JSON.stringify(activeScenario.inputs))
  );

  // Print summary options + the Monte Carlo run used only by the printed fan
  // chart (separate from the on-screen MonteCarloChart request, so printing
  // never touches that panel).
  const [printOptions, setPrintOptions] = useState<PrintOptions>(loadPrintOptions);
  const [printMc, setPrintMc] = useState<MonteCarloResults | null>(null);
  const [printMcPending, setPrintMcPending] = useState(false);

  const updatePrintOptions = (opts: PrintOptions) => {
    setPrintOptions(opts);
    savePrintOptions(opts);
  };

  // Run a fresh 500-run simulation for the print fan chart whenever the
  // include-Monte-Carlo option is on and the plan's inputs change.
  useEffect(() => {
    if (!printOptions.includeMonteCarlo) { setPrintMc(null); setPrintMcPending(false); return; }
    setPrintMcPending(true);
    const worker = new Worker(new URL('./workers/monteCarlo.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ ok: true; results: MonteCarloResults } | { ok: false; error: string }>) => {
      if (event.data.ok) setPrintMc(event.data.results);
      else console.warn('Print Monte Carlo failed:', event.data.error);
      setPrintMcPending(false);
      worker.terminate();
    };
    worker.onerror = () => { setPrintMcPending(false); worker.terminate(); };
    worker.postMessage({ inputs, config, runs: 500, volatility: inputs.returnVolatility });
    return () => worker.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printOptions.includeMonteCarlo, inputs, config]);

  // Persist scenarios + active scenario to localStorage on every change
  useEffect(() => {
    saveScenarioState(scenarios, activeScenarioId);
  }, [scenarios, activeScenarioId]);

  // Persist engine config on every change
  useEffect(() => {
    saveAppConfig(config);
  }, [config]);

  // If the URL carried a shared plan (#plan=...), import it once as a new
  // scenario and select it. Runs before the persist effect's first save would
  // matter, and the hash is cleared on read so refresh won't re-import.
  useEffect(() => {
    const shared = consumePlanFromHash();
    if (!shared) return;
    const id = `shared-${Date.now().toString(36)}`;
    const scenario: Scenario = { id, name: 'Shared plan', inputs: shared };
    setScenarios((prev) => [...prev, scenario]);
    setActiveScenarioId(id);
    setInputs(JSON.parse(JSON.stringify(shared)));
    setHasUnsavedChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExportDb = () => {
    exportAppDb(scenarios, activeScenarioId, config);
  };

  const handleImportDb = (file: File) => {
    file.text().then(text => {
      const result = parseAppDb(text);
      if (!result.ok) {
        window.alert(`Import failed: ${result.error}`);
        return;
      }
      if (!window.confirm('Importing will replace ALL scenarios and settings. Continue?')) return;
      persistAppDb(result.db);
      setScenarios(result.db.scenarios);
      setActiveScenarioId(result.db.activeScenarioId);
      const active = result.db.scenarios.find(s => s.id === result.db.activeScenarioId) ?? result.db.scenarios[0];
      setInputs(JSON.parse(JSON.stringify(active.inputs)));
      setConfig(result.db.config);
      setHasUnsavedChanges(false);
    });
  };

  // Update inputs when scenario changes
  const handleScenarioChange = (id: string) => {
    const scenario = scenarios.find(s => s.id === id);
    if (scenario) {
      setActiveScenarioId(id);
      setInputs(JSON.parse(JSON.stringify(scenario.inputs)));
      setHasUnsavedChanges(false);
    }
  };

  // Update scenario when inputs change - with save button
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const handleInputsChange = (newInputs: RetirementInputs) => {
    setInputs(newInputs);
    setHasUnsavedChanges(true);
  };

  const handleSaveScenario = () => {
    setScenarios(prev => prev.map(s =>
      s.id === activeScenarioId ? { ...s, inputs: JSON.parse(JSON.stringify(inputs)) } : s
    ));
    setHasUnsavedChanges(false);
  };

  const results = useMemo(() => {
    return calculateRetirement(inputs, config);
  }, [inputs, config]);

  const handleExportCSV = () => {
    const headers = ['Age', 'Starting Balance', 'Contributions', 'Market Gains', 'Spending Target', 'Withdrawals', 'Income Tax', 'Tax Burden', 'CPP', 'OAS', 'GIS', 'Ending Balance', 'RRSP', 'RRIF', 'TFSA', 'Taxable', 'Cash Cushion'];
    const csvContent = [
      headers.join(','),
      ...results.yearlyBreakdown.map(row =>
        [
          row.age,
          row.startingBalance,
          row.contributions,
          row.marketGains,
          row.spendingTarget,
          row.withdrawals,
          row.incomeTax,
          row.cumulativeTax,
          row.cppIncome,
          row.oasIncome,
          row.gisIncome,
          row.endingBalance,
          row.rrspBalance,
          row.rrifBalance,
          row.tfsaBalance,
          row.taxableBalance,
          row.cashCushionBalance,
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retirement-projection-${activeScenario.name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Print-only one-page summary (hidden on screen; see index.css) */}
      <PrintSummary
        scenarioName={activeScenario.name}
        inputs={inputs}
        results={results}
        options={printOptions}
        mcResults={printMc}
        rrifConversionAge={config.engine.rrifConversionAge}
      />

      <div className="no-print flex flex-col flex-1 min-h-0">
      <TopHeader
        scenarios={scenarios}
        activeScenarioId={activeScenarioId}
        onScenarioChange={handleScenarioChange}
        onSave={handleSaveScenario}
        hasUnsavedChanges={hasUnsavedChanges}
        onManageScenarios={() => scenarioManagerRef.current?.open()}
        onResetScenario={() => {
          // Revert the sidebar to the current scenario's last-saved inputs
          // (not the built-in program defaults).
          setInputs(JSON.parse(JSON.stringify(activeScenario.inputs)));
          setHasUnsavedChanges(false);
        }}
        onRunMonteCarlo={() => {
          const vol = inputs.returnVolatility ?? 0;
          if (vol <= 0) {
            window.alert('Set a Volatility above 0% (Market Hypotheses in the sidebar) to run Monte Carlo.');
            return;
          }
          setMcRequest({ inputs, config, runs: 500, volatility: vol });
        }}
        onRunBacktest={() => {
          // Real-return series: run with inflation off so historical real
          // multipliers line up with today's-dollar spending.
          const realConfig: AppConfig = JSON.parse(JSON.stringify(config));
          realConfig.engine.inflationRate = 0;
          setBacktestResult(runBacktest(inputs, realConfig, calculateRetirement));
        }}
        onOpenSettings={() => setView('settings')}
        onExportDb={handleExportDb}
        onImportDb={handleImportDb}
        onOpenDonate={() => { setView('projection'); setShowDonate((s) => !s); }}
        onOpenHelp={() => setView('help')}
      />

      {/* Scenario manager modal (triggered from the top bar) */}
      <ScenarioManager
        ref={scenarioManagerRef}
        scenarios={scenarios}
        activeScenarioId={activeScenarioId}
        onScenariosChange={setScenarios}
        onSelectScenario={handleScenarioChange}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (always visible, including on Help & Settings pages) */}
        <SidebarForm
          inputs={inputs}
          onChange={handleInputsChange}
          provinceCodes={Object.keys(config.provinces).sort()}
          config={config}
        />

        {/* Main Workspace */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            {/* Breadcrumbs */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <button
                  onClick={() => setView('projection')}
                  className={`hover:text-slate-900 hover:underline ${view === 'projection' ? 'text-slate-900 font-medium' : 'text-blue-600'}`}
                  title="Return to the projection"
                >
                  Dashboard
                </button>
                <span>/</span>
                {view === 'projection' && (
                  <>
                    <span className="text-slate-900">Retirement Projection</span>
                    <span className="text-neutral-400">•</span>
                    <span className="text-slate-700">{activeScenario.name}</span>
                    {hasUnsavedChanges && (
                      <span className="text-amber-600 font-medium">• unsaved changes</span>
                    )}
                  </>
                )}
                {view === 'settings' && <span className="text-slate-900">Engine Settings</span>}
                {view === 'help' && <span className="text-slate-900">Help &amp; Documentation</span>}
              </div>
              {view === 'projection' && (
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setShowOptimize((s) => !s)}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    title="Explore deterministic strategy variants and AI-suggested inputs"
                  >
                    <Sparkles size={13} /> Optimize
                  </button>
                  <button
                    onClick={() => setShowShare((s) => !s)}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    title="Show a shareable link that encodes this plan's inputs in the URL"
                  >
                    <Share2 size={13} /> Share link
                  </button>
                  <button
                    onClick={() => setShowPrintOptions((s) => !s)}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    title="Choose what goes into the printed plan summary, then print or save as PDF"
                  >
                    <Printer size={13} /> Print summary
                  </button>
                  <button
                    onClick={handleExportCSV}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    title="Download the year-by-year projection as CSV"
                  >
                    <FileSpreadsheet size={13} /> Export CSV
                  </button>
                </div>
              )}
            </div>

            {view === 'projection' && (
              <>
                {/* Getting-started welcome card. The "show on load" toggle only
                    seeds the initial state — dismissal hides it for this
                    session regardless, or it would re-mount instantly. */}
                {showWelcome && (
                  <WelcomeCard onDismiss={() => setShowWelcome(false)} />
                )}

                {/* Share link card */}
                {showShare && (
                  <ShareCard url={buildShareUrl(inputs)} onClose={() => setShowShare(false)} />
                )}

                {/* Optimize card */}
                {showOptimize && (
                  <OptimizeCard
                    inputs={inputs}
                    config={config}
                    onApply={(patch) => handleInputsChange({ ...inputs, ...patch })}
                    onClose={() => setShowOptimize(false)}
                  />
                )}

                {/* Donate card */}
                {showDonate && (
                  <DonateCard onClose={() => setShowDonate(false)} />
                )}

                {/* Print options card */}
                {showPrintOptions && (
                  <PrintOptionsCard
                    options={printOptions}
                    onChange={updatePrintOptions}
                    onClose={() => setShowPrintOptions(false)}
                    onPrint={() => window.print()}
                    mcPending={printMcPending}
                    mcResults={printMc}
                  />
                )}

                {/* KPI Cards */}
                <CollapsiblePanel id="summary" title="Projection Summary">
                  <MetricCards results={results} />
                </CollapsiblePanel>

                {/* Interactive projection timeline */}
                <CollapsiblePanel id="timeline" title="Projection Timeline">
                  <TimelineChart inputs={inputs} results={results} config={config} onChange={handleInputsChange} />
                </CollapsiblePanel>

                {/* Schedule Table */}
                <CollapsiblePanel id="schedule" title="Year-by-Year Projection">
                  <ScheduleTable breakdown={results.yearlyBreakdown} retirementAge={results.retirementAge} />
                </CollapsiblePanel>

                {/* Monte Carlo */}
                {mcRequest && (
                  <div ref={mcPanelRef}>
                    <MonteCarloChart
                      request={mcRequest}
                      retirementAge={results.retirementAge}
                      onClose={() => setMcRequest(null)}
                    />
                  </div>
                )}

                {/* Historical backtest */}
                {backtestResult && (
                  <BacktestPanel result={backtestResult} onClose={() => setBacktestResult(null)} />
                )}
              </>
            )}

            {view === 'settings' && (
              <SettingsModal config={config} onSave={setConfig} />
            )}

            {view === 'help' && (
              <HelpModal />
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

export default App;
