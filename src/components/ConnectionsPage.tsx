// Connections page, in two separate halves —
//
//   MODELS (on this computer) — the private, offline web-llm tier. A catalog
//   row per known model shows whether it's downloaded and offers Download or
//   Delete; a "downloads" block underneath lists anything else living in the
//   browser cache (a model you fetched earlier that's no longer in the
//   catalog) so it can be deleted to reclaim disk. One row is "chosen" — the
//   model the local assistant actually runs.
//
//   CONNECTIONS — how the assistant reaches a model at all: the local engine
//   (which uses whatever model is chosen above) plus any BYO-key cloud
//   providers. Picking the active connection here is what the assistant's
//   header picker mirrors.
//
// This page owns its own AI-settings state and the local-engine warm-up so the
// assistant page stays focused on chatting. Keys and settings are stored only
// in this browser and never touch our servers.

import { useEffect, useRef, useState } from 'react';
import {
  Plug, Plus, Trash2, X, Check, ChevronDown, ChevronRight, Lock, Download, Loader2,
  RefreshCw, Zap,
} from 'lucide-react';
import {
  AI_PROVIDERS, connectionReady, defaultBaseUrlFor, defaultModelFor,
  loadAiSettings, newConnectionId, saveAiSettings,
  type AiConnection, type AiSettings,
} from '../lib/aiSettings';
import { listModels, testConnection, type ModelInfo } from '../lib/ai/providers';
import { WEBLLM_MODELS, fmtSize, webGpuAvailable } from '../lib/ai/webLlmModels';
import { buildMachineGuide, detectGpuMemoryGB, type MachineGuide } from '../lib/ai/machineGuide';
import { estimateContextFit, fmtMB } from '../lib/ai/vramEstimate';
import { defaultContextSize } from '../lib/ai/context';
import { deleteWebLlmModel, isWebLlmModelCached } from '../lib/ai/webLlmProvider';
import { PROVIDER_HELP } from '../lib/ai/providerHelp';

/** Upper bound for the local context window — above this even big GPUs run
 *  out of room for the KV cache, and the small models lose coherence long
 *  before they fill it. */
const MAX_LOCAL_CONTEXT = 32768;

