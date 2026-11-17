import type {
  Asset,
  BlockObj,
  BoxObj,
  CalloutObj,
  ContainerObj,
  EllipseObj,
  ImageObj,
  LineObj,
  Page,
  PageObject,
  Project,
  RectObj,
  StrokeStyle,
  TagObj,
  TextObj,
  TextProps,
  TextualObj,
} from '../model/types';
import { dashArray, PAGE_MARGIN, PAGE_SIZES, titleBlockWidth } from '../model/defaults';
import { BLK, blockFor, blockLayout, portText } from '../model/blockGeometry';
import {
  CURVE_SAMPLES,
  LABEL_SIZE,
  labelGapWidth,
  pathLength,
  pointAt,
  projectOnPath,
  resolvePageRoutes,
  subCurve,
  type Bezier,
  type Pt,
  type ResolvedRoute,
} from '../model/routing';
import { fromLocal, localBox, objBounds, rotatePt, rotMatrix, rotOf } from '../model/geom';
import { pageOfObject, tagFontSize, tagText, TAG_PAD_Y } from '../model/tags';
import { capHeightEm, fitText, measureText, wrapText } from '../text/fonts';
import { parsePathData, type DLItem, type DLStroke, type PathCmd } from './displayList';

export { LABEL_SIZE };

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
  if (o.kind === 'block') return drawBlock(out, project, o);
  if (o.kind === 'tag') return drawTag(out, project, o);
  const rot = rotOf(o);
  const dst: DLItem[] = rot ? [] : out;
  switch (o.kind) {
    case 'rect':
      drawRect(dst, o);
      break;
    case 'text':
      drawText(dst, o);
      break;
    case 'ellipse':
      drawEllipse(dst, o);
      break;
    case 'container':
      drawContainer(dst, o);
      break;
    case 'callout':
      drawCallout(dst, project, o);
      break;
    case 'image':
      drawImage(dst, project, o);
      break;
    case 'line':
      drawLine(dst, o);
      break;
  }
  if (rot) out.push({ t: 'group', m: rotMatrix(localBox(project, o), rot), items: dst });
}

const strokeOf = (b: StrokeStyle | null) => (b && b.width > 0 ? toDLStroke(b) : null);

function drawRect(out: DLItem[], o: RectObj) {
  out.push({ t: 'rect', x: o.x, y: o.y, w: o.w, h: o.h, fill: o.fill, stroke: strokeOf(o.border) });
  drawTextIn(out, textBoxOf(o));
}

const K_ELL = 0.5523;

