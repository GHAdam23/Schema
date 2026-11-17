import type { BlockObj, Page, PageObject, Project, RectObj, StrokeStyle, TextObj, TextProps } from '../model/types';
import { dashArray, PAGE_MARGIN, PAGE_SIZES, titleBlockWidth } from '../model/defaults';
import { BLK, blockFor, blockLayout, portText } from '../model/blockGeometry';
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
  drawTextIn(out, o);
}

export const TEXT_PAD = 3;

type TextBox = TextProps & { x: number; y: number; w: number; h: number };

const LINE = 1.2;
/** Text may come this close to the box edge (≈ half a border line) before it starts to shrink. */
const EDGE = 0.75;

/** Lines and their extent at a given font size (no fitting). */
function layoutAt(o: TextBox, size: number) {
  const font = o.bold ? 'narrowBold' : 'narrow';
  let lines: string[];
  if (o.wrap !== false) {
    // Wrap inside the normal padding, but let a single long word use the padding before it breaks.
    const longestWord = Math.max(0, ...o.text.split(/\s+/).map((p) => measureText(p, font, size)));
    const wrapW = Math.max(o.w - TEXT_PAD * 2, Math.min(longestWord, o.w - EDGE * 2), 1);
    lines = wrapText(o.text, font, size, wrapW + 0.01);
  } else lines = o.text.split(/\r?\n/);
  const widest = Math.max(0, ...lines.map((p) => measureText(p, font, size)));
  // Ink height: line spacing between lines, about one em for the last line.
  const ink = lines.length ? (lines.length - 1) * size * LINE + size : 0;
  return { lines, widest, ink, height: lines.length * size * LINE };
}

interface Fit {
  key: string;
  size: number;
  lines: string[];
  /** Padding actually used: normally TEXT_PAD, less when the text is tight against the box. */
  padX: number;
  padY: number;
}
const fitCache = new WeakMap<object, Fit>();

/**
 * Text layout for a box. The padding collapses first; the font size only shrinks (never grows)
 * once the text would physically overlap the box edge — the same way a block scales.
 */
export function fitTextBox(o: TextBox): Fit {
  const key = `${o.text}|${o.w}|${o.h}|${o.fontSize}|${o.bold}|${o.wrap}`;
  const hit = fitCache.get(o);
  if (hit && hit.key === key) return hit;
  const fits = (size: number) => {
    const L = layoutAt(o, size);
    return L.widest <= o.w - EDGE * 2 + 0.01 && L.ink <= o.h - EDGE * 2 + 0.01;
  };
  let size = o.fontSize;
  if (o.text && !fits(size)) {
    let lo = 2;
    let hi = o.fontSize;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    size = Math.floor(lo * 4) / 4;
  }
  const L = layoutAt(o, size);
  const clamp = (v: number) => Math.min(TEXT_PAD, Math.max(EDGE, v));
  const res: Fit = { key, size, lines: L.lines, padX: clamp((o.w - L.widest) / 2), padY: clamp((o.h - L.ink) / 2) };
  fitCache.set(o, res);
  return res;
}

/** Size a text needs at its full font size (used to grow a text box after typing). */
export function naturalTextSize(o: TextBox) {
  const L = layoutAt(o, o.fontSize);
  return { w: L.widest + TEXT_PAD * 2 + 1, h: L.height + TEXT_PAD * 2 };
}

export function textLines(o: TextBox) {
  return fitTextBox(o).lines;
}

/** Top of the first line's box for the given vertical alignment. */
export function textTop(o: TextBox) {
  const { size, lines, padY } = fitTextBox(o);
  const lh = size * LINE;
  // Line boxes have (lh - size)/2 of leading above the ink; let that leading eat into the padding.
  const lead = (lh - size) / 2;
  const total = (o.text ? lines.length : 1) * lh;
  // Text that has been shrunk to fit scales about the box centre (like a block), whatever its
  // vertical alignment. Centring is optical: cap height of the first line to the last baseline.
  if (o.valign === 'middle' || (o.text && size < o.fontSize - 1e-6)) {
    const cap = size * capHeightEm(o.bold ? 'narrowBold' : 'narrow');
    const body = cap + (Math.max(1, lines.length) - 1) * lh;
    return o.y + o.h / 2 - body / 2 - lead;
  }
  if (o.valign === 'bottom') return o.y + o.h - padY - total + lead;
  return o.y + padY - lead;
}

