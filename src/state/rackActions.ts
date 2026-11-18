// Rack elevations: adding racks, mounting devices, moving units between spaces.
import type { Draft } from 'immer';
import type { BlockDef, Id, Page, Project, ProjectDevice, RackObj, RackSpec, RackUnitObj } from '../model/types';
import { newId } from '../model/ids';
import { cloneDef } from '../model/project';
import { DEFAULT_RACK_SCALE, nearestFree, rackAt, rackLayout, rackSpecOf, slotsOf, unitRect, unitSpec, wantedSlot } from '../model/rack';
import { currentPage, getState, labelLast, nextLabel, setState, toast, updateProject } from './store';
import { uniqueDeviceName } from './actions';

function pageDraft(d: Draft<Project>, pageId = getState().pageId): Draft<Page> {
  return d.pages.find((p) => p.id === pageId) ?? d.pages[0];
}

export function addRack(x: number, y: number, ru = 12): Id {
  const n = currentPage().objects.filter((o) => o.kind === 'rack').length + 1;
  const r: RackObj = {
    id: newId('ob'),
    kind: 'rack',
    x,
    y,
    ru,
    name: `${ru}U Rack`,
    tag: `AV${n}`,
    frame: 'cabinet',
    numbers: true,
    depth: 24,
    scale: DEFAULT_RACK_SCALE,
  };
  nextLabel(`Add rack (${ru}U)`);
  // Racks go behind everything else, like containers.
  updateProject((d) => void pageDraft(d).objects.unshift(r));
  setState({ selection: [r.id], selectedPorts: [] });
  return r.id;
}

/** Where a unit of a given size goes when dropped with its face centred at `p` (rack under the point or free). */
function landing(project: Project, page: Page, ru: number, slots: number, p: { x: number; y: number }, except: Set<Id>) {
  const rack = rackAt(page, p, 4);
  if (!rack) return { rack: null, u: 1, slot: 0, ok: true };
  const k = rack.scale;
  const w = rackLayout(rack).mount.w / slots;
  const h = ru * 1.75 * k;
  const want = wantedSlot(rack, ru, slots, { x: p.x - w / 2, y: p.y - h / 2, w, h });
  const free = nearestFree(project, page, rack, ru, slots, want.u, want.slot, except);
  return free ? { rack, u: free.u, slot: free.slot, ok: true } : { rack, u: 1, slot: 0, ok: false };
}

/** Mount a device (existing project device) at a point: into the rack there, else free-standing. */
export function mountDevice(deviceId: Id, p: { x: number; y: number }): Id | null {
  const s = getState();
  const page = currentPage(s);
  const dev = s.project.devices[deviceId];
  if (!dev) return null;
  const already = page.objects.find((o): o is RackUnitObj => o.kind === 'rackunit' && o.deviceId === deviceId);
  if (already) {
    toast(`${dev.name} is already in a rack on this page.`, 'warn');
    setState({ selection: [already.id], selectedPorts: [] });
    return null;
  }
  const def = s.project.blockDefs[dev.defId];
  const sp = rackSpecOf(def);
  const slots = slotsOf(sp.width);
  const at = landing(s.project, page, sp.ru, slots, p, new Set());
  if (!at.ok) {
    toast(`No room for a ${sp.ru}U${slots > 1 ? ` ${sp.width}-width` : ''} unit in this rack.`, 'warn');
    return null;
  }
  const scale = at.rack?.scale ?? DEFAULT_RACK_SCALE;
  const u: RackUnitObj = { id: newId('ob'), kind: 'rackunit', deviceId, rackId: at.rack?.id ?? null, u: at.u, slot: at.slot, fill: null, color: '#000000', scale, x: p.x, y: p.y };
  if (!at.rack) {
    const w = (19 / slots) * scale;
    u.x = p.x - w / 2;
    u.y = p.y - (sp.ru * 1.75 * scale) / 2;
  }
  return commitUnit(u, def, sp.set);
}