export function ellipsePath(x: number, y: number, w: number, h: number): PathCmd[] {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  const kx = rx * K_ELL;
  const ky = ry * K_ELL;
  return [
    { c: 'M', x: cx + rx, y: cy },
    { c: 'C', x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
    { c: 'C', x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
    { c: 'C', x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
    { c: 'C', x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
    { c: 'Z' },
  ];
}

function drawEllipse(out: DLItem[], o: EllipseObj) {
  out.push({ t: 'path', d: ellipsePath(o.x, o.y, o.w, o.h), fill: o.fill, stroke: strokeOf(o.border) });
  drawTextIn(out, textBoxOf(o));
}

/** Height of a container's label band. */
export function containerBand(o: ContainerObj) {
  return o.text ? Math.min(o.h, o.fontSize * LINE + TEXT_PAD * 2) : 0;
}

function drawContainer(out: DLItem[], o: ContainerObj) {
  out.push({ t: 'rect', x: o.x, y: o.y, w: o.w, h: o.h, fill: o.fill, stroke: null });
  const band = containerBand(o);
  if (band) {
    if (o.headerFill) out.push({ t: 'rect', x: o.x, y: o.y, w: o.w, h: band, fill: o.headerFill, stroke: null });
    if (o.border.width > 0)
      out.push({ t: 'path', d: [{ c: 'M', x: o.x, y: o.y + band }, { c: 'L', x: o.x + o.w, y: o.y + band }], fill: null, stroke: { ...toDLStroke(o.border), width: Math.min(o.border.width, 0.75) } });
    drawTextIn(out, textBoxOf(o));
  }
  out.push({ t: 'rect', x: o.x, y: o.y, w: o.w, h: o.h, fill: null, stroke: strokeOf(o.border) });
}

/** Page position of a callout's pointer tip: glued to an object on its page, or its own offset. */
export function calloutTip(project: Project, o: CalloutObj): Pt {
  const to = o.tailTo;
  const page = to && pageOfObject(project, o.id);
  if (to && page) {
    if ('connId' in to) {
      // Glued to a line: the same fraction of its length, wherever it's routed.
      const r = resolvePageRoutes(project, page).get(to.connId);
      if (r) return pointAt(r.pts, to.t * pathLength(r.pts)).p;
    } else {
      const t = page.objects.find((x) => x.id === to.objId);
      if (t) {
        const b = localBox(project, t);
        return fromLocal(project, t, { x: b.x + to.fx * b.w, y: b.y + to.fy * b.h });
      }
    }
  }
  return { x: o.x + o.tail.x, y: o.y + o.tail.y };
}

/** Outline of a callout: its box with a wedge towards the tip (given in the box's unrotated frame). */
export function calloutPath(o: CalloutObj, tip: Pt): PathCmd[] {
  const { x, y, w, h } = o;
  const tx = tip.x;
  const ty = tip.y;
  const cs: Pt[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  const inside = tx >= x && tx <= x + w && ty >= y && ty <= y + h;
  const pts: Pt[] = [];
  // Which side does the tail leave from? Compare against the box diagonals.
  const nx = (tx - (x + w / 2)) / (w / 2 || 1);
  const ny = (ty - (y + h / 2)) / (h / 2 || 1);
  const side = inside ? -1 : Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 1 : 3) : ny > 0 ? 2 : 0; // 0 top, 1 right, 2 bottom, 3 left
  for (let i = 0; i < 4; i++) {
    pts.push(cs[i]);
    if (i !== side) continue;
    const a = cs[i];
    const b = cs[(i + 1) % 4];
    const horiz = i % 2 === 0;
    const len = horiz ? w : h;
    const half = Math.max(2, Math.min(len * 0.15, 9));
    // Wedge base centred on the tail's projection, kept inside the side.
    const along = horiz ? tx : ty;
    const lo = Math.min(horiz ? a.x : a.y, horiz ? b.x : b.y) + half + 2;
    const hi = Math.max(horiz ? a.x : a.y, horiz ? b.x : b.y) - half - 2;
    const c = lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, along));
    const dir = Math.sign((horiz ? b.x - a.x : b.y - a.y) || 1);
    const p1 = horiz ? { x: c - dir * half, y: a.y } : { x: a.x, y: c - dir * half };
    const p2 = horiz ? { x: c + dir * half, y: a.y } : { x: a.x, y: c + dir * half };
    pts.push(p1, { x: tx, y: ty }, p2);
  }
  return [...pts.map((p, i): PathCmd => ({ c: i ? 'L' : 'M', x: p.x, y: p.y })), { c: 'Z' }];
}

function drawCallout(out: DLItem[], project: Project, o: CalloutObj) {
  // The tip is fixed on the page; the outline is drawn in the (possibly rotated) box frame.
  const tip = rotatePt(calloutTip(project, o), { x: o.x + o.w / 2, y: o.y + o.h / 2 }, -rotOf(o));
  if (o.shape === 'cloud') {
    out.push({ t: 'path', d: cloudPath(o), fill: o.fill, stroke: strokeOf(o.border) });
    for (const b of thoughtBubbles(o, tip)) out.push({ t: 'path', d: ellipsePath(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2), fill: o.fill, stroke: strokeOf(o.border) });
  } else out.push({ t: 'path', d: calloutPath(o, tip), fill: o.fill, stroke: strokeOf(o.border) });
  drawTextIn(out, textBoxOf(o));
}

/** The ellipse the cloud's scallops sit on, and the scallop size. */
function cloudBase(o: { x: number; y: number; w: number; h: number }) {
  const per = Math.PI * (o.w + o.h) / 2;
  const n = Math.max(8, Math.min(22, Math.round(per / (Math.min(o.w, o.h) * 0.3 + 14))));
  const chord = per / n;
  // Scallops stick out about 0.4 × chord beyond the base ellipse; keep them inside the box.
  const ext = chord * 0.4;
  return { cx: o.x + o.w / 2, cy: o.y + o.h / 2, rx: Math.max(4, o.w / 2 - ext), ry: Math.max(4, o.h / 2 - ext), n, chord };
}

/** Thought-bubble outline: scallops around an ellipse. */
export function cloudPath(o: { x: number; y: number; w: number; h: number }): PathCmd[] {
  const { cx, cy, rx, ry, n, chord } = cloudBase(o);
  // Start angle offset so the scallops look hand-placed rather than symmetric.
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // Outward normal of the ellipse at that point.
    const nx = ux / rx;
    const ny = uy / ry;
    const nl = Math.hypot(nx, ny) || 1;
    return { x: cx + rx * ux, y: cy + ry * uy, nx: nx / nl, ny: ny / nl };
  });
  const k = chord * 0.55;
  const d: PathCmd[] = [{ c: 'M', x: pts[0].x, y: pts[0].y }];
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % n];
    d.push({ c: 'C', x1: p.x + p.nx * k, y1: p.y + p.ny * k, x2: q.x + q.nx * k, y2: q.y + q.ny * k, x: q.x, y: q.y });
  });
  d.push({ c: 'Z' });
  return d;
}

