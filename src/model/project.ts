import type { BlockDef, Page, PageSizeId, Project } from './types';
import type { Prefs } from '../state/prefs';
import { newId } from './ids';

export function newPage(name: string, size: PageSizeId): Page {
  return { id: newId('pg'), name, size, objects: [], connections: [], bundles: [] };
}

export function newProject(prefs: Prefs): Project {
  const now = new Date().toISOString();
  const assets: Project['assets'] = {};
  let logoAssetId: string | null = null;
  if (prefs.logo) {
    logoAssetId = newId('as');
    assets[logoAssetId] = prefs.logo;
  }
  return {
    version: 1,
    info: {
      name: 'Untitled Project',
      address: '',
      designerName: prefs.designerName,
      copyright: prefs.copyright,
      phone: prefs.phone,
      email: prefs.email,
      logoAssetId,
      created: now,
      modified: now,
      revision: '0',
    },
    pages: [newPage('Page 1', prefs.defaultPageSize)],
    devices: {},
    blockDefs: {},
    assets,
  };
}

export function emptyBlockDef(): BlockDef {
  return { id: newId('bd'), manufacturer: '', model: '', left: [], right: [] };
}

/** Deep copy a block definition with a new id (port ids are kept, so connections survive updates). */
export function cloneDef(def: BlockDef, id = newId('bd')): BlockDef {
  return { ...def, id, left: def.left.map((p) => ({ ...p })), right: def.right.map((p) => ({ ...p })) };
}

/** Basic validation / migration of a loaded project. */
export function normalizeProject(p: Project): Project {
  if (!p || !Array.isArray(p.pages) || p.pages.length === 0) throw new Error('Not a valid Schema project');
  p.devices ??= {};
  p.blockDefs ??= {};
  p.assets ??= {};
  for (const d of Object.values(p.blockDefs)) normalizeDirs(d);
  for (const pg of p.pages) {
    pg.objects ??= [];
    for (const o of pg.objects) {
      // Older files: rectangles had no text, text boxes had no vertical alignment.
      if (o.kind === 'rect' || o.kind === 'text' || o.kind === 'ellipse' || o.kind === 'container' || o.kind === 'callout') {
        o.text ??= '';
        o.fontSize ??= 9;
        o.bold ??= false;
        o.align ??= 'center';
        o.color ??= '#000000';
        o.valign ??= o.kind === 'rect' ? 'middle' : 'top';
      }
    }
    pg.connections ??= [];
    pg.bundles ??= [];
    // Drop bundle members that no longer exist.
    const ids = new Set(pg.connections.map((c) => c.id));
    pg.bundles = pg.bundles.map((b) => ({ ...b, connIds: b.connIds.filter((id) => ids.has(id)) })).filter((b) => b.connIds.length >= 2);
  }
  return p;
}

/** A port's direction is defined by its column (left = IN, right = OUT). */
export function normalizeDirs(d: BlockDef): BlockDef {
  for (const p of d.left) p.dir = 'IN';
  for (const p of d.right) p.dir = 'OUT';
  return d;
}
