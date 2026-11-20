// Rack elevations: geometry of racks and the units mounted in them.
// Everything is laid out in inches and multiplied by the rack's scale (points per inch).
import type { BlockDef, Id, Page, PageObject, Project, RackAccessory, RackLabelSide, RackObj, RackSpec, RackUnitObj } from './types';
import { measureText } from '../text/fonts';
import type { Rect } from './geom';

export const RU_IN = 1.75;
/** Panel width (19" rack). */
export const PANEL_IN = 19;
/** Rail (ear) width. */
export const RAIL_IN = 0.625;
/** Frame around the mounting area: sides, top, bottom (inches). */
const SIDE_IN = 1.5;
const TOP_IN = 1.5;
const BOTTOM_IN = 1.5;
/** Caster area below the frame. */
const CASTER_IN = 2.25;
/** Gap between the side view and the front view. */
const SIDE_GAP_IN = 0.75;
/** Title lines above the rack (inches at the rack's scale). */
export const TITLE_SIZE_IN = 1.25;
const TITLE_GAP_IN = 0.75;
/** Shelf plate thickness (front view), inches. */
export const SHELF_PLATE_IN = 0.3;

export const DEFAULT_RACK_SCALE = 8;
export const DEFAULT_RACK_DEPTH = 24;
export const DEFAULT_UNIT_DEPTH = 12;

export const ACCESSORY_NAMES: Record<RackAccessory, string> = { blank: 'Blank panel', brush: 'Brush panel', vent: 'Vent panel', shelf: 'Shelf', drawer: 'Drawer' };
export const ACCESSORY_DEPTH: Record<RackAccessory, number> = { blank: 0.5, brush: 1, vent: 0.5, shelf: 16, drawer: 16 };
/** Side labels: font size (inches at the rack's scale), leader length and gap. */
export const SIDE_LABEL_IN = 0.7;
const LEADER_IN = 1.5;

export interface UnitSpec {
  ru: number;
  width: 'full' | 'half' | 'third' | 'custom';
  depth: number;
  /** A size has been set (otherwise the 1U default is used). */
  set: boolean;
  /** Not rack-mount: real size in inches. */
  w: number;
  h: number;
}

export function rackSpecOf(def: BlockDef | undefined): UnitSpec {
  const r = def?.rack;
  return { ru: Math.max(1, Math.round(r?.ru ?? 1)), width: r?.width ?? 'full', depth: r?.depth ?? 0, set: !!r, w: r?.w ?? 8, h: r?.h ?? 1.75 };
}

export function slotsOf(width: RackSpec['width']): number {
  return width === 'half' ? 2 : width === 'third' ? 3 : 1;
}

/** The definition a rack unit draws (its device's). */
export function unitDef(project: Project, o: RackUnitObj): BlockDef | undefined {
  const dev = o.deviceId ? project.devices[o.deviceId] : undefined;
  return dev ? project.blockDefs[dev.defId] : undefined;
}

export function unitSpec(project: Project, o: RackUnitObj): UnitSpec {
  if (o.size) {
    const depth = o.size.depth ?? (o.accessory ? ACCESSORY_DEPTH[o.accessory] : 0);
    return { ru: Math.max(1, Math.round(o.size.ru)), width: o.size.width ?? 'full', depth, set: true, w: 0, h: 0 };
  }
  return rackSpecOf(unitDef(project, o));
}

export function isCustom(sp: UnitSpec) {
  return sp.width === 'custom';
}

/** Name of what a unit shows: device name, accessory type, or image. */
export function unitName(project: Project, o: RackUnitObj): string {
  if (o.accessory) return ACCESSORY_NAMES[o.accessory];
  const dev = project.devices[o.deviceId];
  if (!dev) return o.label?.trim() || 'Image';
  return dev?.name || unitDef(project, o)?.model || '?';
}

/** Where a unit's label goes. */
export function labelSideOf(r: RackObj | undefined, o: RackUnitObj): RackLabelSide {
  if (o.labelSide) return o.labelSide;
  if (o.accessory) return 'face';
  // A picture-only unit shows just its picture unless asked otherwise.
  if (o.assetId && !o.deviceId) return 'none';
  // A device shown by a picture keeps its label off the picture.
  if (o.assetId && o.deviceId) return r?.labels && r.labels !== 'face' ? r.labels : 'right';
  return r?.labels ?? 'face';
}

