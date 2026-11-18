// .schema project files: a zip containing project.json plus assets/<id> binaries.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Asset, Project } from '../model/types';

/** Asset entry in project.json; the bytes live in the zip. */
type AssetMeta = Omit<Asset, 'data' | 'preview'> & { file: string; preview?: { mime: string; file: string } };
import { normalizeProject } from '../model/project';
import { bytesToB64 } from './files';

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function serializeProject(p: Project): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const assetsMeta: Record<string, AssetMeta> = {};
  for (const [id, a] of Object.entries(p.assets)) {
    const file = `assets/${id}`;
    files[file] = b64ToBytes(a.data);
    const { data: _d, preview, ...rest } = a;
    void _d;
    const meta: AssetMeta = { ...rest, file };
    if (preview) {
      files[file + '.preview'] = b64ToBytes(preview.data);
      meta.preview = { mime: preview.mime, file: file + '.preview' };
    }
    assetsMeta[id] = meta;
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
  for (const [id, m] of Object.entries(raw.assets ?? {}) as [string, AssetMeta][]) {
    const f = files[m.file];
    if (!f) continue;
    const { file: _f, preview, ...rest } = m;
    void _f;
    const a: Asset = { ...rest, data: bytesToB64(f) };
    const pf = preview && files[preview.file];
    if (preview && pf) a.preview = { mime: preview.mime, data: bytesToB64(pf) };
    assets[id] = a;
  }
  return normalizeProject({ ...raw, assets });
}
