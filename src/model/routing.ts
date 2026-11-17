// Orthogonal connection routing.
//
// A route is stored as a list of alternating bend coordinates. Starting at the start anchor and
// moving along the start's exit axis, each coordinate says where the current segment ends
// (an x for a horizontal segment, a y for a vertical one); the axis then flips. After the last
// bend the path is completed with at most two more segments to reach the end anchor. Because
// the end segments always stretch to the anchors, lines stay attached when objects move while
// keeping the user's adjusted middle segments.

import type { BlockObj, Bundle, Connection, Endpoint, Page, Project } from './types';
import { isPortEndpoint } from './types';
import { portAnchor } from './blockGeometry';
import { fromLocal, localBox, objBounds, rotatePt, rotOf, type Pt, type Rect } from './geom';
import { measureText } from '../text/fonts';

export { objBounds };
export type { Pt, Rect };
export type Axis = 'h' | 'v';
export const LABEL_SIZE = 6.5;

export interface Anchor extends Pt {
  /** Outward direction from the object. */
  dx: number;
  dy: number;
}

export const STUB = 12;

export function resolveEndpoint(project: Project, page: Page, e: Endpoint): Anchor | null {
  const obj = page.objects.find((o) => o.id === e.objId);
  if (!obj) return null;
  if (isPortEndpoint(e)) {
    if (obj.kind !== 'block') return null;
    const a = portAnchor(project, obj as BlockObj, e.portId);
    if (!a) return null;
    return { x: a.x, y: a.y, dx: a.dir[0], dy: a.dir[1] };
  }
  const b = localBox(project, obj);
  const p = fromLocal(project, obj, { x: b.x + e.fx * b.w, y: b.y + e.fy * b.h });
  // Outward direction: nearest side, rotated with the shape and snapped to the nearest axis.
  const d = [
    { d: e.fx, dx: -1, dy: 0 },
    { d: 1 - e.fx, dx: 1, dy: 0 },
    { d: e.fy, dx: 0, dy: -1 },
    { d: 1 - e.fy, dx: 0, dy: 1 },
  ].sort((a, b) => a.d - b.d)[0];
  const n = rotatePt({ x: d.dx, y: d.dy }, { x: 0, y: 0 }, rotOf(obj));
  const horiz = Math.abs(n.x) >= Math.abs(n.y);
  return { x: p.x, y: p.y, dx: horiz ? Math.sign(n.x) : 0, dy: horiz ? 0 : Math.sign(n.y) };
}

export function axisOf(a: Anchor): Axis {
  return a.dx !== 0 ? 'h' : 'v';
}

/** Automatic bends for a pair of anchors. */
export function autoBends(s: Anchor, e: Anchor): number[] {
  const sa = axisOf(s);
  const ea = axisOf(e);
  if (sa !== ea) {
    // L-shape: one corner. Works when the corner is "ahead" of both anchors; otherwise add a jog.
    const cornerAhead =
      sa === 'h'
        ? (e.x - s.x) * s.dx >= 0 && (s.y - e.y) * e.dy >= 0
        : (e.y - s.y) * s.dy >= 0 && (s.x - e.x) * e.dx >= 0;
    if (cornerAhead) return [];
    if (sa === 'h') return [s.x + s.dx * STUB, e.y + e.dy * STUB];
    return [s.y + s.dy * STUB, e.x + e.dx * STUB];
  }
  if (sa === 'h') {
    const sx = s.x + s.dx * STUB;
    const ex = e.x + e.dx * STUB;
    if (s.dx === -e.dx) {
      // Facing each other, or wrapped around.
      if ((ex - sx) * s.dx >= 0) return [round((s.x + e.x) / 2)];
      return [sx, round((s.y + e.y) / 2), ex];
    }
    // Same direction: go out to the furthest point.
    return [s.dx > 0 ? Math.max(sx, ex) : Math.min(sx, ex)];
  }
  const sy = s.y + s.dy * STUB;
  const ey = e.y + e.dy * STUB;
  if (s.dy === -e.dy) {
    if ((ey - sy) * s.dy >= 0) return [round((s.y + e.y) / 2)];
    return [sy, round((s.x + e.x) / 2), ey];
  }
  return [s.dy > 0 ? Math.max(sy, ey) : Math.min(sy, ey)];
}

function round(v: number) {
  return Math.round(v * 2) / 2;
}

