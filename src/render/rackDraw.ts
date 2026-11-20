// Drawing of rack elevations (front view, optional side view) and the units in them.
import type { Page, Project, RackObj, RackUnitObj } from '../model/types';
import {
  DEFAULT_UNIT_DEPTH,
  RAIL_IN,
  SHELF_PLATE_IN,
  SUB,
  cellsOf,
  isCustom,
  rackLayout,
  slotsOf,
  unitDef,
  unitRect,
  unitSpec,
  unitsIn,
  TITLE_SIZE_IN,
  LEADER,
  SIDE_LABEL_IN,
  labelSideOf,
  rackOf,
  unitLabelLines,
} from '../model/rack';
import { ellipsePath, drawImage, drawTextIn } from './buildPage';
import { measureText } from '../text/fonts';
import type { DLItem, DLStroke } from './displayList';

const LINE: DLStroke = { color: '#000000', width: 0.5, dash: [] };
const THIN: DLStroke = { color: '#000000', width: 0.3, dash: [] };
const RAIL = '#a6a6a6';
const HOLE = '#404040';
/** Blank panels and the filler beside half / third-width gear. */
export const BLANK = '#595959';

function frameColours(r: RackObj) {
  return r.frame === 'frame' ? { fill: '#000000', text: '#ffffff' } : { fill: '#d9d9d9', text: '#000000' };
}