/** Trailing bubbles from the cloud towards the tip (none if the tip is inside the cloud). */
export function thoughtBubbles(o: { x: number; y: number; w: number; h: number }, tip: Pt) {
  const { cx, cy } = cloudBase(o);
  const dx = tip.x - cx;
  const dy = tip.y - cy;
  // Where the ray to the tip leaves the box ellipse.
  const f = 1 / Math.hypot(dx / (o.w / 2), dy / (o.h / 2) || 0);
  if (!isFinite(f) || f >= 1) return [];
  const ex = cx + dx * f;
  const ey = cy + dy * f;
  const big = Math.max(2, Math.min(o.w, o.h) * 0.09);
  const radii = [big, big * 0.65, big * 0.38];
  const gap = Math.hypot(tip.x - ex, tip.y - ey);
  // Spread the bubbles from just outside the cloud to the tip (the smallest touches the tip).
  return radii.map((r, i) => {
    const t = (i === 2 ? (gap - r) / gap : [0.18, 0.55][i] + r / gap) || 0;
    const tt = Math.min(1, Math.max(0, t));
    return { x: ex + (tip.x - ex) * tt, y: ey + (tip.y - ey) * tt, r };
  });
}

/** Arrowhead triangle at `tip`, pointing along (ux, uy). */
function arrowHead(tip: Pt, ux: number, uy: number, width: number) {
  const len = Math.max(5, width * 4 + 3);
  const half = len * 0.4;
  const bx = tip.x - ux * len;
  const by = tip.y - uy * len;
  const d: PathCmd[] = [
    { c: 'M', x: tip.x, y: tip.y },
    { c: 'L', x: bx - uy * half, y: by + ux * half },
    { c: 'L', x: bx + uy * half, y: by - ux * half },
    { c: 'Z' },
  ];
  return { d, len };
}

function drawLine(out: DLItem[], o: LineObj) {
  // Drawn in the unrotated frame (horizontal); the rotation group turns it.
  const y = o.y + o.h / 2;
  let x0 = o.x;
  let x1 = o.x + o.w;
  const st = strokeOf(o.border);
  if (!st) return;
  const heads: PathCmd[][] = [];
  if (o.arrows === 'end' || o.arrows === 'both') {
    const h = arrowHead({ x: x1, y }, 1, 0, st.width);
    heads.push(h.d);
    x1 -= h.len * 0.8;
  }
  if (o.arrows === 'start' || o.arrows === 'both') {
    const h = arrowHead({ x: x0, y }, -1, 0, st.width);
    heads.push(h.d);
    x0 += h.len * 0.8;
  }
  out.push({ t: 'path', d: [{ c: 'M', x: x0, y }, { c: 'L', x: x1, y }], fill: null, stroke: st });
  for (const d of heads) out.push({ t: 'path', d, fill: st.color, stroke: null });
}

