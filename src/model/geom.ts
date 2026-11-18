// Object geometry: boxes, rotation, bounds.
import type { PageObject, Project } from './types';
import { blockSize } from './blockGeometry';
import { tagSize } from './tags';

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Affine matrix [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f (page coordinates, y down). */
export type Matrix = [number, number, number, number, number, number];

export function rotOf(o: PageObject): number {
  return o.kind === 'block' || o.kind === 'tag' ? 0 : normDeg(o.rot ?? 0);
}

export function normDeg(d: number) {
  const r = ((d % 360) + 360) % 360;
  return Math.abs(r - 360) < 1e-9 ? 0 : r;
}

/** The object's box before rotation. */
export function localBox(project: Project, o: PageObject): Rect {
  if (o.kind === 'block') {
    const s = blockSize(project, o);
    return { x: o.x, y: o.y, w: s.w, h: s.h };
  }
  if (o.kind === 'tag') {
    const s = tagSize(project, o);
    return { x: o.x, y: o.y, w: s.w, h: s.h };
  }
  return { x: o.x, y: o.y, w: o.w, h: o.h };
}

export function rotatePt(p: Pt, c: Pt, deg: number): Pt {
  if (!deg) return { x: p.x, y: p.y };
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function centre(r: Rect): Pt {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Page point → the object's unrotated frame. */
export function toLocal(project: Project, o: PageObject, p: Pt): Pt {
  const b = localBox(project, o);
  return rotatePt(p, centre(b), -rotOf(o));
}

/** Unrotated-frame point → page. */
export function fromLocal(project: Project, o: PageObject, p: Pt): Pt {
  const b = localBox(project, o);
  return rotatePt(p, centre(b), rotOf(o));
}

export function corners(r: Rect): Pt[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** Corners of the (possibly rotated) box on the page. */
export function objCorners(project: Project, o: PageObject): Pt[] {
  const b = localBox(project, o);
  const r = rotOf(o);
  return corners(b).map((p) => rotatePt(p, centre(b), r));
}

/** Axis-aligned bounds on the page (rotation included). */
export function objBounds(project: Project, o: PageObject): Rect {
  const b = localBox(project, o);
  if (!rotOf(o)) return b;
  const cs = objCorners(project, o);
  const xs = cs.map((p) => p.x);
  const ys = cs.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Rotation about the box centre as a matrix (identity when not rotated). */
export function rotMatrix(b: Rect, deg: number): Matrix {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const c = centre(b);
  return [cos, sin, -sin, cos, c.x - cos * c.x + sin * c.y, c.y - sin * c.x - cos * c.y];
}

/** Is a page point inside the object's (rotated) box? */
export function insideObj(project: Project, o: PageObject, p: Pt, pad = 0): boolean {
  const b = localBox(project, o);
  const q = toLocal(project, o, p);
  return q.x >= b.x - pad && q.x <= b.x + b.w + pad && q.y >= b.y - pad && q.y <= b.y + b.h + pad;
}
