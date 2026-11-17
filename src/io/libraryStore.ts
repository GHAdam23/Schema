import type { BlockDef } from '../model/types';
import { idbGet, idbSet } from './idb';
import { sampleLibrary } from '../model/sampleLibrary';
import { normalizeDirs } from '../model/project';

const KEY = 'library.v1';

export async function loadLibrary(): Promise<BlockDef[]> {
  const lib = await idbGet<BlockDef[]>(KEY);
  if (lib) return lib.map(normalizeDirs);
  return sampleLibrary();
}

export async function saveLibrary(lib: BlockDef[]) {
  await idbSet(KEY, lib);
}
