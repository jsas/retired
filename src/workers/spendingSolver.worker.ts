import { solveSustainableSpending, type SolverRequest, type SolverResult } from '@retired/engine-core/spendingSolver';

// Runs the spending solver off the main thread (it performs several full
// Monte Carlo evaluations). Vite bundles via `new Worker(new URL(...))`.
self.onmessage = (event: MessageEvent<SolverRequest>) => {
  try {
    const result: SolverResult = solveSustainableSpending(event.data);
    self.postMessage({ ok: true, result });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