const vectorCache = new WeakMap<Asset, DLItem[]>();

function vectorItems(a: Asset): DLItem[] {
  let v = vectorCache.get(a);
  if (!v) {
    v = (a.vector ?? []).map(
      (p): DLItem => ({
        t: 'path',
        d: parsePathData(p.d),
        fill: p.fill,
        stroke: p.stroke && p.width > 0 ? { color: p.stroke, width: p.width, dash: [] } : null,
        evenOdd: p.evenOdd,
      }),
    );
    vectorCache.set(a, v);
  }
  return v;
}

function drawImage(out: DLItem[], project: Project, o: ImageObj) {
  const a = project.assets[o.assetId];
  if (!a) out.push({ t: 'rect', x: o.x, y: o.y, w: o.w, h: o.h, fill: '#ffdddd', stroke: THIN });
  else if (a.vector) out.push({ t: 'group', m: [o.w / a.w, 0, 0, o.h / a.h, o.x, o.y], items: vectorItems(a) });
  else out.push({ t: 'image', x: o.x, y: o.y, w: o.w, h: o.h, assetId: o.assetId });
  if (o.border && o.border.width > 0) out.push({ t: 'rect', x: o.x, y: o.y, w: o.w, h: o.h, fill: null, stroke: toDLStroke(o.border) });
}

function drawTag(out: DLItem[], project: Project, o: TagObj) {
  const b = localBox(project, o);
  out.push({ t: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, fill: o.fill, stroke: strokeOf(o.border) });
  const t = tagText(project, o);
  const fs = tagFontSize(o);
  const tw = measureText(t, 'narrow', fs);
  const base = b.y + b.h / 2 + (fs * capHeightEm('narrow')) / 2;
  out.push({ t: 'text', x: b.x + (b.w - tw) / 2, y: base, text: t, font: 'narrow', size: fs, color: '#000000' });
  void TAG_PAD_Y;
}

export const TEXT_PAD = 3;

export type TextBox = TextProps & { x: number; y: number; w: number; h: number };

/** The area text is laid out in: the box; the inscribed rectangle of an ellipse; a container's label band. */
export function textBoxOf(o: TextualObj): TextBox {
  if (o.kind === 'ellipse') {
    const k = 1 / Math.SQRT2;
    const w = o.w * k;
    const h = o.h * k;
    return { ...o, x: o.x + (o.w - w) / 2, y: o.y + (o.h - h) / 2, w, h };
  }
  if (o.kind === 'container') return { ...o, h: containerBand(o) || o.h, valign: 'middle', wrap: false };
  if (o.kind === 'callout' && o.shape === 'cloud') {
    const w = o.w * 0.66;
    const h = o.h * 0.6;
    return { ...o, x: o.x + (o.w - w) / 2, y: o.y + (o.h - h) / 2, w, h };
  }
  return o;
}

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
const fitCache = new Map<string, Fit>();

/**
 * Text layout for a box. The padding collapses first; the font size only shrinks (never grows)
 * once the text would physically overlap the box edge — the same way a block scales.
 */
export function fitTextBox(o: TextBox): Fit {
  const key = `${o.text}|${o.w}|${o.h}|${o.fontSize}|${o.bold}|${o.wrap}`;
  const hit = fitCache.get(key);
  if (hit) return hit;
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
  if (fitCache.size > 3000) fitCache.clear();
  fitCache.set(key, res);
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
    out.push({ t: 'rect', x: o.x, y: o.y, w: o.w, h: o.h, fill: o.fill, stroke: strokeOf(o.border) });
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

export const HOP_R = 2.5;

/** Distance along the path of the automatic label position: middle of the longest horizontal run. */
export function autoLabelDistance(pts: Pt[], curve?: Pt[]): number {
  let best = -1;
  let bestD = pathLength(pts) / 2;
  let bestP: Pt | null = null;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const horiz = Math.abs(pts[i].y - pts[i - 1].y) < 1e-6;
    if (horiz && len > best + 1e-6) {
      best = len;
      bestD = acc + len / 2;
      bestP = { x: (pts[i].x + pts[i - 1].x) / 2, y: pts[i].y };
    }
    acc += len;
  }
  // Curved line: the middle of that run lies on the curve too.
  if (curve) return bestP ? projectOnPath(curve, bestP) : pathLength(curve) / 2;
  return bestD;
}

