import type { BlockObj, Page, PageObject, Project, RectObj, StrokeStyle, TextObj } from '../model/types';
import { dashArray, PAGE_MARGIN, PAGE_SIZES, titleBlockWidth } from '../model/defaults';
import { BLK, blockFor, blockLayout, headerText, portText } from '../model/blockGeometry';
import { pathLength, pointAt, resolvePageRoutes, type Pt, type ResolvedRoute } from '../model/routing';
import { capHeightEm, fitText, measureText, wrapText } from '../text/fonts';
import type { DLItem, DLStroke, PathCmd } from './displayList';

export function toDLStroke(s: StrokeStyle): DLStroke {
  return { color: s.color, width: s.width, dash: dashArray(s) };
}

const THIN: DLStroke = { color: '#000000', width: 0.5, dash: [] };

export interface BuildOptions {
  /** Page number (1-based) and page count, for the title block. */
  pageIndex: number;
  pageCount: number;
}

export function buildPage(project: Project, page: Page, opts: BuildOptions): DLItem[] {
  const out: DLItem[] = [];
  drawFrame(out, project, page, opts);
  for (const o of page.objects) drawObject(out, project, o);
  drawConnections(out, project, page);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Objects

export function drawObject(out: DLItem[], project: Project, o: PageObject) {
  if (o.kind === 'block') drawBlock(out, project, o);
  else if (o.kind === 'rect') drawRect(out, o);
  else drawText(out, o);
}

function drawRect(out: DLItem[], o: RectObj) {
  out.push({ t: 'rect', x: o.x, y: o.y, w: o.w, h: o.h, fill: o.fill, stroke: o.border.width > 0 ? toDLStroke(o.border) : null });
}

export const TEXT_PAD = 3;

export function textLines(o: TextObj) {
  const font = o.bold ? 'narrowBold' : 'narrow';
  return wrapText(o.text, font, o.fontSize, Math.max(1, o.w - TEXT_PAD * 2));
}

function drawText(out: DLItem[], o: TextObj) {
  if (o.fill || (o.border && o.border.width > 0)) {
    out.push({ t: 'rect', x: o.x, y: o.y, w: o.w, h: o.h, fill: o.fill, stroke: o.border && o.border.width > 0 ? toDLStroke(o.border) : null });
  }
  const font = o.bold ? 'narrowBold' : 'narrow';
  const lh = o.fontSize * 1.2;
  const lines = textLines(o);
  let y = o.y + TEXT_PAD + o.fontSize * capHeightEm(font) + (lh - o.fontSize) / 2;
  for (const line of lines) {
    const w = measureText(line, font, o.fontSize);
    const x = o.align === 'left' ? o.x + TEXT_PAD : o.align === 'right' ? o.x + o.w - TEXT_PAD - w : o.x + (o.w - w) / 2;
    if (line) out.push({ t: 'text', x, y, text: line, font, size: o.fontSize, color: o.color });
    y += lh;
  }
}

function drawBlock(out: DLItem[], project: Project, o: BlockObj) {
  const { dev, def } = blockFor(project, o);
  const s = o.scale;
  if (!dev || !def) {
    out.push({ t: 'rect', x: o.x, y: o.y, w: 40 * s, h: 20 * s, fill: '#ffdddd', stroke: THIN });
    return;
  }
  const L = blockLayout(def, dev.name);
  const W = L.w * s;
  const H = L.h * s;
  const thin: DLStroke = { color: o.border.color, width: 0.5 * Math.min(1, s), dash: [] };
  out.push({ t: 'rect', x: o.x, y: o.y, w: W, h: H, fill: '#ffffff', stroke: null });

  // Header
  const hs = BLK.headerSize * s;
  const ht = fitText(headerText(def), 'narrowBold', BLK.headerSize, L.w - BLK.pad * 2);
  const hw = measureText(ht, 'narrowBold', BLK.headerSize) * s;
  out.push({
    t: 'text',
    x: o.x + (W - hw) / 2,
    y: o.y + (BLK.headerH * s + hs * capHeightEm('narrowBold')) / 2,
    text: ht,
    font: 'narrowBold',
    size: hs,
    color: '#000000',
  });
  const hy = o.y + BLK.headerH * s;
  out.push({ t: 'path', d: [{ c: 'M', x: o.x, y: hy }, { c: 'L', x: o.x + W, y: hy }], fill: null, stroke: thin });

  // Ports
  const ps = BLK.portSize * s;
  const cap = ps * capHeightEm('narrow');
  def.left.forEach((p, i) => {
    const y = hy + (i * BLK.rowH + BLK.rowH / 2) * s + cap / 2;
    out.push({ t: 'text', x: o.x + BLK.pad * s, y, text: portText(p, 'L'), font: 'narrow', size: ps, color: '#000000' });
  });
  def.right.forEach((p, i) => {
    const y = hy + (i * BLK.rowH + BLK.rowH / 2) * s + cap / 2;
    const t = portText(p, 'R');
    const w = measureText(t, 'narrow', BLK.portSize) * s;
    out.push({ t: 'text', x: o.x + W - BLK.pad * s - w, y, text: t, font: 'narrow', size: ps, color: '#000000' });
  });

  // Footer
  const fy = o.y + (BLK.headerH + L.rows * BLK.rowH) * s;
  out.push({ t: 'path', d: [{ c: 'M', x: o.x, y: fy }, { c: 'L', x: o.x + W, y: fy }], fill: null, stroke: thin });
  const fs = BLK.footerSize * s;
  const fb = fy + (BLK.footerH * s + fs * capHeightEm('narrow')) / 2;
  out.push({ t: 'text', x: o.x + BLK.pad * s, y: fb, text: 'IN', font: 'narrow', size: fs, color: '#000000' });
  const ow = measureText('OUT', 'narrow', BLK.footerSize) * s;
  out.push({ t: 'text', x: o.x + W - BLK.pad * s - ow, y: fb, text: 'OUT', font: 'narrow', size: fs, color: '#000000' });
  const nw = measureText(dev.name, 'narrowBold', BLK.footerSize) * s;
  out.push({ t: 'text', x: o.x + (W - nw) / 2, y: fb, text: dev.name, font: 'narrowBold', size: fs, color: '#000000' });

  // Border on top
  if (o.border.width > 0) out.push({ t: 'rect', x: o.x, y: o.y, w: W, h: H, fill: null, stroke: toDLStroke(o.border) });
}

// ---------------------------------------------------------------------------------------------
// Connections

export const LABEL_SIZE = 6.5;
export const HOP_R = 2.5;

/** Distance along the path of the automatic label position: middle of the longest horizontal run. */
export function autoLabelDistance(pts: Pt[]): number {
  let best = -1;
  let bestD = pathLength(pts) / 2;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
    const horiz = Math.abs(pts[i].y - pts[i - 1].y) < 1e-6;
    if (horiz && len > best + 1e-6) {
      best = len;
      bestD = acc + len / 2;
    }
    acc += len;
  }
  return bestD;
}

