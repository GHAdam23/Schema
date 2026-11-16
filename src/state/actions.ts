import type { Draft } from 'immer';
import type {
  BlockDef,
  BlockObj,
  Connection,
  Endpoint,
  Id,
  Page,
  PageObject,
  PageSizeId,
  Project,
  ProjectDevice,
  RectObj,
  StrokeStyle,
  TextObj,
} from '../model/types';
import { isPortEndpoint } from '../model/types';
import { newId } from '../model/ids';
import { cloneDef, newPage } from '../model/project';
import { DEFAULT_BLOCK_BORDER, DEFAULT_LINE, DEFAULT_RECT_BORDER } from '../model/defaults';
import { findPort } from '../model/blockGeometry';
import { objBounds, resolvePageRoutes, type ResolvedRoute } from '../model/routing';
import { labelBox, labelTAt } from '../render/buildPage';
import { currentPage, getState, setState, toast, updateProject, type PortRef } from './store';
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
  const s = getState();
  const pg = newPage(`Page ${s.project.pages.length + 1}`, currentPage().size);
  updateProject((d) => {
    const i = d.pages.findIndex((p) => p.id === s.pageId);
    d.pages.splice(i + 1, 0, pg);
  });
  setPage(pg.id);
}

export function duplicatePage(id: Id) {
  const s = getState();
  const src = s.project.pages.find((p) => p.id === id);
  if (!src) return;
  const copy = copyObjectsInto(s.project, src.objects, src.connections, 0, 0);
  const pg: Page = { ...newPage(src.name + ' (copy)', src.size), objects: copy.objects, connections: copy.connections };
  updateProject((d) => {
    Object.assign(d.devices, copy.devices);
    const i = d.pages.findIndex((p) => p.id === id);
    d.pages.splice(i + 1, 0, pg as Draft<Page>);
  });
  setPage(pg.id);
}

export function renamePage(id: Id, name: string) {
  updateProject((d) => {
    const p = d.pages.find((p) => p.id === id);
    if (p) p.name = name;
  });
}

export function setPageSize(id: Id, size: PageSizeId) {
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

export function deleteSelection() {
  const s = getState();
  const sel = new Set(s.selection);
  if (!sel.size) return;
  updateProject((d) => {
    const pg = pageDraft(d);
    pg.objects = pg.objects.filter((o) => !sel.has(o.id));
    const alive = new Set(pg.objects.map((o) => o.id));
    pg.connections = pg.connections.filter((c) => !sel.has(c.id) && alive.has(c.from.objId) && alive.has(c.to.objId));
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
  }
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
  const set = new Set(ids);
  updateProject((d) => {
    for (const o of pageDraft(d).objects) {
      if (set.has(o.id)) {
        o.x += dx;
        o.y += dy;
      }
    }
  }, record);
}

export function patchObjects(ids: Id[], patch: (o: Draft<PageObject>) => void, record = true) {
  const set = new Set(ids);
  updateProject((d) => {
    for (const o of pageDraft(d).objects) if (set.has(o.id)) patch(o);
  }, record);
}

export function patchConnections(ids: Id[], patch: (c: Draft<Connection>) => void, record = true) {
  const set = new Set(ids);
  updateProject((d) => {
    for (const c of pageDraft(d).connections) if (set.has(c.id)) patch(c);
  }, record);
}

export function setStroke(ids: Id[], style: Partial<StrokeStyle>) {
  const set = new Set(ids);
  updateProject((d) => {
    const pg = pageDraft(d);
    for (const o of pg.objects) {
      if (!set.has(o.id)) continue;
      if (o.kind === 'text') o.border = { ...(o.border ?? { color: '#000000', width: 1, dash: 'solid' }), ...style };
      else o.border = { ...o.border, ...style };
    }
    for (const c of pg.connections) if (set.has(c.id)) c.style = { ...c.style, ...style };
  });
}

export function renameDevice(deviceId: Id, name: string) {
  updateProject((d) => {
    const dev = d.devices[deviceId];
    if (dev) dev.name = name;
  });
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function alignSelection(mode: AlignMode) {
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
      if (mode === 'left') t.x = minX;
      if (mode === 'right') t.x = maxX - b.w;
      if (mode === 'hcenter') t.x = (minX + maxX) / 2 - b.w / 2;
      if (mode === 'top') t.y = minY;
      if (mode === 'bottom') t.y = maxY - b.h;
      if (mode === 'vcenter') t.y = (minY + maxY) / 2 - b.h / 2;
    }
  });
}

