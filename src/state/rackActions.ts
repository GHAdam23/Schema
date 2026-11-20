// Rack elevations: adding racks, mounting devices / accessories / images, moving units between spaces.
// Nothing is placed automatically: a unit goes exactly where it's dropped, or not at all.
import type { Draft } from 'immer';
import type { Asset, BlockDef, Id, Page, Project, ProjectDevice, RackAccessory, RackObj, RackSpec, RackUnitObj } from '../model/types';
import { newId } from '../model/ids';
import { cloneDef } from '../model/project';
import {
  ACCESSORY_NAMES,
  DEFAULT_RACK_DEPTH,
  DEFAULT_RACK_SCALE,
  PANEL_IN,
  RU_IN,
  cellsOf,
  fits,
  isCustom,
  rackAt,
  rackSpecOf,
  shelfLanding,
  slotsOf,
  specSize,
  unitName,
  unitRect,
  unitSpec,
  wantedSlot,
  type UnitSpec,
} from '../model/rack';
import { currentPage, getState, labelLast, nextLabel, setState, toast, updateProject } from './store';
import { plural, uniqueDeviceName } from './actions';

type P = { x: number; y: number };

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
    depth: DEFAULT_RACK_DEPTH,
    scale: DEFAULT_RACK_SCALE,
  };
  nextLabel(`Add rack (${ru}U)`);
  // Racks go behind everything else, like containers.
  updateProject((d) => void pageDraft(d).objects.unshift(r));
  setState({ selection: [r.id], selectedPorts: [] });
  return r.id;
}

/**
 * Where a unit of a given size lands when its face is at `face` (page points): in the rack under
 * the face's centre at exactly that space, or free-standing on the page. `null` = over a rack but
 * that space isn't free.
 */
function landing(project: Project, page: Page, sp: UnitSpec, face: { x: number; y: number; w: number; h: number }, except: Set<Id>) {
  const c = { x: face.x + face.w / 2, y: face.y + face.h / 2 };
  const rack = rackAt(page, c, 4);
  if (!rack) return { rack: null as RackObj | null, u: 1, slot: 0, at: undefined as P | undefined };
  if (isCustom(sp)) {
    const sz = specSize(sp, rack.scale);
    return { rack, u: 1, slot: 0, at: shelfLanding(project, page, rack, { x: face.x, y: face.y, ...sz }) };
  }
  const slots = slotsOf(sp.width);
  const sz = specSize(sp, rack.scale);
  // Scale the face to the rack's scale about its centre before working out the space.
  const want = wantedSlot(rack, sp.ru, slots, { x: c.x - sz.w / 2, y: c.y - sz.h / 2, ...sz });
  if (!fits(project, page, rack, want.u, sp.ru, want.slot, slots, except)) return null;
  return { rack, u: want.u, slot: want.slot, at: undefined };
}

function blankUnit(fields: Partial<RackUnitObj>): RackUnitObj {
  return { id: newId('ob'), kind: 'rackunit', deviceId: '', rackId: null, u: 1, slot: 0, fill: null, color: '#000000', scale: DEFAULT_RACK_SCALE, x: 0, y: 0, ...fields };
}

/** Drop a new unit centred at `p`: into the rack there (that exact space) or free on the page. */
function dropUnit(project: Project, page: Page, unit: RackUnitObj, sp: UnitSpec, p: P): RackUnitObj | null {
  const rack = rackAt(page, p, 4);
  const k = rack?.scale ?? DEFAULT_RACK_SCALE;
  const sz = specSize(sp, k);
  const face = { x: p.x - sz.w / 2, y: p.y - sz.h / 2, ...sz };
  const at = landing(project, page, sp, face, new Set());
  if (!at) return null;
  return { ...unit, rackId: at.rack?.id ?? null, u: at.u, slot: at.slot, at: at.at, scale: k, x: face.x, y: face.y };
}

function noRoom(what: string, sp: UnitSpec) {
  toast(`That space isn't free for ${what} (${sp.ru}U${slotsOf(sp.width) > 1 ? `, ${sp.width} width` : ''}). Drop it on an empty space.`, 'warn');
}