export interface LabelBox {
  p: Pt;
  /** Distance along route.pts (not meaningful for snake legs). */
  d: number;
  gap: number;
  tw: number;
  /** Text reads horizontally (otherwise rotated, on a vertical run). */
  horiz: boolean;
  box: { x: number; y: number; w: number; h: number };
}

/**
 * Label placements of a line: one for normal and curved lines, one per leg for a line in a snake
 * (its full label is repeated at each end). Text follows right-angle segments; on curves it stays horizontal.
 */
export function labelBoxes(route: ResolvedRoute): LabelBox[] {
  const label = route.conn.label;
  if (!label) return [];
  const tw = measureText(label, 'narrow', LABEL_SIZE);
  if (route.legs) {
    return route.legs.map(([a, b]) => {
      const p = { x: (a.x + b.x) / 2, y: a.y };
      return { p, d: 0, gap: tw + 4, tw, horiz: true, box: { x: p.x - (tw + 4) / 2, y: p.y - 5, w: tw + 4, h: 10 } };
    });
  }
  const L = pathLength(route.pts);
  if (route.conn.labelEnds) {
    // One label near each end (for tracing long lines), a little way out from the anchor, unless moved.
    const off = Math.min(L / 4, 6 + (tw + 4) / 2);
    const [t0, t1] = route.conn.labelEndsT ?? [null, null];
    return [labelAt(route, tw, t0 === null ? off : t0 * L), labelAt(route, tw, t1 === null ? L - off : t1 * L)];
  }
  const d = route.conn.labelT === null ? autoLabelDistance(route.ortho ?? route.pts, route.ortho ? route.pts : undefined) : route.conn.labelT * L;
  return [labelAt(route, tw, d)];
}

function labelAt(route: ResolvedRoute, tw: number, d: number): LabelBox {
  const { p, seg } = pointAt(route.pts, d);
  const a = route.pts[seg];
  const b = route.pts[seg + 1] ?? a;
  if (route.curve) {
    // Leave a gap where the line passes through the (horizontal) text's box.
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = Math.abs(b.x - a.x) / len;
    const uy = Math.abs(b.y - a.y) / len;
    const half = Math.min(ux > 1e-6 ? (tw / 2 + 2) / ux : Infinity, uy > 1e-6 ? 5 / uy : Infinity);
    return { p, d, gap: half * 2, tw, horiz: true, box: { x: p.x - tw / 2 - 2, y: p.y - 5, w: tw + 4, h: 10 } };
  }
  const horiz = Math.abs(a.y - b.y) < 1e-6;
  const gap = tw + 4;
  const box = horiz ? { x: p.x - gap / 2, y: p.y - 5, w: gap, h: 10 } : { x: p.x - 5, y: p.y - gap / 2, w: 10, h: gap };
  return { p, d, gap, tw, horiz, box };
}

/** A connection with label `idx` (0, or 0/1 for labels at both ends) moved to position t. */
export function withLabelT<C extends { labelT: number | null; labelEnds?: boolean; labelEndsT?: [number | null, number | null] }>(c: C, idx: number, t: number | null): C {
  if (!c.labelEnds) return { ...c, labelT: t };
  const ends: [number | null, number | null] = [...(c.labelEndsT ?? [null, null])] as [number | null, number | null];
  ends[idx] = t;
  return { ...c, labelEndsT: ends };
}

export function labelBox(route: ResolvedRoute): LabelBox | null {
  return labelBoxes(route)[0] ?? null;
}

/** Polylines actually drawn for a route, for hop detection. */
function drawnPolylines(r: ResolvedRoute): Pt[][] {
  if (r.legs) return [];
  if (r.trunk) return r.curve ? r.trunk.bars : [r.pts, ...r.trunk.bars];
  if (r.curve) return [];
  return [r.pts];
}

