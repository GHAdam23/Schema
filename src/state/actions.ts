import type { Draft } from 'immer';
import type {
  Asset,
  BlockDef,
  BlockObj,
  Bundle,
  CalloutObj,
  Connection,
  ContainerObj,
  EllipseObj,
  Endpoint,
  Id,
  ImageObj,
  Page,
  PageObject,
  PageSizeId,
  Project,
  ProjectDevice,
  RectObj,
  StrokeStyle,
  TagObj,
  TextObj,
} from '../model/types';
import { isPortEndpoint } from '../model/types';
import { newId } from '../model/ids';
import { cloneDef, newPage } from '../model/project';
import { DEFAULT_BLOCK_BORDER, DEFAULT_LINE, DEFAULT_RECT_BORDER, drawingArea } from '../model/defaults';
import { findPort } from '../model/blockGeometry';
import { axisOf, objBounds, resolveEndpoint, resolvePageRoutes, straightenDelta, type ResolvedRoute } from '../model/routing';
import { normDeg, rotOf } from '../model/geom';
import { devicePages, tagSize, tagTargetPage, tagText } from '../model/tags';
import { labelBox, labelTAt } from '../render/buildPage';
import { currentPage, defaultLabel, getState, labelLast, nextLabel, setState, toast, updateProject, type PortRef } from './store';
import { saveLibrary } from '../io/libraryStore';

type D = Draft<Project>;

function pageDraft(d: D, pageId = getState().pageId): Draft<Page> {
  return d.pages.find((p) => p.id === pageId) ?? d.pages[0];
}

// ---------------------------------------------------------------------------------------------
// Pages

export function setPage(id: Id) {
  setState({ pageId: id, selection: [], selectedPorts: [] });
}

export function addPage() {
  nextLabel('Add page');
  const s = getState();
  const pg = newPage(`Page ${s.project.pages.length + 1}`, currentPage().size);
  updateProject((d) => {
    const i = d.pages.findIndex((p) => p.id === s.pageId);
    d.pages.splice(i + 1, 0, pg);
  });
  setPage(pg.id);
}

export function duplicatePage(id: Id) {
  nextLabel('Duplicate page');
  const s = getState();
  const src = s.project.pages.find((p) => p.id === id);
  if (!src) return;
  const copy = copyObjectsInto(s.project, src.objects, src.connections, 0, 0, src.bundles ?? []);
  const pg: Page = { ...newPage(src.name + ' (copy)', src.size), objects: copy.objects, connections: copy.connections, bundles: copy.bundles };
  updateProject((d) => {
    Object.assign(d.devices, copy.devices);
    const i = d.pages.findIndex((p) => p.id === id);
    d.pages.splice(i + 1, 0, pg as Draft<Page>);
  });
  setPage(pg.id);
}

export function renamePage(id: Id, name: string) {
  nextLabel(`Rename page to "${name}"`);
  updateProject((d) => {
    const p = d.pages.find((p) => p.id === id);
    if (p) p.name = name;
  });
}

export function setPageSize(id: Id, size: PageSizeId) {
  nextLabel('Change page size');
  updateProject((d) => {
    const p = d.pages.find((p) => p.id === id);
    if (p) p.size = size;
  });
}

export function deletePage(id: Id) {
  const s = getState();
  if (s.project.pages.length <= 1) {
    toast('A project needs at least one page.', 'warn');
    return;
  }
  const i = s.project.pages.findIndex((p) => p.id === id);
  updateProject((d) => {
    d.pages.splice(i, 1);
    gc(d);
  });
  const pages = getState().project.pages;
  if (s.pageId === id) setPage(pages[Math.min(i, pages.length - 1)].id);
}

export function movePage(from: number, to: number) {
  nextLabel('Reorder pages');
  updateProject((d) => {
    const [p] = d.pages.splice(from, 1);
    d.pages.splice(to, 0, p);
  });
}

// ---------------------------------------------------------------------------------------------
// Objects

/** Place a block. `def` may be a library definition (copied into the project) or a project def. */
export function placeBlock(def: BlockDef, x: number, y: number, fromLibrary = true): Id {
  const s = getState();
  let defId = def.id;
  let newDef: BlockDef | null = null;
  if (fromLibrary) {
    // Reuse an existing project copy of this library definition, if unchanged in the project.
    const existing = Object.values(s.project.blockDefs).find((b) => b.libraryId === def.id);
    if (existing) defId = existing.id;
    else {
      newDef = { ...cloneDef(def), libraryId: def.id };
      defId = newDef.id;
    }
  }
  const dev: ProjectDevice = { id: newId('dv'), defId, name: uniqueDeviceName(s.project, def.defaultName || def.model || 'DEVICE') };
  const obj: BlockObj = { id: newId('ob'), kind: 'block', deviceId: dev.id, x, y, scale: 1, border: { ...DEFAULT_BLOCK_BORDER } };
  nextLabel(`Add ${dev.name} (${def.manufacturer} ${def.model})`);
  updateProject((d) => {
    if (newDef) d.blockDefs[newDef.id] = newDef;
    d.devices[dev.id] = dev;
    pageDraft(d).objects.push(obj);
  });
  setState({ selection: [obj.id], selectedPorts: [] });
  return obj.id;
}

export function uniqueDeviceName(p: Project, base: string): string {
  const names = new Set(Object.values(p.devices).map((d) => d.name));
  if (!names.has(base)) return base;
  const m = base.match(/^(.*?)(\d+)$/);
  const stem = m ? m[1] : base + ' ';
  let n = m ? parseInt(m[2], 10) + 1 : 2;
  while (names.has(stem + n)) n++;
  return stem + n;
}

export function addText(x: number, y: number, text = 'Text'): Id {
  nextLabel('Add text box');
  const o: TextObj = {
    id: newId('ob'),
    kind: 'text',
    x,
    y,
    w: 108,
    h: 27,
    text,
    fontSize: 9,
    bold: false,
    align: 'left',
    valign: 'top',
    wrap: false,
    color: '#000000',
    border: null,
    fill: null,
  };
  updateProject((d) => {
    pageDraft(d).objects.push(o);
  });
  setState({ selection: [o.id], selectedPorts: [] });
  return o.id;
}

