import { solveEq, type EqSolveRequest, type EqSolveResult, type EqRowProgress } from '../lib/eqSolver';

// Runs the EQ constraint solve off the main thread. The grid is streamed row by
// row (center-out) as { type: 'row' } messages so the UI shades in live; a final
// { type: 'done' } message carries the completed result. Vite bundles via
// new Worker(new URL(...)).
self.onmessage = (event: MessageEvent<EqSolveRequest>) => {
  try {
    const onRow = (p: EqRowProgress) => self.postMessage({ type: 'row', row: p.row, cells: p.cells });
    const result: EqSolveResult = solveEq(event.data, onRow);
    self.postMessage({ type: 'done', ok: true, result });
  } catch (err) {
    self.postMessage({ type: 'done', ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
