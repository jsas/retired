// Models page (issue #165): one list of every model the assistant can run.
//
//   ON THIS COMPUTER — the curated web-llm catalog, each row downloadable if
//   the weights aren't cached yet. Picking a row (or finishing a download)
//   makes that the local model.
//
//   FROM YOUR KEYS — every ready cloud connection's models, listed
//   automatically via listModels (no "Fetch models" click). Multiple keys
//   just add more rows.
//
//   KEYS — collapse: paste an API key / add a provider. The catalog above
//   fills itself once the key is ready.
//
// This page owns its own AI-settings state so the assistant page stays
// focused on chatting. Keys never leave this browser.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Plus, Trash2, X, Check, ChevronDown, ChevronRight, Loader2, RefreshCw,
} from 'lucide-react';
import {
  AI_PROVIDERS, connectionReady, defaultBaseUrlFor, defaultModelFor, isLocalProvider,
  getAiSettings, subscribeAiSettings, updateAiSettings, newConnectionId,
  DEFAULT_MAX_TOKENS, DEFAULT_LOCAL_TEMPERATURE,
  DEFAULT_LOCAL_REPETITION_PENALTY, DEFAULT_LOCAL_PRESENCE_PENALTY,
  DEFAULT_LOCAL_FREQUENCY_PENALTY, MODEL_SAMPLER_DEFAULTS,
  type AiConnection, type AiGenerationSettings, type AiSettings,
} from '../lib/aiSettings';
import { testConnection } from '../lib/ai/providers';
import { WEBLLM_MODELS, visibleWebLlmModels, fmtSize, sumCachedSizeGB, webGpuAvailable } from '../lib/ai/webLlmModels';
import { BONSAI_MODELS } from '../lib/ai/bonsaiModels';
import { buildMachineGuide, type MachineGuide } from '../lib/ai/machineGuide';
import { estimateContextFit, fmtMB } from '../lib/ai/vramEstimate';
import { defaultContextSize } from '../lib/ai/context';
import { Check as CheckBox, HelpHint } from '../design/primitives';
import { deleteWebLlmModel, isWebLlmModelCached } from '../lib/ai/webLlmProvider';
import { deleteBonsaiModel, isBonsaiModelCached } from '../lib/ai/bonsaiProvider';
import { PROVIDER_HELP } from '../lib/ai/providerHelp';
import { Progress } from '../design/primitives';
import {
  activeCatalogKey, pickModel, toggleFavorite, useModelCatalog,
  type ModelCatalogEntry,
} from '../lib/modelCatalog';
import {
  OPENROUTER_FREE_PAGE_URL,
  OPENROUTER_FREE_ROUTER,
  OPENROUTER_KEYS_URL,
  OPENROUTER_SIGNUP_URL,
  ensureOpenRouterFree,
  isOpenRouterFreeId,
  openRouterConnection,
} from '../lib/ai/openRouterFree';

/** Upper bound for the local context window — above this even big GPUs run
 *  out of room for the KV cache, and the small models lose coherence long
 *  before they fill it. */
const MAX_LOCAL_CONTEXT = 32768;

