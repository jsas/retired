// Run Monte Carlo in a Web Worker when the bundle ships a separate worker
// chunk (normal multi-file build). In the single-file build the worker chunk
// is emitted beside the HTML but can't be constructed from file://, so we
// detect the failure and fall back to running synchronously on the main
// thread — 500 runs takes ~a second and only happens on demand.

import { runMonteCarlo, type MonteCarloRequest, type MonteCarloResults } from '@retired/engine-core/monteCarlo';

export function runMonteCarloAuto(
  request: MonteCarloRequest,
  onDone: (results: MonteCarloResults) => void,
  onError: (message: string) => void,
): () => void {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('../workers/monteCarlo.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }

  if (!worker) {
    // No worker available (single-file build): run inline, deferred so the
    // caller's loading state paints first.
    const timer = setTimeout(() => {
      try {
        onDone(runMonteCarlo(request));
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    }, 50);
    return () => clearTimeout(timer);
  }

  const w = worker;
  w.onmessage = (event: MessageEvent<{ ok: true; results: MonteCarloResults } | { ok: false; error: string }>) => {
    if (event.data.ok) onDone(event.data.results);
    else onError(event.data.error);
    w.terminate();
  };
  w.onerror = (e) => {
    // Construction succeeded but the script failed to load (file:// worker
    // restrictions): retry inline rather than surface an error.
    w.terminate();
    try {
      onDone(runMonteCarlo(request));
    } catch (err) {
      onError(err instanceof Error ? err.message : (e.message || 'Worker failed'));
    }
  };
  w.postMessage(request);
  return () => w.terminate();
}