/** Mount an existing project device at a point (one rack unit per device per page). */
export function mountDevice(deviceId: Id, p: P): Id | null {
  const s = getState();
  const page = currentPage(s);
  const dev = s.project.devices[deviceId];
  if (!dev) return null;
  const already = page.objects.find((o): o is RackUnitObj => o.kind === 'rackunit' && o.deviceId === deviceId);
  if (already) {
    toast(`${dev.name || 'That device'} is already in a rack on this page.`, 'warn');
    setState({ selection: [already.id], selectedPorts: [] });
    return null;
  }
  const def = s.project.blockDefs[dev.defId];
  const sp = rackSpecOf(def);
  const u = dropUnit(s.project, page, blankUnit({ deviceId }), sp, p);
  if (!u) {
    noRoom(dev.name || def.model, sp);
    return null;
  }
  nextLabel(`Mount ${dev.name || def.model} in ${u.rackId ? 'rack' : 'the page'}`);
  updateProject((d) => void pageDraft(d).objects.push(u));
  setState({ selection: [u.id], selectedPorts: [] });
  if (!sp.set) unsized(def);
  return u.id;
}

function unsized(def: BlockDef) {
  toast(`${def.manufacturer} ${def.model} has no rack size yet — placed as 1U. Set its size in the unit's properties.`, 'info', 6000);
}

/**
 * Library blocks dropped on a rack: new devices, mounted from the drop point downwards (each just
 * below the previous one). Ones that don't fit are skipped.
 */
export function mountFromLibrary(defs: BlockDef[], p: P): Id[] {
  const s = getState();
  let project = s.project;
  let page = currentPage(s);
  const newDefs: BlockDef[] = [];
  const devices: ProjectDevice[] = [];
  const units: RackUnitObj[] = [];
  let at = p;
  let skipped = 0;
  const unsizedDefs: BlockDef[] = [];
  for (const def of defs) {
    const existing = Object.values(project.blockDefs).find((b) => b.libraryId === def.id) ?? newDefs.find((b) => b.libraryId === def.id);
    const pdef = existing ?? { ...cloneDef(def), libraryId: def.id };
    const sp = rackSpecOf(pdef);
    const dev: ProjectDevice = { id: newId('dv'), defId: pdef.id, name: uniqueDeviceName(project, '') };
    // Scratch project with what's been placed so far, so later units see earlier ones.
    const scratch: Project = { ...project, blockDefs: { ...project.blockDefs, [pdef.id]: pdef }, devices: { ...project.devices, [dev.id]: dev } };
    const u = dropUnit(scratch, page, blankUnit({ deviceId: dev.id }), sp, at);
    const k = u?.scale ?? DEFAULT_RACK_SCALE;
    if (!u) {
      skipped++;
      at = { x: at.x, y: at.y + specSize(sp, k).h };
      continue;
    }
    if (!existing) newDefs.push(pdef);
    if (!sp.set) unsizedDefs.push(def);
    devices.push(dev);
    units.push(u);
    project = scratch;
    page = { ...page, objects: [...page.objects, u] };
    const face = unitRect(scratch, page, u);
    at = { x: at.x, y: face.y + face.h + specSize(sp, k).h / 2 };
  }
  if (!units.length) {
    toast(defs.length > 1 ? 'No room there for those units. Drop them on empty spaces.' : "That space isn't free. Drop it on an empty space.", 'warn');
    return [];
  }
  nextLabel(units.length === 1 ? `Mount ${defs[0].manufacturer} ${defs[0].model}` : `Mount ${units.length} units`);
  updateProject((d) => {
    for (const nd of newDefs) d.blockDefs[nd.id] = nd;
    for (const dv of devices) d.devices[dv.id] = dv;
    pageDraft(d).objects.push(...units);
  });
  setState({ selection: units.map((u) => u.id), selectedPorts: [] });
  if (skipped) toast(`${plural(skipped, 'unit')} didn't fit below the others and weren't placed.`, 'warn', 5000);
  else if (unsizedDefs.length) unsized(unsizedDefs[0]);
  return units.map((u) => u.id);
}