function drawTextIn(out: DLItem[], o: TextBox) {
  if (!o.text) return;
  const font = o.bold ? 'narrowBold' : 'narrow';
  const { size, lines, padX } = fitTextBox(o);
  const lh = size * LINE;
  let y = textTop(o) + size * capHeightEm(font) + (lh - size) / 2;
  for (const line of lines) {
    const w = measureText(line, font, size);
    const x = o.align === 'left' ? o.x + padX : o.align === 'right' ? o.x + o.w - padX - w : o.x + (o.w - w) / 2;
    if (line) out.push({ t: 'text', x, y, text: line, font, size, color: o.color });
    y += lh;
  }
}

function drawText(out: DLItem[], o: TextObj) {
  if (o.fill || (o.border && o.border.width > 0)) {
    out.push({ t: 'rect', x: o.x, y: o.y, w: o.w, h: o.h, fill: o.fill, stroke: o.border && o.border.width > 0 ? toDLStroke(o.border) : null });
  }
  drawTextIn(out, o);
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

  const half = W / 2;
  const text = (t: string, x: number, y: number, size: number) => out.push({ t: 'text', x, y, text: t, font: 'narrow', size, color: '#000000' });
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    out.push({ t: 'path', d: [{ c: 'M', x: x1, y: y1 }, { c: 'L', x: x2, y: y2 }], fill: null, stroke: thin });

  // Header: manufacturer centred over the left column, model over the right.
  const hs = BLK.headerSize * s;
  const hb = o.y + (BLK.headerH * s + hs * capHeightEm('narrow')) / 2;
  const colText = (L.colW - BLK.pad * 2) ;
  const man = fitText(def.manufacturer, 'narrow', BLK.headerSize, colText);
  const mod = fitText(def.model, 'narrow', BLK.headerSize, colText);
  text(man, o.x + (half - measureText(man, 'narrow', BLK.headerSize) * s) / 2, hb, hs);
  text(mod, o.x + half + (half - measureText(mod, 'narrow', BLK.headerSize) * s) / 2, hb, hs);
  const hy = o.y + BLK.headerH * s;
  line(o.x, hy, o.x + W, hy);

  // Ports
  const ps = BLK.portSize * s;
  const cap = ps * capHeightEm('narrow');
  def.left.forEach((p, i) => {
    const y = hy + (i * BLK.rowH + BLK.rowH / 2) * s + cap / 2;
    text(portText(p, 'L'), o.x + BLK.pad * s, y, ps);
  });
  def.right.forEach((p, i) => {
    const y = hy + (i * BLK.rowH + BLK.rowH / 2) * s + cap / 2;
    const t = portText(p, 'R');
    text(t, o.x + W - BLK.pad * s - measureText(t, 'narrow', BLK.portSize) * s, y, ps);
  });

  // Centre divider (header + port rows), then the footer across the full width.
  const fy = o.y + (BLK.headerH + L.rows * BLK.rowH) * s;
  line(o.x + half, o.y, o.x + half, fy);
  line(o.x, fy, o.x + W, fy);
  const fs = BLK.footerSize * s;
  const fb = fy + (BLK.footerH * s + fs * capHeightEm('narrow')) / 2;
  const nw = measureText(dev.name, 'narrow', BLK.footerSize) * s;
  const iw = measureText('IN', 'narrow', BLK.footerSize) * s;
  const ow = measureText('OUT', 'narrow', BLK.footerSize) * s;
  // IN / OUT centred in the space either side of the name.
  const side = (W - nw) / 2;
  text('IN', o.x + side / 2 - iw / 2, fb, fs);
  text(dev.name, o.x + (W - nw) / 2, fb, fs);
  text('OUT', o.x + W - side / 2 - ow / 2, fb, fs);

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
  const frame: DLStroke = { color: '#000000', width: 1, dash: [] };
  out.push({ t: 'rect', x: m, y: m, w: P.w - 2 * m, h: P.h - 2 * m, fill: null, stroke: frame });
  const r = titleBlockRect(page.size);
  out.push({ t: 'path', d: [{ c: 'M', x: r.x, y: m }, { c: 'L', x: r.x, y: P.h - m }], fill: null, stroke: frame });
  drawTitleBlock(out, project, page, opts, r);
  // Shared title-block content: text boxes / rectangles placed inside the title block column on
  // page 1 are repeated on every other page (scaled if the page size differs).
  if (opts.pageIndex > 1) {
    const first = project.pages[0];
    const r1 = titleBlockRect(first.size);
    const k = r.w / r1.w;
    for (const o of titleBlockObjects(project)) {
      if (o.kind === 'block') continue;
      const moved = { ...o, x: r.x + (o.x - r1.x) * k, y: r.y + (o.y - r1.y) * k, w: o.w * k, h: o.h * k, fontSize: o.fontSize * k };
      drawObject(out, project, moved);
    }
  }
}

