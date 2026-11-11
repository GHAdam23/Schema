import type { BlockDef, BlockObj, PortDef, Project, Side } from './types';
import { measureText } from '../text/fonts';

// Unscaled block layout constants (points).
export const BLK = {
  headerH: 13,
  headerSize: 7.5,
  rowH: 10,
  portSize: 6.5,
  footerH: 12,
  footerSize: 7,
  pad: 4,
  gap: 12,
  minW: 96,
};

export const SEP = ' – ';

export function portText(p: PortDef, side: Side): string {
  const parts = side === 'L' ? [p.name, p.signal, p.connector] : [p.connector, p.signal, p.name];
  return parts.filter((s) => s && s.trim() !== '').join(SEP);
}

export function headerText(def: BlockDef): string {
  return [def.manufacturer, def.model].filter((s) => s.trim() !== '').join(' | ');
}

export interface BlockLayout {
  w: number;
  h: number;
  rows: number;
  colW: number; // width of each column half
}

const layoutCache = new WeakMap<BlockDef, Map<string, BlockLayout>>();

export function blockLayout(def: BlockDef, name: string): BlockLayout {
  let m = layoutCache.get(def);
  if (!m) layoutCache.set(def, (m = new Map()));
  const hit = m.get(name);
  if (hit) return hit;
  const rows = Math.max(def.left.length, def.right.length, 1);
  const lw = Math.max(0, ...def.left.map((p) => measureText(portText(p, 'L'), 'narrow', BLK.portSize)));
  const rw = Math.max(0, ...def.right.map((p) => measureText(portText(p, 'R'), 'narrow', BLK.portSize)));
  const colW = Math.max(lw, rw) + BLK.pad;
  const header = measureText(headerText(def), 'narrowBold', BLK.headerSize) + BLK.pad * 2;
  const footer =
    measureText(name, 'narrowBold', BLK.footerSize) +
    2 * (measureText('OUT', 'narrow', BLK.footerSize) + BLK.pad * 2);
  const w = Math.ceil(Math.max(BLK.minW, colW * 2 + BLK.gap, header, footer));
  const h = BLK.headerH + rows * BLK.rowH + BLK.footerH;
  const res = { w, h, rows, colW: (w - BLK.gap) / 2 };
  m.set(name, res);
  return res;
}

export function blockFor(project: Project, obj: BlockObj) {
  const dev = project.devices[obj.deviceId];
  const def = dev ? project.blockDefs[dev.defId] : undefined;
  return { dev, def };
}

export function blockSize(project: Project, obj: BlockObj) {
  const { dev, def } = blockFor(project, obj);
  if (!dev || !def) return { w: 40 * obj.scale, h: 20 * obj.scale };
  const L = blockLayout(def, dev.name);
  return { w: L.w * obj.scale, h: L.h * obj.scale };
}

export function findPort(def: BlockDef, portId: string): { port: PortDef; side: Side; index: number } | null {
  let i = def.left.findIndex((p) => p.id === portId);
  if (i >= 0) return { port: def.left[i], side: 'L', index: i };
  i = def.right.findIndex((p) => p.id === portId);
  if (i >= 0) return { port: def.right[i], side: 'R', index: i };
  return null;
}

/** Port anchor point on the page plus outward direction. */
export function portAnchor(project: Project, obj: BlockObj, portId: string) {
  const { dev, def } = blockFor(project, obj);
  if (!dev || !def) return null;
  const f = findPort(def, portId);
  if (!f) return null;
  const L = blockLayout(def, dev.name);
  const s = obj.scale;
  const y = obj.y + (BLK.headerH + f.index * BLK.rowH + BLK.rowH / 2) * s;
  const x = f.side === 'L' ? obj.x : obj.x + L.w * s;
  return { x, y, dir: f.side === 'L' ? ([-1, 0] as const) : ([1, 0] as const), side: f.side, port: f.port };
}

/** Rectangle of a port row (for hit-testing and selection highlight). */
export function portRowRect(project: Project, obj: BlockObj, side: Side, index: number) {
  const { dev, def } = blockFor(project, obj);
  if (!dev || !def) return null;
  const L = blockLayout(def, dev.name);
  const s = obj.scale;
  const colW = L.w / 2;
  return {
    x: obj.x + (side === 'L' ? 0 : colW) * s,
    y: obj.y + (BLK.headerH + index * BLK.rowH) * s,
    w: colW * s,
    h: BLK.rowH * s,
  };
}