/** Check that a bend list's parity is compatible with the anchors' axes. */
export function bendsValid(bends: number[], s: Anchor, e: Anchor): boolean {
  // Start h: after an odd count the next axis is v, which completes in an h end segment.
  const flips = bends.length % 2;
  const nextAxis: Axis = (axisOf(s) === 'h') === (flips === 0) ? 'h' : 'v';
  // Completion: next axis v -> ends horizontally; next axis h -> ends vertically.
  const endAxis: Axis = nextAxis === 'v' ? 'h' : 'v';
  return endAxis === axisOf(e);
}

export function routePoints(s: Anchor, e: Anchor, bends: number[]): Pt[] {
  const pts: Pt[] = [{ x: s.x, y: s.y }];
  let axis: Axis = axisOf(s);
  let cur: Pt = { x: s.x, y: s.y };
  for (const c of bends) {
    cur = axis === 'h' ? { x: c, y: cur.y } : { x: cur.x, y: c };
    pts.push(cur);
    axis = axis === 'h' ? 'v' : 'h';
  }
  if (axis === 'v') {
    pts.push({ x: cur.x, y: e.y });
  } else {
    pts.push({ x: e.x, y: cur.y });
  }
  pts.push({ x: e.x, y: e.y });
  return simplify(pts);
}

/** Remove zero-length segments and merge collinear points. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const col = (Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - c.x) < 1e-6) || (Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - c.y) < 1e-6);
    if (col) out.splice(i, 1);
  }
  return out;
}

export type Bezier = [Pt, Pt, Pt, Pt];

export interface ResolvedRoute {
  conn: Connection;
  s: Anchor;
  e: Anchor;
  bends: number[];
  /** Raw points including possibly zero-length segments (index-aligned with bends for editing). */
  raw: Pt[];
  pts: Pt[];
  /** Curved line: the Bézier (pts/raw are then a flattened copy, used for hit-testing and labels). */
  curve?: Bezier;
  /** Line in a snake: the two short legs actually drawn (each starts at its block's port). */
  legs?: [Pt, Pt][];
  /** Snake trunk (keyed by the bundle id): the bars joining the legs, and the member lines. */
  trunk?: { bundle: Bundle; bars: [Pt, Pt][]; members: string[] };
}

// ---------------------------------------------------------------------------------------------
// Curved lines

/** Bézier between two anchors leaving each along its outward direction. */
export function curveFor(s: Anchor, e: Anchor): Bezier {
  const dist = Math.hypot(e.x - s.x, e.y - s.y);
  const k = Math.max(STUB * 1.5, Math.min(dist * 0.45, 180));
  return [
    { x: s.x, y: s.y },
    { x: s.x + s.dx * k, y: s.y + s.dy * k },
    { x: e.x + e.dx * k, y: e.y + e.dy * k },
    { x: e.x, y: e.y },
  ];
}

export function bezierAt(c: Bezier, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}

export const CURVE_SAMPLES = 48;

export function sampleCurve(c: Bezier, n = CURVE_SAMPLES): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => bezierAt(c, i / n));
}

/** The part of a Bézier between parameters t0 and t1 (de Casteljau). */
export function subCurve(c: Bezier, t0: number, t1: number): Bezier {
  const split = (b: Bezier, t: number): [Bezier, Bezier] => {
    const l = (p: Pt, q: Pt) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    const p01 = l(b[0], b[1]);
    const p12 = l(b[1], b[2]);
    const p23 = l(b[2], b[3]);
    const p012 = l(p01, p12);
    const p123 = l(p12, p23);
    const m = l(p012, p123);
    return [
      [b[0], p01, p012, m],
      [m, p123, p23, b[3]],
    ];
  };
  const right = split(c, t0)[1];
  const t = t0 >= 1 ? 0 : (t1 - t0) / (1 - t0);
  return split(right, Math.min(1, Math.max(0, t)))[0];
}

/** Raw (unsimplified) points: index i..i+1 is segment i; segment k (1..bends.length) is controlled by bends[k-1]. */
export function rawPoints(s: Anchor, e: Anchor, bends: number[]): Pt[] {
  const pts: Pt[] = [{ x: s.x, y: s.y }];
  let axis: Axis = axisOf(s);
  let cur: Pt = { x: s.x, y: s.y };
  for (const c of bends) {
    cur = axis === 'h' ? { x: c, y: cur.y } : { x: cur.x, y: c };
    pts.push(cur);
    axis = axis === 'h' ? 'v' : 'h';
  }
  pts.push(axis === 'v' ? { x: cur.x, y: e.y } : { x: e.x, y: cur.y });
  pts.push({ x: e.x, y: e.y });
  return pts;
}

