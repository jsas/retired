import { solveEq, type EqSolveRequest, type EqSolveResult } from '../lib/eqSolver';

// Runs the EQ constraint solve off the main thread (hundreds of Monte Carlo
// evaluations for the grid + boundaries). Vite bundles via new Worker(new URL(...)).
self.onmessage = (event: MessageEvent<EqSolveRequest>) => {
  try {
    const result: EqSolveResult = solveEq(event.data);
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
