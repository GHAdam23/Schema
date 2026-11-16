// Orthogonal connection routing.
//
// A route is stored as a list of alternating bend coordinates. Starting at the start anchor and
// moving along the start's exit axis, each coordinate says where the current segment ends
// (an x for a horizontal segment, a y for a vertical one); the axis then flips. After the last
// bend the path is completed with at most two more segments to reach the end anchor. Because
// the end segments always stretch to the anchors, lines stay attached when objects move while
// keeping the user's adjusted middle segments.

import type { BlockObj, Connection, Endpoint, Page, PageObject, Project } from './types';
import { isPortEndpoint } from './types';
import { blockSize, portAnchor } from './blockGeometry';

export interface Pt {
  x: number;
  y: number;
}
export type Axis = 'h' | 'v';

export interface Anchor extends Pt {
  /** Outward direction from the object. */
  dx: number;
  dy: number;
}

export const STUB = 12;

export function objBounds(project: Project, o: PageObject) {
  if (o.kind === 'block') {
    const s = blockSize(project, o);
    return { x: o.x, y: o.y, w: s.w, h: s.h };
  }
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}

export function resolveEndpoint(project: Project, page: Page, e: Endpoint): Anchor | null {
  const obj = page.objects.find((o) => o.id === e.objId);
  if (!obj) return null;
  if (isPortEndpoint(e)) {
    if (obj.kind !== 'block') return null;
    const a = portAnchor(project, obj as BlockObj, e.portId);
    if (!a) return null;
    return { x: a.x, y: a.y, dx: a.dir[0], dy: a.dir[1] };
  }
  const b = objBounds(project, obj);
  const x = b.x + e.fx * b.w;
  const y = b.y + e.fy * b.h;
  // Outward direction: nearest side.
  const d = [
    { d: e.fx, dx: -1, dy: 0 },
    { d: 1 - e.fx, dx: 1, dy: 0 },
    { d: e.fy, dx: 0, dy: -1 },
    { d: 1 - e.fy, dx: 0, dy: 1 },
  ].sort((a, b) => a.d - b.d)[0];
  return { x, y, dx: d.dx, dy: d.dy };
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

export interface ResolvedRoute {
  conn: Connection;
  s: Anchor;
  e: Anchor;
  bends: number[];
  /** Raw points including possibly zero-length segments (index-aligned with bends for editing). */
  raw: Pt[];
  pts: Pt[];
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

export function resolveRoute(project: Project, page: Page, conn: Connection, obstacles = blockObstacles(project, page)): ResolvedRoute | null {
  const s = resolveEndpoint(project, page, conn.from);
  const e = resolveEndpoint(project, page, conn.to);
  if (!s || !e) return null;
  const bends = conn.bends && bendsValid(conn.bends, s, e) ? conn.bends : autoRoute(s, e, obstacles);
  const raw = rawPoints(s, e, bends);
  return { conn, s, e, bends, raw, pts: simplify(raw) };
}

// ---------------------------------------------------------------------------------------------
// Automatic routing around blocks

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function blockObstacles(project: Project, page: Page): Rect[] {
  return page.objects.filter((o) => o.kind === 'block').map((o) => objBounds(project, o));
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
  const S1 = { x: s.x + s.dx * STUB, y: s.y + s.dy * STUB };
  const E1 = { x: e.x + e.dx * STUB, y: e.y + e.dy * STUB };
  const inside = (p: Pt, r: Rect) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  const obs = obstacles
    .map((r) => ({ x: r.x - PAD, y: r.y - PAD, w: r.w + PAD * 2, h: r.h + PAD * 2 }))
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

export function pathLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
  return L;
}

/** Point at distance d along an orthogonal polyline, with the segment index. */
export function pointAt(pts: Pt[], d: number): { p: Pt; seg: number } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
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
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    let t = 0;
    if (len > 0) {
      t = a.x === b.x ? (q.y - a.y) / (b.y - a.y) : (q.x - a.x) / (b.x - a.x);
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
export function resolvePageRoutes(project: Project, page: Page): Map<string, ResolvedRoute> {
  const out = new Map<string, ResolvedRoute>();
  const autoZ: ResolvedRoute[] = [];
  const obstacles = blockObstacles(project, page);
  for (const c of page.connections) {
    const r = resolveRoute(project, page, c, obstacles);
    if (!r) continue;
    out.set(c.id, r);
    const usable = !(c.bends && bendsValid(c.bends, r.s, r.e));
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
