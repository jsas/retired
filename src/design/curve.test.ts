import { describe, expect, it } from 'vitest';
import { smoothAreaPath, smoothLinePath, type Pt } from './curve';

// ── Tiny path reader ──────────────────────────────────────────────────────
// The property tests need to evaluate what the `d` string actually draws,
// not just eyeball it. Parse M/L/C vertices, then sample the cubics.
type Seg = { kind: 'L' | 'C'; from: Pt; to: Pt; c1?: Pt; c2?: Pt };

function parsePath(d: string): Seg[] {
  const segs: Seg[] = [];
  const num = /-?\d+(?:\.\d+)?/g;
  let cur: Pt | null = null;
  for (const tok of d.split(/(?=[MLCZ])/)) {
    const cmd = tok[0];
    if (cmd === 'Z') continue;
    const nums = tok.match(num)?.map(Number) ?? [];
    if (cmd === 'M' || cmd === 'L') {
      const to = { x: nums[0], y: nums[1] };
      if (cmd === 'L' && cur) segs.push({ kind: 'L', from: cur, to });
      cur = to;
    } else if (cmd === 'C' && cur) {
      const c1 = { x: nums[0], y: nums[1] };
      const c2 = { x: nums[2], y: nums[3] };
      const to = { x: nums[4], y: nums[5] };
      segs.push({ kind: 'C', from: cur, to, c1, c2 });
      cur = to;
    }
  }
  return segs;
}

function cubicY(s: Seg, t: number): number {
  const u = 1 - t;
  return u * u * u * s.from.y + 3 * u * u * t * s.c1!.y + 3 * u * t * t * s.c2!.y + t * t * t * s.to.y;
}

// toFixed(1) on the emitted coords perturbs control points by ≤0.05, so
// hull containment is checked with a matching slack.
const EPS = 0.2;

// Deterministic pseudo-random bumpy series (LCG — no Math.random in tests).
function bumpy(n: number, seed = 7): Pt[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pts: Pt[] = [];
  let y = 300;
  for (let i = 0; i < n; i++) {
    pts.push({ x: i * 12.5, y });
    y += (rnd() - 0.45) * 90;
  }
  return pts;
}

describe('smoothLinePath', () => {
  it('interpolates every point; first/last vertices match the input', () => {
    const pts = bumpy(40);
    const d = smoothLinePath(pts);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('C');
    const segs = parsePath(d);
    expect(segs.length).toBe(pts.length - 1);
    // Every C segment ends exactly on its data point.
    segs.forEach((s, i) => {
      expect(s.to.x).toBeCloseTo(pts[i + 1].x, 1);
      expect(s.to.y).toBeCloseTo(pts[i + 1].y, 1);
    });
    expect(d.startsWith(`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`)).toBe(true);
    const last = segs[segs.length - 1];
    expect(last.to.x).toBeCloseTo(pts[pts.length - 1].x, 1);
    expect(last.to.y).toBeCloseTo(pts[pts.length - 1].y, 1);
  });

  it('never overshoots a segment: sampled y stays within the endpoint y-range', () => {
    for (const seed of [7, 42, 1337, 2026]) {
      const pts = bumpy(30, seed);
      const segs = parsePath(smoothLinePath(pts));
      expect(segs.length).toBe(pts.length - 1);
      for (const s of segs) {
        const lo = Math.min(s.from.y, s.to.y) - EPS;
        const hi = Math.max(s.from.y, s.to.y) + EPS;
        for (let k = 0; k <= 40; k++) {
          const y = cubicY(s, k / 40);
          expect(y).toBeGreaterThanOrEqual(lo);
          expect(y).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  it('a plateau at 0 stays exactly at 0 (no dip under the baseline)', () => {
    const pts: Pt[] = [
      { x: 0, y: 200 }, { x: 10, y: 150 }, { x: 20, y: 60 },
      { x: 30, y: 0 }, { x: 40, y: 0 }, { x: 50, y: 0 },
    ];
    const segs = parsePath(smoothLinePath(pts));
    for (const s of segs) {
      for (let k = 0; k <= 100; k++) {
        expect(cubicY(s, k / 100)).toBeGreaterThanOrEqual(-1e-9);
      }
    }
    // Flat-flat segments are literally flat: controls sit on y = 0.
    for (const s of segs.slice(3)) {
      expect(s.c1!.y).toBe(0);
      expect(s.c2!.y).toBe(0);
    }
  });

  it('sharp peaks and valleys are rounded but never crossed', () => {
    const pts: Pt[] = [
      { x: 0, y: 100 }, { x: 10, y: 0 }, { x: 20, y: 100 },
      { x: 30, y: 0 }, { x: 40, y: 100 },
    ];
    for (const s of parsePath(smoothLinePath(pts))) {
      const lo = Math.min(s.from.y, s.to.y) - EPS;
      const hi = Math.max(s.from.y, s.to.y) + EPS;
      for (let k = 0; k <= 50; k++) {
        expect(cubicY(s, k / 50)).toBeGreaterThanOrEqual(lo);
        expect(cubicY(s, k / 50)).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('falls back to straight M/L with ≤2 points', () => {
    expect(smoothLinePath([{ x: 5, y: 10 }])).toBe('M5.0,10.0');
    const two = smoothLinePath([{ x: 5, y: 10 }, { x: 50, y: 25 }]);
    expect(two).toBe('M5.0,10.0 L50.0,25.0');
    expect(two).not.toContain('C');
    expect(smoothLinePath([])).toBe('');
  });

  it('skips non-finite points without corrupting the path', () => {
    const pts: Pt[] = [
      { x: 0, y: 100 }, { x: NaN, y: 50 }, { x: 10, y: NaN },
      { x: 10, y: 80 }, { x: 20, y: 60 }, { x: 30, y: Infinity },
    ];
    const d = smoothLinePath(pts);
    expect(d).not.toContain('NaN');
    expect(d).not.toContain('Infinity');
    expect(d.startsWith('M0.0,100.0')).toBe(true);
    expect(d).toContain('C');
    // 3 usable points survive → 2 C segments ending on the survivor tail.
    const segs = parsePath(d);
    expect(segs.length).toBe(2);
    expect(segs[1].to.x).toBeCloseTo(20, 1);
  });
});

describe('smoothAreaPath', () => {
  it('smooth top closes to the baseline at the first/last x', () => {
    const pts: Pt[] = bumpy(12);
    const baseline = 400;
    const d = smoothAreaPath(pts, baseline);
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('C');
    expect(d.endsWith('Z')).toBe(true);
    const tail = `L${pts[pts.length - 1].x.toFixed(1)},${baseline.toFixed(1)} L${pts[0].x.toFixed(1)},${baseline.toFixed(1)} Z`;
    expect(d.endsWith(tail)).toBe(true);
  });

  it('degenerate inputs yield no path', () => {
    expect(smoothAreaPath([], 10)).toBe('');
    expect(smoothAreaPath([{ x: 0, y: 1 }], NaN)).toBe('');
    // 2 points: straight top edge, still a closed area.
    const d = smoothAreaPath([{ x: 0, y: 1 }, { x: 10, y: 2 }], 9);
    expect(d).toBe('M0.0,1.0 L10.0,2.0 L10.0,9.0 L0.0,9.0 Z');
  });
});