function labelText(out: DLItem[], lb: LabelBox, text: string, color: string) {
  const capH = LABEL_SIZE * capHeightEm('narrow');
  out.push(
    lb.horiz
      ? { t: 'text', x: lb.p.x - lb.tw / 2, y: lb.p.y + capH / 2, text, font: 'narrow', size: LABEL_SIZE, color }
      : { t: 'text', x: lb.p.x + capH / 2, y: lb.p.y + lb.tw / 2, text, font: 'narrow', size: LABEL_SIZE, color, rot: -90 },
  );
}

export function drawConnections(out: DLItem[], project: Project, page: Page, onlyIds?: Set<string>) {
  const routes: ResolvedRoute[] = [...resolvePageRoutes(project, page).values()];
  // Vertical segments of every line, for hop detection.
  const verticals: { x: number; y0: number; y1: number; ri: number }[] = [];
  routes.forEach((r, ri) => {
    for (const pts of drawnPolylines(r))
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) > 1e-6) verticals.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), ri });
      }
  });

  routes.forEach((r, ri) => {
    if (onlyIds && !onlyIds.has(r.conn.id)) return;
    const style = toDLStroke(r.conn.style);
    const lbs = labelBoxes(r);
    if (r.legs) {
      // Snake member: only its two legs are drawn, each with the full label.
      r.legs.forEach((leg, k) => {
        const lb = lbs[k];
        const L = Math.abs(leg[1].x - leg[0].x);
        const gaps: [number, number][] = lb ? [[L / 2 - lb.gap / 2, L / 2 + lb.gap / 2]] : [];
        out.push({ t: 'path', d: strokePath(leg, gaps, new Map()), fill: null, stroke: style });
        if (lb) labelText(out, lb, r.conn.label, r.conn.style.color);
      });
      return;
    }
    const gaps = lbs.map((lb): [number, number] => [lb.d - lb.gap / 2, lb.d + lb.gap / 2]);
    const texts = () => lbs.forEach((lb) => labelText(out, lb, r.conn.label, r.conn.style.color));
    if (r.curve) {
      out.push({ t: 'path', d: curvePath(r.curve, r.pts, gaps), fill: null, stroke: style });
      if (r.trunk) for (const bar of r.trunk.bars) if (Math.abs(bar[1].y - bar[0].y) > 1e-6) out.push({ t: 'path', d: strokePath(bar, [], new Map()), fill: null, stroke: style });
      texts();
      return;
    }
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
    out.push({ t: 'path', d: strokePath(r.pts, gaps, hops), fill: null, stroke: style });
    if (r.trunk) for (const bar of r.trunk.bars) if (Math.abs(bar[1].y - bar[0].y) > 1e-6) out.push({ t: 'path', d: strokePath(bar, [], new Map()), fill: null, stroke: style });
    texts();
  });
}

/** Curve pieces drawn as true Béziers, minus gaps given as distances along the samples. */
function curvePath(cs: Bezier[], samples: Pt[], gaps: [number, number][]): PathCmd[] {
  const out: PathCmd[] = [];
  const L = pathLength(samples);
  // Drawn intervals = [0, L] minus the gaps.
  const iv: [number, number][] = [];
  let from = 0;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (g0 > from) iv.push([from, g0]);
    from = Math.max(from, g1);
  }
  if (from < L) iv.push([from, L]);
  for (const [d0, d1] of iv) {
    const a = curveParamAt(samples, d0);
    const z = curveParamAt(samples, d1);
    let first = true;
    for (let i = a.piece; i <= z.piece; i++) {
      const t0 = i === a.piece ? a.t : 0;
      const t1 = i === z.piece ? z.t : 1;
      if (t1 - t0 < 1e-4) continue;
      const b = t0 === 0 && t1 === 1 ? cs[i] : subCurve(cs[i], t0, t1);
      if (first) out.push({ c: 'M', x: b[0].x, y: b[0].y });
      first = false;
      out.push({ c: 'C', x1: b[1].x, y1: b[1].y, x2: b[2].x, y2: b[2].y, x: b[3].x, y: b[3].y });
    }
  }
  return out;
}

