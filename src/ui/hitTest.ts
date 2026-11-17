import type { BlockObj, Page, PageObject, Project, Side } from '../model/types';
import { blockFor, blockLayout, BLK } from '../model/blockGeometry';
import { objBounds } from '../model/routing';
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

/** Topmost object under a point: anywhere inside its bounds counts, for every kind of object. */
export function hitObject(project: Project, page: Page, x: number, y: number, pad = 0): PageObject | null {
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    const b = objBounds(project, o);
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return o;
  }
  return null;
}

/** Connection point on a shape: the centre of the side nearest to (x, y), as fractions of its bounds. */
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
    if (o.kind === 'block') continue;
    const b = objBounds(project, o);
    for (const c of SIDE_CENTRES) {
      if (Math.hypot(b.x + c.fx * b.w - x, b.y + c.fy * b.h - y) <= tol) return { objId: o.id, ...c };
    }
  }
  return null;
}

/** The shape (not block) under or near a point, for showing its dots. */
export function hitShape(project: Project, page: Page, x: number, y: number, pad: number): PageObject | null {
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    if (o.kind === 'block') continue;
    const b = objBounds(project, o);
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return o;
  }
  return null;
}
