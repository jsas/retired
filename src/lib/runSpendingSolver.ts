// Run the spending solver in a Web Worker when available (multi-file build),
// falling back to a synchronous inline run for the single-file build — same
// pattern as runMonteCarlo.ts.

import { solveSustainableSpending, type SolverRequest, type SolverResult } from './spendingSolver';

export function runSpendingSolverAuto(
  request: SolverRequest,
  onDone: (result: SolverResult) => void,
  onError: (message: string) => void,
): () => void {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('../workers/spendingSolver.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }

  if (!worker) {
    const timer = setTimeout(() => {
      try {
        onDone(solveSustainableSpending(request));
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    }, 50);
    return () => clearTimeout(timer);
  }

  const w = worker;
  w.onmessage = (event: MessageEvent<{ ok: true; result: SolverResult } | { ok: false; error: string }>) => {
    if (event.data.ok) onDone(event.data.result);
    else onError(event.data.error);
    w.terminate();
  };
  w.onerror = (e) => {
    w.terminate();
    try {
      onDone(solveSustainableSpending(request));
    } catch (err) {
      onError(err instanceof Error ? err.message : (e.message || 'Worker failed'));
    }
  };
  w.postMessage(request);
  return () => w.terminate();
}