export function resolveRoute(project: Project, page: Page, conn: Connection, obstacles = pageObstacles(project, page)): ResolvedRoute | null {
  const s = resolveEndpoint(project, page, conn.from);
  const e = resolveEndpoint(project, page, conn.to);
  if (!s || !e) return null;
  if (conn.curved) {
    const curve = curveFor(s, e);
    const pts = sampleCurve(curve);
    return { conn, s, e, bends: [], raw: pts, pts, curve };
  }
  const bends = conn.bends && bendsValid(conn.bends, s, e) ? conn.bends : autoRoute(s, e, obstacles);
  const raw = rawPoints(s, e, bends);
  return { conn, s, e, bends, raw, pts: simplify(raw) };
}

// ---------------------------------------------------------------------------------------------
// Automatic routing around blocks

/** Everything on the page is an obstacle for automatic routing: blocks, rectangles, text boxes. */
export function pageObstacles(project: Project, page: Page): Rect[] {
  return page.objects.map((o) => objBounds(project, o));
}

/**
 * Vertical offset that would make a line perfectly straight (both ends horizontal, facing each
 * other, at the same height): `to.y - from.y`, or null if the line can't be straightened that way.
 */
export function straightenDelta(project: Project, page: Page, conn: Connection): number | null {
  const s = resolveEndpoint(project, page, conn.from);
  const e = resolveEndpoint(project, page, conn.to);
  if (!s || !e || axisOf(s) !== 'h' || axisOf(e) !== 'h') return null;
  if (conn.from.objId === conn.to.objId) return null;
  // Facing each other with room for a straight run.
  if (s.dx !== -e.dx || (e.x - s.x) * s.dx <= 0) return null;
  return e.y - s.y;
}

/** Does an orthogonal segment pass through the inside of a rectangle? (Touching the edge is fine.) */
function segCrosses(a: Pt, b: Pt, r: Rect, inset = 0.5) {
  const x0 = r.x + inset;
  const x1 = r.x + r.w - inset;
  const y0 = r.y + inset;
  const y1 = r.y + r.h - inset;
  if (Math.abs(a.y - b.y) < 1e-6) {
    return a.y > y0 && a.y < y1 && Math.max(Math.min(a.x, b.x), x0) < Math.min(Math.max(a.x, b.x), x1);
  }
  return a.x > x0 && a.x < x1 && Math.max(Math.min(a.y, b.y), y0) < Math.min(Math.max(a.y, b.y), y1);
}

const routeCache = new Map<string, number[]>();

/**
 * Automatic bends: the simple route when it is clear of blocks, otherwise the shortest
 * orthogonal path around them (with a penalty per bend). Falls back to the simple route.
 */
export function autoRoute(s: Anchor, e: Anchor, obstacles: Rect[]): number[] {
  const simple = autoBends(s, e);
  const pts = simplify(rawPoints(s, e, simple));
  // Shapes that enclose an end's anchor don't count (the end is inside them).
  const encloses = (r: Rect, p: Pt) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  obstacles = obstacles.filter((r) => !encloses(r, s) && !encloses(r, e));
  const blocked = pts.some((p, i) => i > 0 && obstacles.some((r) => segCrosses(pts[i - 1], p, r)));
  if (!blocked) return simple;
  const key = [s.x, s.y, s.dx, s.dy, e.x, e.y, e.dx, e.dy].join(',') + '|' + obstacles.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join(';');
  const hit = routeCache.get(key);
  if (hit) return hit;
  const found = searchRoute(s, e, obstacles) ?? simple;
  if (routeCache.size > 4000) routeCache.clear();
  routeCache.set(key, found);
  return found;
}

const PAD = 8;
const BEND_COST = 24;

