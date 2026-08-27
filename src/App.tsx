import { useState, useMemo, useEffect, useRef } from 'react';
import { Database, Share2, Printer, Sparkles, Calculator, GitCompareArrows, SlidersHorizontal, LineChart } from 'lucide-react';
import { TopHeader } from './components/TopHeader';
import { SidebarForm } from './components/SidebarForm';
import { MetricCards } from './components/MetricCards';
import { ScheduleTable } from './components/ScheduleTable';
import { ScenarioManager } from './components/ScenarioManager';
import { calculateHousehold, combineHouseholdBreakdown, type RetirementInputs, type RetirementResults } from './lib/retirementEngine';
import { resolveSpouseSource } from './lib/householdTypes';
import { loadScenarioState, saveScenarioState, type Scenario } from './lib/scenarioStorage';
import { loadAppConfig, saveAppConfig, type AppConfig } from './lib/appConfig';
import { buildAppDb } from './lib/appDb';
import { SettingsModal } from './components/SettingsModal';
import { HelpModal } from './components/HelpModal';
import { MonteCarloChart } from './components/MonteCarloChart';
import { TimelineChart } from './components/TimelineChart';
import { BacktestPanel } from './components/BacktestPanel';
import { CollapsiblePanel } from './components/CollapsiblePanel';
import { SharingPage, type SharingImportRequest } from './components/SharingPage';
import { DataPage, type FullBackupSelection, type ProjectionImportRequest } from './components/DataPage';
import { OptimizeCard } from './components/OptimizeCard';
import { CompareCard } from './components/CompareCard';
import { WelcomeCard, isWelcomeDismissed } from './components/WelcomeCard';
import { SetupWizard, wizardDataFrom, applyWizardData, type WizardData } from './components/SetupWizard';
import { PrintOptionsCard } from './components/PrintOptionsCard';
import { DonateCard } from './components/DonateCard';
import { loadPrintOptions, savePrintOptions, type PrintOptions } from './lib/printOptions';
import {
  loadProjectionExportOptions, saveProjectionExportOptions,
  type ProjectionExportOptions,
} from './lib/projectionExport';
import type { MonteCarloResults } from './lib/monteCarlo';
import { runMonteCarloAuto } from './lib/runMonteCarlo';
import { runBacktest, type BacktestResult } from './lib/historicalReturns';