export function ConnectionsPage({ onClose }: { onClose?: () => void }) {
  const settings = useSyncExternalStore(subscribeAiSettings, getAiSettings, getAiSettings);

  const updateSettings = (mutate: (s: AiSettings) => void) => {
    updateAiSettings(prev => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
  };

  const webllmConn = settings.connections.find(c => c.provider === 'webllm') ?? null;
  const bonsaiConn = settings.connections.find(c => c.provider === 'bonsai') ?? null;
  const catalog = useModelCatalog(settings);

  return (
    <div className="max-w-3xl">
      {onClose && (
        <button
          onClick={onClose}
          title="Back to the assistant"
          className="float-right p-1 text-slate-400 hover:text-slate-900"
        >
          <X size={16} />
        </button>
      )}
      <p className="mb-5 text-[12.5px] leading-relaxed text-slate-500">
        Tick the models you want on the chat dropdown — Local, Free, and Remote below. The dock
        only lists those (plus whatever is in use). Download a local pack, or paste a key, then tick.
      </p>
      {(settings.favoriteModels?.length ?? 0) > 0 && (
        <p className="mb-4 text-[12px] text-slate-600">
          Chat list: <span className="font-semibold text-slate-800">{settings.favoriteModels!.length}</span> selected.
        </p>
      )}

      <ModelsSection
        settings={settings}
        onChange={updateSettings}
        webllmConn={webllmConn}
        bonsaiConn={bonsaiConn}
        activeConnectionId={settings.activeConnectionId}
      />

      <CloudModelsSection
        settings={settings}
        catalog={catalog}
        onPick={entry => updateAiSettings(prev => pickModel(prev, entry))}
      />

      <OpenRouterFreeSection
        settings={settings}
        catalog={catalog}
        onPick={entry => updateAiSettings(prev => pickModel(prev, entry))}
      />

      <ConnectionsSection
        settings={settings}
        onChange={updateSettings}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MODELS — the on-this-computer catalog + anything else already downloaded
// ---------------------------------------------------------------------------

function ModelsSection({ settings, onChange, webllmConn, bonsaiConn, activeConnectionId }: {
  settings: AiSettings;
  onChange: (mutate: (s: AiSettings) => void) => void;
  webllmConn: AiConnection | null;
  bonsaiConn: AiConnection | null;
  activeConnectionId: string | null;
}) {
  const [guide, setGuide] = useState<MachineGuide | null>(null);
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  // modelId -> downloaded? Re-probed on demand after a download/delete.
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ progress: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probed, setProbed] = useState(false);
  // Dev-only entries: is the weights folder actually being served? (These
  // models exist only on a dev machine; elsewhere a Download would 404 into
  // the SPA fallback and die parsing HTML as JSON.)
  const [localWeightsReady, setLocalWeightsReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const webllmChosen = webllmConn && webllmConn.id === activeConnectionId ? webllmConn.model : null;
  const bonsaiChosen = bonsaiConn && bonsaiConn.id === activeConnectionId ? bonsaiConn.model : null;
  const chosenId = webllmChosen ?? bonsaiChosen;
  const offered = [...visibleWebLlmModels(), ...BONSAI_MODELS];

  // Check WebGPU support once on mount (for the recommendation + gating).
  // No memory detection — the browser won't report real VRAM.
  useEffect(() => {
    setGuide(buildMachineGuide(webGpuAvailable()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Probe the dev-only fine-tune's weights folder once: a HEAD on its config.
  // Missing (or HTML SPA fallback — HEAD returns 404 before the fallback in
  // vite) means "not on this server": show why instead of a Download button.
  useEffect(() => {
    let cancelled = false;
    const dev = WEBLLM_MODELS.find(m => m.localDevOnly && m.custom);
    if (!dev?.custom) return;
    void fetch(new URL(dev.custom.weightsUrl + '/mlc-chat-config.json', document.baseURI), { method: 'HEAD' })
      .then(res => {
        const type = res.headers.get('content-type') ?? '';
        if (!cancelled && res.ok && type.includes('json')) setLocalWeightsReady(true);
      })
      .catch(() => { /* offline/blocked: leave not-ready */ });
    return () => { cancelled = true; };
  }, []);

  /** Re-check every catalog id (and the chosen/custom id) against the cache,
   *  and collect ids that are downloaded but NOT in the catalog (so the user
   *  can delete a model they fetched that's no longer offered). */
  const reprobe = async () => {
    const webllmIds = new Set<string>(visibleWebLlmModels().map(m => m.id));
    if (webllmConn?.model) webllmIds.add(webllmConn.model);
    const bonsaiIds = new Set<string>(BONSAI_MODELS.map(m => m.id));
    if (bonsaiConn?.model) bonsaiIds.add(bonsaiConn.model);
    const next: Record<string, boolean> = {};
    for (const id of webllmIds) next[id] = await isWebLlmModelCached(id);
    for (const id of bonsaiIds) next[id] = await isBonsaiModelCached(id);
    const known = new Set([...visibleWebLlmModels().map(m => m.id), ...BONSAI_MODELS.map(m => m.id)]);
    const extras = [...webllmIds, ...bonsaiIds].filter(id => next[id] && !known.has(id));
    return { next, extras };
  };

  useEffect(() => {
    let cancelled = false;
    void reprobe().then(({ next, extras }) => {
      if (!cancelled) { setCached(next); setExtraIds(extras); setProbed(true); }
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
      const isBonsai = BONSAI_MODELS.some(m => m.id === id);
      if (isBonsai) {
        const { loadBonsaiEngine } = await import('../lib/ai/bonsaiProvider');
        await loadBonsaiEngine(id, p => {
          setProgress(p.progress >= 1 ? { progress: 1, text: 'Compiling Bonsai for your GPU…' } : p);
        }, abort.signal);
      } else {
        const { loadWebLlmEngine } = await import('../lib/ai/webLlmProvider');
        await loadWebLlmEngine(id, p => {
          setProgress(p.progress >= 1 ? { progress: 1, text: 'Compiling the model for your GPU…' } : p);
        }, abort.signal);
      }
      setModelCached(id, true);
      // Downloading a model also makes it the chosen one, so the assistant
      // uses what you just fetched.
      updateAiSettings(prev => pickModel(prev, {
        key: `local:${id}`,
        modelId: id,
        label: offered.find(m => m.id === id)?.label ?? id,
        connectionId: null,
        connectionLabel: null,
        local: true,
        engine: isBonsai ? 'bonsai' : 'webllm',
      }));
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
    if (BONSAI_MODELS.some(m => m.id === id) || id.startsWith('onnx-community/Bonsai')) {
      await deleteBonsaiModel(id);
    } else {
      await deleteWebLlmModel(id);
    }
    setModelCached(id, false);
    setExtraIds(prev => prev.filter(x => x !== id));
  };

  const pick = (id: string) => {
    const meta = offered.find(m => m.id === id);
    updateAiSettings(prev => pickModel(prev, {
      key: `local:${id}`,
      modelId: id,
      label: meta?.label ?? id,
      connectionId: null,
      connectionLabel: null,
      local: true,
      engine: BONSAI_MODELS.some(m => m.id === id) ? 'bonsai' : 'webllm',
    }));
  };

  const byVram = [...offered].sort((a, b) => a.vramMB - b.vramMB);
  const usedGB = sumCachedSizeGB(offered, cached);
  const catalogCached = offered.filter(m => cached[m.id]).length;
  const unknownExtras = extraIds.length;
  const recommended = guide?.recommended.id ?? null;
  const visible = showAll
    ? byVram
    : byVram.filter(m => m.id === recommended || m.id === chosenId || byVram.indexOf(m) < 3);

  // The probe resolves after mount. While it's pending (guide === null) show a
  // brief placeholder rather than the full catalog; once it says this browser
  // CAN'T run local models, collapse the whole section to just the explanation
  // and a pointer to the online path — no catalog or context control that
  // can't work here.
  if (guide == null) {
    return (
      <section className="border-b border-slate-200 pb-5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Models on this computer
        </div>
        <p className="flex items-center gap-1.5 text-[12px] text-slate-500">
          <Loader2 size={11} className="animate-spin" /> Checking whether this browser can run local models…
        </p>
      </section>
    );
  }
  if (!guide.webgpu) {
    return (
      <section className="border-b border-slate-200 pb-5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Models on this computer — not available in this browser
        </div>
        <div className="text-[12px]">
          <div className="font-semibold text-rose-700">{guide.headline}</div>
          <div className="mt-0.5 leading-relaxed text-slate-600">{guide.detail}</div>
        </div>
      </section>
    );
  }

  const localFav = (settings.favoriteModels ?? []).filter(k => k.startsWith('local:')).length;

  return (
    <section className="border-b border-slate-200 pb-5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="mb-1.5 flex w-full items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 hover:text-slate-700"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Local — on this computer
        {localFav > 0 && <span className="ml-auto font-medium normal-case tracking-normal text-slate-500">{localFav} on chat list</span>}
      </button>
      {open && (
      <>
      <p className="text-[12.5px] leading-relaxed text-slate-600">
        Tick to put a model on the chat dropdown. Download once, then it runs here and nothing you type leaves the device.
        <> We suggest <strong className="text-slate-900">{guide.recommended.label}</strong> for this computer.</>
      </p>
      {probed && (
        <p className="mt-1 text-[12px] text-slate-500">
          {catalogCached === 0 && unknownExtras === 0
            ? 'Nothing downloaded yet — sizes next to each name are what a download will take.'
            : catalogCached === 0
              ? `${unknownExtras} unlisted download${unknownExtras === 1 ? '' : 's'} on this computer (size unknown).`
              : unknownExtras > 0
                ? `About ${fmtSize(usedGB)} on this computer (${catalogCached} download${catalogCached === 1 ? '' : 's'}), plus ${unknownExtras} unlisted.`
                : `About ${fmtSize(usedGB)} on this computer (${catalogCached} download${catalogCached === 1 ? '' : 's'}).`}
        </p>
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
              className={`flex items-center gap-2 border px-2.5 py-1.5 text-left text-[11px] bg-white ${
                isChosen ? 'border-slate-900' : 'border-slate-200'
              }`}
            >
              <input
                type="checkbox"
                checked={(settings.favoriteModels ?? []).includes(`local:${m.id}`)}
                onChange={() => updateAiSettings(prev => toggleFavorite(prev, `local:${m.id}`))}
                title="Show on the chat dropdown"
                className="shrink-0"
              />
              <button
                onClick={() => pick(m.id)}
                title="Use this model"
                className={`h-3.5 w-3.5 shrink-0 border-2 ${
                  isChosen ? 'border-slate-900 bg-slate-900' : 'border-slate-300'
                }`}
              />
              <span className="flex-1 min-w-0">
                <span className="font-semibold text-slate-800">{m.label}</span>
                <span className="text-slate-400"> · {fmtSize(m.sizeGB)}</span>
                {recommended === m.id && (
                  <span className="ml-1.5 border border-slate-200 px-1 py-0.5 text-[9px] font-semibold text-slate-500">BEST FOR YOU</span>
                )}
                {isChosen && (
                  <span className="ml-1.5 bg-slate-900 px-1 py-0.5 text-[9px] font-semibold text-white">IN USE</span>
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
              ) : m.localDevOnly && !localWeightsReady ? (
                <span className="shrink-0 text-[10px] text-slate-400" title="The weights folder (public/models/) isn't served by this instance — it exists only on a dev machine.">
                  weights not on this server
                </span>
              ) : (
                <button
                  onClick={() => void download(m.id)}
                  disabled={downloading != null}
                  className="shrink-0 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
                >
                  Download
                </button>
              )}
            </div>
          );
        })}
        {!showAll && offered.length > visible.length && (
          <button onClick={() => setShowAll(true)} className="pl-1 text-[11px] text-slate-500 hover:text-slate-900 hover:underline">
            Show all {offered.length} models…
          </button>
        )}
      </div>

      {/* Active download progress */}
      {downloading && progress && (
        <div className="mt-2 max-w-md">
          <Progress pct={progress.progress * 100} className="h-2" />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-slate-500">{progress.text}</span>
            <button
              onClick={() => abortRef.current?.abort()}
              className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-rose-700"
            >
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className="mt-1.5 text-[11px] text-rose-700">{error}</div>}

      {/* How much the model can read at once. Plain-language framing: the
          model "sees" this much of your plan and the conversation at a time.
          The window costs GPU memory on top of the model itself, so we show
          the estimated total and warn when it won't fit. */}
      {(webllmConn || bonsaiConn) && (() => {
        const localConn = (bonsaiConn && bonsaiConn.id === activeConnectionId)
          ? bonsaiConn
          : (webllmConn && webllmConn.id === activeConnectionId)
            ? webllmConn
            : (webllmConn ?? bonsaiConn)!;
        const modelMeta =
          WEBLLM_MODELS.find(m => m.id === localConn.model)
          ?? BONSAI_MODELS.find(m => m.id === localConn.model);
        const isAuto = localConn.contextSize == null;
        // Auto aims for the model's ceiling; the engine backs off on OOM and we
        // can't know real VRAM (WebGPU hides it), so show the target not a fit.
        const tokens = localConn.contextSize ?? modelMeta?.maxWindow ?? defaultContextSize(localConn.provider);
        const fit = modelMeta ? estimateContextFit(modelMeta.vramMB, tokens, null) : null;
        return (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <label htmlFor="local-ctx" className="text-[12px] font-medium text-slate-700">
                How much the model reads at once
              </label>
              <input
                id="local-ctx"
                type="number"
                min={2048}
                max={MAX_LOCAL_CONTEXT}
                step={1024}
                value={localConn.contextSize ?? ''}
                disabled={isAuto}
                onChange={e => onChange(s => {
                  const c = s.connections.find(x => x.id === localConn.id);
                  if (!c) return;
                  c.contextSize = e.target.value
                    ? Math.min(MAX_LOCAL_CONTEXT, Math.max(2048, Math.round(Number(e.target.value))))
                    : undefined;
                })}
                placeholder={isAuto ? 'Auto' : String(defaultContextSize(localConn.provider))}
                className="num w-24 border border-slate-300 bg-white px-2 py-1 font-mono text-xs focus:border-slate-900 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
              />
              <CheckBox size={12} checked={isAuto}
                onChange={(on) => onChange(s => {
                  const c = s.connections.find(x => x.id === localConn.id);
                  if (!c) return;
                  // Auto = unset; unchecking seeds the current target as a manual value.
                  c.contextSize = on ? undefined : tokens;
                })}
                label={<span className="text-[12px] text-slate-700">Auto (as big as your GPU allows)</span>} />
            </div>
            <div className="mt-1 text-[10.5px] leading-relaxed text-slate-400">
              {isAuto ? (
                <>
                  Auto tries the model's largest window{modelMeta ? ` (${modelMeta.maxWindow.toLocaleString()} tokens)` : ''} and
                  steps down if your graphics memory can't hold it — no setting to tune.
                </>
              ) : (
                fit && (
                  <>
                    Needs ≈{fmtMB(fit.neededMB)} of graphics memory at this setting
                    ({fmtMB(modelMeta!.vramMB)} for the model + ≈{fmtMB(fit.cacheMB)} for the window).
                    If loading fails, lower the number or switch back to Auto.
                  </>
                )
              )}
            </div>
            <div className="mt-3 border-t border-slate-100 pt-3">
              <GenerationFields
                conn={localConn}
                isLocal
                onPatch={p => onChange(s => {
                  const c = s.connections.find(x => x.id === localConn.id);
                  if (c) Object.assign(c, p);
                })}
              />
            </div>
          </div>
        );
      })()}

      {/* Other downloads: cached models the catalog no longer lists, e.g. an
          older fetch. Shown so they can be deleted to free disk space. */}
      {extraIds.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Also on this device
          </div>
          <div className="space-y-1">
            {extraIds.map(id => (
              <div key={id} className="flex items-center gap-2 border border-slate-200 bg-white px-2.5 py-1.5 text-[11px]">
                <span className="num min-w-0 flex-1 truncate font-mono text-slate-600">{id}</span>
                {id === chosenId && (
                  <span className="shrink-0 bg-slate-900 px-1 py-0.5 text-[9px] font-semibold text-white">IN USE</span>
                )}
                <CachedActions id={id} onDelete={() => void remove(id)} />
              </div>
            ))}
          </div>
        </div>
      )}
      </>
      )}
    </section>
  );
}

/** Generation tuning shared by the local (Models) card and cloud connection
 *  cards. Blank = the app default, shown in the placeholder; values are stored
 *  on the connection so each model/provider can be tuned independently. */
function GenerationFields({ conn, onPatch, isLocal, compact = false }: {
  conn: AiConnection;
  onPatch: (patch: Partial<AiConnection>) => void;
  isLocal: boolean;
  compact?: boolean;
}) {
  const gen = conn.generation ?? {};
  const setGen = (p: Partial<AiGenerationSettings>) =>
    onPatch({ generation: { ...gen, ...p } });

  const num = (v: number | undefined) => (v === undefined ? '' : String(v));
  // Blank → undefined (fall back to the default); a number → store it.
  const parse = (raw: string, min: number, max: number) =>
    raw.trim() === '' ? undefined : Math.min(max, Math.max(min, Number(raw)));

  const label = compact
    ? 'text-[10px] text-slate-500 mb-0.5'
    : 'text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1';

  // A local model may carry its own sampler defaults; show those as the
  // placeholder so the user sees what blank actually means.
  const sampler = isLocal ? MODEL_SAMPLER_DEFAULTS[conn.model] : undefined;
  const tempDefault = sampler?.temperature ?? DEFAULT_LOCAL_TEMPERATURE;
  const repDefault = sampler?.repetitionPenalty ?? DEFAULT_LOCAL_REPETITION_PENALTY;
  const presDefault = sampler?.presencePenalty ?? DEFAULT_LOCAL_PRESENCE_PENALTY;
  const freqDefault = sampler?.frequencyPenalty ?? DEFAULT_LOCAL_FREQUENCY_PENALTY;

  return (
    <div className={compact ? '' : 'mt-3 pt-2 border-t border-slate-100'}>
      {!compact && (
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
          Generation — how the model writes
        </div>
      )}
      <div className={`grid gap-2 ${isLocal ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2'}`}>
        <label className="block">
          <span className={`block ${label}`}>Max tokens per reply</span>
          <input
            type="number" min={256} step={512}
            value={num(gen.maxTokens)}
            onChange={e => setGen({ maxTokens: parse(e.target.value, 256, 200000) })}
            placeholder={String(DEFAULT_MAX_TOKENS)}
            className="num w-full border border-slate-300 px-2 py-1 font-mono text-xs focus:border-slate-900 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className={`block ${label}`}>Temperature</span>
          <input
            type="number" min={0} max={2} step={0.1}
            value={num(gen.temperature)}
            onChange={e => setGen({ temperature: parse(e.target.value, 0, 2) })}
            placeholder={isLocal ? String(tempDefault) : 'provider'}
            className="num w-full border border-slate-300 px-2 py-1 font-mono text-xs focus:border-slate-900 focus:outline-none"
          />
        </label>
        {isLocal && (
          <>
            <label className="block">
              <span className={`block ${label}`}>Repeat penalty</span>
              <input
                type="number" min={0} max={2} step={0.05}
                value={num(gen.repetitionPenalty)}
                onChange={e => setGen({ repetitionPenalty: parse(e.target.value, 0, 2) })}
                placeholder={String(repDefault)}
                className="num w-full border border-slate-300 px-2 py-1 font-mono text-xs focus:border-slate-900 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className={`block ${label}`}>Presence penalty</span>
              <input
                type="number" min={-2} max={2} step={0.1}
                value={num(gen.presencePenalty)}
                onChange={e => setGen({ presencePenalty: parse(e.target.value, -2, 2) })}
                placeholder={String(presDefault)}
                className="num w-full border border-slate-300 px-2 py-1 font-mono text-xs focus:border-slate-900 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className={`block ${label}`}>Frequency penalty</span>
              <input
                type="number" min={-2} max={2} step={0.1}
                value={num(gen.frequencyPenalty)}
                onChange={e => setGen({ frequencyPenalty: parse(e.target.value, -2, 2) })}
                placeholder={String(freqDefault)}
                className="num w-full border border-slate-300 px-2 py-1 font-mono text-xs focus:border-slate-900 focus:outline-none"
              />
            </label>
          </>
        )}
      </div>
      <p className="text-[9px] text-slate-400 mt-1 leading-snug">
        Blank = the default shown. <strong>Max tokens</strong> is the reply budget —
        reasoning models spend it on thinking <em>and</em> the answer, so a small
        value cuts long answers off mid-thought. Higher temperature = more creative,
        lower = more literal.
      </p>
    </div>
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
      onDelete();
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (!confirming) {
    return (
      <span className="flex items-center gap-2 shrink-0">
        <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-700">
          <Check size={11} /> Downloaded
        </span>
        <button
          onClick={() => setConfirming(true)}
          title={`Delete this download${sizeGB ? ` (frees ~${fmtSize(sizeGB)})` : ''}`}
          className="text-slate-400 hover:text-rose-700"
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
        className="border border-rose-300 px-2 py-0.5 font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
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
// FROM YOUR KEYS — every ready cloud connection's models, listed automatically
// ---------------------------------------------------------------------------

function CloudModelsSection({ settings, catalog, onPick }: {
  settings: AiSettings;
  catalog: ReturnType<typeof useModelCatalog>;
  onPick: (entry: ModelCatalogEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const { entries, loading, errors, refresh } = catalog;
  const clouds = entries.filter(e => !e.local);
  const active = activeCatalogKey(settings);
  if (clouds.length === 0 && Object.keys(errors).length === 0 && !loading) return null;

  const groups = new Map<string, ModelCatalogEntry[]>();
  for (const e of clouds) {
    const k = e.connectionId ?? 'other';
    const list = groups.get(k) ?? [];
    list.push(e);
    groups.set(k, list);
  }
  const orConn = settings.connections.find(c => c.provider === 'openrouter');

  const remoteFav = (settings.favoriteModels ?? []).filter(k => clouds.some(e => e.key === k)).length;

  return (
    <section className="mt-8 border-b border-slate-200 pb-5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="mb-1.5 flex w-full items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 hover:text-slate-700"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Remote — from your keys
        {remoteFav > 0 && <span className="ml-auto font-medium normal-case tracking-normal text-slate-500">{remoteFav} on chat list</span>}
      </button>
      {open && (
      <>
      <p className="flex flex-wrap items-baseline gap-x-3 text-[12.5px] leading-relaxed text-slate-600">
        <span>Tick to put a model on the chat dropdown. Listed from each connection.</span>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 disabled:text-slate-400"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : undefined} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </p>
      <div className="mt-2 space-y-3">
        {[...groups.entries()].map(([id, list]) => (
          <div key={id}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {list[0]?.connectionLabel ?? id}
            </div>
            {errors[id] && (
              <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-rose-700">
                <span>{errors[id]}</span>
                <button
                  type="button"
                  onClick={refresh}
                  disabled={loading}
                  className="font-medium text-rose-800 underline decoration-rose-300 hover:decoration-rose-800 disabled:no-underline disabled:opacity-50"
                >
                  Retry
                </button>
              </p>
            )}
            {orConn && id === orConn.id ? (
              <OpenRouterModelGroups list={list} active={active} onPick={onPick} favorites={settings.favoriteModels} />
            ) : (
              <ModelPickList list={list} active={active} onPick={onPick} favorites={settings.favoriteModels} />
            )}
          </div>
        ))}
      </div>
      </>
      )}
    </section>
  );
}

function ModelPickList({ list, active, onPick, favorites = [] }: {
  list: ModelCatalogEntry[];
  active: string | null;
  onPick: (entry: ModelCatalogEntry) => void;
  favorites?: string[];
}) {
  const fav = new Set(favorites);
  return (
    <div className="space-y-1">
      {list.map(e => {
        const isChosen = e.key === active;
        const free = isOpenRouterFreeId(e.modelId);
        return (
          <div
            key={e.key}
            className={`flex w-full items-center gap-2 border px-2.5 py-1.5 text-left text-[11px] ${
              isChosen ? 'border-slate-900 bg-white' : 'border-slate-200 bg-white'
            }`}
          >
            <input
              type="checkbox"
              checked={fav.has(e.key)}
              onChange={() => updateAiSettings(prev => toggleFavorite(prev, e.key))}
              title="Show on the chat dropdown"
              className="shrink-0"
            />
            <button
              type="button"
              onClick={() => onPick(e)}
              title="Use this model"
              className={`h-3.5 w-3.5 shrink-0 border-2 ${isChosen ? 'border-slate-900 bg-slate-900' : 'border-slate-300'}`}
            />
            <button type="button" onClick={() => onPick(e)} className="min-w-0 flex-1 truncate text-left font-semibold text-slate-800">
              {e.label}
            </button>
            {free && (
              <span className="shrink-0 border border-slate-200 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">free</span>
            )}
            {isChosen && (
              <span className="shrink-0 bg-slate-900 px-1 py-0.5 text-[9px] font-semibold text-white">IN USE</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OpenRouterModelGroups({ list, active, onPick, favorites }: {
  list: ModelCatalogEntry[];
  active: string | null;
  onPick: (entry: ModelCatalogEntry) => void;
  favorites?: string[];
}) {
  const free = list.filter(e => isOpenRouterFreeId(e.modelId));
  const paid = list.filter(e => !isOpenRouterFreeId(e.modelId));
  return (
    <div className="space-y-3">
      {free.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Free</div>
          <ModelPickList list={free} active={active} onPick={onPick} favorites={favorites} />
        </div>
      )}
      {paid.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Paid</div>
          <ModelPickList list={paid} active={active} onPick={onPick} favorites={favorites} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OPENROUTER FREE — sign up, paste a key, pick the no-cost pool
// ---------------------------------------------------------------------------

function OpenRouterFreeSection({ settings, catalog, onPick }: {
  settings: AiSettings;
  catalog: ReturnType<typeof useModelCatalog>;
  onPick: (entry: ModelCatalogEntry) => void;
}) {
  const conn = openRouterConnection(settings);
  const ready = conn ? connectionReady(conn) : false;
  const freeRows = catalog.entries.filter(e =>
    !e.local && e.connectionId === conn?.id && isOpenRouterFreeId(e.modelId),
  );
  const active = activeCatalogKey(settings);
  const usingFree = conn != null && settings.activeConnectionId === conn.id && isOpenRouterFreeId(conn.model);
  const [open, setOpen] = useState(true);

  const startSetup = () => {
    updateAiSettings(prev => ensureOpenRouterFree(prev));
  };

  const patchKey = (apiKey: string) => {
    updateAiSettings(prev => {
      const next = ensureOpenRouterFree(prev);
      return {
        ...next,
        connections: next.connections.map(c =>
          c.provider === 'openrouter' ? { ...c, apiKey } : c,
        ),
      };
    });
  };

  return (
    <section className="mt-8 border-b border-slate-200 pb-5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 hover:text-slate-700"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Free — OpenRouter
        </button>
        <HelpHint topic="openrouter-free" />
      </div>
      {open && (
      <>
      <p className="text-[12.5px] leading-relaxed text-slate-600">
        Cloud chat with no token charge. OpenRouter&apos;s{' '}
        <a href={OPENROUTER_FREE_PAGE_URL} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
          free router
        </a>
        {' '}picks a <span className="num">:free</span> model for each request (tools and vision when the prompt needs them).
        Rate-limited.
      </p>
      <p className="mt-2 border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] leading-snug text-amber-900">
        Free is not private. Your prompt (and any plan details in it) leaves this device.
        OpenRouter and the model that answers may log it and use it for training. Don&apos;t paste
        anything you wouldn&apos;t send to a third party — use an on-computer model for that.
      </p>

      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-slate-600">
        <li>
          <a href={OPENROUTER_SIGNUP_URL} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
            Create an OpenRouter account
          </a>
          {' '}(email or GitHub).
        </li>
        <li>
          Open{' '}
          <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
            Keys
          </a>
          {' '}→ Create key. Copy it. It stays in this browser and is sent only to OpenRouter.
        </li>
        <li>Paste the key here, then tick the free router (or any listed :free model) to put it on the chat list.</li>
      </ol>

      {!conn ? (
        <button
          type="button"
          onClick={startSetup}
          className="mt-3 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
        >
          Set up OpenRouter free
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          <label className="block max-w-md">
            <span className="mb-0.5 block text-[10px] text-slate-500">OpenRouter API key (stored locally only)</span>
            <input
              type="password"
              value={conn.apiKey}
              onChange={e => patchKey(e.target.value)}
              placeholder="sk-or-v1-…"
              autoComplete="off"
              className="num w-full border border-slate-300 px-2 py-1 font-mono text-xs focus:border-slate-900 focus:outline-none"
            />
          </label>
          {!ready && (
            <p className="text-[11px] text-amber-700">Paste the key to list free models.</p>
          )}
          {ready && catalog.errors[conn.id] && (
            <p className="text-[11px] text-rose-700">{catalog.errors[conn.id]}</p>
          )}
          {ready && (
            <>
              <p className="text-[11px] text-slate-500">
                Default model is <span className="num font-semibold text-slate-700">{OPENROUTER_FREE_ROUTER}</span>
                {usingFree ? ' — in use.' : '.'}
              </p>
              {freeRows.length > 0 && (
                <ModelPickList list={freeRows} active={active} onPick={onPick} favorites={settings.favoriteModels} />
              )}
            </>
          )}
        </div>
      )}
      </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// KEYS — paste an API key / add a provider. The list above fills itself.
// ---------------------------------------------------------------------------


function ConnectionsSection({ settings, onChange }: {
  settings: AiSettings;
  onChange: (mutate: (s: AiSettings) => void) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [addingProvider, setAddingProvider] = useState<(typeof AI_PROVIDERS)[number]>('gemini');

  const patch = (id: string, p: Partial<AiConnection>) => {
    onChange(s => {
      const c = s.connections.find(x => x.id === id);
      if (c) Object.assign(c, p);
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

  const cloudConns = settings.connections.filter(c => !isLocalProvider(c.provider));

  return (
    <section className="mt-8">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Keys</div>

      {/* The on-computer engine is always available from the catalog above —
          picking a local model creates the connection. Keys here are only
          online providers. */}

      {/* Cloud providers */}
      <button
        onClick={() => setAdvancedOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800"
      >
        {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Add an online provider (needs an API key)
      </button>

      {advancedOpen && (
        <div className="mt-2 border border-slate-200 bg-white p-3">
          <p className="mb-3 text-[12px] leading-relaxed text-slate-500">
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
              className="border border-slate-300 bg-white px-2 py-1.5 text-xs focus:border-slate-900 focus:outline-none"
            >
              {AI_PROVIDERS.filter(p => !isLocalProvider(p)).map(p => (
                <option key={p} value={p}>{PROVIDER_HELP[p]?.name ?? p}</option>
              ))}
            </select>
            <button
              onClick={addCloud}
              className="flex items-center gap-1 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
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

  return (
    <div className="border border-slate-200 bg-white p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          {help?.name ?? c.provider}
        </span>
        {help?.easiest && (
          <span className="border border-slate-200 px-1 py-0.5 text-[9px] font-semibold text-slate-500">EASIEST</span>
        )}
        <input
          value={c.label}
          onChange={e => onPatch(c.id, { label: e.target.value })}
          placeholder="Label (e.g. My key)"
          className="min-w-0 flex-1 border border-slate-300 px-2 py-1 text-xs focus:border-slate-900 focus:outline-none"
        />
        <button
          onClick={onDelete}
          className="text-slate-400 hover:text-rose-700"
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
              <a href={help.keyUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
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
              className="num w-full border border-slate-300 px-2 py-1 font-mono text-xs focus:border-slate-900 focus:outline-none"
            />
          </label>
        )}
        <label className="block">
          <span className="block text-[10px] text-slate-500 mb-0.5">Default model (optional)</span>
          <input
            value={c.model}
            onChange={e => onPatch(c.id, { model: e.target.value })}
            placeholder={defaultModelFor(c.provider) || 'model id'}
            className="num w-full border border-slate-300 px-2 py-1 font-mono text-xs focus:border-slate-900 focus:outline-none"
          />
          <span className="mt-0.5 block text-[9px] text-slate-400">
            The list above fills itself once the key works. This is just the fallback.
          </span>
        </label>
        {(c.provider === 'ollama' || c.provider === 'openai-compatible' || c.provider === 'openrouter' || c.provider === 'openai') && (
          <label className="block sm:col-span-2">
            <span className="block text-[10px] text-slate-500 mb-0.5">Base URL</span>
            <input
              value={c.baseUrl ?? ''}
              onChange={e => onPatch(c.id, { baseUrl: e.target.value })}
              placeholder={defaultBaseUrlFor(c.provider) ?? 'https://…/v1'}
              className="num w-full border border-slate-300 px-2 py-1 font-mono text-xs focus:border-slate-900 focus:outline-none"
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
            className="num w-full border border-slate-300 px-2 py-1 font-mono text-xs focus:border-slate-900 focus:outline-none"
          />
          <span className="block text-[9px] text-slate-400 mt-0.5">
            Drives the usage meter + auto-compaction. Default is small for local models.
          </span>
        </label>
      </div>

      <GenerationFields conn={c} isLocal={false} onPatch={p => onPatch(c.id, p)} />

      {/* Reachability + model discovery */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button
          onClick={() => void runTest()}
          disabled={testing}
          className="flex items-center gap-1 border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-900 hover:text-slate-900 disabled:opacity-40"
        >
          {testing ? <Loader2 size={11} className="animate-spin" /> : null}
          Test connection
        </button>
        {testResult && (
          <span className={`flex items-center gap-1 text-[11px] ${testResult.ok ? 'text-blue-700' : 'text-rose-700'}`}>
            {testResult.ok ? <Check size={11} /> : <X size={11} />}
            {testResult.message}
          </span>
        )}
      </div>

      {!connectionReady(c) && (
        <div className="mt-1.5 text-[10.5px] text-amber-700">
          Incomplete: {c.provider === 'ollama' || c.provider === 'openai-compatible'
            ? 'needs a base URL and a model'
            : 'needs an API key and a model'}.
        </div>
      )}
    </div>
  );
}
