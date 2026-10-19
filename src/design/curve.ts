// Monotone cubic (Fritsch–Carlson) SVG path builders for the dashboard
// curves. Raw per-year polylines look jagged; a plain Catmull-Rom/Roman
// spline smooths nicely but overshoots — a balance series that plateaus at
// $0 dips below the axis. Fritsch–Carlson tangents guarantee the curve is
// monotone between consecutive data points, so it never leaves each
// segment's endpoint y-range while still interpolating every vertex.
//
// Pure math: no DOM, no React. Points arrive already in screen coords.

export interface Pt {
  x: number;
  y: number;
}

// Round to 1 decimal like the polyline builders it replaces; keeps `d`
// strings compact and diff-stable.
const r = (n: number) => n.toFixed(1);

// Drop non-finite points so one NaN from the engine can't poison the path.
function sane(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out.push(p);
  }
  return out;
}

// Fritsch–Carlson monotone tangents: m[i] = dy/dx at point i.
//
// 1. Secant slopes d[i] between consecutive points.
// 2. Interior tangents: 0 at a local extremum or flat, else the
//    x-spacing-weighted harmonic mean of the adjacent secants, clamped to
//    3·min(|d[i-1]|,|d[i]|) in magnitude — the classic Fritsch–Carlson
//    bound. With |m| ≤ 3|d| and matching sign on both ends of every
//    segment, each Bézier control point's y lands between the segment's
//    endpoint y's, so the convex hull property forbids overshoot.
// 3. Ends take the adjacent secant slope (ratio 1, trivially in bounds).
function tangents(pts: Pt[]): number[] {
  const n = pts.length;
  const d: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    // Degenerate x (duplicate ages): zero slope, never divide by ~0.
    d[i] = dx === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx;
  }
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; } // extremum or flat
    const dxl = pts[i].x - pts[i - 1].x;
    const dxr = pts[i + 1].x - pts[i].x;
    const h = (dxl + dxr) / (dxl / d[i - 1] + dxr / d[i]); // weighted harmonic
    const lim = 3 * Math.min(Math.abs(d[i - 1]), Math.abs(d[i]));
    m[i] = Number.isFinite(h) ? Math.sign(h) * Math.min(Math.abs(h), lim) : 0;
  }
  return m;
}

/**
 * Smooth line through every point as cubic Bézier segments (`C` commands),
 * using Fritsch–Carlson monotone tangents. Interpolates all input points;
 * the first/last vertex of the path equals the first/last input point.
 * ≤2 usable points fall back to a straight `M`/`L` path.
 */
export function smoothLinePath(pts: Pt[]): string {
  const p = sane(pts);
  if (p.length === 0) return '';
  const line = (q: Pt) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  if (p.length <= 2) {
    return p.map((q, i) => `${i === 0 ? 'M' : 'L'}${line(q)}`).join(' ');
  }
  const m = tangents(p);
  let s = `M${line(p[0])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const dx = p[i + 1].x - p[i].x;
    // Hermite → Bézier: control points sit 1/3 of the segment along the
    // tangent at each endpoint.
    const c1 = { x: p[i].x + dx / 3, y: p[i].y + (m[i] * dx) / 3 };
    const c2 = { x: p[i + 1].x - dx / 3, y: p[i + 1].y - (m[i + 1] * dx) / 3 };
    s += ` C${line(c1)} ${line(c2)} ${line(p[i + 1])}`;
  }
  return s;
}

/**
 * Smooth-topped area closed to a baseline y: smooth top edge, then straight
 * down to the baseline at the last x, back along the baseline to the first
 * x, and close — same semantics as the old polyline area builder.
 */
export function smoothAreaPath(pts: Pt[], baselineY: number): string {
  const p = sane(pts);
  if (p.length === 0 || !Number.isFinite(baselineY)) return '';
  const top = smoothLinePath(p);
  const first = p[0], last = p[p.length - 1];
  return `${top} L${r(last.x)},${r(baselineY)} L${r(first.x)},${r(baselineY)} Z`;
}