import { viewFromHash, hashForView, type View } from './lib/viewRoutes';
import { consumePlanFromHash } from './lib/shareLink';
import { PrintSummary } from './components/PrintSummary';
import { MathPage } from './components/MathPage';
import { EqPage, type EqSolvedState, type Bands } from './components/EqPage';
import { loadEqBands, saveEqBands } from './lib/eqStorage';
import { runEqSolverAuto } from './lib/runEqSolver';
import { solveEqReadout } from './lib/eqSolver';
import { renderRange, axisValue, consistentAges } from './lib/eqConstraints';
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
  // Default landing: the Welcome page unless the user checked "don't show this
  // again" (or General settings forces it on every load); otherwise the
  // projection dashboard. An explicit hash route always wins.
  const [view, setView] = useState<View>(() =>
    viewFromHash(window.location.hash)
    ?? (config.general.showWelcomeOnLoad || !isWelcomeDismissed() ? 'welcome' : 'projection')
  );

  // Keep the URL hash in sync with the current view (push a history entry per
  // navigation), and follow hash changes so back/forward and pasted links work.
  useEffect(() => {
    const route = hashForView(view);
    if (window.location.hash !== route) {
      window.history.pushState(null, '', window.location.pathname + window.location.search + route);
    }
  }, [view]);

  useEffect(() => {
    const onHashChange = () => {
      const v = viewFromHash(window.location.hash);
      if (v) setView(v);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  // mcRequest is the payload MonteCarloChart re-runs on; built while the
  // montecarlo route is active. backtestResult is built while backtest is.
  const [mcRequest, setMcRequest] = useState<MonteCarloRequest | null>(null);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const cancelEqSolveRef = useRef<(() => void) | null>(null);

  // (Monte Carlo / backtest route-sync effects live further down, after
  // `inputs` and `config` are declared.)
  const [exportOptions, setExportOptions] = useState<ProjectionExportOptions>(loadProjectionExportOptions);

  const updateExportOptions = (opts: ProjectionExportOptions) => {
    setExportOptions(opts);
    saveProjectionExportOptions(opts);
  };
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
    return runMonteCarloAuto(
      { inputs, config, runs: 500, volatility: inputs.returnVolatility },
      (res) => { setPrintMc(res); setPrintMcPending(false); },
      (msg) => { console.warn('Print Monte Carlo failed:', msg); setPrintMcPending(false); },
    );
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
    const scenario: Scenario = { id, name: shared.name?.trim() || 'Shared plan', inputs: shared.inputs };
    setScenarios((prev) => [...prev, scenario]);
    setActiveScenarioId(id);
    setInputs(JSON.parse(JSON.stringify(shared.inputs)));
    setHasUnsavedChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Add a scenario from elsewhere (a share link's plan, a pasted plan code, or
  // an imported projection export) and make it active.
  const importScenario = (name: string, scenarioInputs: RetirementInputs) => {
    const id = `imported-${Date.now().toString(36)}`;
    const scenario: Scenario = { id, name: name.trim() || 'Imported plan', inputs: scenarioInputs };
    setScenarios((prev) => [...prev, scenario]);
    setActiveScenarioId(id);
    setInputs(JSON.parse(JSON.stringify(scenarioInputs)));
    setHasUnsavedChanges(false);
  };

  // Full backup: download the chosen scenarios (+ optionally the engine config).
  const handleExportFull = (scenarioIds: string[], includeConfig: boolean) => {
    const chosen = scenarios.filter(s => scenarioIds.includes(s.id));
    const activeId = chosen.some(s => s.id === activeScenarioId) ? activeScenarioId : (chosen[0]?.id ?? activeScenarioId);
    const db = buildAppDb(chosen, activeId, config);
    if (!includeConfig) {
      // Strip the config so the receiver keeps their own engine settings.
      delete (db as Partial<typeof db>).config;
    }
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retirement-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Apply a full-backup import chosen on the Import/Export page.
  const handleImportFull = (sel: FullBackupSelection) => {
    const list = sel.scenarios.length > 0 ? sel.scenarios : scenarios;
    const activeId = list.some(s => s.id === sel.activeScenarioId) ? sel.activeScenarioId : list[0].id;
    setScenarios(list);
    setActiveScenarioId(activeId);
    const active = list.find(s => s.id === activeId) ?? list[0];
    setInputs(JSON.parse(JSON.stringify(active.inputs)));
    if (sel.config) setConfig(sel.config);
    setHasUnsavedChanges(false);
    setView('projection');
  };

  // Sharing page: a plan received as a link or pasted code becomes a scenario.
  const handleSharingImport = (req: SharingImportRequest) => {
    importScenario(req.name, req.inputs);
    setView('projection');
  };

  // Import/Export page: a projection JSON re-imported as a scenario.
  const handleProjectionImport = (req: ProjectionImportRequest) => {
    importScenario(req.name, req.inputs);
    setView('projection');
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
    // Keep the plan's ages internally consistent: editing current age can
    // invalidate retirement age (retire before now) etc., so clamp them.
    setInputs(consistentAges(newInputs));
    setHasUnsavedChanges(true);
  };

  const handleSaveScenario = () => {
    setScenarios(prev => prev.map(s =>
      s.id === activeScenarioId ? { ...s, inputs: JSON.parse(JSON.stringify(inputs)) } : s
    ));
    setHasUnsavedChanges(false);
  };

  // First-scenario setup wizard. Launched from the Welcome page ("Get started")
  // or re-opened from Help; on completion the collected values overlay the
  // current inputs (keeping engine defaults) and become the active plan.
  const [wizardOpen, setWizardOpen] = useState(false);
  const handleWizardComplete = (data: WizardData) => {
    const next = applyWizardData(inputs, data);
    setInputs(consistentAges(JSON.parse(JSON.stringify(next))));
    // Persist straight into the active scenario so the new plan survives a
    // reload without a separate "save" click.
    setScenarios(prev => prev.map(s =>
      s.id === activeScenarioId ? { ...s, inputs: JSON.parse(JSON.stringify(next)) } : s
    ));
    setHasUnsavedChanges(false);
    setWizardOpen(false);
    setView('projection');
  };

  // Resolve the spouse adapter: when the spouse is a reference to another
  // scenario, materialize that scenario's person into `spouse` (host wins on
  // the shared fields) and surface any conflicts as warnings. The engine and
  // every display consumer always see a concrete SpouseInputs.
  const spouseResolution = useMemo(
    () => resolveSpouseSource(inputs, scenarios, activeScenarioId),
    [inputs, scenarios, activeScenarioId],
  );
  const resolvedInputs = useMemo<RetirementInputs>(
    () => {
      // Only materialize a linked scenario spouse when the spouse is actually
      // ENABLED. The enabled flag is the user's explicit on/off and must win:
      // otherwise unchecking a linked spouse would be silently overridden by
      // the resolver re-injecting the referenced plan.
      const linked = inputs.spouseSource?.kind === 'scenario';
      if (!linked) return inputs;
      if (!inputs.spouse?.enabled) return { ...inputs, spouse: undefined };
      return { ...inputs, spouse: spouseResolution.spouse };
    },
    [inputs, spouseResolution],
  );

  const results = useMemo(() => {
    return calculateHousehold(resolvedInputs, config);
  }, [resolvedInputs, config]);

  // The projection export shows the active plan's own computed numbers. When a
  // spouse is disabled the spouse block lingers in the inputs (for re-enabling),
  // so export against a spouse-stripped copy to keep the file to just "you".
  const exportResults: RetirementResults = useMemo(
    () => (resolvedInputs.spouse?.enabled ? results : calculateHousehold({ ...resolvedInputs, spouse: undefined }, config)),
    [resolvedInputs, results, config],
  );

  // ---- EQ steering surface state ----
  // Per-control allowed bands (min–max). Disabled = the control roams its full axis.
  // EQ steering state (control crops), persisted to localStorage as axis-fraction
  // scalars (see eqStorage) so they survive axis-range changes; restored on load.
  const [eqBands, setEqBands] = useState<Bands>(() => loadEqBands());

  useEffect(() => {
    saveEqBands(eqBands);
  }, [eqBands]);
  const [eqSolved, setEqSolved] = useState<EqSolvedState>({
    successRate: null, grid: null, gridSize: 9, solving: false,
  });

  // The success-rate GRID is sampled across retirementAge × desiredSpending, so
  // each grid cell OVERWRITES those two inputs (withAxis) — their current values
  // don't affect any cell's probability. The grid therefore depends only on the
  // plan's FINANCIAL inputs (balances, contributions, return, volatility, ages,
  // CPP/OAS, pensions, spouse, events, maxAge), the config, and the rendered
  // range (which grows in whole-axis steps when a value crosses the axis max).
  // This key captures exactly those, omitting the two pad axes, so dragging the
  // retirement-age / spending VALUE thumbs (or the pad dot) leaves the key — and
  // the cached grid — unchanged. Only the cheap readout re-runs on those drags.
  const eqGridKey = useMemo(() => {
    const { retirementAge: _ra, desiredSpending: _ds, ...financial } = inputs;
    return JSON.stringify({
      financial,
      config,
      rx: renderRange('retirementAge', axisValue(inputs, 'retirementAge'), inputs),
      ry: renderRange('desiredSpending', axisValue(inputs, 'desiredSpending'), inputs),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, config]);

  // The success-rate READOUT under the dot is one cheap Monte Carlo node on the
  // main thread. Unlike the grid, it DOES depend on the current point, so it
  // re-solves on every inputs change (debounced) — including pad-axis drags.
  useEffect(() => {
    if (view !== 'eq') return;
    setEqSolved(s => ({ ...s, solving: true }));
    const t = setTimeout(() => {
      try {
        const successRate = solveEqReadout({ inputs, config, pad: { x: 'retirementAge', y: 'desiredSpending' } });
        setEqSolved(s => ({ ...s, successRate, solving: false }));
      } catch {
        setEqSolved(s => ({ ...s, solving: false }));
      }
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, inputs, config]);

  // Re-solve the success-rate pad shading only when the grid's actual inputs
  // change (eqGridKey) — NOT on every plan edit. Dragging the retirement-age or
  // spending value thumbs moves the dot but doesn't change any grid cell, so the
  // expensive 81-node worker pool is skipped entirely on those drags. The grid
  // streams in row-by-row (center-out) so the pad shades in live.
  useEffect(() => {
    if (view !== 'eq') return;
    setEqSolved(s => ({ ...s, solving: true }));
    const t = setTimeout(() => {
      const cancel = runEqSolverAuto(
        {
          inputs, config, pad: { x: 'retirementAge', y: 'desiredSpending' },
          // Shade the ranges the pad actually renders (grown to fit an
          // out-of-range point), so the gradient lines up with the dot.
          ranges: {
            x: renderRange('retirementAge', axisValue(inputs, 'retirementAge'), inputs),
            y: renderRange('desiredSpending', axisValue(inputs, 'desiredSpending'), inputs),
          },
        },
        (res) => setEqSolved(s => ({
          ...s,
          grid: res.grid,
          gridSize: res.gridMeta?.size ?? 9,
          solving: false,
        })),
        (msg) => { console.warn('EQ solve failed:', msg); setEqSolved(s => ({ ...s, solving: false })); },
        // Stream partial rows: write each finished row's rates into the grid so
        // the gradient fills in live (center-out). Solved rows overwrite.
        (prog) => setEqSolved(s => {
          const size = s.gridSize;
          const grid = s.grid ? [...s.grid] : new Array<number>(size * size).fill(0);
          for (let gx = 0; gx < size; gx++) grid[prog.row * size + gx] = prog.cells[gx];
          return { ...s, grid, solving: true };
        }),
      );
      cancelEqSolveRef.current = cancel;
    }, 250);
    return () => { clearTimeout(t); cancelEqSolveRef.current?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, eqGridKey]);

  // Household breakdown (both spouses summed per calendar year) for the
  // timeline chart and year-by-year table; singles get the primary plan as-is.
  const householdBreakdown = useMemo(
    () => combineHouseholdBreakdown(results, resolvedInputs),
    [results, resolvedInputs]
  );

  // The age gap between the two partners, for aligning spouse rows to the
  // primary's age axis. Derived from the spouse that ACTUALLY RAN
  // (results.spouse), not the raw inputs — a disabled spouse leaves the inputs
  // populated (for re-enabling) but must not shift the display or show tabs.
  const spouseAgeOffset = useMemo(
    () => (results.spouse
      ? resolvedInputs.currentAge - (resolvedInputs.spouse?.currentAge ?? resolvedInputs.currentAge)
      : 0),
    [results.spouse, resolvedInputs],
  );

  // Monte Carlo is its own page now: build the request while the route is
  // active, refreshing when inputs/config change (debounced so dragging a
  // slider doesn't fire a 500-run batch per pixel). MonteCarloChart re-runs
  // whenever request changes. mcRefreshNonce forces an immediate re-run.
  const [mcRefreshNonce, setMcRefreshNonce] = useState(0);
  const mcNonceSeen = useRef(0);
  useEffect(() => {
    if (view !== 'montecarlo') { setMcRequest(null); return; }
    const vol = inputs.returnVolatility ?? 0;
    if (vol <= 0) { setMcRequest(null); return; }
    // Build immediately when there's nothing showing yet (first visit) or a
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
  }, [view, inputs, config, mcRefreshNonce]);

  // Backtest is its own page too. It's fast and synchronous, so recompute on
  // the route whenever inputs/config change — no debounce needed. Real-return
  // series: inflation off so historical multipliers match today's-dollar spending.
  useEffect(() => {
    if (view !== 'backtest') { setBacktestResult(null); return; }
    const realConfig: AppConfig = JSON.parse(JSON.stringify(config));
    realConfig.engine.inflationRate = 0;
    setBacktestResult(runBacktest(inputs, realConfig, calculateHousehold));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, inputs, config]);

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
        onManageScenarios={() => setView('scenarios')}
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
          setView('montecarlo'); // the route's effect builds the request (and keeps it fresh)
        }}
        onRunBacktest={() => setView('backtest')}
        onOpenSettings={() => setView('settings')}
        onOpenData={() => setView('export')}
        onOpenDonate={() => setView('donate')}
        onOpenHelp={() => setView('help')}
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
            scenarios={scenarios}
            activeScenarioId={activeScenarioId}
            spouseWarnings={spouseResolution.warnings}
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
                {view === 'math' && <span className="text-slate-900">Year Math</span>}
                {view === 'eq' && <span className="text-slate-900">Steering</span>}
                {view === 'optimize' && <span className="text-slate-900">Optimize</span>}
                {view === 'compare' && <span className="text-slate-900">Compare Scenarios</span>}
                {view === 'montecarlo' && <span className="text-slate-900">Monte Carlo</span>}
                {view === 'backtest' && <span className="text-slate-900">Historical Backtest</span>}
                {view === 'print' && <span className="text-slate-900">Print Summary</span>}
                {view === 'export' && <span className="text-slate-900">Import / Export</span>}
                {view === 'scenarios' && <span className="text-slate-900">Manage Scenarios</span>}
                {view === 'sharing' && <span className="text-slate-900">Sharing</span>}
                {view === 'donate' && <span className="text-slate-900">Support This App</span>}
                {view === 'welcome' && <span className="text-slate-900">Welcome</span>}
              </div>
              {/* Toolbar — always visible. Every link navigates to its own routed
                  page; Projection is the home dashboard. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <button
                  onClick={() => setView('projection')}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  title="The main projection dashboard: summary, timeline, and year-by-year schedule"
                >
                  <LineChart size={13} /> Projection
                </button>
                <button
                  onClick={() => setView('math')}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  title="See how any year's numbers are worked out, step by step"
                >
                  <Calculator size={13} /> Year Math
                </button>
                <button
                  onClick={() => setView('eq')}
                  className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700 hover:underline"
                  title="Steer the plan with sliders and a drag pad; limit any control to a range"
                >
                  <SlidersHorizontal size={13} /> Steering
                </button>
                <button
                  onClick={() => setView('optimize')}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  title="Explore deterministic strategy variants and AI-suggested inputs"
                >
                  <Sparkles size={13} /> Optimize
                </button>
                <button
                  onClick={() => setView('compare')}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  title="Diff 2–3 saved scenarios' verdict cards side by side"
                >
                  <GitCompareArrows size={13} /> Compare
                </button>
                <button
                  onClick={() => setView('sharing')}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  title="Send this plan as a link or code, or receive one into a new scenario"
                >
                  <Share2 size={13} /> Sharing
                </button>
                <button
                  onClick={() => setView('print')}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  title="Choose what goes into the printed plan summary, then print or save as PDF"
                >
                  <Printer size={13} /> Print summary
                </button>
                <button
                  onClick={() => setView('export')}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                  title="Export the projection or a full backup; import a backup or projection"
                >
                  <Database size={13} /> Import / Export
                </button>
              </div>
            </div>
          </div>

          <div className="px-3 md:px-6 pb-3 md:pb-6">
            {view === 'projection' && (
              <>
                {/* KPI Cards */}
                <CollapsiblePanel id="summary" title="Projection Summary">
                  <MetricCards results={results} inputs={inputs} />
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
                    spouseAgeOffset={spouseAgeOffset}
                  />
                </CollapsiblePanel>
              </>
            )}

            {view === 'optimize' && (
              <OptimizeCard
                inputs={inputs}
                config={config}
                results={results}
                mcResults={printMc}
                onApply={(patch) => handleInputsChange({ ...inputs, ...patch })}
              />
            )}

            {view === 'compare' && (
              <CompareCard
                scenarios={scenarios}
                activeScenarioId={activeScenarioId}
                config={config}
              />
            )}

            {view === 'montecarlo' && mcRequest && (
              <MonteCarloChart
                request={mcRequest}
                retirementAge={results.retirementAge}
                onRefresh={() => setMcRefreshNonce(n => n + 1)}
              />
            )}

            {view === 'backtest' && backtestResult && (
              <BacktestPanel
                result={backtestResult}
              />
            )}

            {view === 'print' && (
              <PrintOptionsCard
                options={printOptions}
                onChange={updatePrintOptions}
                onPrint={() => window.print()}
                mcPending={printMcPending}
                mcResults={printMc}
              />
            )}

            {view === 'export' && (
              <DataPage
                exportOptions={exportOptions}
                onExportOptionsChange={updateExportOptions}
                hasSpouse={!!exportResults.spouse}
                scenarioName={activeScenario.name}
                inputs={inputs}
                results={exportResults}
                config={config}
                scenarios={scenarios}
                activeScenarioId={activeScenarioId}
                onExportFull={handleExportFull}
                onImportFull={handleImportFull}
                onImportProjection={handleProjectionImport}
              />
            )}

            {view === 'scenarios' && (
              <ScenarioManager
                scenarios={scenarios}
                activeScenarioId={activeScenarioId}
                onScenariosChange={setScenarios}
                onSelectScenario={(id) => { handleScenarioChange(id); setView('projection'); }}
              />
            )}

            {view === 'sharing' && (
              <SharingPage
                inputs={inputs}
                scenarioName={activeScenario.name}
                onImport={handleSharingImport}
              />
            )}

            {view === 'donate' && (
              <DonateCard />
            )}

            {view === 'welcome' && (
              wizardOpen ? (
                <SetupWizard
                  initial={wizardDataFrom(inputs)}
                  onComplete={handleWizardComplete}
                  onSkip={() => { setWizardOpen(false); setView('projection'); }}
                />
              ) : (
                <WelcomeCard onContinue={() => setWizardOpen(true)} />
              )
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
                spouseAgeOffset={spouseAgeOffset}
              />
            )}

            {view === 'eq' && (
              <EqPage
                inputs={inputs}
                config={config}
                onChange={handleInputsChange}
                bands={eqBands}
                onBandsChange={setEqBands}
                solved={eqSolved}
                projection={{ results, breakdown: householdBreakdown }}
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
