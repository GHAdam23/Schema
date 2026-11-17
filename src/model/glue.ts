// Drawn lines whose ends are glued to shapes, other drawn lines or connectors: after every
// change their geometry is recomputed from what they're glued to, so they keep in step when
// those move, resize or rotate.
import type { LineGlue, LineObj, Page, Project } from './types';
import { fromLocal, localBox, normDeg, type Pt } from './geom';
import { pathLength, pointAt, resolvePageRoutes } from './routing';

export const LINE_H = 8;

/** Box + rotation of a line between two page points. */
export function lineBox(x1: number, y1: number, x2: number, y2: number) {
  const w = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rot = normDeg((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI);
  return { x: cx - w / 2, y: cy - LINE_H / 2, w, h: LINE_H, rot: Math.round(rot * 1000) / 1000 };
}

/** The two ends of a drawn line on the page. */
export function lineEnds(o: { x: number; y: number; w: number; h: number; rot?: number }): [Pt, Pt] {
  const a = (normDeg(o.rot ?? 0) * Math.PI) / 180;
  const cx = o.x + o.w / 2;
  const cy = o.y + o.h / 2;
  const hx = (Math.cos(a) * o.w) / 2;
  const hy = (Math.sin(a) * o.w) / 2;
  return [
    { x: cx - hx, y: cy - hy },
    { x: cx + hx, y: cy + hy },
  ];
}

export function gluePoint(project: Project, page: Page, g: LineGlue, routes: () => ReturnType<typeof resolvePageRoutes>): Pt | null {
  if ('connId' in g) {
    const r = routes().get(g.connId);
    return r ? pointAt(r.pts, g.t * pathLength(r.pts)).p : null;
  }
  const t = page.objects.find((o) => o.id === g.objId);
  if (!t) return null;
  const b = localBox(project, t);
  return fromLocal(project, t, { x: b.x + g.fx * b.w, y: b.y + g.fy * b.h });
}

/** Re-solve glued lines (two passes, so lines glued to glued lines settle). Works on an immer draft. */
export function syncGlue(project: Project) {
  for (const page of project.pages) {
    const glued = page.objects.filter((o): o is LineObj => o.kind === 'line' && !!o.ends && !!(o.ends[0] || o.ends[1]));
    if (!glued.length) continue;
    let rs: ReturnType<typeof resolvePageRoutes> | null = null;
    const routes = () => (rs ??= resolvePageRoutes(project, page));
    for (let pass = 0; pass < 2; pass++) {
      for (const o of glued) {
        const cur = lineEnds(o);
        let changed = false;
        o.ends!.forEach((g, i) => {
          if (!g || (!('connId' in g) && g.objId === o.id)) return;
          const q = gluePoint(project, page, g, routes);
          if (q && Math.hypot(q.x - cur[i].x, q.y - cur[i].y) > 1e-4) {
            cur[i] = q;
            changed = true;
          }
        });
        if (changed) Object.assign(o, lineBox(cur[0].x, cur[0].y, cur[1].x, cur[1].y));
      }
    }
  }
}