/**
 * Line up the labels of the selected lines. Left/centre/right put label centres (or edges) on a
 * common x along horizontal runs; top/middle/bottom on a common y along vertical runs.
 */
export function alignLabels(mode: AlignMode) {
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
      if (axis === 'h') t.x = pos;
      else t.y = pos;
      pos += (axis === 'h' ? b.w : b.h) + gapSize;
    }
  });
}

export function zOrder(mode: 'front' | 'back' | 'forward' | 'backward') {
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
  setState({ selection: [...pg.objects.map((o) => o.id), ...pg.connections.map((c) => c.id)], selectedPorts: [] });
}

// ---------------------------------------------------------------------------------------------
// Clipboard

interface ClipData {
  objects: PageObject[];
  connections: Connection[];
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
  clip = { objects, connections, project: s.project };
  pasteCount = 0;
}

export function cutSelection() {
  copySelection();
  deleteSelection();
}

/** Copy objects (+ connections among them) with new ids. Blocks get new devices. */
function copyObjectsInto(project: Project, objects: readonly PageObject[], connections: readonly Connection[], dx: number, dy: number) {
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
  const outConns: Connection[] = connections.map((c) => ({
    ...JSON.parse(JSON.stringify(c)),
    id: newId('cn'),
    from: { ...c.from, objId: idMap.get(c.from.objId)! },
    to: { ...c.to, objId: idMap.get(c.to.objId)! },
    // Port endpoints always start horizontally, so bends alternate x, y, x...
    bends: c.bends && isPortEndpoint(c.from) ? c.bends.map((v, i) => v + (i % 2 === 0 ? dx : dy)) : null,
  }));
  return { objects: outObjs, connections: outConns, devices };
}

export function paste() {
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
  const merged = { ...s.project, devices: { ...s.project.devices, ...clip.project.devices } };
  const copy = copyObjectsInto(merged, clip.objects, clip.connections, off, off);
  updateProject((d) => {
    Object.assign(d.blockDefs, defs);
    Object.assign(d.devices, copy.devices);
    const pg = pageDraft(d);
    pg.objects.push(...(copy.objects as Draft<PageObject>[]));
    pg.connections.push(...(copy.connections as Draft<Connection>[]));
  });
  setState({ selection: [...copy.objects.map((o) => o.id), ...copy.connections.map((c) => c.id)], selectedPorts: [] });
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
  if (A.length !== B.length) warns.add(`Port counts differ (${A.length} vs ${B.length}); connected ${n} pairs.`);
  toast(`Range connect: ${made} connection${made === 1 ? '' : 's'} created.` + (warns.size ? ' ' + [...warns].join(' ') : ''), warns.size ? 'warn' : 'info', 6000);
  setState({ selectedPorts: [] });
}

// ---------------------------------------------------------------------------------------------
// Block definitions

/** Save an edited project-local definition (affects all devices using it). */
export function saveProjectDef(def: BlockDef) {
  updateProject((d) => {
    d.blockDefs[def.id] = def as Draft<BlockDef>;
    gc(d);
  });
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
  const before = countConnections(s.project);
  saveProjectDef(next);
  const lost = before - countConnections(getState().project);
  toast(`Updated "${lib.manufacturer} ${lib.model}" from library.` + (lost ? ` ${lost} connection(s) removed (ports no longer exist).` : ''), lost ? 'warn' : 'info');
}

function countConnections(p: Project) {
  return p.pages.reduce((a, pg) => a + pg.connections.length, 0);
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
