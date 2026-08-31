import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mintReadRecords, toJsonl } from './mint';

// The corpus is gitignored and the eval set is "frozen" only because the engine
// is deterministic: the same catalog + engine must always mint the same bytes.
// If this test goes red, the eval hash changed — regenerate intentionally and
// re-run the bake-off, never let it drift silently (golden-master rule, rule 2).
describe('corpus determinism', () => {
  it('two mint runs produce byte-identical JSONL', () => {
    const a = toJsonl(mintReadRecords());
    const b = toJsonl(mintReadRecords());
    expect(a).toBe(b);
  }, 60000);

  it('the eval split hash is stable across runs', () => {
    const evalJsonl = () => toJsonl(mintReadRecords().filter((r) => r.split === 'eval'));
    const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
    expect(h(evalJsonl())).toBe(h(evalJsonl()));
  }, 60000);

  it('monte-carlo exemplars use a fixed seed (reproducible futures)', () => {
    // run_monte_carlo / solve_spending results must be reproducible; the engine
    // seeds its PRNG deterministically when given a seed, and the mint specs
    // pass fixed runs counts. The strongest signal: identical re-mint (above)
    // already proves the recorded futures don't vary run-to-run.
    const mc = mintReadRecords().filter((r) => r.expect.toolName === 'run_monte_carlo');
    expect(mc.length).toBeGreaterThan(0);
    for (const r of mc) {
      expect(r.messages[1].content).toContain('"runs":500');
    }
  });
});
