import type { BlockObj, Page, PageObject, Project, Side } from '../model/types';
import { blockFor, blockLayout, BLK } from '../model/blockGeometry';
import { fromLocal, insideObj, localBox, toLocal } from '../model/geom';
import { containerBand } from '../render/buildPage';
import type { PortRef } from '../state/store';

export interface PortHit extends PortRef {
  side: Side;
  index: number;
}

/** Port hotspot zones: from the block edge inward to 45% of the width, plus a little outside. */
export function portZones(project: Project, o: BlockObj) {
  const { dev, def } = blockFor(project, o);
  if (!dev || !def) return [];
  const L = blockLayout(def, dev.name);
  const s = o.scale;
  const W = L.w * s;
  const zoneW = W * 0.45;
  const out = 6;
  const zones: { x: number; y: number; w: number; h: number; hit: PortHit }[] = [];
  def.left.forEach((p, i) => {
    const y = o.y + (BLK.headerH + i * BLK.rowH) * s;
    zones.push({ x: o.x - out, y, w: zoneW + out, h: BLK.rowH * s, hit: { objId: o.id, portId: p.id, side: 'L', index: i } });
  });
  def.right.forEach((p, i) => {
    const y = o.y + (BLK.headerH + i * BLK.rowH) * s;
    zones.push({ x: o.x + W - zoneW, y, w: zoneW + out, h: BLK.rowH * s, hit: { objId: o.id, portId: p.id, side: 'R', index: i } });
  });
  return zones;
}

export function hitPort(project: Project, page: Page, x: number, y: number): PortHit | null {
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    if (o.kind !== 'block') continue;
    for (const z of portZones(project, o)) if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z.hit;
  }
  return null;
}

/** Containers are grabbed by their frame or label band, so what's inside stays clickable. */
export function hitsContainer(project: Project, o: PageObject, x: number, y: number, tol: number) {
  if (o.kind !== 'container') return false;
  const b = localBox(project, o);
  const q = toLocal(project, o, { x, y });
  if (!insideObj(project, o, { x, y }, tol)) return false;
  const band = containerBand(o);
  const inner = q.x > b.x + tol && q.x < b.x + b.w - tol && q.y > b.y + Math.max(tol, band) && q.y < b.y + b.h - tol;
  return !inner;
}

/** Topmost object under a point: anywhere inside its (rotated) box counts; containers only on their frame. */
export function hitObject(project: Project, page: Page, x: number, y: number, pad = 0, frameTol = 4): PageObject | null {
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    // Units in a rack are found through their rack (they're always drawn on top of it).
    if (o.kind === 'rackunit' && o.rackId && page.objects.some((r) => r.id === o.rackId)) continue;
    if (o.kind === 'rack') {
      if (!insideObj(project, o, { x, y }, pad)) continue;
      const units = page.objects.filter((u) => u.kind === 'rackunit' && u.rackId === o.id);
      for (let j = units.length - 1; j >= 0; j--) if (insideObj(project, units[j], { x, y }, pad)) return units[j];
      return o;
    }
    if (o.kind === 'container') {
      if (hitsContainer(project, o, x, y, frameTol + pad)) return o;
      continue;
    }
    if (insideObj(project, o, { x, y }, pad)) return o;
  }
  return null;
}

/** Connection point on an object: the centre of the side nearest to the page point (rotation aware). */
export function outlinePointOf(project: Project, o: PageObject, x: number, y: number) {
  const q = toLocal(project, o, { x, y });
  return outlinePoint(localBox(project, o), q.x, q.y);
}

/** Connection point on a box: the centre of the side nearest to (x, y), as fractions of the box. */
export function outlinePoint(b: { x: number; y: number; w: number; h: number }, x: number, y: number) {
  const fx = (x - b.x) / b.w;
  const fy = (y - b.y) / b.h;
  const d = [
    { d: Math.abs(fx) * b.w, fx: 0, fy: 0.5 },
    { d: Math.abs(1 - fx) * b.w, fx: 1, fy: 0.5 },
    { d: Math.abs(fy) * b.h, fx: 0.5, fy: 0 },
    { d: Math.abs(1 - fy) * b.h, fx: 0.5, fy: 1 },
  ].sort((a, b) => a.d - b.d)[0];
  return { fx: d.fx, fy: d.fy };
}

export const SIDE_CENTRES = [
  { fx: 0, fy: 0.5 },
  { fx: 1, fy: 0.5 },
  { fx: 0.5, fy: 0 },
  { fx: 0.5, fy: 1 },
];

export interface ShapeDot {
  objId: string;
  fx: number;
  fy: number;
}

/** A shape's connection dot (side centre) within `tol` of the point. */
export function hitShapeDot(project: Project, page: Page, x: number, y: number, tol: number): ShapeDot | null {
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    if (o.kind === 'block' || o.kind === 'line' || o.kind === 'rack' || o.kind === 'rackunit') continue;
    for (const c of SIDE_CENTRES) {
      const p = dotPos(project, o, c);
      if (Math.hypot(p.x - x, p.y - y) <= tol) return { objId: o.id, ...c };
    }
  }
  return null;
}

/** Page position of a connection dot (fractions of the unrotated box). */
export function dotPos(project: Project, o: PageObject, c: { fx: number; fy: number }) {
  const b = localBox(project, o);
  return fromLocal(project, o, { x: b.x + c.fx * b.w, y: b.y + c.fy * b.h });
}

/** The shape (not block) under or near a point, for showing its dots. */
export function hitShape(project: Project, page: Page, x: number, y: number, pad: number): PageObject | null {
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    if (o.kind === 'block' || o.kind === 'line' || o.kind === 'rack' || o.kind === 'rackunit') continue;
    if (o.kind === 'container' ? hitsContainer(project, o, x, y, pad + 4) : insideObj(project, o, { x, y }, pad)) return o;
  }
  return null;
}