function commitUnit(u: RackUnitObj, def: BlockDef, sized: boolean): Id {
  const s = getState();
  const name = s.project.devices[u.deviceId]?.name ?? '';
  nextLabel(`Mount ${name} in ${u.rackId ? 'rack' : 'the page'}`);
  updateProject((d) => void pageDraft(d).objects.push(u));
  setState({ selection: [u.id], selectedPorts: [] });
  if (!sized) toast(`${def.manufacturer} ${def.model} has no rack size yet — placed as 1RU. Set its size in the unit's properties.`, 'info', 6000);
  return u.id;
}

/** A library block dropped on a rack (or Rack mode): a new device, mounted. */
export function mountFromLibrary(def: BlockDef, p: { x: number; y: number }): Id | null {
  const s = getState();
  const existing = Object.values(s.project.blockDefs).find((b) => b.libraryId === def.id);
  const pdef = existing ?? { ...cloneDef(def), libraryId: def.id };
  const dev: ProjectDevice = { id: newId('dv'), defId: pdef.id, name: uniqueDeviceName(s.project, def.defaultName || def.model || 'DEVICE') };
  const page = currentPage(s);
  const sp = rackSpecOf(pdef);
  const slots = slotsOf(sp.width);
  const at = landing(s.project, page, sp.ru, slots, p, new Set());
  if (!at.ok) {
    toast(`No room for a ${sp.ru}U unit in this rack.`, 'warn');
    return null;
  }
  const scale = at.rack?.scale ?? DEFAULT_RACK_SCALE;
  const u: RackUnitObj = {
    id: newId('ob'),
    kind: 'rackunit',
    deviceId: dev.id,
    rackId: at.rack?.id ?? null,
    u: at.u,
    slot: at.slot,
    fill: null,
    color: '#000000',
    scale,
    x: p.x - ((19 / slots) * scale) / 2,
    y: p.y - (sp.ru * 1.75 * scale) / 2,
  };
  nextLabel(`Mount ${dev.name} (${def.manufacturer} ${def.model})`);
  updateProject((d) => {
    if (!existing) d.blockDefs[pdef.id] = pdef;
    d.devices[dev.id] = dev;
    pageDraft(d).objects.push(u);
  });
  setState({ selection: [u.id], selectedPorts: [] });
  if (!sp.set) toast(`${def.manufacturer} ${def.model} has no rack size yet — placed as 1RU. Set its size in the unit's properties.`, 'info', 6000);
  return u.id;
}

/**
 * After dragging units: each one dropped over a rack snaps into the nearest free space there
 * (keeping its relative order); dropped elsewhere it stays where it is, free-standing. Units that
 * don't fit go back to where they came from. Called inside the drag (no new history step).
 */
export function settleUnits(ids: Id[], origin: Map<Id, { rackId: Id | null; u: number; slot: number; x: number; y: number }>) {
  const s = getState();
  const page = currentPage(s);
  const moving = page.objects.filter((o): o is RackUnitObj => o.kind === 'rackunit' && ids.includes(o.id) && !o.rackId);
  if (!moving.length) return;
  const placed = new Map<Id, { rackId: Id | null; u: number; slot: number; scale: number; x: number; y: number }>();
  let refused = 0;
  // Settle top to bottom so stacked units keep their order.
  const order = [...moving].sort((a, b) => a.y - b.y);
  let scratch = page;
  for (const o of order) {
    const sp = unitSpec(s.project, o);
    const slots = slotsOf(sp.width);
    const face = unitRect(s.project, null, o);
    const c = { x: face.x + face.w / 2, y: face.y + face.h / 2 };
    const rack = rackAt(scratch, c, 4);
    if (!rack) {
      placed.set(o.id, { rackId: null, u: o.u, slot: o.slot, scale: o.scale, x: o.x, y: o.y });
      continue;
    }
    const want = wantedSlot(rack, sp.ru, slots, { x: face.x, y: face.y, w: rackLayout(rack).mount.w / slots, h: sp.ru * rackLayout(rack).ruH });
    const others = new Set(moving.map((m) => m.id).filter((id) => id !== o.id && !placed.has(id)));
    const free = nearestFree(s.project, scratch, rack, sp.ru, slots, want.u, want.slot, others);
    if (!free) {
      refused++;
      const og = origin.get(o.id);
      placed.set(o.id, og ? { rackId: og.rackId, u: og.u, slot: og.slot, scale: o.scale, x: og.x, y: og.y } : { rackId: null, u: o.u, slot: o.slot, scale: o.scale, x: o.x, y: o.y });
    } else placed.set(o.id, { rackId: rack.id, u: free.u, slot: free.slot, scale: rack.scale, x: o.x, y: o.y });
    // Later units see this one in its new place.
    const pl = placed.get(o.id)!;
    scratch = { ...scratch, objects: scratch.objects.map((x) => (x.id === o.id ? { ...(x as RackUnitObj), ...pl } : x)) };
  }
  updateProject((d) => {
    for (const o of pageDraft(d).objects) {
      const pl = o.kind === 'rackunit' && placed.get(o.id);
      if (pl) Object.assign(o, pl);
    }
  }, false);
  if (refused) toast(`${refused === 1 ? 'That unit doesn’t' : `${refused} units don’t`} fit there — moved back.`, 'warn');
  const racked = [...placed.values()].filter((p) => p.rackId).length;
  if (racked) labelLast(moving.length === 1 ? `Move ${s.project.devices[moving[0].deviceId]?.name ?? 'unit'} in rack` : `Move ${moving.length} rack units`);
}

