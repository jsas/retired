// Connections page: where the user manages WHICH model/provider the assistant
// uses. Two tiers —
//   • On this computer (web-llm): private, free, offline; pick + download a
//     local model here, and delete the download to reclaim disk space.
//   • Advanced (cloud providers): BYO API key for Claude / GPT / Gemini / etc.
// This page owns its own AI-settings state and the local-model engine warm-up
// so the assistant page can stay focused on chatting. Everything is stored
// locally in the browser; keys never touch our servers.

import { useEffect, useRef, useState } from 'react';
import {
  Plug, Plus, Trash2, X, Check, ChevronDown, ChevronRight, Lock,
} from 'lucide-react';
import {
  AI_PROVIDERS, connectionReady, defaultBaseUrlFor, defaultModelFor,
  loadAiSettings, newConnectionId, saveAiSettings,
  type AiConnection, type AiSettings,
} from '../lib/aiSettings';
import { WEBLLM_MODELS, fmtSize, webGpuAvailable, type WebLlmModelChoice } from '../lib/ai/webLlmModels';
import { buildMachineGuide, detectGpuMemoryGB, type MachineGuide } from '../lib/ai/machineGuide';
import { deleteWebLlmModel, isWebLlmModelCached } from '../lib/ai/webLlmProvider';
import { PROVIDER_HELP } from '../lib/ai/providerHelp';

