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
import { WEBLLM_MODELS } from './ai/webLlmModels';
import { connectionReady, newConnectionId, type AiConnection, type AiSettings } from './aiSettings';

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
  /** True for on-computer (web-llm) models. */
  local: boolean;
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
  const entries: ModelCatalogEntry[] = WEBLLM_MODELS.map(m => ({
    key: `local:${m.id}`,
    modelId: m.id,
    label: m.label,
    connectionId: null,
    connectionLabel: null,
    local: true,
    cached: cached[m.id],
    sizeGB: m.sizeGB,
    blurb: m.blurb,
  }));
  for (const id of Object.keys(cached)) {
    if (cached[id] && !WEBLLM_MODELS.some(m => m.id === id)) {
      entries.push({
        key: `local:${id}`,
        modelId: id,
        label: id,
        connectionId: null,
        connectionLabel: null,
        local: true,
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
  const list = models && models.length > 0 ? models : [{ id: conn.model }];
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
  return c.provider === 'webllm' ? `local:${c.model}` : `${c.id}:${c.model}`;
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
    const idx = next.connections.findIndex(c => c.provider === 'webllm');
    if (idx < 0) {
      const id = newId();
      next.connections.push({
        id, provider: 'webllm', label: 'On this computer', apiKey: '', model: entry.modelId,
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
  return next;
}

export function buildModelCatalog(
  connections: AiConnection[],
  opts: { cached?: Record<string, boolean>; cloudLists?: Record<string, ModelInfo[] | null> } = {},
): ModelCatalogEntry[] {
  return [
    ...buildLocalModels(opts.cached),
    ...connections
      .filter(c => c.provider !== 'webllm')
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

  // Local tier: probe the browser cache. Dynamic import — the web-llm module
  // is heavy and browser-only, same pattern the download path uses.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { isWebLlmModelCached } = await import('./ai/webLlmProvider');
        const ids = new Set<string>(WEBLLM_MODELS.map(m => m.id));
        if (webllmModel) ids.add(webllmModel);
        const next: Record<string, boolean> = {};
        for (const id of ids) next[id] = await isWebLlmModelCached(id);
        if (!cancelled) setCached(next);
      } catch {
        /* no WebGPU / probe unavailable — locals just read as not cached */
      }
    })();
    return () => { cancelled = true; };
  }, [webllmModel]);

  // Cloud tier: list models for every ready connection not yet fetched.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const todo = settings.connections.filter(
        c => c.provider !== 'webllm' && connectionReady(c) && !fetchedRef.current.has(cloudSig(c)),
      );
      if (todo.length === 0) return;
      setLoading(true);
      await Promise.all(todo.map(async c => {
        fetchedRef.current.add(cloudSig(c));
        try {
          const models = await listModels(c);
          if (cancelled) return;
          setCloudLists(prev => ({ ...prev, [c.id]: models }));
          setErrors(prev => {
            if (!(c.id in prev)) return prev;
            const next = { ...prev };
            delete next[c.id];
            return next;
          });
        } catch (err) {
          fetchedRef.current.delete(cloudSig(c)); // failed — allow a retry
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
  return { entries, loading, errors, cached, markCached, refresh: () => setNonce(n => n + 1) };
}
