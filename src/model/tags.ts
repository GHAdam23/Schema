// Reference tags: text generation and automatic size.
import type { Id, Page, Project, TagObj } from './types';
import { isPortEndpoint } from './types';
import { BLK, findPort } from './blockGeometry';
import { measureText } from '../text/fonts';

export const TAG_PAD_X = 4;
export const TAG_PAD_Y = 2.5;

const pageCache = new WeakMap<Project['pages'], Map<Id, Page>>();

/** The page an object sits on (cached per project version). */
export function pageOfObject(project: Project, objId: Id): Page | undefined {
  let m = pageCache.get(project.pages);
  if (!m) {
    m = new Map();
    for (const pg of project.pages) for (const o of pg.objects) m.set(o.id, pg);
    pageCache.set(project.pages, m);
  }
  return m.get(objId);
}

/** Pages (indices) on which a device has an instance (a block, or a rack unit unless `blocksOnly`). */
export function devicePages(project: Project, deviceId: Id, blocksOnly = false): number[] {
  const out: number[] = [];
  project.pages.forEach((pg, i) => {
    if (pg.objects.some((o) => (o.kind === 'block' || (!blocksOnly && o.kind === 'rackunit')) && o.deviceId === deviceId)) out.push(i);
  });
  return out;
}

/** Pages (indices) on which a device's port has a connection. */
export function portPages(project: Project, deviceId: Id, portId: Id): number[] {
  const out: number[] = [];
  project.pages.forEach((pg, i) => {
    const inst = new Set(pg.objects.filter((o) => o.kind === 'block' && o.deviceId === deviceId).map((o) => o.id));
    if (!inst.size) return;
    const hit = pg.connections.some((c) => [c.from, c.to].some((e) => isPortEndpoint(e) && inst.has(e.objId) && e.portId === portId));
    if (hit) out.push(i);
  });
  return out;
}

/** Index of the page a tag points to, or -1. Prefers another page than the tag's own. */
export function tagTargetPage(project: Project, tag: TagObj): number {
  if (!tag.target) return -1;
  const own = pageOfObject(project, tag.id);
  const ownIdx = own ? project.pages.indexOf(own) : -1;
  const pick = (list: number[]) => list.find((i) => i !== ownIdx) ?? (list.includes(ownIdx) ? ownIdx : undefined);
  if (tag.target.portId) {
    const p = pick(portPages(project, tag.target.deviceId, tag.target.portId));
    if (p !== undefined) return p;
  }
  return pick(devicePages(project, tag.target.deviceId, true)) ?? pick(devicePages(project, tag.target.deviceId)) ?? -1;
}

/** TO / FROM: explicit, or from the line attached to the tag (tag at the line's end = TO). */
export function tagDirection(project: Project, tag: TagObj): 'TO' | 'FROM' {
  if (tag.dir !== 'auto') return tag.dir;
  const pg = pageOfObject(project, tag.id);
  const c = pg?.connections.find((x) => x.from.objId === tag.id || x.to.objId === tag.id);
  return c && c.from.objId === tag.id ? 'FROM' : 'TO';
}

export function tagText(project: Project, tag: TagObj): string {
  const dir = tagDirection(project, tag);
  const parts: string[] = [dir];
  const dev = tag.target ? project.devices[tag.target.deviceId] : undefined;
  if (!tag.target) parts.push('(?)', 'choose a device…');
  else if (!dev) parts.push('(?)', 'missing device');
  else {
    const pi = tagTargetPage(project, tag);
    parts.push(`(${pi >= 0 ? pi + 1 : '?'})`, dev.name);
    if (tag.showPort && tag.target.portId) {
      const def = project.blockDefs[dev.defId];
      const port = def && findPort(def, tag.target.portId);
      if (port) parts.push(port.port.name);
    }
  }
  if (tag.note.trim()) parts.push(tag.note.trim());
  return parts.join(' ');
}

/** Font size actually used: shrunk if a fixed height is too small for it. */
export function tagFontSize(tag: TagObj) {
  return tag.height ? Math.min(tag.fontSize, Math.max(3, (tag.height - 1.5) / 1.15)) : tag.fontSize;
}

export function tagSize(project: Project, tag: TagObj) {
  const t = tagText(project, tag);
  const fs = tagFontSize(tag);
  return {
    w: Math.ceil(measureText(t, 'narrow', fs) + TAG_PAD_X * 2),
    h: tag.height ?? Math.ceil((tag.fontSize * 1.2 + TAG_PAD_Y * 2) * 2) / 2,
  };
}

/** Tag look for a tag sitting at a block's port: as tall as the port's row, in the row's font size. */
export function tagRowFit(scale: number) {
  return { height: BLK.rowH * scale, fontSize: BLK.portSize * scale };
}