export function addRect(x: number, y: number, w = 108, h = 72): Id {
  nextLabel('Add rectangle');
  const o: RectObj = {
    id: newId('ob'),
    kind: 'rect',
    x,
    y,
    w,
    h,
    border: { ...DEFAULT_RECT_BORDER },
    fill: null,
    text: '',
    fontSize: 9,
    bold: false,
    align: 'center',
    valign: 'middle',
    color: '#000000',
  };
  updateProject((d) => {
    pageDraft(d).objects.push(o);
  });
  setState({ selection: [o.id], selectedPorts: [] });
  return o.id;
}

const textDefaults = { text: '', fontSize: 9, bold: false, align: 'center' as const, valign: 'middle' as const, color: '#000000' };

export function addEllipse(x: number, y: number, w = 90, h = 54): Id {
  nextLabel('Add ellipse');
  const o: EllipseObj = { id: newId('ob'), kind: 'ellipse', x, y, w, h, border: { ...DEFAULT_RECT_BORDER }, fill: null, ...textDefaults };
  updateProject((d) => void pageDraft(d).objects.push(o));
  setState({ selection: [o.id], selectedPorts: [] });
  return o.id;
}

/** A labelled grouping frame. Goes behind everything so what's inside stays clickable. */
export function addContainer(x: number, y: number, w = 216, h = 144): Id {
  nextLabel('Add container');
  const o: ContainerObj = {
    id: newId('ob'),
    kind: 'container',
    x,
    y,
    w,
    h,
    border: { color: '#000000', width: 1, dash: 'dashed' },
    fill: null,
    headerFill: '#e2e8f0',
    ...textDefaults,
    text: 'Container',
    align: 'left',
    bold: true,
  };
  updateProject((d) => void pageDraft(d).objects.unshift(o));
  setState({ selection: [o.id], selectedPorts: [] });
  return o.id;
}

export function addCallout(x: number, y: number): Id {
  nextLabel('Add callout');
  const o: CalloutObj = {
    id: newId('ob'),
    kind: 'callout',
    x,
    y,
    w: 108,
    h: 36,
    border: { color: '#000000', width: 0.75, dash: 'solid' },
    fill: '#ffffff',
    tail: { x: -36, y: 60 },
    ...textDefaults,
    text: 'Note',
    wrap: true,
  };
  updateProject((d) => void pageDraft(d).objects.push(o));
  setState({ selection: [o.id], selectedPorts: [] });
  return o.id;
}

/** Add an imported image / PDF page / SVG. The asset is stored in the project. */
export function addImage(asset: Asset, x: number, y: number, name = 'image'): Id {
  const assetId = newId('as');
  const area = drawingArea(currentPage().size);
  // Natural size (PDF/SVG in points, images at 96 dpi), scaled down to fit the drawing area.
  const nat = asset.mime.startsWith('image/') && asset.mime !== 'image/svg+xml' ? { w: asset.w * 0.75, h: asset.h * 0.75 } : { w: asset.w, h: asset.h };
  const k = Math.min(1, (area.w * 0.8) / nat.w, (area.h * 0.8) / nat.h);
  const o: ImageObj = { id: newId('ob'), kind: 'image', x, y, w: Math.round(nat.w * k), h: Math.round(nat.h * k), assetId, border: null };
  nextLabel(`Import ${name}`);
  updateProject((d) => {
    d.assets[assetId] = asset;
    pageDraft(d).objects.push(o);
  });
  setState({ selection: [o.id], selectedPorts: [] });
  return o.id;
}

export function addTag(x: number, y: number, target: TagObj['target'] = null, record = true): Id {
  nextLabel('Add reference tag');
  const o: TagObj = {
    id: newId('ob'),
    kind: 'tag',
    x,
    y,
    target,
    dir: 'auto',
    showPort: true,
    note: '',
    fontSize: 7,
    border: { color: '#000000', width: 0.75, dash: 'solid' },
    fill: null,
  };
  updateProject((d) => void pageDraft(d).objects.push(o), record);
  setState({ selection: [o.id], selectedPorts: [] });
  return o.id;
}

/**
 * Change a tag. Its width follows its text, so when a line is attached to its right side the
 * right edge stays put (the tag grows away from the line).
 */
export function patchTag(id: Id, fn: (t: Draft<TagObj>) => void, label = 'Change tag') {
  const s = getState();
  const page = currentPage(s);
  const before = page.objects.find((o) => o.id === id);
  if (!before || before.kind !== 'tag') return;
  const w0 = tagSize(s.project, before).w;
  const rightAttached = page.connections.some((c) => [c.from, c.to].some((e) => e.objId === id && !isPortEndpoint(e) && e.fx === 1));
  nextLabel(label);
  updateProject((d) => {
    const t = pageDraft(d).objects.find((o) => o.id === id);
    if (t?.kind === 'tag') fn(t);
  });
  if (!rightAttached) return;
  const after = currentPage().objects.find((o) => o.id === id) as TagObj;
  const dw = tagSize(getState().project, after).w - w0;
  if (dw) updateProject((d) => void (pageDraft(d).objects.find((o) => o.id === id)!.x -= dw), false);
}

export function setTagTarget(id: Id, target: TagObj['target']) {
  const p = getState().project;
  const dev = target && p.devices[target.deviceId];
  patchTag(id, (o) => void (o.target = target), dev ? `Point tag to ${dev.name}` : 'Clear tag target');
}

/** Go to the page of a tag's device and select the instance there (and its port). */
export function jumpToTag(tag: TagObj) {
  const p = getState().project;
  const pi = tagTargetPage(p, tag);
  if (!tag.target || pi < 0) {
    toast('This tag doesn’t point to a device yet.', 'warn');
    return;
  }
  const pg = p.pages[pi];
  const inst = pg.objects.find((o) => o.kind === 'block' && o.deviceId === tag.target!.deviceId);
  setState({
    pageId: pg.id,
    selection: inst ? [inst.id] : [],
    selectedPorts: inst && tag.target.portId ? [{ objId: inst.id, portId: tag.target.portId }] : [],
  });
}