/** Rack hardware (blank / brush / vent panel, shelf) dropped at a point. */
export function addAccessory(type: RackAccessory, ru: number, p: P): Id | null {
  const s = getState();
  const page = currentPage(s);
  const unit = blankUnit({ accessory: type, size: { ru } });
  const sp = unitSpec(s.project, unit);
  const u = dropUnit(s.project, page, unit, sp, p);
  if (!u) {
    noRoom(`a ${ru}U ${ACCESSORY_NAMES[type].toLowerCase()}`, sp);
    return null;
  }
  nextLabel(`Add ${ru}U ${ACCESSORY_NAMES[type].toLowerCase()}`);
  updateProject((d) => void pageDraft(d).objects.push(u));
  setState({ selection: [u.id], selectedPorts: [] });
  return u.id;
}

/** RU height an image of this aspect ratio fills at full rack width. */
function imageRu(a: Asset) {
  return Math.max(1, Math.round((PANEL_IN * (a.h / a.w)) / RU_IN));
}

/** An imported front-panel picture (PNG / JPG / PDF / SVG) dropped on a rack: a unit showing it. */
export function mountImage(asset: Asset, assetId: Id, name: string, p: P): Id | null {
  const s = getState();
  const page = currentPage(s);
  const unit = blankUnit({ assetId, size: { ru: imageRu(asset) }, label: name.replace(/\.[^.]+$/, '') });
  const sp = unitSpec({ ...s.project, assets: { ...s.project.assets, [assetId]: asset } }, unit);
  const u = dropUnit(s.project, page, unit, sp, p);
  if (!u) {
    noRoom(name, sp);
    return null;
  }
  nextLabel(`Mount image ${name}`);
  updateProject((d) => {
    d.assets[assetId] = asset;
    pageDraft(d).objects.push(u);
  });
  setState({ selection: [u.id], selectedPorts: [] });
  return u.id;
}

/** An image object on the page dragged onto a rack becomes a rack unit showing it (if that space is free). */
export function imageIntoRack(imageId: Id): boolean {
  const s = getState();
  const page = currentPage(s);
  const img = page.objects.find((o) => o.id === imageId);
  if (img?.kind !== 'image') return false;
  const a = s.project.assets[img.assetId];
  const c = { x: img.x + img.w / 2, y: img.y + img.h / 2 };
  const rack = rackAt(page, c, 0);
  if (!rack || !a) return false;
  const unit = blankUnit({ assetId: img.assetId, size: { ru: imageRu(a) } });
  const sp = unitSpec(s.project, unit);
  const u = dropUnit(s.project, page, unit, sp, c);
  if (!u) {
    noRoom('that image', sp);
    return false;
  }
  updateProject((d) => {
    const pg = pageDraft(d);
    pg.objects = pg.objects.filter((o) => o.id !== imageId);
    pg.objects.push(u);
  }, false);
  labelLast('Mount image in rack');
  setState({ selection: [u.id], selectedPorts: [] });
  return true;
}

/**
 * After dragging units: each one dropped over a rack goes into the space it was dropped on (shelf
 * gear onto the shelf below it); dropped elsewhere it stays free-standing. A unit whose space isn't
 * free goes back to where it came from. Called inside the drag (no new history step).
 */