function searchRoute(s: Anchor, e: Anchor, obstacles: Rect[]): number[] | null {
  const inside = (p: Pt, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  // Stub out of each end: normally STUB, shortened when something sits closer than that.
  const stubFor = (a: Anchor) => {
    let len = STUB;
    for (const r of obstacles) {
      const p = { x: a.x + a.dx * len, y: a.y + a.dy * len };
      if (!inside(p, r)) continue;
      const gap = a.dx > 0 ? r.x - a.x : a.dx < 0 ? a.x - (r.x + r.w) : a.dy > 0 ? r.y - a.y : a.y - (r.y + r.h);
      if (gap > 0) len = Math.min(len, gap / 2);
    }
    return { x: a.x + a.dx * len, y: a.y + a.dy * len };
  };
  const S1 = stubFor(s);
  const E1 = stubFor(e);
  // Pad obstacles for clearance, but never so much that the padding swallows an end's stub.
  const outside = (p: Pt, r: Rect) => Math.max(r.x - p.x, p.x - (r.x + r.w), r.y - p.y, p.y - (r.y + r.h));
  const obs = obstacles
    .map((r) => {
      const room = Math.min(outside(S1, r), outside(E1, r));
      const pad = room > 0 ? Math.max(1, Math.min(PAD, room - 1)) : PAD;
      return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
    })
    .filter((r) => !inside(S1, r) && !inside(E1, r));
  const uniq = (v: number[]) => [...new Set(v.map((n) => Math.round(n * 100) / 100))].sort((a, b) => a - b);
  const xs = uniq([S1.x, E1.x, (S1.x + E1.x) / 2, ...obs.flatMap((r) => [r.x, r.x + r.w])]);
  const ys = uniq([S1.y, E1.y, (S1.y + E1.y) / 2, ...obs.flatMap((r) => [r.y, r.y + r.h])]);
  const nx = xs.length;
  const ny = ys.length;
  const ok = new Uint8Array(nx * ny);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) ok[j * nx + i] = obs.some((r) => inside({ x: xs[i], y: ys[j] }, r)) ? 0 : 1;
  const si = xs.indexOf(Math.round(S1.x * 100) / 100);
  const sj = ys.indexOf(Math.round(S1.y * 100) / 100);
  const ei = xs.indexOf(Math.round(E1.x * 100) / 100);
  const ej = ys.indexOf(Math.round(E1.y * 100) / 100);
  if (si < 0 || sj < 0 || ei < 0 || ej < 0) return null;
  // Directions: 0 +x, 1 -x, 2 +y, 3 -y
  const DX = [1, -1, 0, 0];
  const DY = [0, 0, 1, -1];
  const dirOf = (dx: number, dy: number) => (dx > 0 ? 0 : dx < 0 ? 1 : dy > 0 ? 2 : 3);
  const startDir = dirOf(s.dx, s.dy);
  const endDir = dirOf(-e.dx, -e.dy);
  const N = nx * ny * 4;
  const g = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const h = (i: number, j: number) => Math.abs(xs[i] - xs[ei]) + Math.abs(ys[j] - ys[ej]);
  const heap: [number, number][] = [];
  const push = (f: number, st: number) => {
    heap.push([f, st]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const sid = (sj * nx + si) * 4 + startDir;
  g[sid] = 0;
  push(h(si, sj), sid);
  let goal = -1;
  while (heap.length) {
    const [, st] = pop();
    const dir = st & 3;
    const node = st >> 2;
    const i = node % nx;
    const j = (node - i) / nx;
    if (i === ei && j === ej) {
      goal = st;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      if ((dir ^ 1) === nd && (dir >> 1) === (nd >> 1)) continue; // no U-turns
      const ni = i + DX[nd];
      const nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny || !ok[nj * nx + ni]) continue;
      const a = { x: xs[i], y: ys[j] };
      const b = { x: xs[ni], y: ys[nj] };
      if (obs.some((r) => segCrosses(a, b, r, 0))) continue;
      let cost = g[st] + Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + (nd !== dir ? BEND_COST : 0);
      if (ni === ei && nj === ej && nd !== endDir) cost += BEND_COST;
      const ns = (nj * nx + ni) * 4 + nd;
      if (cost < g[ns]) {
        g[ns] = cost;
        prev[ns] = st;
        push(cost + h(ni, nj), ns);
      }
    }
  }
  if (goal < 0) return null;
  const path: Pt[] = [];
  for (let st = goal; st >= 0; st = prev[st]) {
    const node = st >> 2;
    const i = node % nx;
    path.push({ x: xs[i], y: ys[(node - i) / nx] });
  }
  path.reverse();
  const pts = simplify([{ x: s.x, y: s.y }, ...path, { x: e.x, y: e.y }]);
  // Convert the polyline to bend coordinates (see the top of this file).
  const bends: number[] = [];
  for (let k = 1; k <= pts.length - 3; k++) {
    const horiz = Math.abs(pts[k - 1].y - pts[k].y) < 1e-6;
    bends.push(horiz ? pts[k].x : pts[k].y);
  }
  return bendsValid(bends, s, e) ? bends : null;
}

const segLen = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

export function pathLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += segLen(pts[i - 1], pts[i]);
  return L;
}