/** Place another instance of a project device on the current page (same device, so renaming etc. is shared). */
export function placeInstance(deviceId: Id, x: number, y: number): Id | null {
  const s = getState();
  const dev = s.project.devices[deviceId];
  if (!dev) return null;
  const pg = currentPage(s);
  const existing = pg.objects.find((o) => o.kind === 'block' && o.deviceId === deviceId);
  if (existing) {
    toast(`${dev.name} is already on this page.`, 'warn');
    setState({ selection: [existing.id], selectedPorts: [] });
    return null;
  }
  const other = s.project.pages.flatMap((p) => p.objects).find((o): o is BlockObj => o.kind === 'block' && o.deviceId === deviceId);
  const obj: BlockObj = { id: newId('ob'), kind: 'block', deviceId, x, y, scale: other?.scale ?? 1, border: { ...(other?.border ?? DEFAULT_BLOCK_BORDER) } };
  nextLabel(`Place ${dev.name} on this page too`);
  updateProject((d) => void pageDraft(d).objects.push(obj));
  setState({ selection: [obj.id], selectedPorts: [] });
  return obj.id;
}

export function setRotation(ids: Id[], deg: number | ((cur: number) => number), record = true) {
  defaultLabel('Rotate');
  patchObjects(
    ids,
    (o) => {
      if (o.kind === 'block' || o.kind === 'tag') return;
      const r = normDeg(typeof deg === 'function' ? deg(o.rot ?? 0) : deg);
      o.rot = Math.round(r * 100) / 100;
    },
    record,
  );
}

export function setCurved(ids: Id[], curved: boolean) {
  nextLabel(curved ? 'Curved line' : 'Right-angle line');
  patchConnections(ids, (c) => {
    c.curved = curved || undefined;
    if (curved) c.labelT = null;
  });
}

export function deleteSelection() {
  const s = getState();
  const page0 = currentPage(s);
  // A selected snake trunk stands for its lines.
  const trunkLines = (page0.bundles ?? []).filter((b) => s.selection.includes(b.id)).flatMap((b) => b.connIds);
  const sel = new Set([...s.selection, ...trunkLines]);
  if (!sel.size) return;
  const page = page0;
  const objs = page.objects.filter((o) => sel.has(o.id));
  const alive = new Set(page.objects.filter((o) => !sel.has(o.id)).map((o) => o.id));
  const lines = page.connections.filter((c) => sel.has(c.id) || !alive.has(c.from.objId) || !alive.has(c.to.objId));
  nextLabel(`Delete ${plural(objs.length, 'object')}${lines.length ? `, ${plural(lines.length, 'line')}` : ''}`, [
    ...objs.map((o) => describeObject(s.project, o)),
    ...lines.map((c) => 'Line: ' + describeConnection(s.project, page, c)),
  ]);
  updateProject((d) => {
    const pg = pageDraft(d);
    pg.objects = pg.objects.filter((o) => !sel.has(o.id));
    const alive = new Set(pg.objects.map((o) => o.id));
    pg.connections = pg.connections.filter((c) => !sel.has(c.id) && alive.has(c.from.objId) && alive.has(c.to.objId));
    pg.bundles = (pg.bundles ?? []).filter((b) => !sel.has(b.id));
    gc(d);
  });
  setState({ selection: [], selectedPorts: [] });
}

/** Remove unreferenced devices/defs and dangling connections. */
export function gc(d: D) {
  const usedDevices = new Set<string>();
  for (const pg of d.pages) for (const o of pg.objects) if (o.kind === 'block') usedDevices.add(o.deviceId);
  for (const id of Object.keys(d.devices)) if (!usedDevices.has(id)) delete d.devices[id];
  const usedDefs = new Set(Object.values(d.devices).map((v) => v.defId));
  for (const id of Object.keys(d.blockDefs)) if (!usedDefs.has(id)) delete d.blockDefs[id];
  for (const pg of d.pages) {
    const objs = new Map(pg.objects.map((o) => [o.id, o]));
    pg.connections = pg.connections.filter((c) => endpointAlive(d, objs, c.from) && endpointAlive(d, objs, c.to));
    pruneBundles(pg);
  }
  // Imported images no longer used (the logo is kept).
  const usedAssets = new Set<string>(d.info.logoAssetId ? [d.info.logoAssetId] : []);
  for (const pg of d.pages) for (const o of pg.objects) if (o.kind === 'image') usedAssets.add(o.assetId);
  for (const id of Object.keys(d.assets)) if (!usedAssets.has(id)) delete d.assets[id];
}

/** Bundles lose deleted lines; a bundle with fewer than two lines left is dissolved. */
function pruneBundles(pg: Draft<Page>) {
  pg.bundles ??= [];
  const ids = new Set(pg.connections.map((c) => c.id));
  for (const b of pg.bundles) b.connIds = b.connIds.filter((id) => ids.has(id));
  pg.bundles = pg.bundles.filter((b) => b.connIds.length >= 2);
}

function endpointAlive(d: D, objs: Map<string, Draft<PageObject>>, e: Endpoint) {
  const o = objs.get(e.objId);
  if (!o) return false;
  if (!isPortEndpoint(e)) return o.kind !== 'block';
  if (o.kind !== 'block') return false;
  const dev = d.devices[o.deviceId];
  const def = dev && d.blockDefs[dev.defId];
  return !!def && !!findPort(def as BlockDef, e.portId);
}

export function moveObjects(ids: Id[], dx: number, dy: number, record = true) {
  nextLabel('Nudge');
  const s = getState();
  const page = currentPage(s);
  const all = withContents(s.project, page, ids);
  const set = new Set(all);
  const carry = routesToCarry(s.project, page, all);
  updateProject((d) => {
    const pg = pageDraft(d);
    for (const o of pg.objects) {
      if (set.has(o.id)) {
        o.x += dx;
        o.y += dy;
      }
    }
    applyCarry(pg, carry, dx, dy);
  }, record);
}

/** The given objects plus everything inside the selected containers (fully inside its frame). */
export function withContents(project: Project, page: Page, ids: Id[]): Id[] {
  const out = new Set(ids);
  const queue = page.objects.filter((o) => out.has(o.id) && o.kind === 'container');
  while (queue.length) {
    const c = queue.pop()!;
    const b = objBounds(project, c);
    for (const o of page.objects) {
      if (out.has(o.id)) continue;
      const ob = objBounds(project, o);
      if (ob.x >= b.x && ob.y >= b.y && ob.x + ob.w <= b.x + b.w && ob.y + ob.h <= b.y + b.h) {
        out.add(o.id);
        if (o.kind === 'container') queue.push(o);
      }
    }
  }
  return [...out];
}

export interface Carry {
  conns: Map<Id, { bends: number[]; startH: boolean }>;
  bundles: Map<Id, number[]>;
}