/** The label lines of a unit (manufacturer + model, friendly name; or an image unit's name). */
export function unitLabelLines(project: Project, o: RackUnitObj): string[] {
  if (o.accessory) return o.label?.trim() ? [o.label.trim()] : [];
  const def = unitDef(project, o);
  if (!def) return o.label?.trim() ? [o.label.trim()] : [];
  return [[def.manufacturer, def.model].filter((t) => t.trim()).join(' '), project.devices[o.deviceId]?.name ?? ''].filter((t) => t.trim());
}

/** Width needed by a side label column, inches (leader + text). */
export function sideLabelWidth(lines: string[]) {
  const w = Math.max(0, ...lines.map((t) => measureText(t, 'narrow', SIDE_LABEL_IN)));
  return w ? LEADER_IN + w + 0.25 : 0;
}

export const LEADER = LEADER_IN;

function titleLines(r: RackObj) {
  return (r.name.trim() ? 1 : 0) + (r.tag.trim() ? 1 : 0);
}

/** Layout of a rack drawing in page points. */
export function rackLayout(r: RackObj) {
  const k = r.scale;
  const lines = titleLines(r);
  const titleH = lines ? (lines * TITLE_SIZE_IN * 1.2 + TITLE_GAP_IN) * k : 0;
  const mountH = r.ru * RU_IN * k;
  const frameH = mountH + (TOP_IN + BOTTOM_IN) * k;
  const frameW = (PANEL_IN + SIDE_IN * 2) * k;
  const depth = Math.max(4, r.depth);
  // Units deeper than the rack stick out past the rear rail (on the left of the side view).
  const over = r.side ? Math.max(0, r.over ?? 0) * k : 0;
  const sideFrameW = (depth + SIDE_IN * 2) * k;
  const sideW = r.side ? over + sideFrameW : 0;
  const sideGap = r.side ? SIDE_GAP_IN * k : 0;
  const labL = (r.labW?.[0] ?? 0) * k;
  const labR = (r.labW?.[1] ?? 0) * k;
  const frameX = r.x + labL + sideW + sideGap;
  const frameY = r.y + titleH;
  const casterH = r.casters ? CASTER_IN * k : 0;
  return {
    k,
    titleH,
    /** Front view frame. */
    frame: { x: frameX, y: frameY, w: frameW, h: frameH },
    /** Mounting area (19" wide, RU × 1.75" tall). */
    mount: { x: frameX + SIDE_IN * k, y: frameY + TOP_IN * k, w: PANEL_IN * k, h: mountH },
    /** Side view frame (if shown). Front rail on its right edge. */
    side: r.side ? { x: r.x + labL + over, y: frameY, w: sideFrameW, h: frameH } : null,
    sideMount: r.side ? { x: r.x + labL + over + SIDE_IN * k, y: frameY + TOP_IN * k, w: depth * k, h: mountH } : null,
    /** Label columns: left of everything, right of the front view. */
    labL,
    labR,
    casterH,
    w: labL + sideW + sideGap + frameW + labR,
    h: titleH + frameH + casterH,
    ruH: RU_IN * k,
  };
}

export function rackSize(r: RackObj) {
  const L = rackLayout(r);
  return { w: L.w, h: L.h };
}

/** Top edge (page y) of rack unit number `u` (1 = bottom). */
export function ruTop(r: RackObj, u: number) {
  const L = rackLayout(r);
  return L.mount.y + (r.ru - u) * L.ruH;
}

/** Face rectangle of a unit at (u, slot) in a rack. */
export function slotRect(r: RackObj, u: number, ru: number, slot: number, slots: number): Rect {
  const L = rackLayout(r);
  const w = L.mount.w / slots;
  return { x: L.mount.x + slot * w, y: ruTop(r, u + ru - 1), w, h: ru * L.ruH };
}

export function rackOf(page: Page, o: RackUnitObj): RackObj | undefined {
  if (!o.rackId) return undefined;
  const r = page.objects.find((x) => x.id === o.rackId);
  return r?.kind === 'rack' ? r : undefined;
}

/** Size of a unit at a scale (points per inch). */
export function specSize(sp: UnitSpec, k: number) {
  if (isCustom(sp)) return { w: sp.w * k, h: sp.h * k };
  return { w: (PANEL_IN / slotsOf(sp.width)) * k, h: sp.ru * RU_IN * k };
}

