// Run the EQ solve across a POOL of Web Workers (multi-file build), falling
// back to a synchronous inline run for the single-file build — same pattern as
// runSpendingSolver.ts / runMonteCarlo.ts.
//
// The 9×9 success-rate grid is the expensive part (~81 Monte Carlo nodes). The
// coordinator shards the rows across up-to-hardwareConcurrency workers; each
// computes its rows independently against the same seeded batch and streams them
// back, so the pad shades in live AND the whole grid finishes ~(cores)× faster
// than a single thread. The readout is computed on the main thread (one node)
// so it returns immediately.

import {
  solveEq, solveEqReadout, shardRows,
  type EqSolveRequest, type EqSolveResult, type EqRowProgress, type EqShardResponse,
} from './eqSolver';

export function runEqSolverAuto(
  request: EqSolveRequest,
  onDone: (result: EqSolveResult) => void,
  onError: (message: string) => void,
  onRow?: (progress: EqRowProgress) => void,
): () => void {
  // No pad → just the readout, cheap enough to do inline.
  if (!request.pad) {
    const timer = setTimeout(() => {
      try {
        onDone({ successRate: solveEqReadout(request), grid: null, gridMeta: null });
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    }, 0);
    return () => clearTimeout(timer);
  }

  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const shards = shardRows(request, Math.max(2, Math.min(8, cores - 1)));

  // Spawn the pool. If workers aren't available (single-file build), fall back
  // to a synchronous inline solve.
  let workers: Worker[] = [];
  try {
    workers = shards.map(
      () => new Worker(new URL('../workers/eqSolver.worker.ts', import.meta.url), { type: 'module' }),
    );
  } catch {
    workers.forEach(w => w.terminate());
    workers = [];
  }

  if (workers.length === 0) {
    const timer = setTimeout(() => {
      try {
        onDone(solveEq(request, onRow));
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    }, 50);
    return () => clearTimeout(timer);
  }

  const size = 9; // GRID
  const grid = new Array<number>(size * size).fill(0);
  const gridMeta = { x: request.pad.x, y: request.pad.y, size };
  let finished = 0;
  let failed = false;
  // Readout right away (one node, main thread) so the Status/Success cards
  // update without waiting for the grid.
  let successRate = 0;
  try {
    successRate = solveEqReadout(request);
  } catch { /* leave 0; the grid still shades */ }

  const terminateAll = () => workers.forEach(w => w.terminate());

  workers.forEach((w, i) => {
    w.onmessage = (event: MessageEvent<EqShardResponse>) => {
      if (failed) return;
      const msg = event.data;
      if (msg.type === 'row') {
        for (let gx = 0; gx < size; gx++) grid[msg.row * size + gx] = msg.cells[gx];
        onRow?.({ row: msg.row, cells: msg.cells });
        return;
      }
      if (!msg.ok) {
        failed = true;
        terminateAll();
        // Whole-grid fallback: recompute inline so the UI still gets a result.
        try {
          onDone(solveEq(request, onRow));
        } catch (err) {
          onError(err instanceof Error ? err.message : msg.error);
        }
        return;
      }
      finished++;
      if (finished === workers.length) {
        terminateAll();
        onDone({ successRate, grid, gridMeta });
      }
    };
    w.onerror = (e) => {
      if (failed) return;
      failed = true;
      terminateAll();
      try {
        onDone(solveEq(request, onRow));
      } catch (err) {
        onError(err instanceof Error ? err.message : (e.message || 'Worker failed'));
      }
    };
    w.postMessage({ request, rows: shards[i] });
  });

  return terminateAll;
}
