// SVG import: the drawing is converted to plain vector paths (absolute M/L/C/Z, page-ready
// colours) so the same display list draws it on screen and into the PDF. Geometry and styles
// are read through the browser (computed styles, transforms), so CSS classes work too.
// Not supported: text (convert to outlines first), <use>, images, clipping/masks, gradients
// (drawn in their first stop colour) and partial transparency.

import type { VectorPath } from '../model/types';

type M = DOMMatrix;

export interface SvgResult {
  w: number;
  h: number;
  paths: VectorPath[];
  warnings: string[];
}

const SKIP_PARENTS = 'defs, clipPath, mask, symbol, marker, pattern, linearGradient, radialGradient, filter, metadata, title, desc';

/** Length attribute (with units) in points. */
function toPt(v: string | null): number | null {
  if (!v) return null;
  const m = v.trim().match(/^([\d.eE+-]+)\s*(px|pt|mm|cm|in|pc)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2] ?? 'px';
  const k = { px: 0.75, pt: 1, mm: 72 / 25.4, cm: 72 / 2.54, in: 72, pc: 12 }[u] ?? 0.75;
  return n * k;
}

export function svgToVector(text: string): SvgResult {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const src = doc.documentElement;
  if (src.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('Not a valid SVG file.');
  const svg = document.importNode(src, true) as unknown as SVGSVGElement;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:10px;height:10px;overflow:hidden;opacity:0;pointer-events:none';
  document.body.appendChild(host);
  host.appendChild(svg);
  try {
    const vb = svg.viewBox?.baseVal;
    const attrW = toPt(svg.getAttribute('width'));
    const attrH = toPt(svg.getAttribute('height'));
    const vbW = vb && vb.width ? vb.width : attrW ? attrW / 0.75 : 300;
    const vbH = vb && vb.height ? vb.height : attrH ? attrH / 0.75 : 150;
    const w = attrW ?? vbW * 0.75;
    const h = attrH ?? vbH * 0.75;
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${vbW} ${vbH}`);
    svg.setAttribute('width', String(vbW));
    svg.setAttribute('height', String(vbH));
    svg.setAttribute('preserveAspectRatio', 'none');
    const rootInv = svg.getScreenCTM()?.inverse();
    if (!rootInv) throw new Error('Could not lay out the SVG.');
    const vx = vb && vb.width ? vb.x : 0;
    const vy = vb && vb.height ? vb.y : 0;
    // viewBox user space → our w×h box.
    const toBox = new DOMMatrix().scale(w / vbW, h / vbH).translate(-vx, -vy);
    const paths: VectorPath[] = [];
    let skippedText = 0;
    let skippedOther = 0;
    for (const el of Array.from(svg.querySelectorAll('*'))) {
      if (el.closest(SKIP_PARENTS)) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === 'text' || tag === 'tspan' || tag === 'textpath') {
        if (tag === 'text') skippedText++;
        continue;
      }
      if (tag === 'use' || tag === 'image' || tag === 'foreignobject') {
        skippedOther++;
        continue;
      }
      const d = geometry(el);
      if (!d) continue;
      const g = el as SVGGraphicsElement;
      const cs = getComputedStyle(g);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const ctm = g.getScreenCTM();
      if (!ctm) continue;
      const m = toBox.multiply(rootInv.multiply(ctm));
      const opacity = parseFloat(cs.opacity || '1');
      const fill = paint(cs.fill, parseFloat(cs.fillOpacity || '1') * opacity, svg);
      const stroke = paint(cs.stroke, parseFloat(cs.strokeOpacity || '1') * opacity, svg);
      const sw = parseFloat(cs.strokeWidth || '1') * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
      if (!fill && !stroke) continue;
      const cmds = transformPath(normalizePath(d), m);
      if (!cmds) continue;
      paths.push({ d: cmds, fill, stroke, width: stroke ? Math.round(sw * 1000) / 1000 : 0, evenOdd: cs.fillRule === 'evenodd' || undefined });
    }
    const warnings: string[] = [];
    if (skippedText) warnings.push(`${skippedText} text element(s) skipped — convert text to outlines/paths before exporting the SVG.`);
    if (skippedOther) warnings.push(`${skippedOther} <use>/<image> element(s) skipped.`);
    if (!paths.length) throw new Error('No drawable shapes found in the SVG.');
    return { w, h, paths, warnings };
  } finally {
    host.remove();
  }
}

/** A shape element's outline as SVG path data (any commands). */
function geometry(el: Element): string | null {
  const n = (a: string) => parseFloat(el.getAttribute(a) || '0') || 0;
  switch (el.tagName.toLowerCase()) {
    case 'path':
      return el.getAttribute('d');
    case 'rect': {
      const x = n('x');
      const y = n('y');
      const w = n('width');
      const h = n('height');
      if (w <= 0 || h <= 0) return null;
      let rx = el.hasAttribute('rx') ? n('rx') : n('ry');
      let ry = el.hasAttribute('ry') ? n('ry') : rx;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = n('cx');
      const cy = n('cy');
      const rx = el.tagName.toLowerCase() === 'circle' ? n('r') : n('rx');
      const ry = el.tagName.toLowerCase() === 'circle' ? n('r') : n('ry');
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'line':
      return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
    case 'polyline':
    case 'polygon': {
      const pts = (el.getAttribute('points') || '').trim();
      if (!pts) return null;
      return 'M' + pts + (el.tagName.toLowerCase() === 'polygon' ? 'Z' : '');
    }
  }
  return null;
}

/** Colour (#rrggbb) of a computed paint, or null for none / (nearly) transparent. */
function paint(v: string, alpha: number, svg: SVGSVGElement): string | null {
  if (!v || v === 'none' || alpha < 0.05) return null;
  const url = v.match(/url\(["']?#([^"')]+)["']?\)/);
  if (url) {
    const stop = svg.querySelector(`#${CSS.escape(url[1])} stop`);
    const c = stop ? getComputedStyle(stop).stopColor : '';
    return c ? rgbToHex(c) : '#888888';
  }
  return rgbToHex(v);
}

function rgbToHex(c: string): string | null {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return c.startsWith('#') ? c : null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (p.length > 3 && p[3] < 0.05) return null;
  return '#' + p.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------------------------
// Path data → absolute M/L/C/Z

type Cmd = { c: 'M' | 'L'; x: number; y: number } | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { c: 'Z' };

/** Commands as { cmd }, numbers kept as their source text (arc flags can be packed: "0110"). */
function tokenize(d: string): (string | { cmd: string })[] {
  const out: (string | { cmd: string })[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) out.push(m[1] ? { cmd: m[1] } : m[2]);
  return out;
}

export function normalizePath(d: string): Cmd[] {
  const t = tokenize(d);
  const out: Cmd[] = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC: { x: number; y: number } | null = null; // last cubic control (for S)
  let lastQ: { x: number; y: number } | null = null; // last quad control (for T)
  const num = () => {
    const v = t[i++];
    if (typeof v !== 'string') throw new Error('bad path');
    return parseFloat(v);
  };
  // Arc flags may be written without separators ("a1 1 0 0110 10"): take one digit at a time.
  const flag = () => {
    const v = t[i];
    if (typeof v !== 'string') throw new Error('bad path');
    if (v.length > 1 && (v[0] === '0' || v[0] === '1')) {
      t[i] = v.slice(1);
      return Number(v[0]);
    }
    i++;
    return parseFloat(v) ? 1 : 0;
  };
  const quad = (qx: number, qy: number, ex: number, ey: number) => {
    out.push({ c: 'C', x1: x + (2 / 3) * (qx - x), y1: y + (2 / 3) * (qy - y), x2: ex + (2 / 3) * (qx - ex), y2: ey + (2 / 3) * (qy - ey), x: ex, y: ey });
  };
  try {
    while (i < t.length) {
      const tok = t[i];
      if (typeof tok !== 'string') {
        cmd = tok.cmd;
        i++;
      } else if (!cmd) return out;
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      let keepC = false;
      let keepQ = false;
      switch (C) {
        case 'M': {
          x = ox + num();
          y = oy + num();
          sx = x;
          sy = y;
          out.push({ c: 'M', x, y });
          cmd = rel ? 'l' : 'L';
          break;
        }
        case 'L':
          x = ox + num();
          y = oy + num();
          out.push({ c: 'L', x, y });
          break;
        case 'H':
          x = ox + num();
          out.push({ c: 'L', x, y });
          break;
        case 'V':
          y = oy + num();
          out.push({ c: 'L', x, y });
          break;
        case 'C': {
          const x1 = ox + num();
          const y1 = oy + num();
          const x2 = ox + num();
          const y2 = oy + num();
          x = ox + num();
          y = oy + num();
          out.push({ c: 'C', x1, y1, x2, y2, x, y });
          lastC = { x: x2, y: y2 };
          keepC = true;
          break;
        }
        case 'S': {
          const x1 = lastC ? 2 * x - lastC.x : x;
          const y1 = lastC ? 2 * y - lastC.y : y;
          const x2 = ox + num();
          const y2 = oy + num();
          x = ox + num();
          y = oy + num();
          out.push({ c: 'C', x1, y1, x2, y2, x, y });
          lastC = { x: x2, y: y2 };
          keepC = true;
          break;
        }
        case 'Q': {
          const qx = ox + num();
          const qy = oy + num();
          const ex = ox + num();
          const ey = oy + num();
          quad(qx, qy, ex, ey);
          x = ex;
          y = ey;
          lastQ = { x: qx, y: qy };
          keepQ = true;
          break;
        }
        case 'T': {
          const qx: number = lastQ ? 2 * x - lastQ.x : x;
          const qy: number = lastQ ? 2 * y - lastQ.y : y;
          const ex = ox + num();
          const ey = oy + num();
          quad(qx, qy, ex, ey);
          x = ex;
          y = ey;
          lastQ = { x: qx, y: qy };
          keepQ = true;
          break;
        }
        case 'A': {
          const rx = Math.abs(num());
          const ry = Math.abs(num());
          const phi = num();
          const large = flag();
          const sweep = flag();
          const ex = ox + num();
          const ey = oy + num();
          out.push(...arcToCubics(x, y, rx, ry, phi, large, sweep, ex, ey));
          x = ex;
          y = ey;
          break;
        }
        case 'Z':
          out.push({ c: 'Z' });
          x = sx;
          y = sy;
          break;
        default:
          return out;
      }
      if (!keepC) lastC = null;
      if (!keepQ) lastQ = null;
    }
  } catch {
    // Malformed tail: keep what parsed (as browsers do).
  }
  return out;
}

/** SVG elliptical arc → cubic Béziers (SVG spec, appendix F.6). */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, phiDeg: number, fa: number, fs: number, x2: number, y2: number): Cmd[] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [{ c: 'L', x: x2, y: y2 }];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI;
  if (fs && dth < 0) dth += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9);
  const out: Cmd[] = [];
  const step = dth / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const pt = (t: number) => ({ x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos });
  const dpt = (t: number) => ({ x: -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, y: -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos });
  for (let i = 0; i < n; i++) {
    const a = th1 + i * step;
    const b = a + step;
    const p0 = pt(a);
    const p3 = i === n - 1 ? { x: x2, y: y2 } : pt(b);
    const d0 = dpt(a);
    const d3 = dpt(b);
    out.push({ c: 'C', x1: p0.x + k * d0.x, y1: p0.y + k * d0.y, x2: p3.x - k * d3.x, y2: p3.y - k * d3.y, x: p3.x, y: p3.y });
  }
  return out;
}

function transformPath(cmds: Cmd[], m: M): string | null {
  if (!cmds.length) return null;
  const f = (x: number, y: number) => {
    const X = m.a * x + m.c * y + m.e;
    const Y = m.b * x + m.d * y + m.f;
    return `${Math.round(X * 1000) / 1000} ${Math.round(Y * 1000) / 1000}`;
  };
  return cmds
    .map((c) => {
      if (c.c === 'Z') return 'Z';
      if (c.c === 'C') return `C${f(c.x1, c.y1)} ${f(c.x2, c.y2)} ${f(c.x, c.y)}`;
      return c.c + f(c.x, c.y);
    })
    .join('');
}