/** Face rectangle of a unit on the page (in its rack, or free-standing at its own scale). */
export function unitRect(project: Project, page: Page | null, o: RackUnitObj): Rect {
  const sp = unitSpec(project, o);
  const r = page ? rackOf(page, o) : undefined;
  if (r && isCustom(sp)) {
    const m = rackLayout(r).mount;
    return { x: m.x + (o.at?.x ?? 0) * r.scale, y: m.y + (o.at?.y ?? 0) * r.scale, ...specSize(sp, r.scale) };
  }
  if (r) return slotRect(r, o.u, sp.ru, o.slot, slotsOf(sp.width));
  return { x: o.x, y: o.y, ...specSize(sp, o.scale) };
}

/** Size of a unit from its own fields (without the page: free-standing size). */
export function unitSize(project: Project, o: RackUnitObj) {
  return specSize(unitSpec(project, o), o.scale);
}

export function unitsIn(page: Page, rackId: Id): RackUnitObj[] {
  return page.objects.filter((o): o is RackUnitObj => o.kind === 'rackunit' && o.rackId === rackId);
}

/** Occupancy grid: each RU split into 6 sub-columns (fits 1/2 and 1/3). Shelf-mounted gear takes no space. */
export const SUB = 6;
export function cellsOf(u: number, ru: number, slot: number, slots: number) {
  const out: [number, number][] = [];
  const per = SUB / slots;
  for (let k = u; k < u + ru; k++) for (let c = slot * per; c < (slot + 1) * per; c++) out.push([k, c]);
  return out;
}

export function occupancy(project: Project, page: Page, rack: RackObj, except: Set<Id>) {
  const occ = new Map<string, RackUnitObj>();
  for (const o of unitsIn(page, rack.id)) {
    if (except.has(o.id)) continue;
    const sp = unitSpec(project, o);
    if (isCustom(sp)) continue;
    for (const [u, c] of cellsOf(o.u, sp.ru, o.slot, slotsOf(sp.width))) occ.set(u + ':' + c, o);
  }
  return occ;
}

export function fits(project: Project, page: Page, rack: RackObj, u: number, ru: number, slot: number, slots: number, except: Set<Id>): boolean {
  if (u < 1 || u + ru - 1 > rack.ru || slot < 0 || slot >= slots) return false;
  const occ = occupancy(project, page, rack, except);
  return cellsOf(u, ru, slot, slots).every(([a, c]) => !occ.has(a + ':' + c));
}

/** Where a unit whose face is at `p` (top-left + size) lands in a rack: bottom RU and slot (nearest to where it is). */
export function wantedSlot(rack: RackObj, ru: number, slots: number, p: { x: number; y: number; w: number; h: number }) {
  const L = rackLayout(rack);
  const top = Math.round((p.y - L.mount.y) / L.ruH); // RU index from the top (0-based) of the unit's top
  const u = rack.ru - top - ru + 1;
  const cx = p.x + p.w / 2;
  const slot = Math.max(0, Math.min(slots - 1, Math.floor(((cx - L.mount.x) / L.mount.w) * slots)));
  return { u, slot };
}

/**
 * Where a not-rack-mount unit (top-left `p`, size in points) lands in a rack: kept inside the
 * mounting area and, if a shelf is just below it, sitting on that shelf. Returns inches from the
 * mounting area's top-left.
 */
export function shelfLanding(project: Project, page: Page, rack: RackObj, p: { x: number; y: number; w: number; h: number }) {
  const L = rackLayout(rack);
  const k = rack.scale;
  const m = L.mount;
  let x = Math.min(Math.max(p.x, m.x + RAIL_IN * k), m.x + m.w - RAIL_IN * k - p.w);
  let y = Math.min(Math.max(p.y, m.y), m.y + m.h - p.h);
  // Shelf surfaces (top of each shelf plate) under the unit.
  const bottom = y + p.h;
  let best: number | null = null;
  for (const s of unitsIn(page, rack.id)) {
    if (s.accessory !== 'shelf') continue;
    const sp = unitSpec(project, s);
    const r = slotRect(rack, s.u, sp.ru, s.slot, slotsOf(sp.width));
    if (x + p.w <= r.x || x >= r.x + r.w) continue;
    const surface = r.y + r.h - SHELF_PLATE_IN * k;
    if (Math.abs(surface - bottom) <= Math.max(L.ruH, p.h / 2) && (best === null || Math.abs(surface - bottom) < Math.abs(best - bottom))) best = surface;
  }
  if (best !== null) y = best - p.h;
  x = Math.round(((x - m.x) / k) * 8) / 8;
  y = Math.round(((y - m.y) / k) * 100) / 100;
  return { x, y };
}