/** Rectangle of the title block column on a page. */
export function titleBlockRect(size: Page['size']) {
  const P = PAGE_SIZES[size];
  const m = PAGE_MARGIN;
  const w = titleBlockWidth(size);
  return { x: P.w - m - w, y: m, w, h: P.h - 2 * m };
}

/** Text boxes and rectangles on page 1 that sit entirely inside the title block column. */
export function titleBlockObjects(project: Project): PageObject[] {
  const first = project.pages[0];
  if (!first) return [];
  const r = titleBlockRect(first.size);
  return first.objects.filter((o) => o.kind !== 'block' && o.x >= r.x - 0.5 && o.y >= r.y - 0.5 && o.x + o.w <= r.x + r.w + 0.5 && o.y + o.h <= r.y + r.h + 0.5);
}

/**
 * Title block column, modelled on the designer's reference sheet: logo · project address ·
 * designer · (free area, shared from page 1) · dates · project name + revision · page title ·
 * large page number. Sizes scale with the column width; section heights with its height.
 * Returns the free area.
 */
function drawTitleBlock(out: DLItem[], project: Project, page: Page, opts: BuildOptions, r: { x: number; y: number; w: number; h: number }) {
  const info = project.info;
  const k = r.w / 132; // 132 pt = tabloid column; letter is narrower and scales down
  const inset = r.w * 0.05;
  const iw = r.w - inset * 2;
  // Proportions measured from the reference sheet: body text ≈ 7% of the column width,
  // generous ~1.4 line spacing, page number ≈ 3× body size.
  const body = 9 * k;
  const lh = body * 1.38;
  const pad = body * 0.7;
  const BLACK = '#000000';
  const sep = (yy: number) =>
    out.push({ t: 'path', d: [{ c: 'M', x: r.x + inset, y: yy }, { c: 'L', x: r.x + r.w - inset, y: yy }], fill: null, stroke: { color: '#666666', width: 0.75, dash: [] } });
  type F = 'title' | 'titleBold';
  /** Lines of text from `top`; returns the y below them. */
  const lines = (ls: { t: string; f: F; align?: 'left' | 'right' }[], top: number) => {
    let y = top;
    for (const l of ls) {
      for (const w of wrapText(l.t, l.f, body, iw)) {
        y += lh;
        const tw = measureText(w, l.f, body);
        out.push({ t: 'text', x: l.align === 'right' ? r.x + r.w - inset - tw : r.x + inset, y: y - lh * 0.27, text: w, font: l.f, size: body, color: BLACK });
      }
    }
    return y;
  };
  const wrapCount = (t: string, f: F) => (t ? wrapText(t, f, body, iw).length : 0);

  // ---- Top: logo
  let y = r.y;
  const logoH = r.h * 0.12;
  const logo = info.logoAssetId ? project.assets[info.logoAssetId] : undefined;
  if (logo && info.logoAssetId) {
    const boxW = iw;
    const boxH = logoH * 0.7;
    const sc = Math.min(boxW / logo.w, boxH / logo.h);
    const w = logo.w * sc;
    const h = logo.h * sc;
    out.push({ t: 'image', x: r.x + (r.w - w) / 2, y: y + (logoH - h) / 2, w, h, assetId: info.logoAssetId });
  }
  y += logoH;
  sep(y);

  // ---- Project address (all bold)
  const addr = info.address.split(/\r?\n/).filter((l) => l.trim());
  const addrLines = [{ t: 'PROJECT ADDRESS', f: 'titleBold' as F }, ...addr.map((t) => ({ t, f: 'titleBold' as F }))];
  const addrH = Math.max(r.h * 0.07, addrLines.reduce((a, l) => a + wrapCount(l.t, l.f), 0) * lh + pad * 2);
  lines(addrLines, y + pad * 0.6);
  y += addrH;
  sep(y);

  // ---- Designer (all bold)
  const copyright = info.copyright.trim();
  const designer = [
    info.designerName && { t: `Designed by ${info.designerName}`, f: 'titleBold' as F },
    copyright && { t: /^(copyright|©)/i.test(copyright) ? copyright : `Copyright © ${copyright}`, f: 'titleBold' as F },
    info.phone && { t: info.phone, f: 'titleBold' as F },
    info.email && { t: info.email, f: 'titleBold' as F },
  ].filter(Boolean) as { t: string; f: F }[];
  // A divider always follows the designer block, floating with however many lines it has.
  const freeTop = lines(designer, y + pad * 0.6) + pad;
  sep(freeTop);

  // ---- Bottom group, built upwards from the bottom edge.
  const numH = r.h * 0.055;
  const titleText = `(${opts.pageIndex}) ${page.name}`;
  // Room for two title lines on every page so the separators line up from page to page.
  const titleH = Math.max(2, wrapCount(titleText, 'titleBold')) * lh + pad * 1.4;
  const projLines = wrapCount(info.name, 'title') + (info.revision ? 1 : 0);
  const projH = Math.max(r.h * 0.07, projLines * lh + pad * 2);
  const datesH = Math.max(r.h * 0.07, 2 * lh + pad * 2);
  const numTop = r.y + r.h - numH;
  const titleTop = numTop - titleH;
  const projTop = titleTop - projH;
  const datesTop = projTop - datesH;
  sep(datesTop);
  sep(projTop);
  sep(titleTop);
  sep(numTop);

  // Dates: labels left, values in a second column.
  const fmtDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  };
  [
    ['Created:', fmtDate(info.created)],
    ['Modified:', fmtDate(info.modified)],
  ].forEach(([kx, v], i) => {
    const by = datesTop + pad * 0.6 + (i + 1) * lh - lh * 0.27;
    out.push({ t: 'text', x: r.x + inset, y: by, text: kx, font: 'title', size: body, color: BLACK });
    out.push({ t: 'text', x: r.x + r.w * 0.5, y: by, text: v, font: 'title', size: body, color: BLACK });
  });

  // Project name + revision (right aligned).
  lines([...(info.name ? [{ t: info.name, f: 'title' as F }] : []), ...(info.revision ? [{ t: `Rev. ${info.revision}`, f: 'title' as F, align: 'right' as const }] : [])], projTop + pad * 0.6);

  // Page title.
  lines([{ t: titleText, f: 'titleBold' }], titleTop + pad * 0.4);

  // Page number: "11" in black, "/19" in light grey.
  const ns = 27 * k;
  const a = String(opts.pageIndex);
  const bTxt = `/${opts.pageCount}`;
  const aw = measureText(a, 'titleBold', ns);
  const bw = measureText(bTxt, 'titleBold', ns);
  const nx = r.x + (r.w - aw - bw) / 2;
  const ny = numTop + (numH + ns * capHeightEm('titleBold')) / 2;
  out.push({ t: 'text', x: nx, y: ny, text: a, font: 'titleBold', size: ns, color: BLACK });
  out.push({ t: 'text', x: nx + aw, y: ny, text: bTxt, font: 'titleBold', size: ns, color: '#c4c4c4' });

  return { x: r.x, y: freeTop, w: r.w, h: datesTop - freeTop };
}

