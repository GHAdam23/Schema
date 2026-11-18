// Cable list: every line in the project as one cable, from device/port to device/port.
// A line that ends at a reference tag counts as going to what the tag points at, so a cable drawn
// across two pages (line → tag … tag → line) is listed once.
import type { Endpoint, Page, PageObject, Project } from './types';
import { isPortEndpoint } from './types';
import { blockFor, findPort } from './blockGeometry';
import { connSignal } from './signals';

export interface CableEnd {
  device: string;
  port: string;
  connector: string;
  signal: string;
}

export interface CableRow {
  label: string;
  signal: string;
  from: CableEnd;
  to: CableEnd;
  pages: number[];
}

function shapeName(o: PageObject): string {
  if ('text' in o && o.text.trim()) return o.text.trim().split('\n')[0];
  return o.kind === 'rect' ? 'Rectangle' : o.kind === 'ellipse' ? 'Ellipse' : o.kind === 'text' ? 'Text box' : o.kind;
}

function portEnd(project: Project, deviceId: string, portId: string | undefined, defId?: string): CableEnd {
  const dev = project.devices[deviceId];
  const def = project.blockDefs[defId ?? ''] ?? (dev ? project.blockDefs[dev.defId] : undefined);
  const p = def && portId ? findPort(def, portId)?.port : undefined;
  return { device: dev?.name ?? '?', port: p?.name ?? '', connector: p?.connector ?? '', signal: (p?.signal ?? '').toUpperCase() };
}

function endOf(project: Project, page: Page, e: Endpoint): CableEnd {
  const o = page.objects.find((x) => x.id === e.objId);
  if (!o) return { device: '?', port: '', connector: '', signal: '' };
  if (o.kind === 'block' && isPortEndpoint(e)) {
    const { base } = blockFor(project, o);
    return portEnd(project, o.deviceId, e.portId, base?.id);
  }
  if (o.kind === 'tag') {
    if (!o.target) return { device: '(tag, not linked)', port: '', connector: '', signal: '' };
    return portEnd(project, o.target.deviceId, o.target.portId);
  }
  return { device: shapeName(o), port: '', connector: '', signal: '' };
}

const key = (e: CableEnd) => `${e.device}\u0000${e.port}`;

export function cableList(project: Project): CableRow[] {
  const rows = new Map<string, CableRow>();
  project.pages.forEach((pg, pi) => {
    for (const c of pg.connections) {
      const from = endOf(project, pg, c.from);
      const to = endOf(project, pg, c.to);
      const k1 = key(from) + '\u0001' + key(to);
      const k2 = key(to) + '\u0001' + key(from);
      const hit = rows.get(k1) ?? rows.get(k2);
      if (hit) {
        if (!hit.pages.includes(pi + 1)) hit.pages.push(pi + 1);
        if (!hit.label && c.label) hit.label = c.label;
        continue;
      }
      const signal = connSignal(project, pg, c) || from.signal || to.signal;
      rows.set(k1, { label: c.label, signal, from, to, pages: [pi + 1] });
    }
  });
  const out = [...rows.values()];
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  // Labelled cables in label order first, then the rest by source device / port.
  out.sort((a, b) => (a.label ? 0 : 1) - (b.label ? 0 : 1) || cmp(a.label, b.label) || cmp(a.from.device, b.from.device) || cmp(a.from.port, b.from.port));
  return out;
}

export const CABLE_HEADERS = ['Label', 'Signal', 'From', 'From port', 'From connector', 'To', 'To port', 'To connector', 'Page(s)'];

export function cableRows(project: Project): string[][] {
  return cableList(project).map((r) => [r.label, r.signal, r.from.device, r.from.port, r.from.connector, r.to.device, r.to.port, r.to.connector, r.pages.join(', ')]);
}

export function cableListCsv(project: Project): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  return [CABLE_HEADERS, ...cableRows(project)].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}
