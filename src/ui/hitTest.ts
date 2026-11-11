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

export function hitObject(project: Project, page: Page, x: number, y: number, pad = 0): PageObject | null {
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    const b = objBounds(project, o);
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return o;
  }
  return null;
}

/** Nearest point on a shape's outline, as fractions of its bounds. */
export function outlinePoint(b: { x: number; y: number; w: number; h: number }, x: number, y: number) {
  const fx = Math.min(1, Math.max(0, (x - b.x) / b.w));
  const fy = Math.min(1, Math.max(0, (y - b.y) / b.h));
  const d = [
    { d: fx * b.w, fx: 0, fy },
    { d: (1 - fx) * b.w, fx: 1, fy },
    { d: fy * b.h, fx, fy: 0 },
    { d: (1 - fy) * b.h, fx, fy: 1 },
  ].sort((a, b) => a.d - b.d)[0];
  return { fx: d.fx, fy: d.fy };
}