/** Rack (topmost) whose front view contains the point. */
export function rackAt(page: Page, p: { x: number; y: number }, pad = 0): RackObj | null {
  for (let i = page.objects.length - 1; i >= 0; i--) {
    const o = page.objects[i];
    if (o.kind !== 'rack') continue;
    const f = rackLayout(o).frame;
    if (p.x >= f.x - pad && p.x <= f.x + f.w + pad && p.y >= f.y - pad && p.y <= f.y + f.h + pad) return o;
  }
  return null;
}

/** Keep racked units in step with their rack, and the rack's side-view overhang in step with its units (after every change). */
export function syncRacks(project: Project) {
  for (const pg of project.pages) {
    if (!pg.objects.some((o) => o.kind === 'rack' || o.kind === 'rackunit')) continue;
    const racks = new Map(pg.objects.filter((x): x is RackObj => x.kind === 'rack').map((x) => [x.id, x]));
    // Side-view overhang first (it moves the front view).
    const deepest = new Map<Id, number>();
    for (const o of pg.objects) {
      if (o.kind !== 'rackunit' || !o.rackId || !racks.has(o.rackId)) continue;
      const sp = unitSpec(project, o);
      deepest.set(o.rackId, Math.max(deepest.get(o.rackId) ?? 0, sp.depth || (o.accessory ? 0 : DEFAULT_UNIT_DEPTH)));
    }
    // Side label columns.
    const labs = new Map<Id, [number, number]>();
    for (const o of pg.objects) {
      if (o.kind !== 'rackunit' || !o.rackId || !racks.has(o.rackId)) continue;
      const side = labelSideOf(racks.get(o.rackId), o);
      if (side !== 'left' && side !== 'right') continue;
      const w = sideLabelWidth(unitLabelLines(project, o));
      const cur = labs.get(o.rackId) ?? [0, 0];
      cur[side === 'left' ? 0 : 1] = Math.max(cur[side === 'left' ? 0 : 1], w);
      labs.set(o.rackId, cur);
    }
    for (const r of racks.values()) {
      const over = Math.max(0, (deepest.get(r.id) ?? 0) - Math.max(4, r.depth));
      if ((r.over ?? 0) !== over) r.over = over || undefined;
      const lw = labs.get(r.id);
      const round = (v: number) => Math.ceil(v * 4) / 4;
      const nl = lw && (lw[0] || lw[1]) ? ([round(lw[0]), round(lw[1])] as [number, number]) : undefined;
      if (JSON.stringify(r.labW ?? null) !== JSON.stringify(nl ?? null)) {
        if (nl) r.labW = nl;
        else delete r.labW;
      }
      // Keep the front view where it is when things appear on its left (labels, side view, overhang):
      // the drawing grows outwards instead of pushing the rack across the page.
      const L = rackLayout(r);
      const fx = Math.round(((L.frame.x - r.x) / r.scale) * 1000) / 1000;
      if (r.fx !== undefined && r.fx !== fx) r.x -= (fx - r.fx) * r.scale;
      if (r.fx !== fx) r.fx = fx;
    }
    for (const o of pg.objects) {
      if (o.kind !== 'rackunit' || !o.rackId) continue;
      const r = racks.get(o.rackId);
      if (!r) {
        // Its rack is gone: the unit stays where it was, free-standing.
        o.rackId = null;
        continue;
      }
      const sp = unitSpec(project, o);
      if (o.slot >= slotsOf(sp.width)) o.slot = 0;
      if (isCustom(sp)) o.at ??= { x: RAIL_IN, y: 0 };
      if (o.scale !== r.scale) o.scale = r.scale;
      const rect = unitRect(project, pg, o);
      if (o.x !== rect.x) o.x = rect.x;
      if (o.y !== rect.y) o.y = rect.y;
    }
  }
}

export function isRackish(o: PageObject): boolean {
  return o.kind === 'rack' || o.kind === 'rackunit';
}
