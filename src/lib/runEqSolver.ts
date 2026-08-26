// Run the EQ constraint solve in a Web Worker when available (multi-file
// build), falling back to a synchronous inline run for the single-file build —
// same pattern as runSpendingSolver.ts / runMonteCarlo.ts.

import { solveEq, type EqSolveRequest, type EqSolveResult } from './eqSolver';

export function runEqSolverAuto(
  request: EqSolveRequest,
  onDone: (result: EqSolveResult) => void,
  onError: (message: string) => void,
): () => void {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('../workers/eqSolver.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }

  if (!worker) {
    const timer = setTimeout(() => {
      try {
        onDone(solveEq(request));
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    }, 50);
    return () => clearTimeout(timer);
  }

  const w = worker;
  w.onmessage = (event: MessageEvent<{ ok: true; result: EqSolveResult } | { ok: false; error: string }>) => {
    if (event.data.ok) onDone(event.data.result);
    else onError(event.data.error);
    w.terminate();
  };
  w.onerror = (e) => {
    w.terminate();
    try {
      onDone(solveEq(request));
    } catch (err) {
      onError(err instanceof Error ? err.message : (e.message || 'Worker failed'));
    }
  };
  w.postMessage(request);
  return () => w.terminate();
}