export function drawRack(out: DLItem[], project: Project, r: RackObj, page: Page | null) {
  const L = rackLayout(r);
  const k = L.k;
  const fc = frameColours(r);
  // Title above: name, then the tag in quotes.
  const lines = [r.name.trim(), r.tag.trim() ? `“${r.tag.trim()}”` : ''].filter(Boolean);
  const ts = TITLE_SIZE_IN * k;
  lines.forEach((t, i) => {
    const w = measureText(t, 'titleBold', ts);
    out.push({ t: 'text', x: (r.x + L.labL + L.frame.x + L.frame.w) / 2 - w / 2, y: r.y + ts * (1 + i * 1.2) - ts * 0.2, text: t, font: 'titleBold', size: ts, color: '#000000' });
  });

  // Front view: frame, mounting area, rails with their square holes (three per space).
  const f = L.frame;
  const m = L.mount;
  out.push({ t: 'rect', x: f.x, y: f.y, w: f.w, h: f.h, fill: fc.fill, stroke: LINE });
  out.push({ t: 'rect', x: m.x, y: m.y, w: m.w, h: m.h, fill: '#ffffff', stroke: LINE });
  const railW = RAIL_IN * k;
  const hole = 0.28 * k;
  for (const x of [m.x, m.x + m.w - railW]) {
    out.push({ t: 'rect', x, y: m.y, w: railW, h: m.h, fill: RAIL, stroke: LINE });
    for (let i = 0; i < r.ru; i++) {
      const top = m.y + i * L.ruH;
      // EIA hole pattern: 1/4", 7/8" and 1 1/2" from the top of each space.
      for (const dy of [0.25, 0.875, 1.5]) out.push({ t: 'path', d: ellipsePath(x + railW / 2 - hole / 2, top + dy * k - hole / 2, hole, hole), fill: HOLE, stroke: null });
    }
  }
  const numSize = Math.min(L.ruH * 0.55, 0.85 * k);
  if (r.numbers)
    for (let i = 1; i <= r.ru; i++) {
      const y = m.y + (r.ru - i) * L.ruH;
      const t = String(i);
      const w = measureText(t, 'narrow', numSize);
      out.push({ t: 'text', x: f.x + (m.x - f.x) / 2 - w / 2, y: y + L.ruH / 2 + numSize * 0.35, text: t, font: 'narrow', size: numSize, color: fc.text });
    }

  const units = page ? unitsIn(page, r.id) : [];
  // Beside half / third-width gear the rest of the space is closed with a filler panel (rack kit).
  const partial = new Map<number, Set<number>>();
  for (const u of units) {
    const sp = unitSpec(project, u);
    if (isCustom(sp) || slotsOf(sp.width) === 1) continue;
    for (const [ru, c] of cellsOf(u.u, sp.ru, u.slot, slotsOf(sp.width))) {
      if (!partial.has(ru)) partial.set(ru, new Set());
      partial.get(ru)!.add(c);
    }
  }
  for (const [ru, used] of partial) {
    const y = m.y + (r.ru - ru) * L.ruH;
    const cw = m.w / SUB;
    for (let c = 0; c < SUB; c++) {
      if (used.has(c)) continue;
      let e = c;
      while (e + 1 < SUB && !used.has(e + 1)) e++;
      out.push({ t: 'rect', x: m.x + c * cw, y, w: (e - c + 1) * cw, h: L.ruH, fill: BLANK, stroke: LINE });
      c = e;
    }
  }

  // Side view on the left: rear rail on its left, front rail on its right, units by depth from the
  // front rail (deeper ones stick out past the rear).
  if (L.side && L.sideMount) {
    const s = L.side;
    const sm = L.sideMount;
    out.push({ t: 'rect', x: s.x, y: s.y, w: s.w, h: s.h, fill: fc.fill, stroke: LINE });
    out.push({ t: 'rect', x: sm.x, y: sm.y, w: sm.w, h: sm.h, fill: '#ffffff', stroke: LINE });
    const rw = 0.3 * k;
    for (const x of [sm.x, sm.x + sm.w - rw]) out.push({ t: 'rect', x, y: sm.y, w: rw, h: sm.h, fill: RAIL, stroke: LINE });
    const front = sm.x + sm.w;
    for (const u of units) {
      const sp = unitSpec(project, u);
      const face = unitRect(project, page, u);
      if (u.accessory === 'shelf') {
        const d = sp.depth * k;
        out.push({ t: 'rect', x: front - d, y: face.y + face.h - SHELF_PLATE_IN * k, w: d, h: SHELF_PLATE_IN * k, fill: BLANK, stroke: LINE });
        continue;
      }
      const known = sp.depth > 0;
      const d = (known ? sp.depth : DEFAULT_UNIT_DEPTH) * k;
      const box = { x: front - d, y: face.y, w: d, h: face.h };
      const fill = u.accessory ? BLANK : u.fill ?? '#ffffff';
      out.push({ t: 'rect', ...box, fill, stroke: known ? LINE : { ...LINE, dash: [2, 1.5] } });
      if (u.accessory) continue;
      const def = unitDef(project, u);
      const label = u.assetId ? u.label ?? '' : [def?.model ?? '', project.devices[u.deviceId]?.name ?? ''].filter(Boolean).join('\n');
      drawTextIn(out, { x: box.x, y: box.y, w: box.w, h: box.h, text: label, fontSize: 0.7 * k, bold: false, align: 'center', valign: 'middle', color: u.color, wrap: false });
    }
  }

  // Casters under the frame (front and side views).
  if (r.casters) {
    for (const fr of [f, L.side].filter((x): x is NonNullable<typeof x> => !!x)) {
      const base = fr.y + fr.h;
      const wr = 0.8 * k;
      for (const cx of [fr.x + 2 * k, fr.x + fr.w - 2 * k]) {
        out.push({ t: 'rect', x: cx - 0.35 * k, y: base, w: 0.7 * k, h: L.casterH - wr * 1.6, fill: '#bfbfbf', stroke: LINE });
        out.push({ t: 'path', d: ellipsePath(cx - wr * 0.6, base + L.casterH - wr * 1.7, wr * 1.2, wr * 1.7), fill: '#7f7f7f', stroke: LINE });
      }
    }
  }

  // The units, always on top of their rack; gear standing on shelves last.
  if (page) {
    const custom = (u: RackUnitObj) => isCustom(unitSpec(project, u));
    for (const u of units) if (!custom(u)) drawRackUnit(out, project, u, page);
    for (const u of units) if (custom(u)) drawRackUnit(out, project, u, page);
  }
}