/** Label placement: centre point, gap length along the line, and orientation (text follows the segment). */
export function labelBox(route: ResolvedRoute) {
  const label = route.conn.label;
  if (!label) return null;
  const L = pathLength(route.pts);
  const d = route.conn.labelT === null ? autoLabelDistance(route.pts) : route.conn.labelT * L;
  const { p, seg } = pointAt(route.pts, d);
  const a = route.pts[seg];
  const b = route.pts[seg + 1] ?? a;
  const horiz = Math.abs(a.y - b.y) < 1e-6;
  const tw = measureText(label, 'narrow', LABEL_SIZE);
  const gap = tw + 4;
  // Hit/selection box in page coordinates.
  const box = horiz ? { x: p.x - gap / 2, y: p.y - 5, w: gap, h: 10 } : { x: p.x - 5, y: p.y - gap / 2, w: 10, h: gap };
  return { p, d, gap, tw, horiz, box };
}

export function drawConnections(out: DLItem[], project: Project, page: Page, onlyIds?: Set<string>) {
  const routes: ResolvedRoute[] = [...resolvePageRoutes(project, page).values()];
  // Vertical segments of every line, for hop detection.
  const verticals: { x: number; y0: number; y1: number; ri: number }[] = [];
  routes.forEach((r, ri) => {
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1];
      const b = r.pts[i];
      if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) > 1e-6) verticals.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), ri });
    }
  });

  routes.forEach((r, ri) => {
    if (onlyIds && !onlyIds.has(r.conn.id)) return;
    const hops = new Map<number, number[]>();
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1];
      const b = r.pts[i];
      if (Math.abs(a.y - b.y) > 1e-6) continue;
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const xs: number[] = [];
      for (const v of verticals) {
        if (v.ri === ri) continue;
        if (sameSource(routes[v.ri], r)) continue;
        if (v.x > x0 + HOP_R + 0.5 && v.x < x1 - HOP_R - 0.5 && a.y > v.y0 + 0.5 && a.y < v.y1 - 0.5) xs.push(v.x);
      }
      if (xs.length) hops.set(i - 1, mergeHops(xs));
    }
    const lb = labelBox(r);
    const gap = lb ? ([lb.d - lb.gap / 2, lb.d + lb.gap / 2] as [number, number]) : null;
    const d = strokePath(r.pts, gap, hops);
    out.push({ t: 'path', d, fill: null, stroke: toDLStroke(r.conn.style) });
    if (lb) {
      const capH = LABEL_SIZE * capHeightEm('narrow');
      out.push(
        lb.horiz
          ? { t: 'text', x: lb.p.x - lb.tw / 2, y: lb.p.y + capH / 2, text: r.conn.label, font: 'narrow', size: LABEL_SIZE, color: r.conn.style.color }
          : { t: 'text', x: lb.p.x + capH / 2, y: lb.p.y + lb.tw / 2, text: r.conn.label, font: 'narrow', size: LABEL_SIZE, color: r.conn.style.color, rot: -90 },
      );
    }
  });
}

