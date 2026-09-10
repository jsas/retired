// One model catalog for the whole assistant (issue #165): every model the
// assistant can run, in one list —
//
//   • on-computer models (the curated web-llm catalog), each with its download
//     state so an un-downloaded model reads as downloadable;
//   • every ready cloud connection's models, fetched with the provider's own
//     list endpoint the moment the connection is usable — no per-connection
//     "Fetch models" click.
//
// The pure builders are pure on purpose: the model pickers and the Models page
// render from their output, and the tests exercise merge/dedupe/download-state
// logic without touching the network. The hook layers the two async sources
// (browser cache probe, provider list calls) on top.

import { useEffect, useMemo, useRef, useState } from 'react';
import { listModels, type ModelInfo } from './ai/providers';
import { visibleWebLlmModels } from './ai/webLlmModels';
import { BONSAI_MODELS } from './ai/bonsaiModels';
import { connectionReady, isLocalProvider, newConnectionId, type AiConnection, type AiSettings } from './aiSettings';
import { isOpenRouterFreeId, OPENROUTER_FREE_ROUTER } from './ai/openRouterFree';

/** Chat-picker / Models-page grouping. */
export type CatalogBucket = 'local' | 'free' | 'remote';

/** Recommended on-computer default when the user hasn't shortlisted yet. */
export const DEFAULT_CHAT_LOCAL_ID = 'Qwen3.5-4B-q4f16_1-MLC';

/** One row of the merged catalog: a model, where it runs, and how to pick it. */
export interface ModelCatalogEntry {
  /** Stable pick key. Locals: `local:<model id>` (they share the one web-llm
   *  connection, which may not exist yet). Clouds: `<connection id>:<model>`. */
  key: string;
  /** The model id the provider expects. */
  modelId: string;
  /** Display label — the curated catalog's short name, or the provider's. */
  label: string;
  /** Which connection serves this model. Locals all share the (possibly
   *  not-yet-created) web-llm connection; null there. */
  connectionId: string | null;
  /** Human name of the connection for grouping ("My key", "On this computer"). */
  connectionLabel: string | null;
  /** True for on-computer (web-llm / Bonsai) models. */
  local: boolean;
  /** Which in-browser engine serves this local row. Clouds omit it. */
  engine?: 'webllm' | 'bonsai';
  /** Local only: is the model already downloaded to this browser? Undefined
   *  while the cache probe hasn't answered; clouds are always undefined. */
  cached?: boolean;
  /** Local only: curated-catalog metadata for the picker's download hint. */
  sizeGB?: number;
  blurb?: string;
}

/** The on-computer tier: the curated catalog with download state, plus any
 *  cached ids the catalog no longer lists (older downloads — still runnable,
 *  still deletable, so they belong in the list). */
export function buildLocalModels(cached: Record<string, boolean> = {}): ModelCatalogEntry[] {
  const webllm = visibleWebLlmModels();
  const listedIds = new Set([...webllm.map(m => m.id), ...BONSAI_MODELS.map(m => m.id)]);
  const entries: ModelCatalogEntry[] = [
    ...webllm.map(m => ({
      key: `local:${m.id}`,
      modelId: m.id,
      label: m.label,
      connectionId: null,
      connectionLabel: null,
      local: true,
      engine: 'webllm' as const,
      cached: cached[m.id],
      sizeGB: m.sizeGB,
      blurb: m.blurb,
    })),
    ...BONSAI_MODELS.map(m => ({
      key: `local:${m.id}`,
      modelId: m.id,
      label: m.label,
      connectionId: null,
      connectionLabel: null,
      local: true,
      engine: 'bonsai' as const,
      cached: cached[m.id],
      sizeGB: m.sizeGB,
      blurb: m.blurb,
    })),
  ];
  for (const id of Object.keys(cached)) {
    if (cached[id] && !listedIds.has(id)) {
      entries.push({
        key: `local:${id}`,
        modelId: id,
        label: id,
        connectionId: null,
        connectionLabel: null,
        local: true,
        engine: id.startsWith('onnx-community/Bonsai') ? 'bonsai' : 'webllm',
        cached: true,
      });
    }
  }
  return entries;
}

