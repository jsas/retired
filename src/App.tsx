import { useState, useMemo, useEffect, useRef } from 'react';
import { BetaApp } from './components/BetaApp';
import { StyleGuide } from './design/StyleGuide';
import { applyBetaAtBoot } from './lib/betaSkin';
import { Share2, Printer, Sparkles, Calculator, GitCompareArrows, SlidersHorizontal, LineChart, Bot, AlertTriangle, X } from 'lucide-react';
import { TopHeader } from './components/TopHeader';
import { SidebarForm } from './components/SidebarForm';
import { MetricCards } from './components/MetricCards';
import { ScheduleTable } from './components/ScheduleTable';
import { ScenarioManager } from './components/ScenarioManager';
import { calculateHousehold, calculateHouseholdModel, combineHouseholdBreakdown, type RetirementInputs, type RetirementResults } from '@retired/engine-core/retirementEngine';
import { resolveSpouseSource, baselineSpouse, legacySpouseToPerson, toHousehold } from '@retired/engine-core/householdTypes';
import type { Scenario } from '@retired/engine-core/types';
import { DEFAULT_APP_CONFIG, type AppConfig } from '@retired/engine-core/appConfig';
import { AppStore } from './data/store';
import { AppDatabase, readSeedScenariosFromMirror } from './data/db';
import { SettingsModal } from './components/SettingsModal';
import { SavePromptModal } from './components/SavePromptModal';
import { HelpModal } from './components/HelpModal';
import { MonteCarloChart } from './components/MonteCarloChart';
import { TimelineChart } from './components/TimelineChart';
import { BacktestPanel } from './components/BacktestPanel';
import { CollapsiblePanel } from './components/CollapsiblePanel';
import { SharingPage, type SharingImportRequest } from './components/SharingPage';
import { DataPage, type FullBackupSelection, type ProjectionImportRequest, type AiBackupInclude } from './components/DataPage';
import { AI_CHATS_STORAGE_KEY } from './lib/ai/chatStore';
import { AI_SETTINGS_STORAGE_KEY } from './lib/aiSettings';
import { OptimizeCard } from './components/OptimizeCard';
import { AgentPage } from './components/AgentPage';
import { ConnectionsPage } from './components/ConnectionsPage';
import { CompareCard } from './components/CompareCard';
import { WelcomeCard, isWelcomeDismissed } from './components/WelcomeCard';
import { SetupWizard, wizardDataFrom, applyWizardData, spouseWizardDataFrom, applySpouseWizardData, type WizardData } from './components/SetupWizard';
import { PrintOptionsCard } from './components/PrintOptionsCard';
import { DonateCard } from './components/DonateCard';
import { loadPrintOptions, savePrintOptions, type PrintOptions } from './lib/printOptions';
import {
  loadProjectionExportOptions, saveProjectionExportOptions,
  type ProjectionExportOptions,
} from './lib/projectionExport';
import type { MonteCarloResults } from '@retired/engine-core/monteCarlo';
import { runMonteCarloAuto } from './lib/runMonteCarlo';
import { runBacktest, type BacktestResult } from './lib/historicalReturns';

import { viewFromHash, hashForView, type View } from './lib/viewRoutes';
import { consumePlanFromHash } from './lib/shareLink';
import { buildDefaultScenarios } from '@retired/engine-core/exampleScenarios';
import { PrintSummary } from './components/PrintSummary';
import { MathPage } from './components/MathPage';
import { EqPage, type EqSolvedState, type Bands } from './components/EqPage';
import { loadEqBands, saveEqBands } from './lib/eqStorage';
import { PREF_KEYS, prefKV } from './lib/prefKv';
import { runEqSolverAuto } from './lib/runEqSolver';
import { solveEqReadout } from '@retired/engine-core/eqSolver';
import { renderRange, axisValue, consistentAges } from '@retired/engine-core/eqConstraints';
import type { MonteCarloRequest } from '@retired/engine-core/monteCarlo';

