import type { BlockDef, Page, PageSizeId, Project } from './types';
import type { Prefs } from '../state/prefs';
import { newId } from './ids';

export function newPage(name: string, size: PageSizeId): Page {
  return { id: newId('pg'), name, size, objects: [], connections: [] };
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
  return { id: newId('bd'), manufacturer: '', model: '', defaultName: '', left: [], right: [] };
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
  for (const pg of p.pages) {
    pg.objects ??= [];
    pg.connections ??= [];
  }
  return p;
}
