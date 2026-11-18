// Rack elevations: geometry of racks and the units mounted in them.
// Everything is laid out in inches and multiplied by the rack's scale (points per inch).
import type { BlockDef, Id, Page, PageObject, Project, RackObj, RackSpec, RackUnitObj } from './types';
import type { Rect } from './geom';

export const RU_IN = 1.75;
/** Panel width (19" rack). */
export const PANEL_IN = 19;
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

export const DEFAULT_RACK_SCALE = 8;
export const DEFAULT_UNIT_DEPTH = 12;

export function rackSpecOf(def: BlockDef | undefined): Required<RackSpec> & { set: boolean } {
  const r = def?.rack;
  return { ru: Math.max(1, Math.round(r?.ru ?? 1)), width: r?.width ?? 'full', depth: r?.depth ?? 0, set: !!r };
}

export function slotsOf(width: RackSpec['width']): number {
  return width === 'half' ? 2 : width === 'third' ? 3 : 1;
}

/** The definition a rack unit draws (its device's). */
export function unitDef(project: Project, o: RackUnitObj): BlockDef | undefined {
  const dev = project.devices[o.deviceId];
  return dev ? project.blockDefs[dev.defId] : undefined;
}

export function unitSpec(project: Project, o: RackUnitObj) {
  return rackSpecOf(unitDef(project, o));
}

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
  const sideW = r.side ? (Math.max(4, r.depth) + SIDE_IN * 2) * k : 0;
  const sideGap = r.side ? SIDE_GAP_IN * k : 0;
  const frameX = r.x + sideW + sideGap;
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
    side: r.side ? { x: r.x, y: frameY, w: sideW, h: frameH } : null,
    sideMount: r.side ? { x: r.x + SIDE_IN * k, y: frameY + TOP_IN * k, w: Math.max(4, r.depth) * k, h: mountH } : null,
    casterH,
    w: sideW + sideGap + frameW,
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

/** Face rectangle of a unit on the page (in its rack, or free-standing at its own scale). */
export function unitRect(project: Project, page: Page | null, o: RackUnitObj): Rect {
  const sp = unitSpec(project, o);
  const slots = slotsOf(sp.width);
  const r = page ? rackOf(page, o) : undefined;
  if (r) return slotRect(r, o.u, sp.ru, o.slot, slots);
  return { x: o.x, y: o.y, w: (PANEL_IN / slots) * o.scale, h: sp.ru * RU_IN * o.scale };
}

/** Size of a unit from its own fields (without the page: free-standing size). */
export function unitSize(project: Project, o: RackUnitObj) {
  const sp = unitSpec(project, o);
  const slots = slotsOf(sp.width);
  return { w: (PANEL_IN / slots) * o.scale, h: sp.ru * RU_IN * o.scale };
}

export function unitsIn(page: Page, rackId: Id): RackUnitObj[] {
  return page.objects.filter((o): o is RackUnitObj => o.kind === 'rackunit' && o.rackId === rackId);
}

/** Occupancy grid: cell (u, sub) → unit id, with each RU split into 6 sub-columns (fits 1/2 and 1/3). */
const SUB = 6;
function cellsOf(u: number, ru: number, slot: number, slots: number) {
  const out: [number, number][] = [];
  const per = SUB / slots;
  for (let k = u; k < u + ru; k++) for (let c = slot * per; c < (slot + 1) * per; c++) out.push([k, c]);
  return out;
}

function occupancy(project: Project, page: Page, rack: RackObj, except: Set<Id>) {
  const occ = new Set<string>();
  for (const o of unitsIn(page, rack.id)) {
    if (except.has(o.id)) continue;
    const sp = unitSpec(project, o);
    for (const [u, c] of cellsOf(o.u, sp.ru, o.slot, slotsOf(sp.width))) occ.add(u + ':' + c);
  }
  return occ;
}

export function fits(project: Project, page: Page, rack: RackObj, u: number, ru: number, slot: number, slots: number, except: Set<Id>): boolean {
  if (u < 1 || u + ru - 1 > rack.ru || slot < 0 || slot >= slots) return false;
  const occ = occupancy(project, page, rack, except);
  return cellsOf(u, ru, slot, slots).every(([a, c]) => !occ.has(a + ':' + c));
}

/**
 * The free space nearest to a wanted position (u = bottom RU, slot), searching outward; null when
 * the rack has no room for it.
 */
export function nearestFree(project: Project, page: Page, rack: RackObj, ru: number, slots: number, wantU: number, wantSlot: number, except: Set<Id>) {
  let best: { u: number; slot: number; d: number } | null = null;
  for (let u = 1; u + ru - 1 <= rack.ru; u++)
    for (let sl = 0; sl < slots; sl++) {
      if (!fits(project, page, rack, u, ru, sl, slots, except)) continue;
      const d = Math.abs(u - wantU) * 10 + Math.abs(sl - wantSlot);
      if (!best || d < best.d) best = { u, slot: sl, d };
    }
  return best;
}

/** Where a unit whose face would have its top-left at `p` lands in a rack: RU (bottom) and slot. */
export function wantedSlot(rack: RackObj, ru: number, slots: number, p: { x: number; y: number; w: number; h: number }) {
  const L = rackLayout(rack);
  const cy = p.y + p.h / 2;
  // Bottom RU from the centre of the dragged face.
  const fromTop = (cy - L.mount.y) / L.ruH; // in RU, from the top
  const top = Math.round(fromTop - ru / 2); // RU index from the top (0-based) of the unit's top
  const u = rack.ru - top - ru + 1;
  const cx = p.x + p.w / 2;
  const slot = Math.max(0, Math.min(slots - 1, Math.floor(((cx - L.mount.x) / L.mount.w) * slots)));
  return { u, slot };
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

/** Keep the x/y of racked units in step with their rack (run after every change). */
export function syncRacks(project: Project) {
  for (const pg of project.pages) {
    let racks: Map<Id, RackObj> | null = null;
    for (const o of pg.objects) {
      if (o.kind !== 'rackunit' || !o.rackId) continue;
      racks ??= new Map(pg.objects.filter((x): x is RackObj => x.kind === 'rack').map((x) => [x.id, x]));
      const r = racks.get(o.rackId);
      if (!r) {
        // Its rack is gone: the unit stays where it was, free-standing.
        o.rackId = null;
        continue;
      }
      const slots = slotsOf(unitSpec(project, o).width);
      if (o.slot >= slots) o.slot = 0;
      const rect = unitRect(project, pg, o);
      if (o.x !== rect.x) o.x = rect.x;
      if (o.y !== rect.y) o.y = rect.y;
      if (o.scale !== r.scale) o.scale = r.scale;
    }
  }
}

export function isRackish(o: PageObject): boolean {
  return o.kind === 'rack' || o.kind === 'rackunit';
}