export function ConnectionsPage() {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  useEffect(() => { saveAiSettings(settings); }, [settings]);

  // Local-model engine warm-up state, so the download/compile can be started
  // here (and cancelled) instead of stalling the first chat message.
  const [engineState, setEngineState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [engineError, setEngineError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ progress: number; text: string } | null>(null);
  const warmAbortRef = useRef<AbortController | null>(null);

  const updateSettings = (mutate: (s: AiSettings) => void) => {
    setSettings(prev => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
  };

  const active = settings.connections.find(c => c.id === settings.activeConnectionId) ?? null;
  // Reset engine status when the chosen local model changes.
  const engineKey = `${active?.id ?? ''}:${active?.model ?? ''}`;
  const [prevEngineKey, setPrevEngineKey] = useState(engineKey);
  if (prevEngineKey !== engineKey) {
    setPrevEngineKey(engineKey);
    setEngineState('idle');
    setEngineError(null);
  }

  /** Download + compile the chosen local model now. Cancellable. */
  const warmUpLocalModel = async () => {
    if (!active || active.provider !== 'webllm') return;
    const abort = new AbortController();
    warmAbortRef.current = abort;
    setEngineState('loading');
    setEngineError(null);
    setLoadProgress({ progress: 0, text: 'Downloading the model…' });
    try {
      const { loadWebLlmEngine, loadedWebLlmModel } = await import('../lib/ai/webLlmProvider');
      await loadWebLlmEngine(active.model, p => {
        setLoadProgress(p.progress >= 1
          ? { progress: 1, text: 'Compiling the model for your GPU…' }
          : p);
      }, abort.signal);
      setEngineState(loadedWebLlmModel() === active.model ? 'ready' : 'idle');
    } catch (err) {
      if (abort.signal.aborted) {
        setEngineState('idle'); // cancelled — quiet reset, not an error
      } else {
        setEngineState('error');
        setEngineError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoadProgress(null);
      warmAbortRef.current = null;
    }
  };
  const cancelWarmUp = () => warmAbortRef.current?.abort();

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-1.5 mb-1">
        <Plug size={18} className="text-violet-600" />
        <h2 className="text-lg font-bold text-slate-900">Models &amp; Connections</h2>
      </div>
      <p className="text-[11px] text-slate-500 leading-snug mb-4">
        Choose what powers the assistant. The simplest option runs <strong className="text-slate-700">entirely on
        this computer</strong> — free, private, offline. Bring-your-own-key providers are stored only in this
        browser and contacted directly when you chat.
      </p>

      <ConnectionSetup
        settings={settings}
        onChange={updateSettings}
        engine={{ state: engineState, error: engineError, progress: loadProgress, onUse: () => void warmUpLocalModel(), onCancel: cancelWarmUp }}
        onModelDeleted={() => { setEngineState('idle'); setEngineError(null); }}
      />

      {/* Which connection the assistant uses, when more than one exists. */}
      {settings.connections.length > 1 && (
        <div className="mt-4 border border-slate-200 bg-white rounded p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
            Active connection
          </div>
          <select
            value={settings.activeConnectionId ?? ''}
            onChange={e => updateSettings(s => { s.activeConnectionId = e.target.value || null; })}
            className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-700 w-full sm:w-auto"
          >
            {settings.connections.map(c => (
              <option key={c.id} value={c.id}>{c.label || c.provider} · {c.model}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection setup panel
// ---------------------------------------------------------------------------

function ConnectionSetup({ settings, onChange, engine, onModelDeleted }: {
  settings: AiSettings;
  onChange: (mutate: (s: AiSettings) => void) => void;
  engine: { state: 'idle' | 'loading' | 'ready' | 'error'; error: string | null; progress: { progress: number; text: string } | null; onUse: () => void; onCancel: () => void };
  onModelDeleted: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [addingProvider, setAddingProvider] = useState<(typeof AI_PROVIDERS)[number]>('gemini');
  const [guide, setGuide] = useState<MachineGuide | null>(null);

  const webllmConn = settings.connections.find(c => c.provider === 'webllm') ?? null;

  // Probe the machine once so we can recommend a model size in plain English.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const gpu = webGpuAvailable();
      const mem = gpu ? await detectGpuMemoryGB() : null;
      if (!cancelled) setGuide(buildMachineGuide(gpu, mem));
    })();
    return () => { cancelled = true; };
  }, []);

  const patch = (id: string, p: Partial<AiConnection>) => {
    onChange(s => {
      const c = s.connections.find(x => x.id === id);
      if (c) Object.assign(c, p);
    });
  };

  const ensureWebllm = () => {
    if (webllmConn) {
      onChange(s => { s.activeConnectionId = webllmConn.id; });
      return;
    }
    const id = newConnectionId();
    onChange(s => {
      s.connections.push({
        id, provider: 'webllm', label: 'On this computer', apiKey: '',
        model: guide?.recommended.id ?? defaultModelFor('webllm'),
      });
      s.activeConnectionId = id;
    });
  };

  const addCloud = () => {
    const id = newConnectionId();
    onChange(s => {
      s.connections.push({
        id, provider: addingProvider, label: '', apiKey: '',
        model: defaultModelFor(addingProvider),
        baseUrl: defaultBaseUrlFor(addingProvider),
      });
      s.activeConnectionId = id;
    });
  };

  return (
    <div>
      {/* ---- Simple: on this computer (the default for everyone) ---- */}
      <div className="border border-emerald-200 bg-emerald-50/60 rounded p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
          <Lock size={12} /> On this computer — free, private, works offline
        </div>
        {!webllmConn && (
          <p className="text-[11px] text-emerald-900/80 leading-snug mt-1">
            The model downloads once and runs here; nothing you type leaves the device.
          </p>
        )}
        {guide && !guide.webgpu && (
          <div className="text-[11px] mt-1.5">
            <div className="font-semibold text-red-700">{guide.headline}</div>
            <div className="text-slate-600 leading-snug mt-0.5">{guide.detail}</div>
          </div>
        )}

        {!webllmConn ? (
          <button
            onClick={ensureWebllm}
            disabled={guide != null && !guide.webgpu}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700 disabled:opacity-40"
          >
            <Check size={13} />
            {guide && guide.webgpu && guide.gpuMemoryGB != null
              ? `Set up — we suggest ${guide.recommended.label}`
              : 'Set up the on-computer assistant'}
          </button>
        ) : (
          <LocalModelPicker conn={webllmConn} guide={guide} onPatch={patch} engine={engine} onModelDeleted={onModelDeleted} />
        )}
      </div>

      {/* ---- Advanced: cloud providers with API keys ---- */}
      <div className="mt-3">
        <button
          onClick={() => setAdvancedOpen(o => !o)}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800"
        >
          {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Advanced: use an online provider (needs an API key)
        </button>

        {advancedOpen && (
          <div className="mt-2 border border-slate-200 bg-white rounded p-3">
            <p className="text-[11px] text-slate-500 leading-snug mb-3">
              For stronger models. You sign up with the provider, copy an API key, and paste it here —
              the key is stored only in this browser and sent only to that provider when you chat.
            </p>

            <div className="space-y-3">
              {settings.connections.filter(c => c.provider !== 'webllm').map(c => (
                <CloudConnectionCard key={c.id} conn={c} onPatch={patch} onDelete={() => onChange(s => {
                  s.connections = s.connections.filter(x => x.id !== c.id);
                  if (s.activeConnectionId === c.id) s.activeConnectionId = s.connections[0]?.id ?? null;
                })} />
              ))}
            </div>

            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
              <select
                value={addingProvider}
                onChange={e => setAddingProvider(e.target.value as (typeof AI_PROVIDERS)[number])}
                className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs"
              >
                {AI_PROVIDERS.filter(p => p !== 'webllm').map(p => (
                  <option key={p} value={p}>{PROVIDER_HELP[p]?.name ?? p}</option>
                ))}
              </select>
              <button
                onClick={addCloud}
                className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded hover:bg-violet-700"
              >
                <Plus size={13} /> Add provider
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Dead-simple local-model setup. Three states, one at a time:
 *   1. PICK  — click a model card to select it, one big download button.
 *   2. LOAD  — the list is gone; only a progress bar and Cancel remain.
 *   3. READY — a check mark confirming the model is loaded. */
function LocalModelPicker({ conn, guide, onPatch, engine, onModelDeleted }: {
  conn: AiConnection;
  guide: MachineGuide | null;
  onPatch: (id: string, p: Partial<AiConnection>) => void;
  engine: { state: 'idle' | 'loading' | 'ready' | 'error'; error: string | null; progress: { progress: number; text: string } | null; onUse: () => void; onCancel: () => void };
  onModelDeleted: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const current = WEBLLM_MODELS.find(m => m.id === conn.model);
  const isCustom = !current;

  // ---- 2. LOADING: progress + cancel, nothing else. ----
  if (engine.state === 'loading') {
    const pct = engine.progress ? Math.round(engine.progress.progress * 100) : 0;
    const compiling = engine.progress != null && engine.progress.progress >= 1;
    return (
      <div className="mt-3 max-w-md">
        <div className="text-xs font-semibold text-slate-800 mb-1.5">
          {compiling ? 'Almost there — finishing setup…' : `Downloading ${current?.label ?? 'the model'}…`}
        </div>
        <div className="h-2 bg-slate-200 rounded overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${compiling ? 100 : pct}%` }} />
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-[10px] text-slate-500">
            {compiling ? 'getting it ready for your computer' : `${pct}% · ${fmtSize(current?.sizeGB ?? 0)} one-time download`}
          </span>
          <button
            onClick={engine.onCancel}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-600 font-semibold"
          >
            <X size={12} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  // ---- 3. READY: confirm it's loaded. ----
  if (engine.state === 'ready') {
    return (
      <div className="mt-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <Check size={14} /> {current?.label ?? 'The model'} is ready — private, on this device
        </span>
        <DeleteLocalModel modelId={conn.model} sizeGB={current?.sizeGB} onDeleted={onModelDeleted} />
      </div>
    );
  }

  // ---- 1. PICK (or recover from an error). ----
  const byVram = [...WEBLLM_MODELS].sort((a, b) => a.vramMB - b.vramMB);
  let visible: WebLlmModelChoice[];
  if (showAll) {
    visible = WEBLLM_MODELS;
  } else if (guide) {
    const short = new Set([guide.recommended.id, ...(isCustom ? [] : [conn.model])]);
    visible = WEBLLM_MODELS.filter(m => short.has(m.id));
    if (visible.length < 2) visible = byVram.slice(0, 3);
  } else {
    visible = byVram.slice(0, 3);
  }

  return (
    <div className="mt-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
        1 · Pick a model
      </div>
      <div className="space-y-1">
        {visible.map(m => (
          <button
            key={m.id}
            onClick={() => onPatch(conn.id, { model: m.id })}
            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded border text-left text-[11px] bg-white ${
              conn.model === m.id ? 'border-emerald-500 ring-1 ring-emerald-300' : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${
              conn.model === m.id ? 'border-emerald-600 bg-emerald-500' : 'border-slate-300'
            }`} />
            <span className="flex-1 min-w-0">
              <span className="font-semibold text-slate-800">{m.label}</span>
              <span className="text-slate-400"> · {fmtSize(m.sizeGB)}</span>
              {guide?.recommended.id === m.id && (
                <span className="ml-1.5 text-[9px] font-bold text-emerald-700 bg-emerald-100 rounded px-1 py-0.5">BEST FOR YOU</span>
              )}
              <span className="block text-[10px] text-slate-500 truncate">{m.blurb}</span>
            </span>
          </button>
        ))}
        {!showAll && (
          <button onClick={() => setShowAll(true)} className="text-[11px] text-emerald-700 hover:underline pl-1">
            Show all {WEBLLM_MODELS.length} models…
          </button>
        )}
      </div>

      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mt-3 mb-1">
        2 · Download it (once)
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={engine.onUse}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700"
        >
          Download {current?.label ?? 'model'}{current ? ` · ${fmtSize(current.sizeGB)}` : ''}
        </button>
        <span className="text-[10px] text-slate-400">then it works offline, nothing leaves this device</span>
      </div>
      {engine.state === 'error' && (
        <div className="mt-1.5 text-[11px] text-red-700">{engine.error}</div>
      )}

      <DeleteLocalModel modelId={conn.model} sizeGB={current?.sizeGB} onDeleted={onModelDeleted} />
    </div>
  );
}

/** Shows whether the picked model is already downloaded, with a delete
 *  affordance to free the disk space. Deleting also unloads the live engine
 *  (handled in the provider), so the parent resets its engine state. */
function DeleteLocalModel({ modelId, sizeGB, onDeleted }: {
  modelId: string;
  sizeGB?: number;
  onDeleted: () => void;
}) {
  const [cached, setCached] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isWebLlmModelCached(modelId).then(c => { if (!cancelled) setCached(c); });
    return () => { cancelled = true; };
  }, [modelId]);

  if (cached !== true) return null;

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteWebLlmModel(modelId);
      setCached(false);
      setConfirming(false);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mt-3 pt-2 border-t border-emerald-100">
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-600"
        >
          <Trash2 size={11} />
          Remove this download{sizeGB ? ` (frees ~${fmtSize(sizeGB)})` : ''}
        </button>
      ) : (
        <span className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-600">Delete the downloaded model? You'll download it again to use it.</span>
          <button
            onClick={() => void doDelete()}
            disabled={deleting}
            className="px-2 py-0.5 bg-red-600 text-white font-semibold rounded hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={deleting}
            className="text-slate-500 hover:underline"
          >
            Keep
          </button>
        </span>
      )}
    </div>
  );
}

function CloudConnectionCard({ conn: c, onPatch, onDelete }: {
  conn: AiConnection;
  onPatch: (id: string, p: Partial<AiConnection>) => void;
  onDelete: () => void;
}) {
  const help = PROVIDER_HELP[c.provider];
  return (
    <div className="border border-slate-200 bg-white rounded p-2.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700 bg-violet-100 rounded px-1.5 py-0.5">
          {help?.name ?? c.provider}
        </span>
        {help?.easiest && (
          <span className="text-[9px] font-bold text-blue-700 bg-blue-100 rounded px-1 py-0.5">EASIEST</span>
        )}
        <input
          value={c.label}
          onChange={e => onPatch(c.id, { label: e.target.value })}
          placeholder="Label (e.g. My key)"
          className="flex-1 px-2 py-1 border border-slate-200 rounded text-xs"
        />
        <button
          onClick={onDelete}
          className="text-slate-400 hover:text-red-600"
          title="Delete this connection (the key is removed from this browser)"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {help && (
        <div className="mb-2 text-[11px] text-slate-500 leading-snug">
          {help.howTo}
          {help.keyUrl && (
            <> {' '}
              <a href={help.keyUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                Get a key here ↗
              </a>
            </>
          )}
          <span className="block text-[10px] text-slate-400 mt-0.5">{help.cost}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {c.provider !== 'ollama' && (
          <label className="block">
            <span className="block text-[10px] text-slate-500 mb-0.5">API key (stored locally only)</span>
            <input
              type="password"
              value={c.apiKey}
              onChange={e => onPatch(c.id, { apiKey: e.target.value })}
              placeholder={c.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              autoComplete="off"
              className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono"
            />
          </label>
        )}
        <label className="block">
          <span className="block text-[10px] text-slate-500 mb-0.5">Model</span>
          <input
            value={c.model}
            onChange={e => onPatch(c.id, { model: e.target.value })}
            placeholder={defaultModelFor(c.provider) || 'model id'}
            className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono"
          />
        </label>
        {(c.provider === 'ollama' || c.provider === 'openai-compatible' || c.provider === 'openrouter' || c.provider === 'openai') && (
          <label className="block sm:col-span-2">
            <span className="block text-[10px] text-slate-500 mb-0.5">Base URL</span>
            <input
              value={c.baseUrl ?? ''}
              onChange={e => onPatch(c.id, { baseUrl: e.target.value })}
              placeholder={defaultBaseUrlFor(c.provider) ?? 'https://…/v1'}
              className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono"
            />
          </label>
        )}
      </div>
      {!connectionReady(c) && (
        <div className="mt-1.5 text-[10px] text-amber-700">
          Incomplete: {c.provider === 'ollama' || c.provider === 'openai-compatible'
            ? 'needs a base URL and a model'
            : 'needs an API key and a model'}.
        </div>
      )}
    </div>
  );
}