/** Manual routes whose ends all move together: they move along instead of stretching. */
export function routesToCarry(project: Project, page: Page, ids: Id[]): Carry {
  const set = new Set(ids);
  const conns: Carry['conns'] = new Map();
  for (const c of page.connections) {
    if (!c.bends || !set.has(c.from.objId) || !set.has(c.to.objId)) continue;
    const a = resolveEndpoint(project, page, c.from);
    if (a) conns.set(c.id, { bends: [...c.bends], startH: axisOf(a) === 'h' });
  }
  const bundles: Carry['bundles'] = new Map();
  for (const b of page.bundles ?? []) {
    if (!b.bends) continue;
    const members = page.connections.filter((c) => b.connIds.includes(c.id));
    if (members.length && members.every((c) => set.has(c.from.objId) && set.has(c.to.objId))) bundles.set(b.id, [...b.bends]);
  }
  return { conns, bundles };
}

const shiftBends = (bends: number[], startH: boolean, dx: number, dy: number) => bends.map((v, i) => v + ((i % 2 === 0) === startH ? dx : dy));

export function applyCarry(pg: Draft<Page>, carry: Carry, dx: number, dy: number) {
  if (!carry.conns.size && !carry.bundles.size) return;
  for (const c of pg.connections) {
    const k = carry.conns.get(c.id);
    if (k) c.bends = shiftBends(k.bends, k.startH, dx, dy);
  }
  for (const b of pg.bundles ?? []) {
    const k = carry.bundles.get(b.id);
    if (k) b.bends = shiftBends(k, true, dx, dy);
  }
}

export function patchObjects(ids: Id[], patch: (o: Draft<PageObject>) => void, record = true) {
  defaultLabel('Change object');
  const set = new Set(ids);
  updateProject((d) => {
    for (const o of pageDraft(d).objects) if (set.has(o.id)) patch(o);
  }, record);
}

export function patchConnections(ids: Id[], patch: (c: Draft<Connection>) => void, record = true) {
  defaultLabel('Change line');
  const set = new Set(ids);
  updateProject((d) => {
    for (const c of pageDraft(d).connections) if (set.has(c.id)) patch(c);
  }, record);
}

export function setStroke(ids: Id[], style: Partial<StrokeStyle>) {
  defaultLabel('Change line/border style');
  const set = new Set(ids);
  updateProject((d) => {
    const pg = pageDraft(d);
    for (const o of pg.objects) {
      if (!set.has(o.id)) continue;
      if (o.kind === 'text' || o.kind === 'image') o.border = { ...(o.border ?? { color: '#000000', width: 1, dash: 'solid' }), ...style } as StrokeStyle;
      else o.border = { ...o.border, ...style } as StrokeStyle;
    }
    for (const c of pg.connections) if (set.has(c.id)) c.style = { ...c.style, ...style } as StrokeStyle;
    for (const b of pg.bundles ?? []) if (set.has(b.id)) b.style = { ...b.style, ...style } as StrokeStyle;
  });
}