/** Point at distance d along a polyline, with the segment index. */
export function pointAt(pts: Pt[], d: number): { p: Pt; seg: number } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = segLen(a, b);
    if (acc + len >= d || i === pts.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, Math.max(0, (d - acc) / len));
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, seg: i - 1 };
    }
    acc += len;
  }
  return { p: pts[0], seg: 0 };
}

/** Project a point onto the polyline; returns distance along it. */
export function projectOnPath(pts: Pt[], q: Pt): number {
  let best = Infinity;
  let bestD = 0;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = segLen(a, b);
    let t = 0;
    if (len > 0) {
      t = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (len * len);
      t = Math.min(1, Math.max(0, t));
    }
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    const dist = Math.hypot(px - q.x, py - q.y);
    if (dist < best) {
      best = dist;
      bestD = acc + len * t;
    }
    acc += len;
  }
  return bestD;
}

export const LANE_SPACING = 6;

/**
 * Resolve every connection on a page. Automatic Z-shaped routes whose middle segments would
 * overlap are spread into parallel lanes, ordered so that they don't cross each other.
 * Lines leaving the same port share a lane (fan-out trunk).
 */
const pageRouteCache = new WeakMap<Page, { project: Project; routes: Map<string, ResolvedRoute> }>();

export function resolvePageRoutes(project: Project, page: Page): Map<string, ResolvedRoute> {
  // Pages are immutable (immer), so a page + project pair always resolves the same way.
  const hit = pageRouteCache.get(page);
  if (hit && hit.project === project) return hit.routes;
  const routes = computePageRoutes(project, page);
  pageRouteCache.set(page, { project, routes });
  return routes;
}

