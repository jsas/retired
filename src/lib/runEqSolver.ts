// Run the EQ constraint solve in a Web Worker when available (multi-file
// build), falling back to a synchronous inline run for the single-file build —
// same pattern as runSpendingSolver.ts / runMonteCarlo.ts.
//
// The grid streams in row by row (center-out from the current point) so the pad
// shades in live: `onRow` fires per finished row, `onDone` with the final result.

import { solveEq, type EqSolveRequest, type EqSolveResult, type EqRowProgress } from './eqSolver';

export function runEqSolverAuto(
  request: EqSolveRequest,
  onDone: (result: EqSolveResult) => void,
  onError: (message: string) => void,
  onRow?: (progress: EqRowProgress) => void,
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
        onDone(solveEq(request, onRow));
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    }, 50);
    return () => clearTimeout(timer);
  }

  const w = worker;
  w.onmessage = (event: MessageEvent<
    | { type: 'row'; row: number; cells: boolean[] }
    | { type: 'done'; ok: true; result: EqSolveResult }
    | { type: 'done'; ok: false; error: string }
  >) => {
    const msg = event.data;
    if (msg.type === 'row') {
      onRow?.({ row: msg.row, cells: msg.cells });
      return;
    }
    if (msg.ok) onDone(msg.result);
    else onError(msg.error);
    w.terminate();
  };
  w.onerror = (e) => {
    w.terminate();
    try {
      onDone(solveEq(request, onRow));
    } catch (err) {
      onError(err instanceof Error ? err.message : (e.message || 'Worker failed'));
    }
  };
  w.postMessage(request);
  return () => w.terminate();
}
