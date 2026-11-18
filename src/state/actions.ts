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
  LineGlue,
  LineObj,
  Page,
  PageObject,
  PageSizeId,
  Project,
  ProjectDevice,
  RackUnitObj,
  RectObj,
  StrokeStyle,
  TagObj,
  TextObj,
} from '../model/types';
import { isPortEndpoint } from '../model/types';
import { newId } from '../model/ids';
import { cloneDef, newPage } from '../model/project';
import { DEFAULT_BLOCK_BORDER, DEFAULT_LINE, DEFAULT_RECT_BORDER, drawingArea } from '../model/defaults';
import { blockFor, findPort, portAnchor } from '../model/blockGeometry';
import { LINE_H, lineBox, lineEnds } from '../model/glue';
import { axisOf, objBounds, resolveEndpoint, resolvePageRoutes, straightenDelta, type ResolvedRoute } from '../model/routing';
import { isBox, normDeg, rotOf } from '../model/geom';
import { devicePages, tagRowFit, tagSize, tagTargetPage, tagText } from '../model/tags';
import { calloutTip, labelBox, labelBoxes, labelTAt, withLabelT, type LabelBox } from '../render/buildPage';
import { currentPage, defaultLabel, getState, labelLast, nextLabel, setState, toast, updateProject, type PortRef } from './store';
import { saveLibrary } from '../io/libraryStore';
import { DEFAULT_AUTO_LABEL, formatLabel } from '../model/signals';
import { rackSpecOf } from '../model/rack';

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
  // The copy shows the same devices (instances), like pasting onto another page.
  const copy = copyObjectsInto(s.project, s.project, src.objects, src.connections, 0, 0, src.bundles ?? [], { onPage: null, forceNew: false });
  const pg: Page = { ...newPage(src.name + ' (copy)', src.size), objects: copy.objects, connections: copy.connections, bundles: copy.bundles };
  updateProject((d) => {
    Object.assign(d.devices, copy.devices);
    Object.assign(d.blockDefs, copy.defs);
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

/** A text box: clicked = grows with its text (no wrap); dragged out to a size (w, h given) = wraps. */
export function addText(x: number, y: number, text = 'Text', w?: number, h?: number): Id {
  nextLabel('Add text box');
  const o: TextObj = {
    id: newId('ob'),
    kind: 'text',
    x,
    y,
    w: w ?? 108,
    h: h ?? 27,
    text,
    fontSize: 9,
    bold: false,
    align: 'left',
    valign: 'top',
    wrap: w !== undefined,
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

export function addCallout(x: number, y: number, shape: CalloutObj['shape'] = 'box', w?: number, h?: number): Id {
  const cloud = shape === 'cloud';
  nextLabel(cloud ? 'Add thought bubble' : 'Add callout');
  w ??= cloud ? 162 : 108;
  h ??= cloud ? 90 : 36;
  const o: CalloutObj = {
    id: newId('ob'),
    kind: 'callout',
    x,
    y,
    w,
    h,
    border: { color: '#000000', width: 0.75, dash: 'solid' },
    fill: '#ffffff',
    tail: defaultTail(cloud, w, h),
    ...textDefaults,
    text: 'Note',
    wrap: true,
    shape: cloud ? 'cloud' : undefined,
  };
  updateProject((d) => void pageDraft(d).objects.push(o));
  setState({ selection: [o.id], selectedPorts: [] });
  return o.id;
}

/** Where a new callout points: below-left of a box, below-right of a cloud. */
export function defaultTail(cloud: boolean, w: number, h: number) {
  return cloud ? { x: w + 38, y: h + 20 } : { x: -36, y: h + 24 };
}

export { LINE_H, lineBox, lineEnds };

/** A drawn line / arrow from (x1, y1) to (x2, y2). */
export function addLine(x1: number, y1: number, x2: number, y2: number, arrows: LineObj['arrows'], record = true): Id {
  nextLabel(arrows === 'none' ? 'Add line' : arrows === 'both' ? 'Add double arrow' : 'Add arrow');
  const o: LineObj = { id: newId('ob'), kind: 'line', ...lineBox(x1, y1, x2, y2), border: { color: '#000000', width: 1, dash: 'solid' }, arrows };
  updateProject((d) => void pageDraft(d).objects.push(o), record);
  setState({ selection: [o.id], selectedPorts: [] });
  return o.id;
}

/**
 * Moving a drawn line by itself lets go of what its ends are glued to (unless that moves too).
 * Call inside the move's update.
 */
export function unglueMoved(pg: Draft<Page>, ids: Set<Id>) {
  for (const o of pg.objects) {
    if (o.kind !== 'line' || !o.ends || !ids.has(o.id)) continue;
    const keeps = (g: LineGlue | null) => {
      if (!g) return null;
      if ('connId' in g) {
        const c = pg.connections.find((x) => x.id === g.connId);
        return c && ids.has(c.from.objId) && ids.has(c.to.objId) ? g : null;
      }
      return ids.has(g.objId) ? g : null;
    };
    const ends: [LineGlue | null, LineGlue | null] = [keeps(o.ends[0] as LineGlue | null), keeps(o.ends[1] as LineGlue | null)];
    if (JSON.stringify(ends) !== JSON.stringify(o.ends)) o.ends = ends[0] || ends[1] ? ends : undefined;
  }
}

/**
 * Clicking a port's "used elsewhere" dot: add an off-page reference tag at this port for each
 * line that port has on another page, pointing at what that line goes to there.
 */
export function tagsFromElsewhere(objId: Id, portId: Id) {
  const s = getState();
  const page = currentPage(s);
  const o = page.objects.find((x): x is BlockObj => x.id === objId && x.kind === 'block');
  if (!o) return;
  const targets: TagObj['target'][] = [];
  s.project.pages.forEach((pg) => {
    if (pg === page) return;
    const inst = new Set(pg.objects.filter((x) => x.kind === 'block' && x.deviceId === o.deviceId).map((x) => x.id));
    for (const c of pg.connections) {
      const mine = [c.from, c.to].find((e) => isPortEndpoint(e) && inst.has(e.objId) && e.portId === portId);
      if (!mine) continue;
      const far = mine === c.from ? c.to : c.from;
      const fo = pg.objects.find((x) => x.id === far.objId);
      // The far end: a device's port, or a tag (then where that tag points).
      let t: TagObj['target'] = null;
      if (fo?.kind === 'block' && isPortEndpoint(far)) t = { deviceId: fo.deviceId, portId: far.portId };
      else if (fo?.kind === 'tag' && fo.target) t = { ...fo.target };
      if (t && t.deviceId !== o.deviceId && !targets.some((x) => x?.deviceId === t!.deviceId && x?.portId === t!.portId)) targets.push(t);
    }
  });
  const dev = s.project.devices[o.deviceId];
  const port = blockFor(s.project, o).base && findPort(blockFor(s.project, o).base!, portId)?.port;
  if (!targets.length) {
    toast(`The line${''} from ${dev?.name} ${port?.name ?? ''} on the other page doesn't end at a device — add a tag by hand (G).`, 'warn', 6000);
    return;
  }
  // Skip ones already tagged at this port on this page.
  const existing = page.objects.filter((x): x is TagObj => x.kind === 'tag' && page.connections.some((c) => [c.from, c.to].some((e) => e.objId === x.id) && [c.from, c.to].some((e) => isPortEndpoint(e) && e.objId === objId && e.portId === portId)));
  const todo = targets.filter((t) => !existing.some((x) => x.target?.deviceId === t!.deviceId && x.target?.portId === t!.portId));
  if (!todo.length) {
    toast('This port already has those reference tags.', 'info');
    return;
  }
  const a = portAnchor(s.project, o, portId);
  if (!a) return;
  nextLabel(`Off-page tag${todo.length > 1 ? 's' : ''} at ${dev?.name} ${port?.name ?? ''}`);
  const left = a.dir[0] < 0;
  const made: Id[] = [];
  todo.forEach((t, i) => {
    const tag: TagObj = {
      id: newId('ob'),
      kind: 'tag',
      x: a.x,
      y: a.y,
      target: t,
      dir: 'auto',
      showPort: true,
      note: '',
      border: { color: '#000000', width: 0.75, dash: 'solid' },
      fill: null,
      ...tagRowFit(o.scale),
    };
    const line: Connection = {
      id: newId('cn'),
      from: left ? { objId: tag.id, fx: 1, fy: 0.5 } : { objId, portId },
      to: left ? { objId, portId } : { objId: tag.id, fx: 0, fy: 0.5 },
      bends: null,
      label: '',
      labelT: null,
      style: { ...DEFAULT_LINE },
    };
    updateProject((d) => {
      const pg = pageDraft(d);
      pg.objects.push(tag as Draft<TagObj>);
      pg.connections.push(line as Draft<Connection>);
    }, made.length === 0);
    const sz = tagSize(getState().project, currentPage().objects.find((x) => x.id === tag.id) as TagObj);
    updateProject((d) => {
      const tt = pageDraft(d).objects.find((x) => x.id === tag.id)!;
      tt.x = left ? a.x - PAIR_GAP - sz.w : a.x + PAIR_GAP;
      // Several: stacked below each other (edges touching), the first level with the port.
      tt.y = a.y - sz.h / 2 + i * sz.h;
    }, false);
    made.push(tag.id);
  });
  setState({ selection: made, selectedPorts: [] });
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
  patchTag(
    id,
    (o) => {
      o.target = target;
      o.auto = undefined; // a tag the user points somewhere is theirs
    },
    dev ? `Point tag to ${dev.name}` : 'Clear tag target',
  );
  syncTagPair(id);
}

const PAIR_GAP = 36;

/**
 * A tag on a line from a port that points to a specific port elsewhere gets a matching tag at that
 * port (on the page where it's drawn), pointing back: "TO (2) DISP-1 HDMI 1" here,
 * "FROM (1) VR-1 SDI OUT 8" there. Re-pointing the tag replaces its automatic partner.
 * Part of the same undo step as the change that triggered it.
 */
function syncTagPair(id: Id) {
  // 1. Drop the old automatic partner (a partner the user made stays, just unlinked).
  updateProject((d) => {
    for (const pg of d.pages) {
      pg.objects = pg.objects.filter((o) => !(o.kind === 'tag' && o.auto && o.pairId === id));
      for (const o of pg.objects) if (o.kind === 'tag' && (o.pairId === id || o.id === id)) delete o.pairId;
    }
    gc(d);
  }, false);
  // 2. Work out whether a partner belongs somewhere.
  const p = getState().project;
  const own = p.pages.find((pg) => pg.objects.some((o) => o.id === id));
  const tag = own?.objects.find((o) => o.id === id);
  if (!own || !tag || tag.kind !== 'tag' || !tag.target?.portId) return;
  const conn = own.connections.find((c) => c.from.objId === id || c.to.objId === id);
  const srcEnd = conn && (conn.from.objId === id ? conn.to : conn.from);
  if (!srcEnd || !isPortEndpoint(srcEnd)) return;
  const srcObj = own.objects.find((o) => o.id === srcEnd.objId);
  if (!srcObj || srcObj.kind !== 'block') return;
  const ti = tagTargetPage(p, tag);
  const tp = p.pages[ti];
  if (!tp || tp === own) return;
  const target = tag.target;
  const inst = tp.objects.find((o): o is BlockObj => o.kind === 'block' && o.deviceId === target.deviceId);
  const a = inst && portAnchor(p, inst, target.portId!);
  if (!inst || !a) return;
  const isTagAtPort = (t: PageObject) =>
    tp.connections.some((c) => [c.from, c.to].some((e) => e.objId === t.id) && [c.from, c.to].some((e) => isPortEndpoint(e) && e.objId === inst.id && e.portId === target.portId));
  // A tag already there pointing back: just link the two.
  const existing = tp.objects.find((o) => o.kind === 'tag' && o.target?.deviceId === srcObj.deviceId && o.target?.portId === srcEnd.portId && isTagAtPort(o));
  if (existing) {
    updateProject((d) => {
      for (const pg of d.pages)
        for (const o of pg.objects) {
          if (o.id === id && o.kind === 'tag') o.pairId = existing.id;
          if (o.id === existing.id && o.kind === 'tag') o.pairId = id;
        }
    }, false);
    return;
  }
  const partner: TagObj = {
    ...tag,
    id: newId('ob'),
    x: a.x,
    y: a.y,
    target: { deviceId: srcObj.deviceId, portId: srcEnd.portId },
    dir: 'auto',
    note: '',
    pairId: id,
    auto: true,
    ...tagRowFit(inst.scale),
  };
  // Inputs (left column) get the tag on the left with the line running tag → port; outputs the reverse.
  const left = a.dir[0] < 0;
  const line: Connection = {
    id: newId('cn'),
    from: left ? { objId: partner.id, fx: 1, fy: 0.5 } : { objId: inst.id, portId: target.portId! },
    to: left ? { objId: inst.id, portId: target.portId! } : { objId: partner.id, fx: 0, fy: 0.5 },
    bends: null,
    label: conn.label,
    labelT: null,
    style: { ...conn.style },
  };
  updateProject((d) => {
    const pg = d.pages.find((x) => x.id === tp.id)!;
    pg.objects.push(partner as Draft<TagObj>);
    pg.connections.push(line as Draft<Connection>);
    for (const o of d.pages.find((x) => x.id === own.id)!.objects) if (o.id === id && o.kind === 'tag') o.pairId = partner.id;
  }, false);
  // Size depends on the text, which needs the tag in place: position it now.
  const placed = getState().project.pages.find((x) => x.id === tp.id)!.objects.find((o) => o.id === partner.id) as TagObj;
  const sz = tagSize(getState().project, placed);
  updateProject((d) => {
    const t = d.pages.find((x) => x.id === tp.id)!.objects.find((o) => o.id === partner.id)!;
    t.x = left ? a.x - PAIR_GAP - sz.w : a.x + PAIR_GAP;
    t.y = a.y - sz.h / 2;
  }, false);
  toast(`Added the matching tag at ${p.devices[target.deviceId]?.name} on page ${ti + 1}.`);
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
      if (!isBox(o)) return;
      const r = normDeg(typeof deg === 'function' ? deg(o.rot ?? 0) : deg);
      o.rot = Math.round(r * 100) / 100;
      // A line turned by hand lets go of what its ends are glued to (they would pull it back).
      if (o.kind === 'line') delete o.ends;
    },
    record,
  );
}

export function setCurved(ids: Id[], curved: boolean) {
  nextLabel(curved ? 'Curved' : 'Right-angle');
  const set = new Set(ids);
  updateProject((d) => {
    const pg = pageDraft(d);
    for (const c of pg.connections) if (set.has(c.id)) c.curved = curved || undefined;
    for (const b of pg.bundles ?? []) if (set.has(b.id)) b.curved = curved || undefined;
  });
}

export function deleteSelection() {
  const s = getState();
  const page0 = currentPage(s);
  // A selected snake trunk stands for its lines.
  const trunkLines = (page0.bundles ?? []).filter((b) => s.selection.includes(b.id)).flatMap((b) => b.connIds);
  const sel = new Set([...s.selection, ...trunkLines]);
  if (!sel.size) return;
  // Reference tags wired only to what's being deleted go with it.
  for (const t of page0.objects) {
    if (t.kind !== 'tag' || sel.has(t.id)) continue;
    const others = page0.connections.filter((c) => c.from.objId === t.id || c.to.objId === t.id).map((c) => (c.from.objId === t.id ? c.to.objId : c.from.objId));
    if (others.length && others.every((id) => sel.has(id))) sel.add(t.id);
  }
  // Units in a deleted rack go with it.
  for (const o of page0.objects) if (o.kind === 'rackunit' && o.rackId && sel.has(o.rackId)) sel.add(o.id);
  // A tag's automatic partner at the far end goes too.
  const partners = new Set(page0.objects.filter((o): o is TagObj => o.kind === 'tag' && sel.has(o.id) && !!o.pairId).map((o) => o.pairId!));
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
    for (const p of d.pages) {
      p.objects = p.objects.filter((o) => !(partners.has(o.id) && o.kind === 'tag' && o.auto));
      for (const o of p.objects) if (o.kind === 'tag' && o.pairId && sel.has(o.pairId)) delete o.pairId;
    }
    gc(d);
  });
  // Tags elsewhere that went because their device is gone: say so in History.
  const after = new Set(getState().project.pages.flatMap((p) => p.objects.map((o) => o.id)));
  const gone = s.project.pages.flatMap((p, i) => p.objects.filter((o) => o.kind === 'tag' && !after.has(o.id) && !sel.has(o.id)).map((o) => `Tag "${tagText(s.project, o as TagObj)}" (page ${i + 1})`));
  if (gone.length) {
    const last = getState().pastLog[getState().pastLog.length - 1];
    labelLast(last.label + `, ${plural(gone.length, 'reference tag')} elsewhere`, [...(last.details ?? []), ...gone.map((g) => 'Removed: ' + g)]);
  }
  setState({ selection: [], selectedPorts: [] });
}

