import { runMonteCarlo, type MonteCarloRequest, type MonteCarloResults } from '../lib/monteCarlo';

// Runs the Monte Carlo simulation off the main thread so the UI stays
// responsive. Vite bundles this via `new Worker(new URL(...), {type:'module'})`.
self.onmessage = (event: MessageEvent<MonteCarloRequest>) => {
  try {
    const results: MonteCarloResults = runMonteCarlo(event.data);
    self.postMessage({ ok: true, results });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