export function ConnectionsPage({ onClose }: { onClose?: () => void }) {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings);
  useEffect(() => { saveAiSettings(settings); }, [settings]);

  const updateSettings = (mutate: (s: AiSettings) => void) => {
    setSettings(prev => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
  };

  const webllmConn = settings.connections.find(c => c.provider === 'webllm') ?? null;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-1.5 mb-1">
        <Plug size={18} className="text-violet-600" />
        <h2 className="text-lg font-bold text-slate-900">Models &amp; Connections</h2>
        {/* This page is reached from (and is subordinate to) the Assistant —
            the close button returns there. */}
        {onClose && (
          <button
            onClick={onClose}
            title="Back to the assistant"
            className="ml-auto p-1 text-slate-400 hover:text-slate-700 rounded"
          >
            <X size={16} />
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500 leading-snug mb-4">
        <strong className="text-slate-700">Models</strong> are what thinks; <strong className="text-slate-700">connections</strong> are
        how the assistant reaches one. The simplest model runs <strong className="text-slate-700">entirely on this
        computer</strong> — free, private, offline. Cloud connections store their key only in this browser and
        contact the provider directly when you chat.
      </p>

      <ModelsSection
        onChange={updateSettings}
        webllmConn={webllmConn}
      />

      <ConnectionsSection
        settings={settings}
        onChange={updateSettings}
        webllmConn={webllmConn}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MODELS — the on-this-computer catalog + anything else already downloaded
// ---------------------------------------------------------------------------

function ModelsSection({ onChange, webllmConn }: {
  onChange: (mutate: (s: AiSettings) => void) => void;
  webllmConn: AiConnection | null;
}) {
  const [guide, setGuide] = useState<MachineGuide | null>(null);
  const [showAll, setShowAll] = useState(false);
  // modelId -> downloaded? Re-probed on demand after a download/delete.
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ progress: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const chosenId = webllmConn?.model ?? null;

  // Probe the machine (for a recommendation) and the cache once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const gpu = webGpuAvailable();
      const mem = gpu ? await detectGpuMemoryGB() : null;
      if (!cancelled) setGuide(buildMachineGuide(gpu, mem));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Re-check every catalog id (and the chosen/custom id) against the cache,
   *  and collect ids that are downloaded but NOT in the catalog (so the user
   *  can delete a model they fetched that's no longer offered). */
  const reprobe = async () => {
    const ids = new Set<string>(WEBLLM_MODELS.map(m => m.id));
    if (chosenId) ids.add(chosenId);
    const next: Record<string, boolean> = {};
    for (const id of ids) next[id] = await isWebLlmModelCached(id);
    // Any cached id the catalog doesn't know about is an "extra" (e.g. an
    // older download). We only learn about ids we probe, so treat the chosen
    // custom id as the canonical extra when it's cached.
    const extras = [...ids].filter(id => next[id] && !WEBLLM_MODELS.some(m => m.id === id));
    return { next, extras };
  };

  useEffect(() => {
    let cancelled = false;
    void reprobe().then(({ next, extras }) => {
      if (!cancelled) { setCached(next); setExtraIds(extras); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenId]);

  const setModelCached = (id: string, v: boolean) =>
    setCached(prev => ({ ...prev, [id]: v }));

  const download = async (id: string) => {
    const abort = new AbortController();
    abortRef.current = abort;
    setDownloading(id);
    setError(null);
    setProgress({ progress: 0, text: 'Downloading the model…' });
    try {
      const { loadWebLlmEngine } = await import('../lib/ai/webLlmProvider');
      await loadWebLlmEngine(id, p => {
        setProgress(p.progress >= 1 ? { progress: 1, text: 'Compiling the model for your GPU…' } : p);
      }, abort.signal);
      setModelCached(id, true);
      // Downloading a model also makes it the chosen one, so the assistant
      // uses what you just fetched.
      if (webllmConn) onChange(s => {
        const c = s.connections.find(x => x.id === webllmConn.id);
        if (c) c.model = id;
      });
    } catch (err) {
      if (!abort.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setProgress(null);
      setDownloading(null);
      abortRef.current = null;
    }
  };

  const remove = async (id: string) => {
    await deleteWebLlmModel(id);
    setModelCached(id, false);
    setExtraIds(prev => prev.filter(x => x !== id));
  };

  const pick = (id: string) => {
    if (!webllmConn) return;
    onChange(s => {
      const c = s.connections.find(x => x.id === webllmConn.id);
      if (c) c.model = id;
    });
  };

  const byVram = [...WEBLLM_MODELS].sort((a, b) => a.vramMB - b.vramMB);
  const recommended = guide?.recommended.id ?? null;
  const visible = showAll
    ? byVram
    : byVram.filter(m => m.id === recommended || m.id === chosenId || byVram.indexOf(m) < 3);

  return (
    <section className="border border-emerald-200 bg-emerald-50/60 rounded p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
        <Lock size={12} /> Models on this computer — free, private, works offline
      </div>
      <p className="text-[11px] text-emerald-900/80 leading-snug mt-1">
        Download once, then the model runs here and nothing you type leaves the device.
        {guide && guide.webgpu && (
          <> We suggest <strong>{guide.recommended.label}</strong> for this computer.</>
        )}
      </p>
      {guide && !guide.webgpu && (
        <div className="text-[11px] mt-1.5">
          <div className="font-semibold text-red-700">{guide.headline}</div>
          <div className="text-slate-600 leading-snug mt-0.5">{guide.detail}</div>
        </div>
      )}

      {/* Catalog */}
      <div className="mt-2 space-y-1">
        {visible.map(m => {
          const isChosen = m.id === chosenId;
          const isCached = cached[m.id] === true;
          const isDownloading = downloading === m.id;
          return (
            <div
              key={m.id}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-left text-[11px] bg-white ${
                isChosen ? 'border-emerald-500 ring-1 ring-emerald-300' : 'border-slate-200'
              }`}
            >
              <button
                onClick={() => pick(m.id)}
                disabled={!webllmConn}
                title={webllmConn ? 'Use this model' : 'Add the on-computer connection (below) to pick a model'}
                className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${
                  isChosen ? 'border-emerald-600 bg-emerald-500' : 'border-slate-300'
                } ${webllmConn ? '' : 'opacity-40 cursor-not-allowed'}`}
              />
              <span className="flex-1 min-w-0">
                <span className="font-semibold text-slate-800">{m.label}</span>
                <span className="text-slate-400"> · {fmtSize(m.sizeGB)}</span>
                {recommended === m.id && (
                  <span className="ml-1.5 text-[9px] font-bold text-emerald-700 bg-emerald-100 rounded px-1 py-0.5">BEST FOR YOU</span>
                )}
                {isChosen && (
                  <span className="ml-1.5 text-[9px] font-bold text-violet-700 bg-violet-100 rounded px-1 py-0.5">IN USE</span>
                )}
                <span className="block text-[10px] text-slate-500 truncate">{m.blurb}</span>
              </span>
              {isDownloading ? (
                <span className="flex items-center gap-1 text-[10px] text-slate-500 shrink-0">
                  <Loader2 size={11} className="animate-spin" />
                  {progress && progress.progress < 1 ? `${Math.round(progress.progress * 100)}%` : '…'}
                </span>
              ) : isCached ? (
                <CachedActions id={m.id} sizeGB={m.sizeGB} onDelete={() => void remove(m.id)} />
              ) : (
                <button
                  onClick={() => void download(m.id)}
                  disabled={downloading != null || (guide != null && !guide.webgpu)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 text-white text-[11px] font-semibold rounded hover:bg-emerald-700 disabled:opacity-40 shrink-0"
                >
                  <Download size={11} /> Download
                </button>
              )}
            </div>
          );
        })}
        {!showAll && WEBLLM_MODELS.length > visible.length && (
          <button onClick={() => setShowAll(true)} className="text-[11px] text-emerald-700 hover:underline pl-1">
            Show all {WEBLLM_MODELS.length} models…
          </button>
        )}
      </div>

      {/* Active download progress */}
      {downloading && progress && (
        <div className="mt-2 max-w-md">
          <div className="h-2 bg-slate-200 rounded overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-slate-500">{progress.text}</span>
            <button
              onClick={() => abortRef.current?.abort()}
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-600 font-semibold"
            >
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="mt-1.5 text-[11px] text-red-700">{error}</div>}

      {/* How much the model can read at once. Plain-language framing: the
          model "sees" this much of your plan and the conversation at a time.
          The window costs GPU memory on top of the model itself, so we show
          the estimated total and warn when it won't fit. */}
      {webllmConn && (() => {
        const modelMeta = WEBLLM_MODELS.find(m => m.id === webllmConn.model);
        const tokens = webllmConn.contextSize ?? defaultContextSize('webllm');
        const fit = modelMeta ? estimateContextFit(modelMeta.vramMB, tokens, guide?.gpuMemoryGB ?? null) : null;
        return (
          <div className="mt-3 pt-2 border-t border-emerald-100">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <label htmlFor="local-ctx" className="text-[11px] font-medium text-emerald-900">
                How much the model reads at once
              </label>
              <input
                id="local-ctx"
                type="number"
                min={2048}
                max={MAX_LOCAL_CONTEXT}
                step={1024}
                value={webllmConn.contextSize ?? ''}
                onChange={e => onChange(s => {
                  const c = s.connections.find(x => x.id === webllmConn.id);
                  if (!c) return;
                  c.contextSize = e.target.value
                    ? Math.min(MAX_LOCAL_CONTEXT, Math.max(2048, Math.round(Number(e.target.value))))
                    : undefined;
                })}
                placeholder={String(defaultContextSize('webllm'))}
                className="w-24 px-2 py-1 border border-emerald-200 rounded text-xs font-mono bg-white"
              />
              <span className="text-[10px] text-emerald-900/70">
                Leave blank for the default. Larger needs more memory; smaller runs on weaker computers.
              </span>
            </div>
            {fit && (
              <div className={`text-[10px] mt-1 leading-snug ${fit.fits === false ? 'text-amber-700 font-medium' : 'text-emerald-900/60'}`}>
                Needs ≈{fmtMB(fit.neededMB)} of graphics memory at this setting
                ({fmtMB(modelMeta!.vramMB)} for the model + ≈{fmtMB(fit.cacheMB)} for the window).
                {fit.fits === false && fit.budgetMB != null && (
                  <> Your computer has about {fmtMB(fit.budgetMB)} free — lower the number or pick a smaller model.</>
                )}
                {fit.fits == null && ' Your browser didn\'t say how much you have; if loading fails, lower it.'}
              </div>
            )}
          </div>
        );
      })()}

      {/* Other downloads: cached models the catalog no longer lists, e.g. an
          older fetch. Shown so they can be deleted to free disk space. */}
      {extraIds.length > 0 && (
        <div className="mt-3 pt-2 border-t border-emerald-100">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
            Also on this device
          </div>
          <div className="space-y-1">
            {extraIds.map(id => (
              <div key={id} className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-slate-200 bg-white text-[11px]">
                <span className="flex-1 min-w-0 font-mono text-slate-600 truncate">{id}</span>
                {id === chosenId && (
                  <span className="text-[9px] font-bold text-violet-700 bg-violet-100 rounded px-1 py-0.5 shrink-0">IN USE</span>
                )}
                <CachedActions id={id} onDelete={() => void remove(id)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** The per-model affordance once it's downloaded: a "downloaded" marker plus a
 *  delete (two-step) to reclaim disk space. */
function CachedActions({ id, sizeGB, onDelete }: { id: string; sizeGB?: number; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteWebLlmModel(id);
      onDelete();
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (!confirming) {
    return (
      <span className="flex items-center gap-2 shrink-0">
        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
          <Check size={11} /> Downloaded
        </span>
        <button
          onClick={() => setConfirming(true)}
          title={`Delete this download${sizeGB ? ` (frees ~${fmtSize(sizeGB)})` : ''}`}
          className="text-slate-400 hover:text-red-600"
        >
          <Trash2 size={12} />
        </button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 shrink-0 text-[10px]">
      <button
        onClick={() => void doDelete()}
        disabled={deleting}
        className="px-2 py-0.5 bg-red-600 text-white font-semibold rounded hover:bg-red-700 disabled:opacity-50"
      >
        {deleting ? 'Deleting…' : 'Delete'}
      </button>
      <button onClick={() => setConfirming(false)} disabled={deleting} className="text-slate-500 hover:underline">
        Keep
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// CONNECTIONS — how the assistant reaches a model (local engine + cloud keys)
// ---------------------------------------------------------------------------

function ConnectionsSection({ settings, onChange, webllmConn }: {
  settings: AiSettings;
  onChange: (mutate: (s: AiSettings) => void) => void;
  webllmConn: AiConnection | null;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [addingProvider, setAddingProvider] = useState<(typeof AI_PROVIDERS)[number]>('gemini');

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
        model: defaultModelFor('webllm'),
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

  const deleteConnection = (id: string) => onChange(s => {
    s.connections = s.connections.filter(x => x.id !== id);
    if (s.activeConnectionId === id) s.activeConnectionId = s.connections[0]?.id ?? null;
  });

  const cloudConns = settings.connections.filter(c => c.provider !== 'webllm');

  return (
    <section className="mt-4">
      <div className="text-xs font-semibold text-slate-800 mb-2">Connections</div>

      {/* Active connection picker */}
      {settings.connections.length > 0 && (
        <div className="border border-slate-200 bg-white rounded p-3 mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
            Active connection — what the assistant uses
          </div>
          <select
            value={settings.activeConnectionId ?? ''}
            onChange={e => onChange(s => { s.activeConnectionId = e.target.value || null; })}
            className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-700 w-full sm:w-auto"
          >
            {settings.connections.map(c => (
              <option key={c.id} value={c.id}>{c.label || c.provider} · {c.model}</option>
            ))}
          </select>
        </div>
      )}

      {/* The local connection uses whatever model is chosen in Models above. */}
      {!webllmConn ? (
        <button
          onClick={ensureWebllm}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded hover:bg-emerald-700"
        >
          <Plus size={13} /> Add the on-computer connection
        </button>
      ) : (
        <div className="border border-emerald-200 bg-white rounded p-2.5 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 rounded px-1.5 py-0.5">
              On this computer
            </span>
            <span className="flex-1 text-[11px] text-slate-600 truncate">
              Uses the model chosen above · <span className="font-mono">{webllmConn.model}</span>
            </span>
            {settings.activeConnectionId !== webllmConn.id && (
              <button
                onClick={() => onChange(s => { s.activeConnectionId = webllmConn.id; })}
                className="text-[11px] text-emerald-700 hover:underline shrink-0"
              >
                Make active
              </button>
            )}
            <button
              onClick={() => deleteConnection(webllmConn.id)}
              className="text-slate-400 hover:text-red-600 shrink-0"
              title="Remove this connection (the downloaded model stays until you delete it above)"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Cloud providers */}
      <button
        onClick={() => setAdvancedOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800"
      >
        {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Online providers (needs an API key)
      </button>

      {advancedOpen && (
        <div className="mt-2 border border-slate-200 bg-white rounded p-3">
          <p className="text-[11px] text-slate-500 leading-snug mb-3">
            For stronger models. You sign up with the provider, copy an API key, and paste it here —
            the key is stored only in this browser and sent only to that provider when you chat.
          </p>

          <div className="space-y-3">
            {cloudConns.map(c => (
              <CloudConnectionCard key={c.id} conn={c} onPatch={patch} onDelete={() => deleteConnection(c.id)} />
            ))}
            {cloudConns.length === 0 && (
              <p className="text-[11px] text-slate-400">No online providers yet.</p>
            )}
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
    </section>
  );
}

function CloudConnectionCard({ conn: c, onPatch, onDelete }: {
  conn: AiConnection;
  onPatch: (id: string, p: Partial<AiConnection>) => void;
  onDelete: () => void;
}) {
  const help = PROVIDER_HELP[c.provider];
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelList, setModelList] = useState<ModelInfo[] | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await testConnection(c);
      setTestResult({ ok: true, message: 'Connection works.' });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  const fetchModels = async () => {
    setFetchingModels(true);
    setTestResult(null);
    try {
      const models = await listModels(c);
      setModelList(models);
      setTestResult(models.length
        ? { ok: true, message: `${models.length} model${models.length === 1 ? '' : 's'} available.` }
        : { ok: false, message: 'Connected, but the endpoint listed no models.' });
    } catch (err) {
      setModelList(null);
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setFetchingModels(false);
    }
  };
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
            list={`models-${c.id}`}
            className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono"
          />
          {/* Suggestions appear after "Fetch models" below; typing still works. */}
          <datalist id={`models-${c.id}`}>
            {(modelList ?? []).map(m => (
              <option key={m.id} value={m.id}>{m.detail ?? m.id}</option>
            ))}
          </datalist>
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
        <label className="block">
          <span className="block text-[10px] text-slate-500 mb-0.5">Context window (tokens, optional)</span>
          <input
            type="number"
            min={1024}
            value={c.contextSize ?? ''}
            onChange={e => onPatch(c.id, { contextSize: e.target.value ? Math.max(1024, Math.round(Number(e.target.value))) : undefined })}
            placeholder="128000"
            className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-mono"
          />
          <span className="block text-[9px] text-slate-400 mt-0.5">
            Drives the usage meter + auto-compaction. Default is small for local models.
          </span>
        </label>
      </div>

      {/* Reachability + model discovery */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button
          onClick={() => void runTest()}
          disabled={testing || fetchingModels}
          className="flex items-center gap-1 px-2.5 py-1 border border-slate-300 text-slate-700 text-[11px] font-semibold rounded hover:bg-slate-50 disabled:opacity-40"
        >
          {testing ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
          Test connection
        </button>
        <button
          onClick={() => void fetchModels()}
          disabled={testing || fetchingModels}
          className="flex items-center gap-1 px-2.5 py-1 border border-slate-300 text-slate-700 text-[11px] font-semibold rounded hover:bg-slate-50 disabled:opacity-40"
        >
          {fetchingModels ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Fetch models
        </button>
        {testResult && (
          <span className={`flex items-center gap-1 text-[11px] ${testResult.ok ? 'text-emerald-700' : 'text-red-700'}`}>
            {testResult.ok ? <Check size={11} /> : <X size={11} />}
            {testResult.message}
          </span>
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