// The SQL store loads asynchronously (the wasm binary has to be fetched/decoded
// first — near-instant after the first visit). To keep first paint synchronous
// we seed state from the localStorage mirror of the SQL blob (or first-run
// examples) and then swap in the store's authoritative contents the moment it
// opens. The mirror is the SQL store's own compatibility copy, written on every
// persist, so this is a cache read of the same source of truth — not a fork.
// The swap is skipped while the user holds unsaved edits so in-flight work is
// never clobbered.
const getSyncSeed = () => {
  const stored = readSeedScenariosFromMirror();
  if (stored) {
    return { scenarios: stored.scenarios, activeScenarioId: stored.activeScenarioId };
  }
  const scenarios = buildDefaultScenarios();
  return { scenarios, activeScenarioId: scenarios[0].id };
};

function App() {
  const [initialState] = useState(getSyncSeed);
  // Beta reskin channel (?beta → beta-version cookie; see lib/betaSkin). The
  // flag is resolved once, synchronously, on the very first render — writing
  // the cookie is a side effect React must not replay, so it lives in the
  // useState initializer, not an effect. The whole hook set below stays
  // unconditional; only the render output branches.
  const [beta] = useState(applyBetaAtBoot);

  const [scenarios, setScenarios] = useState<Scenario[]>(initialState.scenarios);
  const [activeScenarioId, setActiveScenarioId] = useState<string>(initialState.activeScenarioId);
  // Config seed: defaults until the store opens and adopts the stored config
  // (setConfig(state.config) below). No legacy config read — issue #21.
  const [config, setConfig] = useState<AppConfig>(() => structuredClone(DEFAULT_APP_CONFIG));
  const [store, setStore] = useState<AppStore | null>(null);
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

  // Resolve the spouse adapter: when the spouse is a reference to another
  // scenario, materialize that scenario's person into `spouse` (host wins on
  // the shared fields) and surface any conflicts as warnings. The engine and
  // every display consumer always see a concrete SpouseInputs. Declared early
  // because EVERY engine consumer below (projection, Monte Carlo, backtest, EQ,
  // Optimize) runs against the resolved plan, not the raw inputs.
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

  // Run a fresh 500-run simulation for the print fan chart whenever the
  // include-Monte-Carlo option is on and the plan's inputs change.
  useEffect(() => {
    if (!printOptions.includeMonteCarlo) { setPrintMc(null); setPrintMcPending(false); return; }
    setPrintMcPending(true);
    return runMonteCarloAuto(
      { inputs: resolvedInputs, config, runs: 500, volatility: resolvedInputs.returnVolatility },
      (res) => { setPrintMc(res); setPrintMcPending(false); },
      (msg) => { console.warn('Print Monte Carlo failed:', msg); setPrintMcPending(false); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printOptions.includeMonteCarlo, resolvedInputs, config]);

  // Open the SQL store once (async: the wasm has to load). When its contents
  // differ from the sync seed and the user isn't mid-edit, adopt them — the
  // store is the authoritative copy.
  useEffect(() => {
    let cancelled = false;
    AppStore.open(buildDefaultScenarios).then(({ store: opened, state }) => {
      if (cancelled) return;
      setStore(opened);
      setHasUnsavedChanges(dirty => {
        if (!dirty) {
          setScenarios(state.scenarios);
          setActiveScenarioId(state.activeScenarioId);
          setInputs(JSON.parse(JSON.stringify(
            state.scenarios.find(s => s.id === state.activeScenarioId)!.inputs,
          )));
        }
        return dirty;
      });
      if (state.config) setConfig(state.config);
      // Issue #19: a stored config that failed wholesale validation was reset
      // to defaults — don't let that pass silently; the user's custom tax
      // tables need re-entering.
      if (state.configLoadWarning) setConfigLoadWarning(state.configLoadWarning);
    }).catch(err => console.warn('SQL store failed to open; running in-memory:', err));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist scenarios + active scenario on every change (once the store is
  // open — before that there's nothing to write through to). persist returns
  // whether a revision was recorded, which bumps a nonce so the scenarios
  // page's history list re-reads it.
  const [revisionNonce, setRevisionNonce] = useState(0);
  useEffect(() => {
    const wrote = store?.persist({ scenarios, activeScenarioId }) ?? false;
    if (wrote) setRevisionNonce(n => n + 1);
  }, [store, scenarios, activeScenarioId]);

  // Durability feedback (issue U-02): the persist writes are fire-and-forget,
  // so a failed OPFS/localStorage write was previously only a console.warn —
  // the user kept editing believing their plan was safe. Subscribe to the
  // store's save-outcome channel: a failure shows a dismissible banner, the
  // next durable write (any later persist) clears it.
  const [saveError, setSaveError] = useState(false);
  useEffect(() => {
    if (!store) return;
    return store.onSaveOutcome((err) => setSaveError(err != null));
  }, [store]);

  // Issue #19: a stored config that failed wholesale validation was reset to
  // defaults. Surface that — custom tax tables silently vanishing is a data
  // loss the user must know about. Stays until dismissed.
  const [configLoadWarning, setConfigLoadWarning] = useState<string | null>(null);

  // Persist engine config on every change.
  useEffect(() => {
    store?.persist({ config });
  }, [store, config]);

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

  // Full backup: download a REAL SQLite database file holding the chosen
  // scenarios (+ optionally the engine config). Openable by any SQLite tool
  // and re-importable here; the same file format a self-contained Node
  // package would use.
  // Copy one AI localStorage payload into the backup's kv table under the same
  // key, or strip it from the file when the user didn't opt in.
  const packAiKey = (db: AppDatabase, key: string, include: boolean) => {
    if (!include) { db.deleteKv(key); return; }
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) db.setKv(key, raw);
    } catch { /* storage unavailable — nothing to pack */ }
  };

  const handleExportFull = async (scenarioIds: string[], includeConfig: boolean, ai: AiBackupInclude) => {
    const chosen = scenarios.filter(s => scenarioIds.includes(s.id));
    const activeId = chosen.some(s => s.id === activeScenarioId) ? activeScenarioId : (chosen[0]?.id ?? activeScenarioId);
    // Seed the throwaway DB from the LIVE store's in-memory bytes — not from
    // OPFS/localStorage, which can lag behind the persist effect's latest write
    // (issue U-01). The chosen-subset overwrite below still filters the backup
    // to what the user picked; the seed just guarantees the starting point is
    // current, not stale.
    const seed = store?.exportBytes();
    const db = await AppDatabase.open(seed);
    db.saveScenarios(chosen);
    db.saveActiveScenarioId(activeId);
    if (includeConfig) db.saveConfig(config);
    // AI data is opt-in: pack the localStorage payload under the same kv key
    // when the user asked for it, strip it from the file otherwise (the live
    // store may hold it even when this backup shouldn't).
    packAiKey(db, AI_CHATS_STORAGE_KEY, ai.chats);
    packAiKey(db, AI_SETTINGS_STORAGE_KEY, ai.settings);
    // UI preferences always ride along (issue #20): the store's kv rows were
    // seeded from the live bytes, but this session's pref writes may be ahead
    // of the last debounced save — copy the mirror's current payload over to
    // be sure. These are non-sensitive choices, unlike the AI keys above, so
    // there's no reason to make them opt-in.
    for (const key of PREF_KEYS) packAiKey(db, key, true);
    const bytes = db.exportBytes();
    db.close();
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retirement-backup-${new Date().toISOString().split('T')[0]}.sqlite`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Apply a full-backup import chosen on the Data page.
  const handleImportFull = (sel: FullBackupSelection) => {
    // UI preferences (issue #20) go through the pref facade so BOTH homes
    // update — the mirror the synchronous readers use, and the live store's
    // kv row (writing only the mirror would leave the store's old row
    // divergent, and the next open's reconcile would revert the import).
    // Panels/print/export/EQ pick the values up on their next mount, same as
    // the AI payloads below.
    if (sel.prefs) {
      for (const [key, value] of Object.entries(sel.prefs)) {
        prefKV().setItem(key, JSON.stringify(value));
      }
    }
    const list = sel.scenarios.length > 0 ? sel.scenarios : scenarios;
    const activeId = list.some(s => s.id === sel.activeScenarioId) ? sel.activeScenarioId : list[0].id;
    setScenarios(list);
    setActiveScenarioId(activeId);
    const active = list.find(s => s.id === activeId) ?? list[0];
    setInputs(JSON.parse(JSON.stringify(active.inputs)));
    if (sel.config) setConfig(sel.config);
    // AI data applies straight back to its localStorage key; the assistant /
    // connections pages load it on next mount. The values were validated by
    // the Data page only as parseable JSON, so a malformed payload can still
    // fail those pages' own loaders — they fall back to empty, never crash.
    if (sel.aiChats !== undefined) localStorage.setItem(AI_CHATS_STORAGE_KEY, JSON.stringify(sel.aiChats));
    if (sel.aiSettings !== undefined) localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(sel.aiSettings));
    setHasUnsavedChanges(false);
    setView('projection');
  };

  // Sharing page: a plan received as a link or pasted code becomes a scenario.
  const handleSharingImport = (req: SharingImportRequest) => {
    importScenario(req.name, req.inputs);
    setView('projection');
  };

  // Data page: a projection JSON re-imported as a scenario.
  const handleProjectionImport = (req: ProjectionImportRequest) => {
    importScenario(req.name, req.inputs);
    setView('projection');
  };

  // Pending scenario switch, held while the "save your edits first?" prompt is
  // up. Null = no prompt showing.
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  const applyScenarioSwitch = (id: string) => {
    const scenario = scenarios.find(s => s.id === id);
    if (!scenario) return;
    setActiveScenarioId(id);
    setInputs(JSON.parse(JSON.stringify(scenario.inputs)));
    setHasUnsavedChanges(false);
  };

  // Update inputs when scenario changes. If the current scenario has unsaved
  // edits and the user hasn't opted out, ask whether to save before switching.
  const handleScenarioChange = (id: string) => {
    if (id === activeScenarioId) return;
    if (hasUnsavedChanges && config.general.promptToSaveOnSwitch) {
      setPendingSwitch(id);
      return;
    }
    applyScenarioSwitch(id);
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

  // Agent scenario tools (open_scenario / save_scenario_as). Both mirror the
  // sidebar paths: open saves the current plan first (nothing the user typed
  // is lost), save-as snapshots the live inputs into a NEW scenario and
  // switches to it, leaving the original untouched.
  const agentOpenScenario = (id: string) => {
    if (id === activeScenarioId) return;
    if (hasUnsavedChanges) handleSaveScenario();
    applyScenarioSwitch(id);
  };

  const agentSaveScenarioAs = (name: string) => {
    const id = `scenario-${Date.now().toString(36)}`;
    setScenarios(prev => [...prev, { id, name, inputs: JSON.parse(JSON.stringify(inputs)) }]);
    setActiveScenarioId(id);
    setHasUnsavedChanges(false);
    return id;
  };

  // Scenario revision history (scenarios page). The store owns the snapshots;
  // the UI reads them through this memo, refreshed by revisionNonce (bumped by
  // the persist effect whenever a new revision landed).
  const revisions = useMemo(
    () => store?.allRevisions() ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, revisionNonce],
  );

  // Roll back the active scenario to a revision: restore the snapshot into the
  // live working set AND the saved scenario row, and persist WITHOUT recording
  // a revision — a rollback is a move through history, not a change to it.
  // (The pre-rollback state is already in history as the newest revision; the
  // restored revision stays put too, so history is untouched.) Unsaved edits
  // are discarded — rolling back IS the explicit choice.
  const handleRollback = (revisionId: string) => {
    if (!store) return;
    const restored = store.rollbackRevision(activeScenarioId, revisionId);
    if (!restored) return;
    setInputs(restored);
    setScenarios(prev => prev.map(s =>
      s.id === activeScenarioId ? { ...s, inputs: JSON.parse(JSON.stringify(restored)) } : s
    ));
    setHasUnsavedChanges(false);
    store.persist({ scenarios: scenarios.map(s =>
      s.id === activeScenarioId ? { ...s, inputs: JSON.parse(JSON.stringify(restored)) } : s
    ), activeScenarioId, skipRevisions: true });
    // Rollback rewrites history (deletes newer revisions) but persists with
    // skipRevisions, so the persist effect above never reports a write. Bump
    // the nonce here or the history list keeps showing the deleted rows.
    setRevisionNonce(n => n + 1);
  };

  // The save-prompt modal's three outcomes. `dontAskAgain` flips the General
  // setting off (persisted), so the prompt stops appearing.
  const resolvePendingSwitch = (action: 'save' | 'discard' | 'cancel', dontAskAgain: boolean) => {
    const target = pendingSwitch;
    setPendingSwitch(null);
    if (dontAskAgain) {
      setConfig(prev => ({ ...prev, general: { ...prev.general, promptToSaveOnSwitch: false } }));
    }
    if (action === 'cancel' || target == null) return;
    if (action === 'save') handleSaveScenario();
    applyScenarioSwitch(target);
  };

  // First-scenario setup wizard. Launched from the Welcome page ("Get started"),
  // re-opened from Help, or run after New Scenario. On completion the collected
  // values overlay the current inputs (keeping engine defaults), the scenario is
  // renamed to what the user typed, and the whole thing is persisted.
  const [wizardOpen, setWizardOpen] = useState(false);
  // Set when the primary wizard finished with "add a spouse" checked: the plan
  // is saved (with a baseline spouse so the household already runs as a couple)
  // and a second, limited wizard pass opens to collect the partner's numbers.
  const [spouseWizardOpen, setSpouseWizardOpen] = useState(false);
  const handleWizardComplete = (data: WizardData, opts: { addSpouse: boolean }) => {
    let next = applyWizardData(inputs, data);
    // "Add a spouse" on the review step: enable a baseline spouse (starting at
    // the same ages) so the household runs as a couple — then the spouse pass
    // below replaces the baseline with the partner's real numbers.
    if (opts.addSpouse && !next.spouse?.enabled) {
      next = {
        ...next,
        spouseSource: { kind: 'builtin' },
        spouse: baselineSpouse(next),
      };
    }
    const finalInputs = consistentAges(JSON.parse(JSON.stringify(next)));
    setInputs(finalInputs);
    // Persist inputs AND the chosen name straight into the active scenario so
    // the new plan survives a reload without a separate "save" click. The name
    // must be included here — setScenarios and setInputs flush together, so
    // renaming in the same functional update keeps name and inputs in sync.
    const name = data.scenarioName.trim() || 'My Plan';
    setScenarios(prev => prev.map(s =>
      s.id === activeScenarioId ? { ...s, name, inputs: JSON.parse(JSON.stringify(finalInputs)) } : s
    ));
    setHasUnsavedChanges(false);
    setWizardOpen(false);
    if (opts.addSpouse) {
      // Run the partner through their own limited wizard rather than dropping
      // the user into the sidebar's Spouse section cold.
      setSpouseWizardOpen(true);
    } else {
      setView('projection');
    }
  };

  // Spouse pass done: write the partner's numbers into the (already saved)
  // scenario's spouse block and persist again.
  const handleSpouseWizardComplete = (data: WizardData) => {
    const next = consistentAges(applySpouseWizardData(inputs, data));
    setInputs(next);
    setScenarios(prev => prev.map(s =>
      s.id === activeScenarioId ? { ...s, inputs: JSON.parse(JSON.stringify(next)) } : s
    ));
    setHasUnsavedChanges(false);
    setSpouseWizardOpen(false);
    setView('projection');
  };

  // Sidebar "Save to linked plan": patch person fields on another saved
  // scenario (the linked spouse) without switching to it. The resolution memo
  // picks the change up on the next render, so the household updates in place.
  const handleUpdateScenarioInputs = (scenarioId: string, patch: Partial<RetirementInputs>) => {
    setScenarios(prev => prev.map(s =>
      s.id === scenarioId ? { ...s, inputs: { ...s.inputs, ...patch } } : s
    ));
  };

  // Sidebar "Save spouse as its own plan": promote the embedded spouse to a
  // standalone scenario. Person fields come from the spouse block; the shared
  // household fields (horizon, market, province) are inherited from the host —
  // the same split legacyToShared/legacySpouseToPerson make for the engine.
  // The new plan gets engine-typical defaults for fields a spouse block
  // doesn't carry (annualWithdrawal is recomputed by the engine anyway).
  const handleSaveSpouseAsScenario = (name: string) => {
    if (!inputs.spouse) return;
    const person = legacySpouseToPerson(inputs.spouse);
    const spouseInputs: RetirementInputs = {
      ...person,
      maxAge: inputs.maxAge,
      investmentReturn: inputs.investmentReturn,
      returnVolatility: inputs.returnVolatility,
      provinceCode: inputs.provinceCode,
      annualWithdrawal: 0,
      cppAdjustedAmount: false,
      withdrawalOrder: person.withdrawalOrder ?? ['tfsa', 'taxable', 'rrsp'],
      spouse: undefined,
      spouseSource: undefined,
    };
    setScenarios(prev => [...prev, {
      id: `scenario-${Date.now()}`,
      name,
      inputs: spouseInputs,
    }]);
  };

  // The runnable household derived once from the resolved inputs — the engine
  // and every read-side helper operate on this model (issue #124).
  const household = useMemo(() => toHousehold(resolvedInputs), [resolvedInputs]);

  const results = useMemo(() => {
    return calculateHouseholdModel(household, config);
  }, [household, config]);

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
    const { retirementAge: _ra, desiredSpending: _ds, ...financial } = resolvedInputs;
    return JSON.stringify({
      financial,
      config,
      rx: renderRange('retirementAge', axisValue(resolvedInputs, 'retirementAge'), resolvedInputs),
      ry: renderRange('desiredSpending', axisValue(resolvedInputs, 'desiredSpending'), resolvedInputs),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedInputs, config]);

  // The success-rate READOUT under the dot is one cheap Monte Carlo node on the
  // main thread. Unlike the grid, it DOES depend on the current point, so it
  // re-solves on every inputs change (debounced) — including pad-axis drags.
  useEffect(() => {
    if (view !== 'eq') return;
    setEqSolved(s => ({ ...s, solving: true }));
    const t = setTimeout(() => {
      try {
        const successRate = solveEqReadout({ inputs: resolvedInputs, config, pad: { x: 'retirementAge', y: 'desiredSpending' } });
        setEqSolved(s => ({ ...s, successRate, solving: false }));
      } catch {
        setEqSolved(s => ({ ...s, solving: false }));
      }
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, resolvedInputs, config]);

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
          inputs: resolvedInputs, config, pad: { x: 'retirementAge', y: 'desiredSpending' },
          // Shade the ranges the pad actually renders (grown to fit an
          // out-of-range point), so the gradient lines up with the dot.
          ranges: {
            x: renderRange('retirementAge', axisValue(resolvedInputs, 'retirementAge'), resolvedInputs),
            y: renderRange('desiredSpending', axisValue(resolvedInputs, 'desiredSpending'), resolvedInputs),
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
    () => combineHouseholdBreakdown(results, household),
    [results, household]
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
    const vol = resolvedInputs.returnVolatility ?? 0;
    if (vol <= 0) { setMcRequest(null); return; }
    // Build immediately when there's nothing showing yet (first visit) or a
    // fresh manual refresh was requested (nonce consumed once). Debounce only
    // the input-driven rebuilds so slider drags don't spam 500-run batches.
    // Monte Carlo runs against the RESOLVED plan (linked spouse materialized)
    // so the fan matches the projection dashboard.
    const manualRefresh = mcRefreshNonce !== mcNonceSeen.current;
    if (mcRequest == null || manualRefresh) {
      mcNonceSeen.current = mcRefreshNonce;
      setMcRequest({ inputs: resolvedInputs, config, runs: 500, volatility: vol });
      return;
    }
    const t = setTimeout(() => {
      setMcRequest({ inputs: resolvedInputs, config, runs: 500, volatility: vol });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, resolvedInputs, config, mcRefreshNonce]);

  // Backtest is its own page too. It's fast and synchronous, so recompute on
  // the route whenever inputs/config change — no debounce needed. Real-return
  // series: inflation off so historical multipliers match today's-dollar spending.
  useEffect(() => {
    if (view !== 'backtest') { setBacktestResult(null); return; }
    const realConfig: AppConfig = JSON.parse(JSON.stringify(config));
    realConfig.engine.inflationRate = 0;
    // Backtest the RESOLVED plan so a linked spouse's balances/benefits are
    // the ones being tested against history.
    setBacktestResult(runBacktest(resolvedInputs, realConfig, calculateHousehold));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, resolvedInputs, config]);

  // The beta skin replaces the whole view; every hook above has already run
  // unconditionally, so toggling ?beta off just re-renders the stable UI.
  // `inputs` here is the RAW plan (like SidebarForm) — the two levers touch
  // host-won household fields, so it matches the resolved numbers on screen.
  if (beta) {
    // The style guide is part of the beta skin — reach it without leaving the
    // new surface. It reads only src/design/, so it always matches the code.
    // `view` already parsed #/styleguide via viewFromHash, so the URL-sync
    // effect above recognizes the route and leaves the hash alone.
    if (view === 'styleguide') {
      return <StyleGuide />;
    }
    return (
      <BetaApp
        scenarios={scenarios}
        activeScenarioId={activeScenarioId}
        onScenarioChange={handleScenarioChange}
        inputs={inputs}
        onInputsChange={handleInputsChange}
        results={results}
        hasUnsavedChanges={hasUnsavedChanges}
        onSave={handleSaveScenario}
      />
    );
  }

  return (
    <div className="min-h-screen md:h-screen flex flex-col bg-slate-50">
      {/* Print-only one-page summary (hidden on screen; see index.css) */}
      <PrintSummary
        scenarioName={activeScenario.name}
        inputs={resolvedInputs}
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

      {/* Config-reset warning (issue #19): the stored engine config failed
          validation and was replaced by defaults — the user's custom tax
          tables didn't survive the load and need re-entering. Dismissible;
          it does not re-fire this session. */}
      {configLoadWarning && (
        <div className="no-print flex items-center gap-2 bg-amber-50 border-b border-amber-300 px-3 md:px-6 py-2 text-xs text-amber-900" role="alert">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">{configLoadWarning}</span>
          <button
            onClick={() => setConfigLoadWarning(null)}
            className="shrink-0 rounded p-0.5 hover:bg-amber-100"
            title="Dismiss this warning"
            aria-label="Dismiss settings warning"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Durability warning (issue U-02): shown when a persist write failed
          (OPFS unavailable/full, or localStorage full with no OPFS). Clears
          itself on the next durable write; dismissible for the session. The
          fix is usually "free up browser storage" — the plan still lives in
          this tab's memory, so exporting a backup keeps it. */}
      {saveError && (
        <div className="no-print flex items-center gap-2 bg-amber-50 border-b border-amber-300 px-3 md:px-6 py-2 text-xs text-amber-900" role="alert">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">
            <strong>Changes may not be saved.</strong> Browser storage is unavailable or full —
            your plan is still in this tab, but it won&apos;t survive closing it.
            Free up site storage, or use Data → Export full backup to keep a copy on disk.
          </span>
          <button
            onClick={() => setSaveError(false)}
            className="shrink-0 rounded p-0.5 hover:bg-amber-100"
            title="Dismiss (the warning returns if saving still fails)"
            aria-label="Dismiss storage warning"
          >
            <X size={14} />
          </button>
        </div>
      )}

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
            onUpdateScenarioInputs={handleUpdateScenarioInputs}
            onSaveSpouseAsScenario={handleSaveSpouseAsScenario}
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
                {view === 'export' && <span className="text-slate-900">Data</span>}
                {view === 'scenarios' && <span className="text-slate-900">Manage Scenarios</span>}
                {view === 'sharing' && <span className="text-slate-900">Sharing</span>}
                {view === 'agent' && <span className="text-slate-900">AI Assistant</span>}
                {view === 'connections' && <span className="text-slate-900">AI Connections</span>}
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
                  onClick={() => setView('agent')}
                  className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-800 hover:underline"
                  title="Chat with an AI that can read your plan and run the engine (bring your own API key)"
                >
                  <Bot size={13} /> Assistant

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
              </div>
            </div>
          </div>

          <div className="px-3 md:px-6 pb-3 md:pb-6">
            {view === 'projection' && (
              <>
                {/* KPI Cards */}
                <CollapsiblePanel id="summary" title="Projection Summary">
                  <MetricCards results={results} household={household} />
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
                inputs={resolvedInputs}
                config={config}
                onApply={(patch) => handleInputsChange({ ...inputs, ...patch })}
              />
            )}

            {view === 'agent' && (
              <AgentPage
                inputs={resolvedInputs}
                config={config}
                scenarioName={activeScenario.name}
                scenarioList={scenarios.map(s => ({ id: s.id, name: s.name }))}
                activeScenarioId={activeScenarioId}
                scenarioInputsById={(id) => scenarios.find(s => s.id === id)?.inputs}
                onApply={(patch) => handleInputsChange({ ...inputs, ...patch })}
                onOpenConnections={() => setView('connections')}
                memory={store?.memory}
                memoryScenarioId={activeScenarioId}
                onOpenScenario={agentOpenScenario}
                onSaveScenarioAs={agentSaveScenarioAs}
              />
            )}

            {view === 'connections' && <ConnectionsPage onClose={() => setView('agent')} />}

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
                revisions={revisions}
                onRollback={handleRollback}
                onSelectScenario={(id) => { handleScenarioChange(id); setView('projection'); }}
                onCreateScenario={(scenario) => {
                  // Add AND activate in one shot. Setting inputs directly from the
                  // new scenario (rather than re-finding it in the list) avoids
                  // the stale-state race where the select ran before the add.
                  setScenarios(prev => [...prev, scenario]);
                  setActiveScenarioId(scenario.id);
                  setInputs(JSON.parse(JSON.stringify(scenario.inputs)));
                  setHasUnsavedChanges(false);
                  // A brand-new baseline gets the guided setup; a Duplicate
                  // (already-filled inputs) goes straight to the projection.
                  if (scenario.isFresh) {
                    setWizardOpen(true);
                    setView('welcome');
                  } else {
                    setView('projection');
                  }
                }}
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
              spouseWizardOpen ? (
                <SetupWizard
                  key="spouse"
                  initial={spouseWizardDataFrom(inputs)}
                  onComplete={(data) => handleSpouseWizardComplete(data)}
                  onSkip={() => { setSpouseWizardOpen(false); setView('projection'); }}
                />
              ) : wizardOpen ? (
                <SetupWizard
                  initial={wizardDataFrom(inputs, activeScenario.name)}
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
                inputs={resolvedInputs}
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

      {pendingSwitch != null && (
        <SavePromptModal
          scenarioName={activeScenario.name}
          onSave={(dontAsk) => resolvePendingSwitch('save', dontAsk)}
          onDiscard={(dontAsk) => resolvePendingSwitch('discard', dontAsk)}
          onCancel={() => resolvePendingSwitch('cancel', false)}
        />
      )}
    </div>
  );
}

export default App;