function sameSource(a: ResolvedRoute, b: ResolvedRoute) {
  const ea = a.conn.from;
  const eb = b.conn.from;
  return JSON.stringify(ea) === JSON.stringify(eb);
}

function mergeHops(xs: number[]): number[] {
  xs.sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of xs) if (!out.length || x - out[out.length - 1] > HOP_R * 2.2) out.push(x);
  return out;
}

const K = 0.5523;

/** Build path commands for an orthogonal polyline with an optional gap (distance interval) and hops. */
export function strokePath(pts: Pt[], gap: [number, number] | null, hops: Map<number, number[]>): PathCmd[] {
  const d: PathCmd[] = [];
  let pen: Pt | null = null;
  let acc = 0;
  const moveOrLine = (p: Pt) => {
    if (!pen || Math.abs(pen.x - p.x) > 1e-6 || Math.abs(pen.y - p.y) > 1e-6) d.push({ c: 'M', x: p.x, y: p.y });
    pen = p;
  };
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1];
    const B = pts[i];
    const len = Math.abs(B.x - A.x) + Math.abs(B.y - A.y);
    if (len === 0) continue;
    const at = (u: number): Pt => ({ x: A.x + ((B.x - A.x) * u) / len, y: A.y + ((B.y - A.y) * u) / len });
    // Draw intervals = [0,len] minus gap.
    let intervals: [number, number][] = [[0, len]];
    if (gap) {
      const g0 = gap[0] - acc;
      const g1 = gap[1] - acc;
      if (g1 > 0 && g0 < len) {
        intervals = [];
        if (g0 > 0) intervals.push([0, g0]);
        if (g1 < len) intervals.push([g1, len]);
      }
    }
    const hx = hops.get(i - 1) ?? [];
    const sgn = Math.sign(B.x - A.x) || 1;
    const hu = hx.map((x) => Math.abs(x - A.x)).sort((a, b) => a - b);
    for (const [p, q] of intervals) {
      moveOrLine(at(p));
      for (const u of hu) {
        if (u - HOP_R <= p || u + HOP_R >= q) continue;
        const s0 = at(u - HOP_R);
        d.push({ c: 'L', x: s0.x, y: s0.y });
        const y = A.y;
        const xc = A.x + sgn * u;
        const r = HOP_R;
        d.push({ c: 'C', x1: xc - sgn * r, y1: y - K * r, x2: xc - sgn * K * r, y2: y - r, x: xc, y: y - r });
        d.push({ c: 'C', x1: xc + sgn * K * r, y1: y - r, x2: xc + sgn * r, y2: y - K * r, x: xc + sgn * r, y });
      }
      const e = at(q);
      d.push({ c: 'L', x: e.x, y: e.y });
      pen = e;
    }
    acc += len;
  }
  return d;
}