/** One cloud connection's tier. Not-ready connections (no key yet) contribute
 *  nothing — there's nothing to list until the connection can actually call.
 *  A ready connection whose list hasn't landed yet (or failed) falls back to
 *  its configured model so the picker is never empty for it. */
export function cloudEntriesFor(conn: AiConnection, models: ModelInfo[] | null | undefined): ModelCatalogEntry[] {
  if (!connectionReady(conn)) return [];
  const list = models && models.length > 0 ? [...models] : [{ id: conn.model }];
  // OpenRouter's list endpoint often omits the free router; keep it pickable.
  if (conn.provider === 'openrouter' && !list.some(m => m.id === OPENROUTER_FREE_ROUTER)) {
    list.unshift({ id: OPENROUTER_FREE_ROUTER, detail: 'Free router (picks a :free model)' });
  }
  return list.map(m => ({
    key: `${conn.id}:${m.id}`,
    modelId: m.id,
    label: m.detail ?? m.id,
    connectionId: conn.id,
    connectionLabel: conn.label || conn.provider,
    local: false,
  }));
}

/** The catalog key for whatever the assistant is currently using. */
export function activeCatalogKey(settings: AiSettings): string | null {
  const c = settings.connections.find(x => x.id === settings.activeConnectionId);
  if (!c) return null;
  return isLocalProvider(c.provider) ? `local:${c.model}` : `${c.id}:${c.model}`;
}

/** Apply a catalog pick: set the connection's model (creating the on-computer
 *  connection if needed) and make it active. Pure — the picker and the Models
 *  page both go through this so a pick always means the same thing. */
export function pickModel(settings: AiSettings, entry: ModelCatalogEntry, newId: () => string = newConnectionId): AiSettings {
  const next: AiSettings = {
    ...settings,
    connections: settings.connections.map(c => ({ ...c })),
  };
  if (entry.local) {
    const provider = entry.engine === 'bonsai' ? 'bonsai' : 'webllm';
    const label = provider === 'bonsai' ? 'Bonsai (on this computer)' : 'On this computer';
    const idx = next.connections.findIndex(c => c.provider === provider);
    if (idx < 0) {
      const id = newId();
      next.connections.push({
        id, provider, label, apiKey: '', model: entry.modelId,
      });
      next.activeConnectionId = id;
    } else {
      next.connections[idx] = { ...next.connections[idx]!, model: entry.modelId };
      next.activeConnectionId = next.connections[idx]!.id;
    }
  } else if (entry.connectionId) {
    next.connections = next.connections.map(c =>
      c.id === entry.connectionId ? { ...c, model: entry.modelId } : c,
    );
    next.activeConnectionId = entry.connectionId;
  }
  const favorites = new Set(next.favoriteModels ?? []);
  favorites.add(entry.key);
  next.favoriteModels = [...favorites];
  return next;
}

export function catalogBucket(entry: ModelCatalogEntry): CatalogBucket {
  if (entry.local) return 'local';
  if (isOpenRouterFreeId(entry.modelId)) return 'free';
  return 'remote';
}

export function toggleFavorite(settings: AiSettings, key: string): AiSettings {
  const have = new Set(settings.favoriteModels ?? []);
  if (have.has(key)) have.delete(key);
  else have.add(key);
  return { ...settings, favoriteModels: [...have] };
}

/** What the dock dropdown lists: shortlisted keys, plus the in-use model so
 *  a pick never vanishes mid-chat. Empty shortlist → the recommended local. */
export function chatPickerEntries(
  entries: ModelCatalogEntry[],
  settings: AiSettings,
): ModelCatalogEntry[] {
  const fav = new Set(settings.favoriteModels ?? []);
  const active = activeCatalogKey(settings);
  const picked = entries.filter(e => fav.has(e.key) || e.key === active);
  if (picked.length > 0) return picked;
  const rec = entries.find(e => e.local && e.modelId === DEFAULT_CHAT_LOCAL_ID);
  return rec ? [rec] : entries.filter(e => e.local).slice(0, 1);
}

export function entriesByBucket(entries: ModelCatalogEntry[]): Record<CatalogBucket, ModelCatalogEntry[]> {
  const out: Record<CatalogBucket, ModelCatalogEntry[]> = { local: [], free: [], remote: [] };
  for (const e of entries) out[catalogBucket(e)].push(e);
  return out;
}

