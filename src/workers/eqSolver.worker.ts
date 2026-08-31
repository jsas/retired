import { solveEqRows, type EqShardRequest, type EqShardResponse, type EqRowProgress } from '@retired/engine-core/eqSolver';

// One worker in the EQ pool: computes a SHARD of grid rows (solveEqRows) off the
// main thread, streaming each finished row back as a { type: 'row' } message so
// the coordinator can shade the pad live. A final { type: 'done' } marks the
// shard complete. Vite bundles via new Worker(new URL(...)).
self.onmessage = (event: MessageEvent<EqShardRequest>) => {
  const { request, rows } = event.data;
  const post = (msg: EqShardResponse) => self.postMessage(msg);
  try {
    const onRow = (p: EqRowProgress) => post({ type: 'row', row: p.row, cells: p.cells });
    solveEqRows(request, rows, onRow);
    post({ type: 'done', ok: true });
  } catch (err) {
    post({ type: 'done', ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