function screw(out: DLItem[], cx: number, cy: number, k: number) {
  const rr = 0.12 * k;
  out.push({ t: 'path', d: ellipsePath(cx - rr, cy - rr, rr * 2, rr * 2), fill: '#ffffff', stroke: THIN });
}

/** Screws in both rack ears of a full-width panel. */
function earScrews(out: DLItem[], b: { x: number; y: number; w: number; h: number }, ru: number, k: number) {
  const ear = RAIL_IN * k;
  // Two screws per ear on every panel, 1/4" from its top and bottom (the outer holes of the EIA pattern).
  void ru;
  const ys = [b.y + 0.25 * k, b.y + b.h - 0.25 * k];
  for (const cx of [b.x + ear / 2, b.x + b.w - ear / 2]) for (const cy of ys) screw(out, cx, cy, k);
}

/** A unit's front panel: device face (manufacturer / model / name), accessory, or imported image. */
export function drawRackUnit(out: DLItem[], project: Project, o: RackUnitObj, page: Page | null) {
  const b = unitRect(project, page, o);
  const k = o.scale;
  const sp = unitSpec(project, o);
  const full = !isCustom(sp) && slotsOf(sp.width) === 1;
  const ear = full ? RAIL_IN * k : 0;

  if (o.accessory === 'shelf') {
    // Rack ears plus the shelf plate at the bottom of its space; gear sits on top of it.
    const plate = SHELF_PLATE_IN * k;
    for (const x of [b.x, b.x + b.w - RAIL_IN * k]) out.push({ t: 'rect', x, y: b.y, w: RAIL_IN * k, h: b.h, fill: BLANK, stroke: LINE });
    out.push({ t: 'rect', x: b.x, y: b.y + b.h - plate, w: b.w, h: plate, fill: BLANK, stroke: LINE });
    earScrews(out, b, sp.ru, k);
    return;
  }
  if (o.accessory) {
    out.push({ t: 'rect', ...b, fill: o.fill ?? BLANK, stroke: LINE });
    const inner = { x: b.x + ear + 0.4 * k, w: b.w - ear * 2 - 0.8 * k };
    if (o.accessory === 'brush') {
      // A horizontal opening filled with bristles.
      // The opening grows with the panel's height.
      const oh = Math.max(0.4 * k, b.h - 0.9 * k);
      const oy = b.y + (b.h - oh) / 2;
      out.push({ t: 'rect', x: inner.x, y: oy, w: inner.w, h: oh, fill: '#262626', stroke: LINE });
      const d: DLItem[] = [];
      const step = 0.12 * k;
      const path = [];
      for (let x = inner.x + step / 2; x < inner.x + inner.w; x += step) path.push({ c: 'M' as const, x, y: oy + 0.04 * k }, { c: 'L' as const, x: x + step * 0.3, y: oy + oh - 0.04 * k });
      d.push({ t: 'path', d: path, fill: null, stroke: { color: '#8c8c8c', width: Math.max(0.15, 0.03 * k), dash: [] } });
      out.push(...d);
    } else if (o.accessory === 'drawer') {
      // Drawer front inside the ears, with a handle.
      const inset = 0.15 * k;
      out.push({ t: 'rect', x: b.x + ear + inset, y: b.y + inset, w: b.w - ear * 2 - inset * 2, h: b.h - inset * 2, fill: o.fill ?? BLANK, stroke: LINE });
      const hw = Math.min(6 * k, b.w * 0.35);
      const hh = 0.32 * k;
      out.push({ t: 'rect', x: b.x + b.w / 2 - hw / 2, y: b.y + Math.min(b.h / 2, 0.875 * k) - hh / 2, w: hw, h: hh, fill: '#a6a6a6', stroke: LINE });
    } else if (o.accessory === 'vent') {
      // Rows of slots.
      const rows = Math.max(1, Math.round(sp.ru * 2));
      const sh = Math.min(0.18 * k, b.h / (rows * 3));
      for (let i = 0; i < rows; i++) {
        const y = b.y + ((i + 0.5) * b.h) / rows - sh / 2;
        out.push({ t: 'rect', x: inner.x, y, w: inner.w, h: sh, fill: '#262626', stroke: null });
      }
    }
    if (full) earScrews(out, b, sp.ru, k);
    if (o.label?.trim()) drawTextIn(out, { x: b.x + ear, y: b.y, w: b.w - ear * 2, h: b.h, text: o.label.trim(), fontSize: 0.6 * k, bold: false, align: 'center', valign: 'middle', color: o.color === '#000000' ? '#ffffff' : o.color, wrap: false });
    return;
  }
  const rack = page ? rackOf(page, o) : undefined;
  const side = labelSideOf(rack, o);
  if (o.assetId) {
    // An imported picture of the front panel, stretched to the unit's space.
    if (o.fill) out.push({ t: 'rect', ...b, fill: o.fill, stroke: null });
    drawImage(out, project, { id: o.id, kind: 'image', assetId: o.assetId, x: b.x, y: b.y, w: b.w, h: b.h, border: null });
    out.push({ t: 'rect', ...b, fill: null, stroke: THIN });
  } else {
    out.push({ t: 'rect', ...b, fill: o.fill ?? '#ffffff', stroke: LINE });
    if (full) earScrews(out, b, sp.ru, k);
  }
  const lines = unitLabelLines(project, o);
  if (side === 'face' && lines.length) {
    // Manufacturer and model on separate lines on the face, then the friendly name.
    const def = unitDef(project, o);
    const name = project.devices[o.deviceId]?.name ?? '';
    const text = def ? [def.manufacturer, def.model, name].filter((t) => t.trim()).join('\n') : lines.join('\n');
    drawTextIn(out, { x: b.x + ear, y: b.y, w: b.w - ear * 2, h: b.h, text, fontSize: 0.9 * k, bold: false, align: 'center', valign: 'middle', color: o.color, wrap: false });
  }
  if ((side === 'left' || side === 'right') && lines.length && rack) drawSideLabel(out, rack, b, lines, side);
}