/** Piece index and parameter at a distance along a curve's samples (see sampleCurves). */
export function curveParamAt(samples: Pt[], d: number): { piece: number; t: number } {
  const N = CURVE_SAMPLES;
  if (d <= 0) return { piece: 0, t: 0 };
  let acc = 0;
  for (let k = 1; k < samples.length; k++) {
    const len = Math.hypot(samples[k].x - samples[k - 1].x, samples[k].y - samples[k - 1].y);
    if (acc + len >= d) {
      const p = Math.ceil(k / N) - 1;
      const t0 = (k - 1 - p * N) / N;
      const f = len ? (d - acc) / len : 0;
      return { piece: p, t: t0 + f / N };
    }
    acc += len;
  }
  return { piece: Math.max(0, Math.ceil((samples.length - 1) / N) - 1), t: 1 };
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
void labelGapWidth;

/** Build path commands for an orthogonal polyline minus gaps (distance intervals), with hops. */
export function strokePath(pts: Pt[], gaps: [number, number][], hops: Map<number, number[]>): PathCmd[] {
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
    for (const gap of gaps) {
      const g0 = gap[0] - acc;
      const g1 = gap[1] - acc;
      if (g1 <= 0 || g0 >= len) continue;
      intervals = intervals.flatMap(([p, q]): [number, number][] => {
        if (g1 <= p || g0 >= q) return [[p, q]];
        const r: [number, number][] = [];
        if (g0 > p) r.push([p, g0]);
        if (g1 < q) r.push([g1, q]);
        return r;
      });
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
    for (const o of titleBlockObjects(project)) drawObject(out, project, scaleBoxObj(o, r1, r, k));
  }
}

/** Rectangle of the title block column on a page. */
export function titleBlockRect(size: Page['size']) {
  const P = PAGE_SIZES[size];
  const m = PAGE_MARGIN;
  const w = titleBlockWidth(size);
  return { x: P.w - m - w, y: m, w, h: P.h - 2 * m };
}

/** Shapes, text and images on page 1 that sit entirely inside the title block column. */
export function titleBlockObjects(project: Project): BoxObj[] {
  const first = project.pages[0];
  if (!first) return [];
  const r = titleBlockRect(first.size);
  return first.objects.filter((o): o is BoxObj => {
    if (o.kind === 'block' || o.kind === 'tag') return false;
    const b = objBounds(project, o);
    return b.x >= r.x - 0.5 && b.y >= r.y - 0.5 && b.x + b.w <= r.x + r.w + 0.5 && b.y + b.h <= r.y + r.h + 0.5;
  });
}

/** Copy of a box object moved from one title block column to another (scaled by k). */
function scaleBoxObj(o: BoxObj, from: { x: number; y: number }, to: { x: number; y: number }, k: number): BoxObj {
  const moved = { ...o, x: to.x + (o.x - from.x) * k, y: to.y + (o.y - from.y) * k, w: o.w * k, h: o.h * k } as BoxObj;
  if ('fontSize' in moved) moved.fontSize *= k;
  if (moved.kind === 'callout') {
    moved.tail = { x: moved.tail.x * k, y: moved.tail.y * k };
    delete moved.tailTo;
  }
  return moved;
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
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const horiz = Math.abs(a.y - b.y) < 1e-6;
    // Right-angle lines: runs along the axis only. Curves: wherever the curve crosses the value.
    const along = route.curve ? Math.abs(axis === 'x' ? b.x - a.x : b.y - a.y) > 1e-6 : horiz === (axis === 'x');
    if (len > 0 && along) {
      const lo = Math.min(axis === 'x' ? a.x : a.y, axis === 'x' ? b.x : b.y);
      const hi = Math.max(axis === 'x' ? a.x : a.y, axis === 'x' ? b.x : b.y);
      if (value >= lo && value <= hi) {
        const f = (value - (axis === 'x' ? a.x : a.y)) / ((axis === 'x' ? b.x - a.x : b.y - a.y) || 1);
        const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        const dist = Math.hypot(p.x - near.x, p.y - near.y);
        const t = (acc + len * f) / L;
        if (!best || dist < best.dist) best = { t, dist };
      }
    }
    acc += len;
  }
  return best ? Math.min(0.99, Math.max(0.01, best.t)) : null;
}