/** Remove unreferenced devices/defs and dangling connections. */
export function gc(d: D) {
  const usedDevices = new Set<string>();
  for (const pg of d.pages) for (const o of pg.objects) if (o.kind === 'block' || o.kind === 'rackunit') usedDevices.add(o.deviceId);
  for (const id of Object.keys(d.devices)) if (!usedDevices.has(id)) delete d.devices[id];
  const usedDefs = new Set(Object.values(d.devices).map((v) => v.defId));
  for (const pg of d.pages) for (const o of pg.objects) if (o.kind === 'block' && o.defId) usedDefs.add(o.defId);
  for (const id of Object.keys(d.blockDefs)) if (!usedDefs.has(id)) delete d.blockDefs[id];
  for (const pg of d.pages) {
    const objs = new Map(pg.objects.map((o) => [o.id, o]));
    pg.connections = pg.connections.filter((c) => endpointAlive(d, objs, c.from) && endpointAlive(d, objs, c.to));
    pruneBundles(pg);
  }
  // Reference tags pointing at a device that no longer exists anywhere.
  for (const pg of d.pages) pg.objects = pg.objects.filter((o) => !(o.kind === 'tag' && o.target && !d.devices[o.target.deviceId]));
  for (const pg of d.pages) {
    const objs = new Set(pg.objects.map((o) => o.id));
    pg.connections = pg.connections.filter((c) => objs.has(c.from.objId) && objs.has(c.to.objId));
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
  const def = dev && (d.blockDefs[o.defId ?? ''] ?? d.blockDefs[dev.defId]);
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
    unglueMoved(pg, set);
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
      if (!set.has(o.id) || o.kind === 'rack' || o.kind === 'rackunit') continue;
      if (o.kind === 'text' || o.kind === 'image') o.border = { ...(o.border ?? { color: '#000000', width: 1, dash: 'solid' }), ...style } as StrokeStyle;
      else o.border = { ...o.border, ...style } as StrokeStyle;
    }
    for (const c of pg.connections) if (set.has(c.id)) c.style = { ...c.style, ...style } as StrokeStyle;
    for (const b of pg.bundles ?? []) if (set.has(b.id)) b.style = { ...b.style, ...style } as StrokeStyle;
  });
}

