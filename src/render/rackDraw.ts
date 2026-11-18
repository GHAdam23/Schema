// Drawing of rack elevations (front view, optional side view) and the units in them.
import type { Page, Project, RackObj, RackUnitObj } from '../model/types';
import { DEFAULT_UNIT_DEPTH, rackLayout, slotsOf, unitDef, unitRect, unitSpec, unitsIn, TITLE_SIZE_IN } from '../model/rack';
import { ellipsePath, drawTextIn } from './buildPage';
import { measureText } from '../text/fonts';
import type { DLItem, DLStroke } from './displayList';

const LINE: DLStroke = { color: '#000000', width: 0.5, dash: [] };
const RAIL = '#a6a6a6';
const BLANK = '#7f7f7f';

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
    out.push({ t: 'text', x: r.x + L.w / 2 - w / 2, y: r.y + ts * (1 + i * 1.2) - ts * 0.2, text: t, font: 'titleBold', size: ts, color: '#000000' });
  });

  // Front view: frame, mounting area, rails.
  const f = L.frame;
  const m = L.mount;
  out.push({ t: 'rect', x: f.x, y: f.y, w: f.w, h: f.h, fill: fc.fill, stroke: LINE });
  out.push({ t: 'rect', x: m.x, y: m.y, w: m.w, h: m.h, fill: '#ffffff', stroke: LINE });
  const railW = 0.625 * k;
  for (const x of [m.x, m.x + m.w - railW]) out.push({ t: 'rect', x, y: m.y, w: railW, h: m.h, fill: RAIL, stroke: LINE });
  // Space dividers on the rails and RU numbers (1 at the bottom).
  const units = page ? unitsIn(page, r.id) : [];
  const numSize = Math.min(L.ruH * 0.55, 0.85 * k);
  for (let i = 1; i <= r.ru; i++) {
    const y = m.y + (r.ru - i) * L.ruH;
    if (i < r.ru) for (const x of [m.x, m.x + m.w - railW]) out.push({ t: 'path', d: [{ c: 'M', x, y }, { c: 'L', x: x + railW, y }], fill: null, stroke: { ...LINE, width: 0.3 } });
    if (r.blanks && !units.some((u) => u.u <= i && i < u.u + unitSpec(project, u).ru)) {
      out.push({ t: 'rect', x: m.x, y, w: m.w, h: L.ruH, fill: BLANK, stroke: LINE });
      screws(out, m.x, y, m.w, L.ruH, k);
    }
    if (r.numbers) {
      const t = String(i);
      const w = measureText(t, 'narrow', numSize);
      out.push({ t: 'text', x: f.x + (m.x - f.x) / 2 - w / 2, y: y + L.ruH / 2 + numSize * 0.35, text: t, font: 'narrow', size: numSize, color: fc.text });
    }
  }

  // Side view on the left: rear rail on its left, front rail on its right, units by depth.
  if (L.side && L.sideMount) {
    const s = L.side;
    const sm = L.sideMount;
    out.push({ t: 'rect', x: s.x, y: s.y, w: s.w, h: s.h, fill: fc.fill, stroke: LINE });
    out.push({ t: 'rect', x: sm.x, y: sm.y, w: sm.w, h: sm.h, fill: '#ffffff', stroke: LINE });
    const rw = 0.3 * k;
    for (const x of [sm.x, sm.x + sm.w - rw]) out.push({ t: 'rect', x, y: sm.y, w: rw, h: sm.h, fill: RAIL, stroke: LINE });
    for (const u of units) {
      const sp = unitSpec(project, u);
      const known = sp.depth > 0;
      const d = Math.min(sm.w, (known ? sp.depth : DEFAULT_UNIT_DEPTH) * k);
      const face = unitRect(project, page, u);
      const box = { x: sm.x + sm.w - d, y: face.y, w: d, h: face.h };
      out.push({ t: 'rect', ...box, fill: u.fill ?? '#ffffff', stroke: known ? LINE : { ...LINE, dash: [2, 1.5] } });
      const def = unitDef(project, u);
      const label = [def?.model ?? '', project.devices[u.deviceId]?.name ?? ''].filter(Boolean).join('\n');
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

  // The units, always on top of their rack.
  if (page) for (const u of units) drawRackUnit(out, project, u, page);
}

function screws(out: DLItem[], x: number, y: number, w: number, h: number, k: number) {
  const rr = 0.12 * k;
  for (const cx of [x + 0.32 * k, x + w - 0.32 * k]) out.push({ t: 'path', d: ellipsePath(cx - rr, y + h / 2 - rr, rr * 2, rr * 2), fill: '#ffffff', stroke: { ...LINE, width: 0.3 } });
}

/** A unit's front panel: face, rack ears with screws (full width), manufacturer / model / name. */
export function drawRackUnit(out: DLItem[], project: Project, o: RackUnitObj, page: Page | null) {
  const b = unitRect(project, page, o);
  const k = o.scale;
  const sp = unitSpec(project, o);
  const full = slotsOf(sp.width) === 1;
  out.push({ t: 'rect', ...b, fill: o.fill ?? '#ffffff', stroke: LINE });
  const ear = full ? 0.625 * k : 0;
  if (full) {
    const rr = 0.12 * k;
    const ys = sp.ru === 1 ? [b.y + b.h / 2] : [b.y + 0.875 * k, b.y + b.h - 0.875 * k];
    for (const cx of [b.x + ear / 2, b.x + b.w - ear / 2]) for (const cy of ys) out.push({ t: 'path', d: ellipsePath(cx - rr, cy - rr, rr * 2, rr * 2), fill: '#ffffff', stroke: { ...LINE, width: 0.3 } });
  }
  const def = unitDef(project, o);
  const name = project.devices[o.deviceId]?.name ?? '';
  const text = [def?.manufacturer ?? '', def?.model ?? '', name].filter((t) => t.trim()).join('\n');
  drawTextIn(out, { x: b.x + ear, y: b.y, w: b.w - ear * 2, h: b.h, text, fontSize: 0.9 * k, bold: false, align: 'center', valign: 'middle', color: o.color, wrap: false });
}
