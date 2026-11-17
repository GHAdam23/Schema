// .schema project files: a zip containing project.json plus assets/<id> binaries.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Project } from '../model/types';
import { normalizeProject } from '../model/project';
import { bytesToB64 } from './files';

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function serializeProject(p: Project): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const assetsMeta: Record<string, { mime: string; w: number; h: number; file: string }> = {};
  for (const [id, a] of Object.entries(p.assets)) {
    const file = `assets/${id}`;
    files[file] = b64ToBytes(a.data);
    assetsMeta[id] = { mime: a.mime, w: a.w, h: a.h, file };
  }
  const json = { ...p, assets: assetsMeta };
  files['project.json'] = strToU8(JSON.stringify(json));
  files['mimetype'] = strToU8('application/x-schema');
  return zipSync(files, { level: 6 });
}

export function deserializeProject(bytes: Uint8Array): Project {
  // Accept plain JSON too (handy for debugging).
  if (bytes[0] === 0x7b) return normalizeProject(JSON.parse(strFromU8(bytes)));
  const files = unzipSync(bytes);
  const pj = files['project.json'];
  if (!pj) throw new Error('Not a Schema project (project.json missing)');
  const raw = JSON.parse(strFromU8(pj));
  const assets: Project['assets'] = {};
  for (const [id, m] of Object.entries(raw.assets ?? {}) as [string, { mime: string; w: number; h: number; file: string }][]) {
    const f = files[m.file];
    if (f) assets[id] = { mime: m.mime, w: m.w, h: m.h, data: bytesToB64(f) };
  }
  return normalizeProject({ ...raw, assets });
}