function computePageRoutes(project: Project, page: Page): Map<string, ResolvedRoute> {
  const out = new Map<string, ResolvedRoute>();
  const autoZ: ResolvedRoute[] = [];
  const obstacles = pageObstacles(project, page);
  const bundled = new Set<string>();
  for (const b of page.bundles ?? []) if (resolveBundle(project, page, b, out, obstacles)) b.connIds.forEach((id) => bundled.add(id));
  for (const c of page.connections) {
    if (bundled.has(c.id)) continue;
    const r = resolveRoute(project, page, c, obstacles);
    if (!r) continue;
    out.set(c.id, r);
    const usable = !r.curve && !(c.bends && bendsValid(c.bends, r.s, r.e));
    if (usable && r.bends.length === 1 && axisOf(r.s) === axisOf(r.e)) autoZ.push(r);
  }
  // Group by the middle coordinate.
  const groups = new Map<number, ResolvedRoute[]>();
  for (const r of autoZ) {
    const k = Math.round(r.bends[0] * 2) / 2;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  for (const [mid, rs] of groups) {
    if (rs.length < 2) continue;
    const horiz = axisOf(rs[0].s) === 'h';
    const along = (p: Pt) => (horiz ? p.y : p.x);
    // Units: lines sharing a start endpoint move together.
    const units = new Map<string, ResolvedRoute[]>();
    for (const r of rs) {
      const key = JSON.stringify(r.conn.from);
      const u = units.get(key);
      if (u) u.push(r);
      else units.set(key, [r]);
    }
    const list = [...units.values()].map((u) => {
      const s0 = along(u[0].s);
      const ends = u.map((r) => along(r.e));
      return { u, s0, lo: Math.min(s0, ...ends), hi: Math.max(s0, ...ends), down: ends.reduce((a, b) => a + b, 0) / ends.length >= s0 };
    });
    // Cluster by overlapping spans.
    list.sort((a, b) => a.lo - b.lo);
    const clusters: (typeof list)[] = [];
    let cur: typeof list = [];
    let curHi = -Infinity;
    for (const it of list) {
      if (cur.length && it.lo > curHi + 0.5) {
        clusters.push(cur);
        cur = [];
        curHi = -Infinity;
      }
      cur.push(it);
      curHi = Math.max(curHi, it.hi);
    }
    if (cur.length) clusters.push(cur);
    for (const cl of clusters) {
      if (cl.length < 2) continue;
      const downs = cl.filter((x) => x.down).sort((a, b) => a.s0 - b.s0);
      const ups = cl.filter((x) => !x.down).sort((a, b) => b.s0 - a.s0);
      const ordered = [...downs, ...ups];
      const n = ordered.length;
      // Direction of travel along the first segment decides which side is "further".
      const sgn = horiz ? rs[0].s.dx || 1 : rs[0].s.dy || 1;
      ordered.forEach((it, k) => {
        const v = mid + sgn * ((n - 1) / 2 - k) * LANE_SPACING;
        for (const r of it.u) {
          const bends = [v];
          const raw = rawPoints(r.s, r.e, bends);
          out.set(r.conn.id, { ...r, bends, raw, pts: simplify(raw) });
        }
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Snakes (bundles)

export const LEG_MIN = 18;

/** Width of a line label's gap. */
export function labelGapWidth(label: string) {
  return measureText(label, 'narrow', LABEL_SIZE) + 4;
}

/**
 * Resolve a bundle: a trunk route (stored in `out` under the bundle id) plus each member line as
 * leg → bar → trunk → bar → leg. Returns false (members then draw as normal lines) if the
 * geometry doesn't allow a bundle, e.g. an end isn't a block port.
 */
function resolveBundle(project: Project, page: Page, b: Bundle, out: Map<string, ResolvedRoute>, obstacles: Rect[]): boolean {
  const members = b.connIds.map((id) => page.connections.find((c) => c.id === id)).filter((c): c is Connection => !!c);
  if (members.length < 2) return false;
  const objA = members[0].from.objId;
  const ends = [];
  for (const c of members) {
    const s = resolveEndpoint(project, page, c.from);
    const e = resolveEndpoint(project, page, c.to);
    if (!s || !e || axisOf(s) !== 'h' || axisOf(e) !== 'h') return false;
    const aIsFrom = c.from.objId === objA;
    ends.push({ c, a: aIsFrom ? s : e, b: aIsFrom ? e : s, aIsFrom });
  }
  const dxA = ends[0].a.dx;
  const dxB = ends[0].b.dx;
  if (ends.some((x) => x.a.dx !== dxA || x.b.dx !== dxB)) return false;
  const labelW = Math.max(0, ...members.map((c) => (c.label ? labelGapWidth(c.label) : 0)));
  const leg = Math.max(LEG_MIN, labelW + 12);
  const ext = (xs: number[], dx: number) => (dx > 0 ? Math.max(...xs) + leg : Math.min(...xs) - leg);
  const ax = ext(ends.map((x) => x.a.x), dxA);
  const bx = ext(ends.map((x) => x.b.x), dxB);
  const aYs = ends.map((x) => x.a.y);
  const bYs = ends.map((x) => x.b.y);
  const midA = (Math.min(...aYs) + Math.max(...aYs)) / 2;
  const midB = (Math.min(...bYs) + Math.max(...bYs)) / 2;
  const sT: Anchor = { x: ax, y: midA, dx: dxA, dy: 0 };
  const eT: Anchor = { x: bx, y: midB, dx: dxB, dy: 0 };
  const bends = b.bends && bendsValid(b.bends, sT, eT) ? b.bends : autoRoute(sT, eT, obstacles);
  const raw = rawPoints(sT, eT, bends);
  const pts = simplify(raw);
  const pseudo: Connection = { id: b.id, from: members[0].from, to: members[0].to, bends: b.bends, label: b.label, labelT: null, style: b.style };
  out.set(b.id, {
    conn: pseudo,
    s: sT,
    e: eT,
    bends,
    raw,
    pts,
    trunk: {
      bundle: b,
      bars: [
        [{ x: ax, y: Math.min(...aYs) }, { x: ax, y: Math.max(...aYs) }],
        [{ x: bx, y: Math.min(...bYs) }, { x: bx, y: Math.max(...bYs) }],
      ],
      members: members.map((c) => c.id),
    },
  });
  for (const x of ends) {
    let full = simplify([x.a, { x: ax, y: x.a.y }, { x: ax, y: midA }, ...pts.slice(1, -1), { x: bx, y: midB }, { x: bx, y: x.b.y }, x.b]);
    if (!x.aIsFrom) full = full.reverse();
    const legA: [Pt, Pt] = [{ x: x.a.x, y: x.a.y }, { x: ax, y: x.a.y }];
    const legB: [Pt, Pt] = [{ x: x.b.x, y: x.b.y }, { x: bx, y: x.b.y }];
    out.set(x.c.id, {
      conn: x.c,
      s: x.aIsFrom ? x.a : x.b,
      e: x.aIsFrom ? x.b : x.a,
      bends: [],
      raw: full,
      pts: full,
      legs: x.aIsFrom ? [legA, legB] : [legB, legA],
    });
  }
  return true;
}