export function settleUnits(ids: Id[], origin: Map<Id, { rackId: Id | null; u: number; slot: number; x: number; y: number; at?: P }>) {
  const s = getState();
  const page = currentPage(s);
  const moving = page.objects.filter((o): o is RackUnitObj => o.kind === 'rackunit' && ids.includes(o.id) && !o.rackId);
  if (!moving.length) return;
  type Pl = Pick<RackUnitObj, 'rackId' | 'u' | 'slot' | 'x' | 'y' | 'at'>;
  const placed = new Map<Id, Pl>();
  let refused = 0;
  let scratch = page;
  for (const o of [...moving].sort((a, b) => a.y - b.y)) {
    const sp = unitSpec(s.project, o);
    const face = unitRect(s.project, null, o);
    const others = new Set(moving.map((m) => m.id).filter((id) => id !== o.id && !placed.has(id)));
    const at = landing(s.project, scratch, sp, face, others);
    let pl: Pl;
    if (!at) {
      refused++;
      const og = origin.get(o.id);
      pl = og ? { rackId: og.rackId, u: og.u, slot: og.slot, x: og.x, y: og.y, at: og.at } : { rackId: null, u: o.u, slot: o.slot, x: o.x, y: o.y, at: o.at };
    } else pl = { rackId: at.rack?.id ?? null, u: at.u, slot: at.slot, x: o.x, y: o.y, at: at.at ?? o.at };
    placed.set(o.id, pl);
    scratch = { ...scratch, objects: scratch.objects.map((x) => (x.id === o.id ? { ...(x as RackUnitObj), ...pl } : x)) };
  }
  updateProject((d) => {
    for (const o of pageDraft(d).objects) {
      const pl = o.kind === 'rackunit' && placed.get(o.id);
      if (pl) Object.assign(o, pl);
    }
  }, false);
  if (refused) toast(`${refused === 1 ? "That space isn't" : `${refused} of those spaces aren't`} free — moved back.`, 'warn');
  const racked = [...placed.values()].filter((p) => p.rackId).length;
  if (racked) labelLast(moving.length === 1 ? `Move ${unitName(s.project, moving[0])} in rack` : `Move ${moving.length} rack units`);
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
    dd.rack = { ru: cur.ru, width: cur.width, ...dd.rack, ...patch };
    if (!dd.rack.depth) delete dd.rack.depth;
    if (dd.rack.width !== 'custom') {
      delete dd.rack.w;
      delete dd.rack.h;
    } else {
      dd.rack.w ??= cur.w;
      dd.rack.h ??= cur.h;
    }
  });
}

/** Size of an accessory / image unit. */
export function setUnitSize(id: Id, patch: Partial<NonNullable<RackUnitObj['size']>>) {
  nextLabel('Rack unit size');
  updateProject((d) => {
    const t = pageDraft(d).objects.find((x) => x.id === id);
    if (t?.kind !== 'rackunit' || !t.size) return;
    Object.assign(t.size, patch);
    if (!t.size.depth) delete t.size.depth;
  });
}

/** Move a unit to a given bottom RU / slot in its rack (if that space is free). */
export function setUnitPosition(id: Id, u: number, slot: number): boolean {
  const s = getState();
  const page = currentPage(s);
  const o = page.objects.find((x): x is RackUnitObj => x.kind === 'rackunit' && x.id === id);
  const rack = o?.rackId ? (page.objects.find((x) => x.id === o.rackId) as RackObj | undefined) : undefined;
  if (!o || !rack) return false;
  const sp = unitSpec(s.project, o);
  const slots = slotsOf(sp.width);
  if (!fits(s.project, page, rack, u, sp.ru, slot, slots, new Set([o.id]))) {
    toast(`RU ${u}${slots > 1 ? `, position ${slot + 1}` : ''} isn't free.`, 'warn');
    return false;
  }
  nextLabel(`Move ${unitName(s.project, o)} to RU ${u}`);
  updateProject((d) => {
    const t = pageDraft(d).objects.find((x) => x.id === id);
    if (t?.kind === 'rackunit') Object.assign(t, { u, slot });
  });
  return true;
}

/** Units that overlap others / run out of the rack (e.g. after a size change), and units deeper than the rack. */
export function rackProblems(project: Project, page: Page, rack: RackObj): string[] {
  const out: string[] = [];
  const cells = new Map<string, RackUnitObj>();
  for (const o of page.objects) {
    if (o.kind !== 'rackunit' || o.rackId !== rack.id) continue;
    const sp = unitSpec(project, o);
    const name = unitName(project, o);
    if (sp.depth > rack.depth) out.push(`${name} is ${sp.depth}″ deep — deeper than the rack (${rack.depth}″).`);
    if (isCustom(sp)) continue;
    if (o.u + sp.ru - 1 > rack.ru) out.push(`${name} runs past the top of the rack.`);
    for (const [u, c] of cellsOf(o.u, sp.ru, o.slot, slotsOf(sp.width))) {
      const k = u + ':' + c;
      const other = cells.get(k);
      if (other && other.id !== o.id) {
        const msg = `${name} overlaps ${unitName(project, other)}.`;
        if (!out.includes(msg)) out.push(msg);
      }
      cells.set(k, o);
    }
  }
  return out;
}