// ---------------------------------------------------------------------------------------------
// Page frame + title block

function drawFrame(out: DLItem[], project: Project, page: Page, opts: BuildOptions) {
  const P = PAGE_SIZES[page.size];
  const m = PAGE_MARGIN;
  const tbw = titleBlockWidth(page.size);
  const frame: DLStroke = { color: '#000000', width: 1, dash: [] };
  out.push({ t: 'rect', x: m, y: m, w: P.w - 2 * m, h: P.h - 2 * m, fill: null, stroke: frame });
  const x0 = P.w - m - tbw;
  out.push({ t: 'path', d: [{ c: 'M', x: x0, y: m }, { c: 'L', x: x0, y: P.h - m }], fill: null, stroke: frame });
  drawTitleBlock(out, project, page, opts, { x: x0, y: m, w: tbw, h: P.h - 2 * m });
}

function drawTitleBlock(out: DLItem[], project: Project, page: Page, opts: BuildOptions, r: { x: number; y: number; w: number; h: number }) {
  const info = project.info;
  const pad = 5;
  const iw = r.w - pad * 2;
  let y = r.y + pad;
  const line = (yy: number) => out.push({ t: 'path', d: [{ c: 'M', x: r.x, y: yy }, { c: 'L', x: r.x + r.w, y: yy }], fill: null, stroke: THIN });
  const text = (t: string, font: 'title' | 'titleBold', size: number, align: 'left' | 'center' = 'left') => {
    for (const ln of wrapText(t, font, size, iw)) {
      y += size * 1.15;
      const w = measureText(ln, font, size);
      out.push({ t: 'text', x: align === 'left' ? r.x + pad : r.x + (r.w - w) / 2, y: y - size * 0.25, text: ln, font, size, color: '#000000' });
    }
  };

  // Logo
  const logoH = r.w * 0.55;
  const logo = info.logoAssetId ? project.assets[info.logoAssetId] : undefined;
  if (logo && info.logoAssetId) {
    const scale = Math.min(iw / logo.w, (logoH - pad) / logo.h);
    const w = logo.w * scale;
    const h = logo.h * scale;
    out.push({ t: 'image', x: r.x + (r.w - w) / 2, y: y + (logoH - pad - h) / 2, w, h, assetId: info.logoAssetId });
  }
  y += logoH;
  line(y);
  y += 2;

  // Project
  if (info.name) text(info.name, 'titleBold', 9);
  if (info.address) text(info.address, 'title', 7);
  y += 4;
  line(y);
  y += 2;

  // Designer
  if (info.designerName) text(info.designerName, 'titleBold', 7);
  if (info.copyright) text(info.copyright, 'title', 6);
  if (info.phone) text(info.phone, 'title', 6);
  if (info.email) text(info.email, 'title', 6);
  y += 4;
  line(y);

  // Bottom: page box, above it the dates box.
  const pageBoxH = 64;
  const datesH = 3 * 8 + 8;
  const pb = r.y + r.h - pageBoxH;
  const db = pb - datesH;
  line(db);
  line(pb);
  const fmtDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  };
  const rows: [string, string][] = [
    ['Created', fmtDate(info.created)],
    ['Modified', fmtDate(info.modified)],
    ['Revision', info.revision],
  ];
  rows.forEach(([k, v], i) => {
    const by = db + 4 + (i + 1) * 8 - 1.5;
    out.push({ t: 'text', x: r.x + pad, y: by, text: k, font: 'title', size: 6.5, color: '#000000' });
    const vw = measureText(v, 'titleBold', 6.5);
    out.push({ t: 'text', x: r.x + r.w - pad - vw, y: by, text: v, font: 'titleBold', size: 6.5, color: '#000000' });
  });

  // Page name + number
  y = pb + 2;
  const title = `(${opts.pageIndex}) ${page.name}`;
  text(title, 'titleBold', 8, 'center');
  const num = `${opts.pageIndex}/${opts.pageCount}`;
  const ns = 18;
  const nw = measureText(num, 'titleBold', ns);
  out.push({ t: 'text', x: r.x + (r.w - nw) / 2, y: r.y + r.h - 8, text: num, font: 'titleBold', size: ns, color: '#000000' });
}