/** A label beside the rack with a leader line pointing at the unit. */
function drawSideLabel(out: DLItem[], r: RackObj, b: { x: number; y: number; w: number; h: number }, lines: string[], side: 'left' | 'right') {
  const L = rackLayout(r);
  const k = L.k;
  const size = SIDE_LABEL_IN * k;
  const cy = b.y + b.h / 2;
  const edge = side === 'right' ? L.frame.x + L.frame.w : r.x + L.labL;
  const end = side === 'right' ? edge + LEADER * k * 0.85 : edge - LEADER * k * 0.85;
  const start = side === 'right' ? b.x + b.w : side === 'left' && !L.side ? b.x : edge;
  out.push({ t: 'path', d: [{ c: 'M', x: start, y: cy }, { c: 'L', x: end, y: cy }], fill: null, stroke: { color: '#000000', width: 0.4, dash: [] } });
  out.push({ t: 'path', d: ellipsePath(start - 0.08 * k, cy - 0.08 * k, 0.16 * k, 0.16 * k), fill: '#000000', stroke: null });
  const lh = size * 1.2;
  const top = cy - (lines.length * lh) / 2;
  lines.forEach((t, i) => {
    const w = measureText(t, i === lines.length - 1 && lines.length > 1 ? 'narrowBold' : 'narrow', size);
    const x = side === 'right' ? end + 0.15 * k : end - 0.15 * k - w;
    out.push({ t: 'text', x, y: top + i * lh + size * 0.85, text: t, font: i === lines.length - 1 && lines.length > 1 ? 'narrowBold' : 'narrow', size, color: '#000000' });
  });
}