/**
 * Rename a device (every instance shows the new name). Renaming to the name of another device of
 * the same model offers to make them one device: the friendly name is the device's identity.
 */
export function renameDevice(deviceId: Id, name: string) {
  const p = getState().project;
  const dev = p.devices[deviceId];
  if (!dev) return;
  const other = Object.values(p.devices).find((d) => d.id !== deviceId && d.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (other) {
    const a = p.blockDefs[dev.defId];
    const b = p.blockDefs[other.defId];
    const sameModel = a && b && a.manufacturer === b.manufacturer && a.model === b.model;
    const pagesA = devicePages(p, deviceId, true);
    const pagesB = devicePages(p, other.id, true);
    const clash = pagesA.some((i) => pagesB.includes(i));
    if (sameModel && !clash) {
      const where = pagesB.map((i) => i + 1).join(', ');
      if (confirm(`"${other.name}" already exists (page ${where}).\n\nOK — it's the same device: show it here too (one name, shared ports).\nCancel — keep them as two separate devices.`)) {
        mergeDevices(deviceId, other.id);
        return;
      }
    } else if (!sameModel) toast(`Another device is already named "${other.name}" (${b?.manufacturer} ${b?.model}).`, 'warn', 5000);
    else toast(`"${other.name}" is already on this page — kept as two devices with the same name.`, 'warn', 5000);
  }
  nextLabel(`Rename device "${dev.name}" → "${name}"`);
  updateProject((d) => {
    const dv = d.devices[deviceId];
    if (dv) dv.name = name;
  });
}

/** Make every instance of device `from` an instance of device `into` (lines are kept by port id, else by port name). */
export function mergeDevices(from: Id, into: Id) {
  const p = getState().project;
  const fromDef = p.blockDefs[p.devices[from].defId];
  const intoDef = p.blockDefs[p.devices[into].defId];
  const portMap = new Map<Id, Id>();
  if (fromDef && intoDef) {
    for (const col of ['left', 'right'] as const)
      for (const pt of fromDef[col]) {
        const m = intoDef[col].find((x) => x.id === pt.id) ?? intoDef[col].find((x) => x.name === pt.name);
        if (m) portMap.set(pt.id, m.id);
      }
  }
  const before = p;
  nextLabel(`Merge "${p.devices[from].name}" into "${p.devices[into].name}" (same device)`);
  updateProject((d) => {
    for (const pg of d.pages) {
      const objs = new Set<Id>();
      for (const o of pg.objects) if (o.kind === 'rackunit' && o.deviceId === from) o.deviceId = into;
      for (const o of pg.objects)
        if (o.kind === 'block' && o.deviceId === from) {
          o.deviceId = into;
          objs.add(o.id);
          // Rows hidden by id follow the mapping.
          if (o.hidden) o.hidden = o.hidden.map((h) => portMap.get(h) ?? h);
        }
      for (const c of pg.connections)
        for (const e of [c.from, c.to]) {
          const own = pg.objects.find((o) => o.id === e.objId);
          if (isPortEndpoint(e) && objs.has(e.objId) && !(own?.kind === 'block' && own.defId)) e.portId = portMap.get(e.portId) ?? e.portId;
        }
      for (const o of pg.objects)
        if (o.kind === 'tag' && o.target?.deviceId === from) {
          o.target.deviceId = into;
          if (o.target.portId) o.target.portId = portMap.get(o.target.portId);
        }
    }
    gc(d);
  });
  const lost = lostConnections(before, getState().project);
  if (lost.length) {
    labelLast(`Merge into "${before.devices[into].name}" — ${plural(lost.length, 'connection')} removed`, lost.map((l) => 'Removed: ' + l));
    toast(`${plural(lost.length, 'line')} removed: those ports don't exist on "${before.devices[into].name}". See History.`, 'warn', 8000);
  } else toast(`Now one device: "${before.devices[into].name}".`);
}

/** Split one placed block off into a new device of the same model (e.g. a second console). */
export function makeSeparateDevice(objId: Id, name: string) {
  const s = getState();
  const o = currentPage(s).objects.find((x) => x.id === objId);
  if (!o || o.kind !== 'block') return;
  const dev = s.project.devices[o.deviceId];
  const nd: ProjectDevice = { id: newId('dv'), defId: dev.defId, name: name.trim() || uniqueDeviceName(s.project, dev.name) };
  nextLabel(`Make "${nd.name}" a separate device (was "${dev.name}")`);
  updateProject((d) => {
    d.devices[nd.id] = nd;
    const t = pageDraft(d).objects.find((x) => x.id === objId);
    if (t?.kind === 'block') t.deviceId = nd.id;
  });
}

// ---------------------------------------------------------------------------------------------
// Rows / ports of one placed block

/** Show or hide rows on one block (other instances and the library are unchanged). */
export function setHiddenPorts(objId: Id, hidden: Id[]) {
  const s = getState();
  const page = currentPage(s);
  const o = page.objects.find((x) => x.id === objId);
  if (!o || o.kind !== 'block') return false;
  const used = page.connections.flatMap((c) => [c.from, c.to]).filter((e) => isPortEndpoint(e) && e.objId === objId && hidden.includes(e.portId));
  if (used.length) {
    const { base } = blockFor(s.project, o);
    const names = [...new Set(used.map((e) => (base && isPortEndpoint(e) ? findPort(base, e.portId)?.port.name : '') ?? ''))].join(', ');
    toast(`Can't hide ${names}: there's a line on it on this page. Delete the line first.`, 'warn', 6000);
    return false;
  }
  nextLabel(`${hidden.length > (o.hidden?.length ?? 0) ? 'Hide' : 'Show'} rows on ${s.project.devices[o.deviceId]?.name}`);
  patchObjects([objId], (t) => void (t.kind === 'block' && (t.hidden = hidden.length ? hidden : undefined)));
  return true;
}

/** Save ports edited for this block only: the block gets its own port list (connections keep port ids). */
export function saveInstanceDef(objId: Id, def: BlockDef): string[] {
  const s = getState();
  const o = currentPage(s).objects.find((x) => x.id === objId);
  if (!o || o.kind !== 'block') return [];
  const id = o.defId ?? newId('bd');
  const name = s.project.devices[o.deviceId]?.name;
  const before = s.project;
  updateProject((d) => {
    d.blockDefs[id] = { ...def, id } as Draft<BlockDef>;
    const t = pageDraft(d).objects.find((x) => x.id === objId);
    if (t?.kind === 'block') {
      t.defId = id;
      // Hidden rows that no longer exist are forgotten.
      if (t.hidden) t.hidden = t.hidden.filter((h) => findPort(def, h));
    }
    gc(d);
  }, `Edit ports of ${name} (this block only)`);
  const lost = lostConnections(before, getState().project);
  if (lost.length) labelLast(`Edit ports of ${name} (this block only) — ${plural(lost.length, 'connection')} removed`, lost.map((l) => 'Removed: ' + l));
  return lost;
}

/** Back to the device's shared ports. */
export function revertInstanceDef(objId: Id) {
  const s = getState();
  const o = currentPage(s).objects.find((x) => x.id === objId);
  if (!o || o.kind !== 'block' || !o.defId) return;
  const before = s.project;
  nextLabel(`Use shared ports for ${s.project.devices[o.deviceId]?.name}`);
  updateProject((d) => {
    const t = pageDraft(d).objects.find((x) => x.id === objId);
    if (t?.kind === 'block') delete t.defId;
    gc(d);
  });
  const lost = lostConnections(before, getState().project);
  if (lost.length) {
    labelLast(`Use shared ports for ${before.devices[o.deviceId]?.name} — ${plural(lost.length, 'connection')} removed`, lost.map((l) => 'Removed: ' + l));
    toast(`${plural(lost.length, 'line')} removed (their ports only existed on this block). See History.`, 'warn', 7000);
  }
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
  const rs = s.selection.map((id) => routes.get(id)).filter((r): r is ResolvedRoute => !!r && !!r.conn.label && !r.legs);
  const axis: 'x' | 'y' = mode === 'left' || mode === 'hcenter' || mode === 'right' ? 'x' : 'y';
  type Item = { r: ResolvedRoute; idx: number; lb: LabelBox };
  // Which labels line up: lines with one label use it. A line with a label at each end uses the one
  // nearest the reference label (below); if every line has two, start labels line up with start
  // labels and end labels with end labels.
  // Reference for centring: the label of the line selected first — it stays where it is.
  const order = (it: Item) => s.selection.indexOf(it.r.conn.id);
  const singles: Item[] = rs.filter((r) => !r.conn.labelEnds).map((r) => ({ r, idx: 0, lb: labelBox(r)! }));
  const doubles = rs.filter((r) => r.conn.labelEnds);
  const groups: Item[][] = [];
  if (singles.length) {
    const ref0 = [...singles].sort((a, b) => order(a) - order(b))[0];
    const c = axis === 'x' ? ref0.lb.p.x : ref0.lb.p.y;
    const near = doubles.map((r) => {
      const bs = labelBoxes(r);
      const k = bs.length > 1 && Math.abs((axis === 'x' ? bs[1].p.x : bs[1].p.y) - c) < Math.abs((axis === 'x' ? bs[0].p.x : bs[0].p.y) - c) ? 1 : 0;
      return { r, idx: k, lb: bs[k] };
    });
    groups.push([...singles, ...near]);
  } else {
    groups.push(doubles.map((r) => ({ r, idx: 0, lb: labelBoxes(r)[0] })));
    groups.push(doubles.map((r) => ({ r, idx: 1, lb: labelBoxes(r)[1] })).filter((x) => x.lb));
  }
  if (!groups.some((g) => g.length >= 2)) {
    toast('Select two or more labelled lines to align their labels.', 'warn');
    return;
  }
  let missed = 0;
  const sets: { id: Id; idx: number; t: number }[] = [];
  for (const items of groups) {
    if (items.length < 2) continue;
    const lo = (i: Item) => (axis === 'x' ? i.lb.box.x : i.lb.box.y);
    const hi = (i: Item) => (axis === 'x' ? i.lb.box.x + i.lb.box.w : i.lb.box.y + i.lb.box.h);
    const minV = Math.min(...items.map(lo));
    const maxV = Math.max(...items.map(hi));
    // Reference: the label of the line selected first — it stays put; the others take its left
    // edge, centre or right edge (top / middle / bottom for labels on vertical runs).
    const ref = [...items].sort((a, b) => order(a) - order(b))[0];
    void minV;
    void maxV;
    for (const it of items) {
      if (it === ref) continue;
      // Half its length along the alignment axis once it sits on a run in that direction
      // (a label moving off a vertical run turns horizontal).
      const half = (it.lb.tw + 4) / 2;
      const target = mode === 'left' || mode === 'top' ? lo(ref) + half : mode === 'right' || mode === 'bottom' ? hi(ref) - half : (lo(ref) + hi(ref)) / 2;
      const t = labelTAt(it.r, axis, target, it.lb.p);
      if (t === null) missed++;
      else sets.push({ id: it.r.conn.id, idx: it.idx, t });
    }
  }
  updateProject((d) => {
    for (const c of pageDraft(d).connections) for (const x of sets) if (x.id === c.id) Object.assign(c, withLabelT(c, x.idx, x.t));
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
  pageId: Id;
  objects: PageObject[];
  connections: Connection[];
  bundles: Bundle[];
  project: Project;
}
let clip: ClipData | null = null;
let pasteCount = 0;
const pastedOn = new Set<Id>();

export function copySelection() {
  const s = getState();
  const pg = currentPage();
  const sel = new Set(s.selection);
  for (const o of pg.objects) if (o.kind === 'rackunit' && o.rackId && sel.has(o.rackId)) sel.add(o.id);
  const objects = pg.objects.filter((o) => sel.has(o.id));
  if (!objects.length) return;
  const ids = new Set(objects.map((o) => o.id));
  const connections = pg.connections.filter((c) => ids.has(c.from.objId) && ids.has(c.to.objId));
  const cids = new Set(connections.map((c) => c.id));
  const bundles = (pg.bundles ?? []).filter((b) => b.connIds.every((id) => cids.has(id)));
  clip = { pageId: pg.id, objects, connections, bundles, project: s.project };
  pasteCount = 0;
  pastedOn.clear();
}

/**
 * Give the selected lines the next auto-numbers, top to bottom then left to right (by their
 * output end). Lines that already have a label keep it unless `relabel`.
 */
export function numberLines(ids: Id[], relabel = false) {
  const s = getState();
  const pg = currentPage(s);
  const auto = s.project.autoLabel ?? DEFAULT_AUTO_LABEL;
  const routes = resolvePageRoutes(s.project, pg);
  const lines = pg.connections
    .filter((c) => ids.includes(c.id) && (relabel || !c.label))
    .map((c) => ({ c, a: routes.get(c.id)?.s }))
    .sort((p, q) => (p.a?.y ?? 0) - (q.a?.y ?? 0) || (p.a?.x ?? 0) - (q.a?.x ?? 0));
  if (!lines.length) {
    toast('Those lines already have labels.', 'info');
    return;
  }
  const first = formatLabel(auto, auto.next);
  const last = formatLabel(auto, auto.next + lines.length - 1);
  nextLabel(`Number ${plural(lines.length, 'line')} ${first}${lines.length > 1 ? '–' + last : ''}`);
  updateProject((d) => {
    const pgd = pageDraft(d);
    lines.forEach((l, i) => {
      const c = pgd.connections.find((x) => x.id === l.c.id);
      if (c) c.label = formatLabel(auto, auto.next + i);
    });
    d.autoLabel = { ...auto, next: auto.next + lines.length };
  });
}

export function hasClipboard() {
  return !!clip;
}

export function cutSelection() {
  copySelection();
  deleteSelection();
}

interface CopyOpts {
  /** Page the copies go to (devices already there get a new device); null = a new page. */
  onPage: Page | null;
  /** Always make new devices (Ctrl+Shift+V). */
  forceNew: boolean;
}

/**
 * Copy objects (+ connections and snakes among them) with new ids. A block becomes another
 * instance of the same device when that device isn't on the target page yet (copying to another
 * page shows the same equipment); otherwise — or when forced — it gets a new device.
 */
function copyObjectsInto(
  project: Project,
  src: Project,
  objects: readonly PageObject[],
  connections: readonly Connection[],
  dx: number,
  dy: number,
  bundles: readonly Bundle[],
  opts: CopyOpts,
) {
  const idMap = new Map<string, string>();
  const devices: Record<string, ProjectDevice> = {};
  const defs: Record<string, BlockDef> = {};
  const scratch = { ...project, devices: { ...project.devices } };
  const onPage = new Set(opts.onPage?.objects.filter((o) => o.kind === 'block').map((o) => (o as BlockObj).deviceId) ?? []);
  const inRackOnPage = new Set(opts.onPage?.objects.filter((o): o is RackUnitObj => o.kind === 'rackunit').map((o) => o.deviceId) ?? []);
  const outObjs: PageObject[] = objects.map((o) => {
    const id = newId('ob');
    idMap.set(o.id, id);
    if (o.kind === 'block') {
      const dev = src.devices[o.deviceId];
      let deviceId = o.deviceId;
      if (opts.forceNew || !project.devices[o.deviceId] || onPage.has(o.deviceId)) {
        const nd: ProjectDevice = { id: newId('dv'), defId: dev.defId, name: uniqueDeviceName(scratch, dev.name) };
        devices[nd.id] = nd;
        scratch.devices[nd.id] = nd;
        deviceId = nd.id;
      }
      onPage.add(deviceId);
      // A block with its own port list gets its own copy of it.
      let defId = o.defId;
      if (defId && src.blockDefs[defId]) {
        const c = { ...cloneDef(src.blockDefs[defId]), libraryId: src.blockDefs[defId].libraryId };
        defs[c.id] = c;
        defId = c.id;
      }
      return { ...o, id, deviceId, defId, hidden: o.hidden ? [...o.hidden] : undefined, x: o.x + dx, y: o.y + dy, border: { ...o.border } };
    }
    if (o.kind === 'rackunit') {
      // Same rule as blocks: the same device on another page, a new one where it's already racked.
      const dev = src.devices[o.deviceId];
      let deviceId = o.deviceId;
      if (opts.forceNew || !project.devices[o.deviceId] || inRackOnPage.has(o.deviceId)) {
        const nd: ProjectDevice = { id: newId('dv'), defId: dev.defId, name: uniqueDeviceName(scratch, dev.name) };
        devices[nd.id] = nd;
        scratch.devices[nd.id] = nd;
        deviceId = nd.id;
      }
      inRackOnPage.add(deviceId);
      return { ...o, id, deviceId, x: o.x + dx, y: o.y + dy };
    }
    const copy = { ...JSON.parse(JSON.stringify(o)), id, x: o.x + dx, y: o.y + dy };
    if (copy.kind === 'tag') {
      delete copy.pairId;
      delete copy.auto;
    }
    return copy;
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
  // Callout pointers glued to an object or line: follow the copy of it, or keep pointing at the same spot.
  outObjs.forEach((o, i) => {
    if (o.kind !== 'callout' || !o.tailTo) return;
    const orig = objects[i] as CalloutObj;
    const tt = o.tailTo;
    const to = idMap.get('connId' in tt ? tt.connId : tt.objId);
    if (to) o.tailTo = 'connId' in tt ? { ...tt, connId: to } : { ...tt, objId: to };
    else {
      const tip = calloutTip(src, orig);
      o.tail = { x: tip.x - orig.x, y: tip.y - orig.y };
      delete o.tailTo;
    }
  });
  // Rack units follow the copy of their rack, or stand on their own.
  for (const o of outObjs) if (o.kind === 'rackunit' && o.rackId) o.rackId = idMap.get(o.rackId) ?? null;
  // Drawn lines glued to something: follow the copy of it, or let go.
  for (const o of outObjs) {
    if (o.kind !== 'line' || !o.ends) continue;
    o.ends = o.ends.map((g) => {
      if (!g) return null;
      const to = idMap.get('connId' in g ? g.connId : g.objId);
      return to ? ('connId' in g ? { ...g, connId: to } : { ...g, objId: to }) : null;
    }) as [LineGlue | null, LineGlue | null];
  }
  const outBundles: Bundle[] = bundles.map((b) => ({
    ...JSON.parse(JSON.stringify(b)),
    id: newId('bn'),
    connIds: b.connIds.map((id) => idMap.get(id)!),
    bends: b.bends ? b.bends.map((v, i) => v + (i % 2 === 0 ? dx : dy)) : null,
  }));
  return { objects: outObjs, connections: outConns, bundles: outBundles, devices, defs };
}

/**
 * Paste. Blocks pasted onto a page where their device isn't yet become the same device (one
 * friendly name, shared ports); on the same page — or with Ctrl+Shift+V (`newDevices`) — they're
 * new devices of the same model.
 */
export function paste(newDevices = false) {
  nextLabel(newDevices ? 'Paste as new devices' : 'Paste');
  if (!clip) return;
  const s = getState();
  pasteCount++;
  const page = currentPage(s);
  // Same position when going to another page, offset when duplicating on the same page.
  const samePage = clip.pageId === page.id || pastedOn.has(page.id);
  pastedOn.add(page.id);
  const off = samePage || newDevices ? 18 * pasteCount : 0;
  // Bring over block defs if pasting from another project.
  const defs: Record<string, BlockDef> = {};
  for (const o of clip.objects) {
    if (o.kind !== 'block' && o.kind !== 'rackunit') continue;
    const dev = clip.project.devices[o.deviceId];
    if (dev && !s.project.blockDefs[dev.defId]) defs[dev.defId] = clip.project.blockDefs[dev.defId];
  }
  // Images bring their assets along (e.g. pasting from another project).
  const assets: Record<string, Asset> = {};
  for (const o of clip.objects) if (o.kind === 'image' && !s.project.assets[o.assetId] && clip.project.assets[o.assetId]) assets[o.assetId] = clip.project.assets[o.assetId];
  const copy = copyObjectsInto(s.project, clip.project, clip.objects, clip.connections, off, off, clip.bundles, { onPage: page, forceNew: newDevices });
  const reused = copy.objects.filter((o) => o.kind === 'block' && s.project.devices[o.deviceId]).length;
  updateProject((d) => {
    Object.assign(d.blockDefs, defs, copy.defs);
    Object.assign(d.devices, copy.devices);
    Object.assign(d.assets, assets);
    const pg = pageDraft(d);
    pg.objects.push(...(copy.objects as Draft<PageObject>[]));
    pg.connections.push(...(copy.connections as Draft<Connection>[]));
    (pg.bundles ??= []).push(...(copy.bundles as Draft<Bundle>[]));
  });
  setState({ selection: [...copy.objects.map((o) => o.id), ...copy.connections.map((c) => c.id), ...copy.bundles.map((b) => b.id)], selectedPorts: [] });
  if (reused) toast(`${plural(reused, 'block')} pasted as the same device${reused === 1 ? '' : 's'} (shared name). Ctrl+Shift+V pastes new devices instead.`, 'info', 5000);
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
  const { dev, def } = blockFor(project, o);
  if (!def || !dev) return null;
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
  const auto = s.project.autoLabel;
  const c: Connection = { id: newId('cn'), from: a, to: b, bends: null, label: auto?.on ? formatLabel(auto, auto.next) : '', labelT: null, style: { ...DEFAULT_LINE } };
  nextLabel('Connect ' + describeConnection(s.project, pg, c));
  updateProject((d) => {
    pageDraft(d).connections.push(c);
    if (auto?.on && d.autoLabel) d.autoLabel.next++;
  }, opts.record ?? true);
  if (warnings.length && !opts.quiet) toast(warnings.join(' '), 'warn', 5000);
  // A line drawn to a tag that already points at a port: add its partner at the far end.
  for (const e of [a, b]) {
    const o = pg.objects.find((x) => x.id === e.objId);
    if (o?.kind === 'tag' && o.target?.portId && !o.pairId) syncTagPair(o.id);
  }
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

/** Connect several port pairs as one history step (multi-port drag). */
export function connectPairs(pairs: [Endpoint, Endpoint][], skipped = 0) {
  const s = getState();
  const pg = currentPage(s);
  let made = 0;
  const warns = new Set<string>();
  const ids: Id[] = [];
  for (const [a, b] of pairs) {
    connectionWarnings(s.project, pg, a, b).forEach((w) => warns.add(w));
    const id = connect(a, b, { record: made === 0, quiet: true });
    if (id) {
      made++;
      ids.push(id);
    }
  }
  if (made) labelLast(`Connect ${plural(made, 'line')}`);
  if (skipped) warns.add(`${plural(skipped, 'port')} had no row to go to on the target block.`);
  if (warns.size || made > 1) toast(`${plural(made, 'line')} connected.` + (warns.size ? ' ' + [...warns].join(' ') : ''), warns.size ? 'warn' : 'info', warns.size ? 6000 : 3000);
  setState({ selection: ids, selectedPorts: [] });
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
  line: 'Line',
  rack: 'Rack',
  rackunit: 'Rack unit',
};

export function kindName(o: PageObject) {
  return KIND_NAMES[o.kind];
}

export function describeObject(p: Project, o: PageObject) {
  if (o.kind === 'block') return p.devices[o.deviceId]?.name ?? 'block';
  if (o.kind === 'tag') return `Tag "${tagText(p, o)}"`;
  if (o.kind === 'image') return 'Image';
  if (o.kind === 'line') return o.arrows === 'none' ? 'Line' : o.arrows === 'both' ? 'Double arrow' : 'Arrow';
  if (o.kind === 'rack') return 'Rack' + (o.tag.trim() || o.name.trim() ? ` "${(o.tag.trim() || o.name.trim()).slice(0, 24)}"` : '');
  if (o.kind === 'rackunit') return 'Rack unit ' + (p.devices[o.deviceId]?.name ?? '');
  if (o.kind === 'callout' && o.shape === 'cloud') return 'Thought bubble' + (o.text.trim() ? ` "${o.text.trim().split('\n')[0].slice(0, 24)}"` : '');
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
  // Lines between two blocks can only all be level if their rows are spaced the same: match scales first.
  const rescaled = matchScalesForStraightening();
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
    if (!rescaled) toast(selObjs.length || sel.size ? 'Nothing to straighten — the selected lines are already straight (or can\'t be).' : 'Select blocks or lines to straighten.', 'info');
    return;
  }
  updateProject((d) => {
    for (const o of pageDraft(d).objects) if (moves.has(o.id)) o.y += moves.get(o.id)!;
  }, !rescaled);
}

/**
 * For Straighten: a block that has two or more lines to the same other block, at a different
 * scale, takes that block's scale (top-left stays put). Returns how many blocks changed;
 * the change is recorded as the "Straighten" history step.
 */
function matchScalesForStraightening(): number {
  const s = getState();
  const page = currentPage(s);
  const sel = new Set(s.selection);
  const blocks = new Map(page.objects.filter((o): o is BlockObj => o.kind === 'block').map((o) => [o.id, o]));
  // Which block moves, relative to which: selected blocks against unselected; selected lines move their input end.
  const pairs = new Map<Id, Map<Id, number>>(); // mover → other → line count
  const add = (mover: Id, other: Id) => {
    if (!blocks.has(mover) || !blocks.has(other) || mover === other) return;
    const m = pairs.get(mover) ?? new Map<Id, number>();
    m.set(other, (m.get(other) ?? 0) + 1);
    pairs.set(mover, m);
  };
  const selObjs = page.objects.filter((o) => sel.has(o.id));
  for (const c of page.connections) {
    if (!isPortEndpoint(c.from) || !isPortEndpoint(c.to)) continue;
    if (selObjs.length) {
      if (sel.has(c.from.objId) && !sel.has(c.to.objId)) add(c.from.objId, c.to.objId);
      if (sel.has(c.to.objId) && !sel.has(c.from.objId)) add(c.to.objId, c.from.objId);
    } else if (sel.has(c.id)) add(c.to.objId, c.from.objId);
  }
  const scales = new Map<Id, number>();
  for (const [mover, others] of pairs) {
    const best = [...others.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
    if (!best) continue;
    const target = blocks.get(best[0])!.scale;
    if (Math.abs(blocks.get(mover)!.scale - target) > 1e-6) scales.set(mover, target);
  }
  if (!scales.size) return 0;
  updateProject((d) => {
    for (const o of pageDraft(d).objects) if (o.kind === 'block' && scales.has(o.id)) o.scale = scales.get(o.id)!;
  });
  labelLast('Straighten (matched block scale so the rows line up)');
  toast(`${plural(scales.size, 'block')} rescaled to match the block ${scales.size === 1 ? 'it’s' : 'they’re'} wired to, so every row can line up.`, 'info', 5000);
  return scales.size;
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
      // Shapes (e.g. owner-furnished equipment drawn as a rectangle) have no ports: anything goes.
      if (!isPortEndpoint(e)) continue;
      const info = portInfo(project, page, e);
      if (!info) return 'A line ends on a missing port.';
      if (!sides.has(e.objId)) sides.set(e.objId, new Set());
      sides.get(e.objId)!.add(info.side);
      signals.add((info.port.signal || '').toUpperCase());
    }
  }
  if (signals.size > 1) return `All lines must carry the same signal type (found ${[...signals].map((x) => x || 'none').join(', ')}).`;
  if ([...sides.values()].some((x) => x.size > 1)) return 'On each device the ports must be in the same column.';
  return null;
}

/**
 * Select the next / previous line (Shift+↓ / Shift+↑), e.g. to label lines one after another:
 * first the other lines leaving the same object, top to bottom, then all lines on the page.
 */
export function selectNextLine(dir: 1 | -1) {
  const s = getState();
  const page = currentPage(s);
  const routes = resolvePageRoutes(s.project, page);
  const cur = page.connections.find((c) => c.id === s.selection[0]);
  const at = (c: Connection) => routes.get(c.id)?.s ?? { x: 0, y: 0 };
  const order = (a: Connection, b: Connection) => at(a).y - at(b).y || at(a).x - at(b).x;
  const all = [...page.connections].sort(order);
  if (!all.length) return;
  if (!cur) {
    setState({ selection: [dir > 0 ? all[0].id : all[all.length - 1].id], selectedPorts: [] });
    return;
  }
  const same = all.filter((c) => c.from.objId === cur.from.objId);
  const i = same.indexOf(cur);
  let next = same[i + dir];
  if (!next) {
    const j = all.indexOf(cur);
    next = all[(j + dir + all.length) % all.length];
  }
  setState({ selection: [next.id], selectedPorts: [] });
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
    // Rack position, if mounted: rack tag/name and RU span.
    let rack = '';
    let ru = '';
    for (const pg of project.pages)
      for (const o of pg.objects) {
        if (o.kind !== 'rackunit' || o.deviceId !== dev.id || rack) continue;
        const r = pg.objects.find((x) => x.id === o.rackId);
        if (r?.kind !== 'rack') continue;
        const n = rackSpecOf(def).ru;
        rack = r.tag.trim() || r.name.trim() || 'Rack';
        ru = n > 1 ? `${o.u}-${o.u + n - 1}` : String(o.u);
      }
    return [def?.manufacturer ?? '', def?.model ?? '', dev.name, devicePages(project, dev.id).map((i) => i + 1).join(', '), rack, ru];
  });
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2], undefined, { numeric: true }));
  const esc = (v: string) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  return [['Manufacturer', 'Model', 'Friendly name', 'Page(s)', 'Rack', 'RU'], ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

void rotOf;