export function renameDevice(deviceId: Id, name: string) {
  nextLabel(`Rename device "${getState().project.devices[deviceId]?.name}" → "${name}"`);
  updateProject((d) => {
    const dev = d.devices[deviceId];
    if (dev) dev.name = name;
  });
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function alignSelection(mode: AlignMode) {
  nextLabel('Align ' + mode);
  const s = getState();
  const page = currentPage();
  const objs = page.objects.filter((o) => s.selection.includes(o.id));
  // Only lines selected: align their labels instead.
  if (objs.length === 0) return alignLabels(mode);
  if (objs.length < 2) return;
  const bs = objs.map((o) => ({ o, b: objBounds(s.project, o) }));
  const minX = Math.min(...bs.map((x) => x.b.x));
  const maxX = Math.max(...bs.map((x) => x.b.x + x.b.w));
  const minY = Math.min(...bs.map((x) => x.b.y));
  const maxY = Math.max(...bs.map((x) => x.b.y + x.b.h));
  updateProject((d) => {
    const pg = pageDraft(d);
    for (const { o, b } of bs) {
      const t = pg.objects.find((x) => x.id === o.id)!;
      // Bounds may differ from x/y (rotated shapes): move by the difference.
      if (mode === 'left') t.x += minX - b.x;
      if (mode === 'right') t.x += maxX - b.w - b.x;
      if (mode === 'hcenter') t.x += (minX + maxX) / 2 - b.w / 2 - b.x;
      if (mode === 'top') t.y += minY - b.y;
      if (mode === 'bottom') t.y += maxY - b.h - b.y;
      if (mode === 'vcenter') t.y += (minY + maxY) / 2 - b.h / 2 - b.y;
    }
  });
}

/**
 * Line up the labels of the selected lines. Left/centre/right put label centres (or edges) on a
 * common x along horizontal runs; top/middle/bottom on a common y along vertical runs.
 */
export function alignLabels(mode: AlignMode) {
  nextLabel('Line up labels');
  const s = getState();
  const page = currentPage();
  const routes = resolvePageRoutes(s.project, page);
  const items = s.selection
    .map((id) => routes.get(id))
    .filter((r): r is ResolvedRoute => !!r && !!r.conn.label)
    .map((r) => ({ r, lb: labelBox(r)! }));
  if (items.length < 2) {
    toast('Select two or more labelled lines to align their labels.', 'warn');
    return;
  }
  const axis: 'x' | 'y' = mode === 'left' || mode === 'hcenter' || mode === 'right' ? 'x' : 'y';
  const lo = (i: (typeof items)[number]) => (axis === 'x' ? i.lb.box.x : i.lb.box.y);
  const hi = (i: (typeof items)[number]) => (axis === 'x' ? i.lb.box.x + i.lb.box.w : i.lb.box.y + i.lb.box.h);
  const minV = Math.min(...items.map(lo));
  const maxV = Math.max(...items.map(hi));
  let missed = 0;
  const ts = new Map<string, number>();
  for (const it of items) {
    const half = (hi(it) - lo(it)) / 2;
    const target = mode === 'left' || mode === 'top' ? minV + half : mode === 'right' || mode === 'bottom' ? maxV - half : (minV + maxV) / 2;
    const t = labelTAt(it.r, axis, target, it.lb.p);
    if (t === null) missed++;
    else ts.set(it.r.conn.id, t);
  }
  updateProject((d) => {
    for (const c of pageDraft(d).connections) if (ts.has(c.id)) c.labelT = ts.get(c.id)!;
  });
  if (missed) toast(`${missed} label(s) could not be moved there — the line has no ${axis === 'x' ? 'horizontal' : 'vertical'} run at that position.`, 'warn', 5000);
}

export function distributeSelection(axis: 'h' | 'v') {
  nextLabel('Distribute');
  const s = getState();
  const page = currentPage();
  const objs = page.objects.filter((o) => s.selection.includes(o.id));
  if (objs.length < 3) return;
  const bs = objs.map((o) => ({ o, b: objBounds(s.project, o) }));
  bs.sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
  const first = bs[0].b;
  const last = bs[bs.length - 1].b;
  const total = bs.reduce((acc, x) => acc + (axis === 'h' ? x.b.w : x.b.h), 0);
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gapSize = (span - total) / (bs.length - 1);
  updateProject((d) => {
    const pg = pageDraft(d);
    let pos = axis === 'h' ? first.x : first.y;
    for (const { o, b } of bs) {
      const t = pg.objects.find((x) => x.id === o.id)!;
      if (axis === 'h') t.x += pos - b.x;
      else t.y += pos - b.y;
      pos += (axis === 'h' ? b.w : b.h) + gapSize;
    }
  });
}

export function zOrder(mode: 'front' | 'back' | 'forward' | 'backward') {
  nextLabel('Stacking order: ' + mode);
  const sel = new Set(getState().selection);
  updateProject((d) => {
    const pg = pageDraft(d);
    const objs = pg.objects;
    if (mode === 'front') pg.objects = [...objs.filter((o) => !sel.has(o.id)), ...objs.filter((o) => sel.has(o.id))];
    else if (mode === 'back') pg.objects = [...objs.filter((o) => sel.has(o.id)), ...objs.filter((o) => !sel.has(o.id))];
    else if (mode === 'forward') {
      for (let i = objs.length - 2; i >= 0; i--) if (sel.has(objs[i].id) && !sel.has(objs[i + 1].id)) [objs[i], objs[i + 1]] = [objs[i + 1], objs[i]];
    } else {
      for (let i = 1; i < objs.length; i++) if (sel.has(objs[i].id) && !sel.has(objs[i - 1].id)) [objs[i], objs[i - 1]] = [objs[i - 1], objs[i]];
    }
  });
}

export function selectAll() {
  const pg = currentPage();
  setState({ selection: [...pg.objects.map((o) => o.id), ...pg.connections.map((c) => c.id), ...(pg.bundles ?? []).map((b) => b.id)], selectedPorts: [] });
}

// ---------------------------------------------------------------------------------------------
// Clipboard

interface ClipData {
  objects: PageObject[];
  connections: Connection[];
  bundles: Bundle[];
  project: Project;
}
let clip: ClipData | null = null;
let pasteCount = 0;

export function copySelection() {
  const s = getState();
  const pg = currentPage();
  const sel = new Set(s.selection);
  const objects = pg.objects.filter((o) => sel.has(o.id));
  if (!objects.length) return;
  const ids = new Set(objects.map((o) => o.id));
  const connections = pg.connections.filter((c) => ids.has(c.from.objId) && ids.has(c.to.objId));
  const cids = new Set(connections.map((c) => c.id));
  const bundles = (pg.bundles ?? []).filter((b) => b.connIds.every((id) => cids.has(id)));
  clip = { objects, connections, bundles, project: s.project };
  pasteCount = 0;
}

export function cutSelection() {
  copySelection();
  deleteSelection();
}

/** Copy objects (+ connections among them) with new ids. Blocks get new devices. */
function copyObjectsInto(project: Project, objects: readonly PageObject[], connections: readonly Connection[], dx: number, dy: number, bundles: readonly Bundle[] = []) {
  const idMap = new Map<string, string>();
  const devices: Record<string, ProjectDevice> = {};
  const scratch = { ...project, devices: { ...project.devices } };
  const outObjs: PageObject[] = objects.map((o) => {
    const id = newId('ob');
    idMap.set(o.id, id);
    if (o.kind === 'block') {
      const dev = project.devices[o.deviceId];
      const nd: ProjectDevice = { id: newId('dv'), defId: dev.defId, name: uniqueDeviceName(scratch, dev.name) };
      devices[nd.id] = nd;
      scratch.devices[nd.id] = nd;
      return { ...o, id, deviceId: nd.id, x: o.x + dx, y: o.y + dy, border: { ...o.border } };
    }
    return { ...JSON.parse(JSON.stringify(o)), id, x: o.x + dx, y: o.y + dy };
  });
  const outConns: Connection[] = connections.map((c) => {
    const id = newId('cn');
    idMap.set(c.id, id);
    return {
      ...JSON.parse(JSON.stringify(c)),
      id,
      from: { ...c.from, objId: idMap.get(c.from.objId)! },
      to: { ...c.to, objId: idMap.get(c.to.objId)! },
      // Port endpoints always start horizontally, so bends alternate x, y, x...
      bends: c.bends && isPortEndpoint(c.from) ? c.bends.map((v, i) => v + (i % 2 === 0 ? dx : dy)) : null,
    };
  });
  const outBundles: Bundle[] = bundles.map((b) => ({
    ...JSON.parse(JSON.stringify(b)),
    id: newId('bn'),
    connIds: b.connIds.map((id) => idMap.get(id)!),
    bends: b.bends ? b.bends.map((v, i) => v + (i % 2 === 0 ? dx : dy)) : null,
  }));
  return { objects: outObjs, connections: outConns, bundles: outBundles, devices };
}

export function paste() {
  nextLabel('Paste');
  if (!clip) return;
  const s = getState();
  pasteCount++;
  const off = 18 * pasteCount;
  // Bring over block defs if pasting from another project.
  const defs: Record<string, BlockDef> = {};
  for (const o of clip.objects) {
    if (o.kind !== 'block') continue;
    const dev = clip.project.devices[o.deviceId];
    if (dev && !s.project.blockDefs[dev.defId]) defs[dev.defId] = clip.project.blockDefs[dev.defId];
  }
  // Images bring their assets along (e.g. pasting from another project).
  const assets: Record<string, Asset> = {};
  for (const o of clip.objects) if (o.kind === 'image' && !s.project.assets[o.assetId] && clip.project.assets[o.assetId]) assets[o.assetId] = clip.project.assets[o.assetId];
  const merged = { ...s.project, devices: { ...s.project.devices, ...clip.project.devices } };
  const copy = copyObjectsInto(merged, clip.objects, clip.connections, off, off, clip.bundles);
  updateProject((d) => {
    Object.assign(d.blockDefs, defs);
    Object.assign(d.devices, copy.devices);
    Object.assign(d.assets, assets);
    const pg = pageDraft(d);
    pg.objects.push(...(copy.objects as Draft<PageObject>[]));
    pg.connections.push(...(copy.connections as Draft<Connection>[]));
    (pg.bundles ??= []).push(...(copy.bundles as Draft<Bundle>[]));
  });
  setState({ selection: [...copy.objects.map((o) => o.id), ...copy.connections.map((c) => c.id), ...copy.bundles.map((b) => b.id)], selectedPorts: [] });
}

/**
 * Paste the copied blocks as further instances of the same devices (e.g. the network switch on
 * the audio page). Only within the same project; blocks already on this page are skipped.
 */
export function pasteAsInstance() {
  if (!clip) return;
  const s = getState();
  const blocks = clip.objects.filter((o): o is BlockObj => o.kind === 'block' && !!s.project.devices[o.deviceId]);
  if (!blocks.length) {
    toast('Copy blocks from this project first (Ctrl+C), then Ctrl+Shift+V places the same devices here.', 'warn', 6000);
    return;
  }
  const pg = currentPage(s);
  const here = new Set(pg.objects.filter((o) => o.kind === 'block').map((o) => (o as BlockObj).deviceId));
  const add = blocks.filter((b) => !here.has(b.deviceId));
  if (!add.length) {
    toast('Those devices are already on this page.', 'warn');
    return;
  }
  const objs: BlockObj[] = add.map((b) => ({ ...b, id: newId('ob'), border: { ...b.border } }));
  nextLabel(`Place ${plural(objs.length, 'device')} on this page too`, objs.map((o) => s.project.devices[o.deviceId].name));
  updateProject((d) => void pageDraft(d).objects.push(...(objs as Draft<BlockObj>[])));
  setState({ selection: objs.map((o) => o.id), selectedPorts: [] });
  if (add.length < blocks.length) toast(`${plural(blocks.length - add.length, 'device')} already on this page — skipped.`, 'info');
}

export function duplicateSelection() {
  copySelection();
  paste();
}

// ---------------------------------------------------------------------------------------------
// Connections

export function portInfo(project: Project, page: Page, e: Endpoint) {
  if (!isPortEndpoint(e)) return null;
  const o = page.objects.find((x) => x.id === e.objId);
  if (!o || o.kind !== 'block') return null;
  const dev = project.devices[o.deviceId];
  const def = dev && project.blockDefs[dev.defId];
  if (!def) return null;
  const f = findPort(def, e.portId);
  return f ? { ...f, device: dev } : null;
}

function sameEndpoint(a: Endpoint, b: Endpoint) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Create a connection. Returns the new id, or null if rejected. Signal mismatches only warn. */
export function connect(from: Endpoint, to: Endpoint, opts: { record?: boolean; quiet?: boolean } = {}): Id | null {
  const s = getState();
  const pg = currentPage();
  if (from.objId === to.objId && sameEndpoint(from, to)) return null;
  let a = from;
  let b = to;
  const pa = portInfo(s.project, pg, a);
  const pb = portInfo(s.project, pg, b);
  // Normalize so the line runs from the output towards the input.
  if (pa && pb && pa.port.dir === 'IN' && pb.port.dir !== 'IN') [a, b] = [b, a];
  else if (pa && !pb && pa.port.dir === 'IN') [a, b] = [b, a];
  if (pg.connections.some((c) => (sameEndpoint(c.from, a) && sameEndpoint(c.to, b)) || (sameEndpoint(c.from, b) && sameEndpoint(c.to, a)))) {
    if (!opts.quiet) toast('Those ports are already connected.', 'warn');
    return null;
  }
  const warnings = connectionWarnings(s.project, pg, a, b);
  const c: Connection = { id: newId('cn'), from: a, to: b, bends: null, label: '', labelT: null, style: { ...DEFAULT_LINE } };
  nextLabel('Connect ' + describeConnection(s.project, pg, c));
  updateProject((d) => {
    pageDraft(d).connections.push(c);
  }, opts.record ?? true);
  if (warnings.length && !opts.quiet) toast(warnings.join(' '), 'warn', 5000);
  return c.id;
}

export function connectionWarnings(project: Project, page: Page, a: Endpoint, b: Endpoint): string[] {
  const pa = portInfo(project, page, a);
  const pb = portInfo(project, page, b);
  const w: string[] = [];
  if (pa && pb) {
    if (pa.port.signal && pb.port.signal && pa.port.signal.toUpperCase() !== pb.port.signal.toUpperCase())
      w.push(`Signal mismatch: ${pa.port.signal} → ${pb.port.signal}.`);
  }
  return w;
}

/** Ports sorted in display order (left column then right column, top to bottom). */
function sortPorts(project: Project, page: Page, refs: PortRef[]) {
  return refs
    .map((r) => ({ r, info: portInfo(project, page, r) }))
    .filter((x) => x.info)
    .sort((a, b) => (a.info!.side === b.info!.side ? a.info!.index - b.info!.index : a.info!.side === 'L' ? -1 : 1));
}

export function rangeConnectAvailable(): boolean {
  const s = getState();
  const objs = new Set(s.selectedPorts.map((p) => p.objId));
  return objs.size === 2 && s.selectedPorts.length >= 2;
}

export function rangeConnect() {
  const s = getState();
  const pg = currentPage();
  const objIds = [...new Set(s.selectedPorts.map((p) => p.objId))];
  if (objIds.length !== 2) {
    toast('Range connect: select ports on exactly two blocks (Shift/Ctrl-click port rows).', 'warn');
    return;
  }
  let A = sortPorts(s.project, pg, s.selectedPorts.filter((p) => p.objId === objIds[0]));
  let B = sortPorts(s.project, pg, s.selectedPorts.filter((p) => p.objId === objIds[1]));
  // Source = the side with more outputs.
  const outs = (xs: typeof A) => xs.filter((x) => x.info!.port.dir === 'OUT').length;
  if (outs(B) > outs(A)) [A, B] = [B, A];
  const n = Math.min(A.length, B.length);
  let made = 0;
  const warns = new Set<string>();
  for (let i = 0; i < n; i++) {
    const w = connectionWarnings(s.project, pg, A[i].r, B[i].r);
    w.forEach((x) => warns.add(x));
    const id = connect(A[i].r, B[i].r, { record: made === 0, quiet: true });
    if (id) made++;
  }
  if (made) labelLast(`Range connect: ${plural(made, 'line')}`);
  if (A.length !== B.length) warns.add(`Port counts differ (${A.length} vs ${B.length}); connected ${n} pairs.`);
  toast(`Range connect: ${made} connection${made === 1 ? '' : 's'} created.` + (warns.size ? ' ' + [...warns].join(' ') : ''), warns.size ? 'warn' : 'info', 6000);
  setState({ selectedPorts: [] });
}

// ---------------------------------------------------------------------------------------------
// Block definitions

/**
 * Save an edited project-local definition (affects all devices using it). Returns descriptions of
 * connections that were removed because their ports no longer exist (also listed in History).
 */
export function saveProjectDef(def: BlockDef, label = `Edit block definition ${def.manufacturer} ${def.model}`): string[] {
  const before = getState().project;
  updateProject((d) => {
    d.blockDefs[def.id] = def as Draft<BlockDef>;
    gc(d);
  }, label);
  const lost = lostConnections(before, getState().project);
  if (lost.length) labelLast(`${label} — ${plural(lost.length, 'connection')} removed`, lost.map((l) => 'Removed: ' + l));
  return lost;
}

/** Connections present in `a` but not in `b`, described. */
export function lostConnections(a: Project, b: Project): string[] {
  const alive = new Set(b.pages.flatMap((p) => p.connections.map((c) => c.id)));
  return a.pages.flatMap((p, i) => p.connections.filter((c) => !alive.has(c.id)).map((c) => `${describeConnection(a, p, c)} (page ${i + 1})`));
}

export function plural(n: number, w: string) {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

function endpointText(p: Project, page: Page, e: Endpoint) {
  const info = portInfo(p, page, e);
  if (info) return `${info.device.name} ${info.port.name}`.trim();
  const o = page.objects.find((x) => x.id === e.objId);
  return o ? describeObject(p, o) : '?';
}

export function describeConnection(p: Project, page: Page, c: Connection) {
  return `${endpointText(p, page, c.from)} → ${endpointText(p, page, c.to)}${c.label ? ` [${c.label}]` : ''}`;
}

const KIND_NAMES: Record<PageObject['kind'], string> = {
  block: 'Block',
  text: 'Text box',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  container: 'Container',
  callout: 'Callout',
  image: 'Image',
  tag: 'Tag',
};

export function kindName(o: PageObject) {
  return KIND_NAMES[o.kind];
}

export function describeObject(p: Project, o: PageObject) {
  if (o.kind === 'block') return p.devices[o.deviceId]?.name ?? 'block';
  if (o.kind === 'tag') return `Tag "${tagText(p, o)}"`;
  if (o.kind === 'image') return 'Image';
  const t = o.text?.trim().split('\n')[0].slice(0, 24);
  return KIND_NAMES[o.kind] + (t ? ` "${t}"` : '');
}

/** Replace a project definition with the current library version (by libraryId). */
export function updateFromLibrary(defId: Id) {
  const s = getState();
  const pd = s.project.blockDefs[defId];
  if (!pd) return;
  const lib =
    s.library.find((l) => l.id === pd.libraryId) ??
    s.library.find((l) => l.manufacturer === pd.manufacturer && l.model === pd.model);
  if (!lib) {
    toast('No matching library block found.', 'warn');
    return;
  }
  // Keep port ids where names match so existing connections survive.
  const mapPorts = (lp: BlockDef['left'], old: BlockDef['left'], oldOther: BlockDef['left']) =>
    lp.map((p) => {
      const m = old.find((o) => o.name === p.name) ?? oldOther.find((o) => o.name === p.name);
      return { ...p, id: m ? m.id : p.id };
    });
  const next: BlockDef = {
    ...cloneDef(lib, defId),
    libraryId: lib.id,
    left: mapPorts(lib.left, pd.left, pd.right),
    right: mapPorts(lib.right, pd.right, pd.left),
  };
  const lost = saveProjectDef(next, `Update ${lib.manufacturer} ${lib.model} from library`);
  toast(
    `Updated "${lib.manufacturer} ${lib.model}" from library.` +
      (lost.length ? ` ${plural(lost.length, 'connection')} removed because the port no longer exists — see History for details.` : ''),
    lost.length ? 'warn' : 'info',
    lost.length ? 8000 : 3500,
  );
}

// ---------------------------------------------------------------------------------------------
// Library

export function setLibrary(lib: BlockDef[], persist = true) {
  setState({ library: lib });
  if (persist) void saveLibrary(lib);
}

export function upsertLibraryDef(def: BlockDef) {
  const lib = getState().library;
  const i = lib.findIndex((l) => l.id === def.id);
  setLibrary(i >= 0 ? lib.map((l) => (l.id === def.id ? def : l)) : [...lib, def]);
}

export function deleteLibraryDef(id: Id) {
  setLibrary(getState().library.filter((l) => l.id !== id));
}

/** Add a project definition to the library (e.g. after editing it in a project). */
export function projectDefToLibrary(defId: Id) {
  const s = getState();
  const pd = s.project.blockDefs[defId];
  if (!pd) return;
  const existing = s.library.find((l) => l.id === pd.libraryId);
  const libDef: BlockDef = { ...cloneDef(pd, existing ? existing.id : newId('bd')) };
  delete libDef.libraryId;
  upsertLibraryDef(libDef);
  updateProject((d) => {
    d.blockDefs[defId].libraryId = libDef.id;
  });
  toast(existing ? 'Library block updated.' : 'Added to library.');
}

// ---------------------------------------------------------------------------------------------
// Straightening lines by moving blocks

/**
 * Move objects so their lines run perfectly straight.
 * - Selected objects move to straighten their nearest-to-straight line to something unselected.
 * - With only lines selected, each line's input end (the "to" object) moves.
 */
export function straighten() {
  nextLabel('Straighten');
  const s = getState();
  const page = currentPage(s);
  const sel = new Set(s.selection);
  const moves = new Map<string, number>();
  const selObjs = page.objects.filter((o) => sel.has(o.id));
  if (selObjs.length) {
    for (const o of selObjs) {
      let best: number | null = null;
      for (const c of page.connections) {
        const mineFrom = c.from.objId === o.id;
        const mineTo = c.to.objId === o.id;
        if (mineFrom === mineTo) continue;
        if (sel.has(mineFrom ? c.to.objId : c.from.objId)) continue;
        const d = straightenDelta(s.project, page, c);
        if (d === null || Math.abs(d) < 1e-6) continue;
        const myMove = mineTo ? -d : d;
        if (best === null || Math.abs(myMove) < Math.abs(best)) best = myMove;
      }
      if (best !== null) moves.set(o.id, best);
    }
  } else {
    for (const c of page.connections.filter((c) => sel.has(c.id))) {
      const d = straightenDelta(s.project, page, c);
      if (d === null || Math.abs(d) < 1e-6 || moves.has(c.to.objId)) continue;
      moves.set(c.to.objId, -d);
    }
  }
  if (!moves.size) {
    toast(selObjs.length || sel.size ? 'Nothing to straighten — the selected lines are already straight (or can\'t be).' : 'Select blocks or lines to straighten.', 'info');
    return;
  }
  updateProject((d) => {
    for (const o of pageDraft(d).objects) if (moves.has(o.id)) o.y += moves.get(o.id)!;
  });
}

/**
 * After drawing a line with a small jog, move one end so it's straight — but only an end that
 * has no other lines (so nothing else gets bent). Merged into the same undo step as the line.
 */
export function autoStraighten(connId: string, maxJog = 24) {
  const s = getState();
  const page = currentPage(s);
  const c = page.connections.find((x) => x.id === connId);
  if (!c) return;
  const d = straightenDelta(s.project, page, c);
  if (d === null || Math.abs(d) < 1e-6 || Math.abs(d) > maxJog) return;
  const lines = (objId: string) => page.connections.filter((x) => x.from.objId === objId || x.to.objId === objId).length;
  let id: string | null = null;
  let dy = 0;
  if (lines(c.to.objId) === 1) [id, dy] = [c.to.objId, -d];
  else if (lines(c.from.objId) === 1) [id, dy] = [c.from.objId, d];
  if (!id) return;
  updateProject((dr) => {
    const o = pageDraft(dr).objects.find((x) => x.id === id);
    if (o) o.y += dy;
  }, false);
}

// ---------------------------------------------------------------------------------------------
// Snakes (bundles)

/** Why the selected lines can't be bundled, or null if they can. */
export function bundleProblem(project: Project, page: Page, connIds: Id[]): string | null {
  const conns = page.connections.filter((c) => connIds.includes(c.id));
  if (conns.length < 4) return 'A snake needs at least 4 lines.';
  if ((page.bundles ?? []).some((b) => b.connIds.some((id) => connIds.includes(id)))) return 'Some of those lines are already in a snake.';
  const objs = new Set(conns.flatMap((c) => [c.from.objId, c.to.objId]));
  if (objs.size !== 2) return 'All lines must run between the same two devices.';
  const sides = new Map<string, Set<string>>();
  const signals = new Set<string>();
  for (const c of conns) {
    for (const e of [c.from, c.to]) {
      const info = portInfo(project, page, e);
      if (!info) return 'Snakes connect block ports only.';
      if (!sides.has(e.objId)) sides.set(e.objId, new Set());
      sides.get(e.objId)!.add(info.side);
      signals.add((info.port.signal || '').toUpperCase());
    }
  }
  if (signals.size !== 1) return `All lines must carry the same signal type (found ${[...signals].map((x) => x || 'none').join(', ')}).`;
  if ([...sides.values()].some((x) => x.size > 1)) return 'On each device the ports must be in the same column.';
  return null;
}

export function bundleSelection() {
  const s = getState();
  const page = currentPage(s);
  const ids = page.connections.filter((c) => s.selection.includes(c.id)).map((c) => c.id);
  const problem = bundleProblem(s.project, page, ids);
  if (problem) {
    toast('Bundle: ' + problem, 'warn', 6000);
    return;
  }
  // Order the members as their ports appear on the first device.
  const first = page.connections.find((c) => c.id === ids[0])!;
  const objA = first.from.objId;
  const at = (c: Connection) => portInfo(s.project, page, c.from.objId === objA ? c.from : c.to)?.index ?? 0;
  const conns = page.connections.filter((c) => ids.includes(c.id)).sort((a, b) => at(a) - at(b));
  const b: Bundle = { id: newId('bn'), connIds: conns.map((c) => c.id), label: '', bends: null, style: { ...conns[0].style, width: Math.max(2, conns[0].style.width * 3) } };
  nextLabel(`Bundle ${plural(conns.length, 'line')} into a snake`, conns.map((c) => describeConnection(s.project, page, c)));
  updateProject((d) => void (pageDraft(d).bundles ??= []).push(b as Draft<Bundle>));
  setState({ selection: [b.id], selectedPorts: [] });
}

export function unbundle(bundleIds: Id[]) {
  const s = getState();
  const page = currentPage(s);
  const bs = (page.bundles ?? []).filter((b) => bundleIds.includes(b.id) || b.connIds.some((id) => bundleIds.includes(id)));
  if (!bs.length) return;
  nextLabel(bs.length === 1 ? 'Unbundle snake' : `Unbundle ${bs.length} snakes`);
  const gone = new Set(bs.map((b) => b.id));
  updateProject((d) => {
    const pg = pageDraft(d);
    pg.bundles = (pg.bundles ?? []).filter((b) => !gone.has(b.id));
  });
  setState({ selection: bs.flatMap((b) => b.connIds), selectedPorts: [] });
}

export function patchBundles(ids: Id[], patch: (b: Draft<Bundle>) => void, record = true) {
  defaultLabel('Change snake');
  const set = new Set(ids);
  updateProject((d) => {
    for (const b of pageDraft(d).bundles ?? []) if (set.has(b.id)) patch(b);
  }, record);
}

// ---------------------------------------------------------------------------------------------
// Equipment list

export function equipmentListCsv(project: Project): string {
  const rows = Object.values(project.devices).map((dev) => {
    const def = project.blockDefs[dev.defId];
    return [def?.manufacturer ?? '', def?.model ?? '', dev.name, devicePages(project, dev.id).map((i) => i + 1).join(', ')];
  });
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2], undefined, { numeric: true }));
  const esc = (v: string) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  return [['Manufacturer', 'Model', 'Friendly name', 'Page(s)'], ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

void rotOf;