export function buildModelCatalog(
  connections: AiConnection[],
  opts: { cached?: Record<string, boolean>; cloudLists?: Record<string, ModelInfo[] | null> } = {},
): ModelCatalogEntry[] {
  return [
    ...buildLocalModels(opts.cached),
    ...connections
      .filter(c => !isLocalProvider(c.provider))
      .flatMap(c => cloudEntriesFor(c, opts.cloudLists?.[c.id])),
  ];
}

const cloudSig = (c: AiConnection) => `${c.id}|${c.apiKey}|${c.baseUrl ?? ''}`;

/** The catalog's live half: probes the browser's model cache for the local
 *  tier and calls each ready connection's list endpoint once per key/url
 *  signature. Returns the merged entries plus per-connection errors and a
 *  refresh for a manual retry. Renders fine before anything resolves — locals
 *  show as not-yet-probed, clouds fall back to their configured model. */
export function useModelCatalog(settings: AiSettings) {
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [cloudLists, setCloudLists] = useState<Record<string, ModelInfo[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  // Signatures already fetched (or in flight) — the connections array identity
  // changes on every settings write, but a key/url that hasn't changed must
  // not re-hit the provider's list endpoint.
  const fetchedRef = useRef<Set<string>>(new Set());

  const webllmModel = settings.connections.find(c => c.provider === 'webllm')?.model ?? null;
  const bonsaiModelId = settings.connections.find(c => c.provider === 'bonsai')?.model ?? null;

  // Local tier: probe the browser cache. Dynamic import — the web-llm / Bonsai
  // modules are heavy and browser-only, same pattern the download path uses.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, boolean> = {};
      try {
        const { isWebLlmModelCached } = await import('./ai/webLlmProvider');
        const ids = new Set<string>(visibleWebLlmModels().map(m => m.id));
        if (webllmModel) ids.add(webllmModel);
        for (const id of ids) next[id] = await isWebLlmModelCached(id);
      } catch {
        /* no WebGPU / probe unavailable — locals just read as not cached */
      }
      try {
        const { isBonsaiModelCached } = await import('./ai/bonsaiProvider');
        const ids = new Set<string>(BONSAI_MODELS.map(m => m.id));
        if (bonsaiModelId) ids.add(bonsaiModelId);
        for (const id of ids) next[id] = await isBonsaiModelCached(id);
      } catch {
        /* transformers.js / cache unavailable */
      }
      if (!cancelled) setCached(next);
    })();
    return () => { cancelled = true; };
  }, [webllmModel, bonsaiModelId]);

  // Cloud tier: list models for every ready connection not yet fetched.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const todo = settings.connections.filter(
        c => !isLocalProvider(c.provider) && connectionReady(c) && !fetchedRef.current.has(cloudSig(c)),
      );
      // Strict Mode remounts this effect: the first run is cancelled after it
      // set loading true. If we then early-return here (already fetched / nothing
      // to do) without clearing loading, "Refreshing…" sticks forever.
      if (todo.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }
      setLoading(true);
      await Promise.all(todo.map(async c => {
        try {
          const models = await listModels(c);
          fetchedRef.current.add(cloudSig(c));
          if (cancelled) return;
          setCloudLists(prev => ({ ...prev, [c.id]: models }));
          setErrors(prev => {
            if (!(c.id in prev)) return prev;
            const next = { ...prev };
            delete next[c.id];
            return next;
          });
        } catch (err) {
          if (!cancelled) {
            setErrors(prev => ({ ...prev, [c.id]: err instanceof Error ? err.message : String(err) }));
          }
        }
      }));
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.connections, nonce]);

  const entries = useMemo(
    () => buildModelCatalog(settings.connections, { cached, cloudLists }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.connections, cached, cloudLists],
  );
  const markCached = (id: string, v: boolean) =>
    setCached(prev => ({ ...prev, [id]: v }));
  const refresh = () => {
    // Drop the "already listed" set so a failed LM Studio / Ollama fetch
    // (or a server that wasn't up yet) is tried again from scratch.
    fetchedRef.current.clear();
    setNonce(n => n + 1);
  };
  return { entries, loading, errors, cached, markCached, refresh };
}