/** Change the rack size of a model (every device of that model in this project). */
export function setRackSpec(defId: Id, patch: Partial<RackSpec>) {
  const s = getState();
  const def = s.project.blockDefs[defId];
  if (!def) return;
  const cur = rackSpecOf(def);
  nextLabel(`Rack size of ${def.manufacturer} ${def.model}`);
  updateProject((d) => {
    const dd = d.blockDefs[defId];
    dd.rack = { ru: cur.ru, width: cur.width, depth: cur.depth || undefined, ...dd.rack, ...patch };
    if (!dd.rack.depth) delete dd.rack.depth;
  });
}

/** Move a unit to a given bottom RU / slot in its rack (if there's room). */
export function setUnitPosition(id: Id, u: number, slot: number): boolean {
  const s = getState();
  const page = currentPage(s);
  const o = page.objects.find((x): x is RackUnitObj => x.kind === 'rackunit' && x.id === id);
  const rack = o?.rackId ? (page.objects.find((x) => x.id === o.rackId) as RackObj | undefined) : undefined;
  if (!o || !rack) return false;
  const sp = unitSpec(s.project, o);
  const slots = slotsOf(sp.width);
  const fitsThere = nearestFree(s.project, page, rack, sp.ru, slots, u, slot, new Set([o.id]));
  if (!fitsThere || fitsThere.u !== u || fitsThere.slot !== slot) {
    toast(`RU ${u}${slots > 1 ? `, position ${slot + 1}` : ''} isn't free.`, 'warn');
    return false;
  }
  nextLabel(`Move ${s.project.devices[o.deviceId]?.name ?? 'unit'} to RU ${u}`);
  updateProject((d) => {
    const t = pageDraft(d).objects.find((x) => x.id === id);
    if (t?.kind === 'rackunit') Object.assign(t, { u, slot });
  });
  return true;
}

/** Units whose device size changed so they now overlap others / run out of the rack. */
export function rackProblems(project: Project, page: Page, rack: RackObj): string[] {
  const out: string[] = [];
  const cells = new Map<string, Id>();
  for (const o of page.objects) {
    if (o.kind !== 'rackunit' || o.rackId !== rack.id) continue;
    const sp = unitSpec(project, o);
    const name = project.devices[o.deviceId]?.name ?? '?';
    if (o.u + sp.ru - 1 > rack.ru) out.push(`${name} runs past the top of the rack.`);
    const slots = slotsOf(sp.width);
    const per = 6 / slots;
    for (let u = o.u; u < o.u + sp.ru; u++)
      for (let c = o.slot * per; c < (o.slot + 1) * per; c++) {
        const k = u + ':' + c;
        const other = cells.get(k);
        if (other && other !== o.id) {
          const msg = `${name} overlaps ${project.devices[(page.objects.find((x) => x.id === other) as RackUnitObj).deviceId]?.name ?? '?'}.`;
          if (!out.includes(msg)) out.push(msg);
        }
        cells.set(k, o.id);
      }
  }
  return out;
}