/**
 * labelT that puts a line's label centre at x = value (axis 'x', on a horizontal run) or
 * y = value (axis 'y', on a vertical run). Picks the matching run nearest to `near`. null if none.
 */
export function labelTAt(route: ResolvedRoute, axis: 'x' | 'y', value: number, near: Pt): number | null {
  const pts = route.pts;
  const L = pathLength(pts);
  if (L <= 0) return null;
  let best: { t: number; dist: number } | null = null;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const horiz = Math.abs(a.y - b.y) < 1e-6;
    if (len > 0 && horiz === (axis === 'x')) {
      const lo = Math.min(axis === 'x' ? a.x : a.y, axis === 'x' ? b.x : b.y);
      const hi = Math.max(axis === 'x' ? a.x : a.y, axis === 'x' ? b.x : b.y);
      if (value >= lo && value <= hi) {
        const p = axis === 'x' ? { x: value, y: a.y } : { x: a.x, y: value };
        const dist = Math.hypot(p.x - near.x, p.y - near.y);
        const t = (acc + Math.abs((axis === 'x' ? p.x - a.x : p.y - a.y))) / L;
        if (!best || dist < best.dist) best = { t, dist };
      }
    }
    acc += len;
  }
  return best ? Math.min(0.99, Math.max(0.01, best.t)) : null;
}
