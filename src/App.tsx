import { useState, useMemo, useEffect, useRef } from 'react';
import { FileSpreadsheet, Share2, Printer, Sparkles, Calculator } from 'lucide-react';
import { TopHeader } from './components/TopHeader';
import { SidebarForm } from './components/SidebarForm';
import { MetricCards } from './components/MetricCards';
import { ScheduleTable } from './components/ScheduleTable';
import { ScenarioManager, type ScenarioManagerHandle } from './components/ScenarioManager';
import { calculateHousehold, combineHouseholdBreakdown, type RetirementInputs } from './lib/retirementEngine';
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
import { ExportCard } from './components/ExportCard';
import { loadPrintOptions, savePrintOptions, type PrintOptions } from './lib/printOptions';
import {
  loadProjectionExportOptions, saveProjectionExportOptions, buildExport,
  type ProjectionExportOptions,
} from './lib/projectionExport';
import type { MonteCarloResults } from './lib/monteCarlo';
import { runMonteCarloAuto } from './lib/runMonteCarlo';
import { runBacktest, type BacktestResult } from './lib/historicalReturns';

type View = 'projection' | 'settings' | 'help' | 'math';
import { buildShareUrl, consumePlanFromHash } from './lib/shareLink';
import { PrintSummary } from './components/PrintSummary';
import { MathPage } from './components/MathPage';
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
  // mcOpen tracks panel visibility; mcRequest is the payload MonteCarloChart
  // re-runs on. Keeping them separate lets an effect refresh mcRequest when
  // inputs change without re-triggering itself.
  const [mcOpen, setMcOpen] = useState(false);
  const [mcRequest, setMcRequest] = useState<MonteCarloRequest | null>(null);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const mcPanelRef = useRef<HTMLDivElement>(null);
  const backtestPanelRef = useRef<HTMLDivElement>(null);
  const shareCardRef = useRef<HTMLDivElement>(null);
  const optimizeCardRef = useRef<HTMLDivElement>(null);
  const printOptionsCardRef = useRef<HTMLDivElement>(null);
  const donateCardRef = useRef<HTMLDivElement>(null);
  const exportCardRef = useRef<HTMLDivElement>(null);

  // Scroll a panel into view when it opens. Runs on every render and scrolls
  // only on the closed → open transition (tracked in prevOpen), so input-driven
  // re-renders and Monte Carlo auto-refreshes don't yank the page while editing.
  const prevOpen = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const targets: Array<[string, boolean, React.RefObject<HTMLDivElement | null>]> = [
      ['share', showShare, shareCardRef],
      ['optimize', showOptimize, optimizeCardRef],
      ['print', showPrintOptions, printOptionsCardRef],
      ['donate', showDonate, donateCardRef],
      ['export', showExport, exportCardRef],
    ];
    for (const [key, isOpen, ref] of targets) {
      const was = prevOpen.current[key] ?? false;
      if (isOpen && !was) {
        // Defer a frame so the panel has mounted and laid out before scrolling.
        requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
      prevOpen.current[key] = isOpen;
    }
  });

  // (Monte Carlo / backtest auto-refresh effects live further down, after
  // `inputs` and `config` are declared.)
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
  const [showExport, setShowExport] = useState(false);
  const [exportOptions, setExportOptions] = useState<ProjectionExportOptions>(loadProjectionExportOptions);

  const updateExportOptions = (opts: ProjectionExportOptions) => {
    setExportOptions(opts);
    saveProjectionExportOptions(opts);
  };
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
    const cancel = runMonteCarloAuto(
      { inputs, config, runs: 500, volatility: inputs.returnVolatility },
      (res) => { setPrintMc(res); setPrintMcPending(false); },
      (msg) => { console.warn('Print Monte Carlo failed:', msg); setPrintMcPending(false); },
    );
    return cancel;
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
    return calculateHousehold(inputs, config);
  }, [inputs, config]);

  // Household breakdown (both spouses summed per calendar year) for the
  // timeline chart and year-by-year table; singles get the primary plan as-is.
  const householdBreakdown = useMemo(
    () => combineHouseholdBreakdown(results, inputs),
    [results, inputs]
  );

  // Keep an open Monte Carlo panel in sync with the plan: rebuild the request
  // when inputs/config change, debounced so dragging a slider doesn't fire a
  // 500-run batch per pixel. MonteCarloChart re-runs whenever request changes.
  // mcRefreshNonce lets the header's refresh button force an immediate re-run.
  const [mcRefreshNonce, setMcRefreshNonce] = useState(0);
  const mcNonceSeen = useRef(0);
  useEffect(() => {
    if (!mcOpen) { setMcRequest(null); return; }
    const vol = inputs.returnVolatility ?? 0;
    if (vol <= 0) { setMcRequest(null); return; }
    // Build immediately when there's nothing showing yet (first open) or a
    // fresh manual refresh was requested (nonce consumed once). Debounce only
    // the input-driven rebuilds so slider drags don't spam 500-run batches.
    const manualRefresh = mcRefreshNonce !== mcNonceSeen.current;
    if (mcRequest == null || manualRefresh) {
      mcNonceSeen.current = mcRefreshNonce;
      setMcRequest({ inputs, config, runs: 500, volatility: vol });
      return;
    }
    const t = setTimeout(() => {
      setMcRequest({ inputs, config, runs: 500, volatility: vol });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcOpen, inputs, config, mcRefreshNonce]);

  // Keep an open backtest panel in sync too. It's fast and synchronous, so no
  // debounce needed.
  useEffect(() => {
    if (!backtestResult) return;
    const realConfig: AppConfig = JSON.parse(JSON.stringify(config));
    realConfig.engine.inflationRate = 0;
    setBacktestResult(runBacktest(inputs, realConfig, calculateHousehold));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, config]);

  const handleExportProjection = () => {
    const payload = buildExport(activeScenario.name, inputs, results, config, exportOptions);
    const blob = new Blob([payload.content], { type: payload.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retirement-projection-${activeScenario.name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.${payload.extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen md:h-screen flex flex-col bg-slate-50">
      {/* Print-only one-page summary (hidden on screen; see index.css) */}
      <PrintSummary
        scenarioName={activeScenario.name}
        inputs={inputs}
        results={results}
        householdBreakdown={householdBreakdown}
        options={printOptions}
        mcResults={printMc}
        rrifConversionAge={config.engine.rrifConversionAge}
      />

      <div className="no-print flex flex-col flex-1 min-h-0">
      <TopHeader
        onToggleSidebar={() => setSidebarOpen((s) => !s)}
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
          if (mcOpen) {
            // Already open: onMounted won't refire, so scroll explicitly.
            mcPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          setMcOpen(true); // the sync effect builds the request (and keeps it fresh)
        }}
        onRunBacktest={() => {
          // Real-return series: run with inflation off so historical real
          // multipliers line up with today's-dollar spending.
          const realConfig: AppConfig = JSON.parse(JSON.stringify(config));
          realConfig.engine.inflationRate = 0;
          setBacktestResult(runBacktest(inputs, realConfig, calculateHousehold));
          if (backtestResult != null) {
            // Already open: scroll explicitly since nothing remounts.
            backtestPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
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

      <div className="relative flex flex-1 flex-col md:flex-row md:overflow-hidden">
        {/* Mobile backdrop for the drawer sidebar */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar: a slide-in drawer on mobile, a static column on md+ */}
        <div
          className={`fixed inset-y-0 left-0 z-40 transform transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:transform-none ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <SidebarForm
            inputs={inputs}
            onChange={handleInputsChange}
            provinceCodes={Object.keys(config.provinces).sort()}
            config={config}
            onClose={() => setSidebarOpen(false)}
          />
        </div>

        {/* Main Workspace */}
        <div className="flex-1 md:overflow-y-auto">
          {/* Breadcrumb bar: sticky so the breadcrumb and the
              Optimize/Share/Print/Export links stay reachable while scrolling. */}
          <div className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 px-3 md:px-6 py-2.5 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
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
                {view === 'math' && <span className="text-slate-900">How the Math Works</span>}
              </div>
              {view === 'projection' && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <button
                    onClick={() => setView('math')}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    title="See how any year's numbers are worked out, step by step"
                  >
                    <Calculator size={13} /> Math
                  </button>
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
                    onClick={() => setShowExport((s) => {
                      const next = !s;
                      if (!next) return false;
                      // Same behaviour as MC/backtest: scroll even when already open.
                      requestAnimationFrame(() => exportCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                      return true;
                    })}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    title="Export the year-by-year projection as CSV, JSON or YAML"
                  >
                    <FileSpreadsheet size={13} /> Export Projection
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="px-3 md:px-6 pb-3 md:pb-6">
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
                  <div ref={shareCardRef}>
                    <ShareCard url={buildShareUrl(inputs)} onClose={() => setShowShare(false)} />
                  </div>
                )}

                {/* Optimize card */}
                {showOptimize && (
                  <div ref={optimizeCardRef}>
                    <OptimizeCard
                      inputs={inputs}
                      config={config}
                      results={results}
                      mcResults={printMc}
                      onApply={(patch) => handleInputsChange({ ...inputs, ...patch })}
                      onClose={() => setShowOptimize(false)}
                    />
                  </div>
                )}

                {/* Donate card */}
                {showDonate && (
                  <div ref={donateCardRef}>
                    <DonateCard onClose={() => setShowDonate(false)} />
                  </div>
                )}

                {/* Print options card */}
                {showPrintOptions && (
                  <div ref={printOptionsCardRef}>
                    <PrintOptionsCard
                      options={printOptions}
                      onChange={updatePrintOptions}
                      onClose={() => setShowPrintOptions(false)}
                      onPrint={() => window.print()}
                      mcPending={printMcPending}
                      mcResults={printMc}
                    />
                  </div>
                )}

                {/* Export projection card */}
                {showExport && (
                  <div ref={exportCardRef}>
                    <ExportCard
                      options={exportOptions}
                      onChange={updateExportOptions}
                      onClose={() => setShowExport(false)}
                      onExport={handleExportProjection}
                      hasSpouse={!!results.spouse}
                    />
                  </div>
                )}

                {/* KPI Cards */}
                <CollapsiblePanel id="summary" title="Projection Summary">
                  <MetricCards results={results} />
                </CollapsiblePanel>

                {/* Interactive projection timeline (household when a spouse is enabled) */}
                <CollapsiblePanel id="timeline" title="Projection Timeline">
                  <TimelineChart inputs={inputs} results={{ ...results, yearlyBreakdown: householdBreakdown }} config={config} onChange={handleInputsChange} />
                </CollapsiblePanel>

                {/* Schedule Table (household when a spouse is enabled); the drill-down
                    reads each person's own rows so both spouses' detail is available. */}
                <CollapsiblePanel id="schedule" title="Year-by-Year Projection">
                  <ScheduleTable
                    breakdown={householdBreakdown}
                    retirementAge={results.retirementAge}
                    primaryBreakdown={results.spouse ? results.yearlyBreakdown : undefined}
                    spouseBreakdown={results.spouse?.yearlyBreakdown}
                    spouseAgeOffset={inputs.currentAge - (inputs.spouse?.currentAge ?? inputs.currentAge)}
                  />
                </CollapsiblePanel>

                {/* Monte Carlo */}
                {mcOpen && mcRequest && (
                  <div ref={mcPanelRef}>
                    <MonteCarloChart
                      request={mcRequest}
                      retirementAge={results.retirementAge}
                      onClose={() => setMcOpen(false)}
                      onRefresh={() => setMcRefreshNonce(n => n + 1)}
                      onMounted={() => mcPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    />
                  </div>
                )}

                {/* Historical backtest */}
                {backtestResult && (
                  <div ref={backtestPanelRef}>
                    <BacktestPanel
                      result={backtestResult}
                      onClose={() => setBacktestResult(null)}
                      onMounted={() => backtestPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    />
                  </div>
                )}
              </>
            )}

            {view === 'settings' && (
              <SettingsModal config={config} onSave={setConfig} />
            )}

            {view === 'help' && (
              <HelpModal />
            )}

            {view === 'math' && (
              <MathPage
                inputs={inputs}
                results={results}
                spouseAgeOffset={inputs.currentAge - (inputs.spouse?.currentAge ?? inputs.currentAge)}
              />
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

export default App;
