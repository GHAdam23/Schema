import { useSyncExternalStore } from 'react';
import { emptyDatabase, normalize } from './defaults';
import { mergeDatabases } from './merge';
import { idbDel, idbGet, idbSet } from './storage';
import type { Database } from './types';
import { nowStamp } from './util';

// ---------------------------------------------------------------------------
// In-memory state with immutable updates, undo, and two persistence targets:
//  1. IndexedDB in this browser (always)
//  2. Optionally a linked file on disk (File System Access API). Put that file
//     in a OneDrive / Dropbox / iCloud Drive / Syncthing folder and every
//     device that links the same file stays in sync — no server of ours.
// ---------------------------------------------------------------------------

let state: Database = emptyDatabase();
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const undoStack: Database[] = [];
const redoStack: Database[] = [];
let lastUndoKey = '';
let lastUndoTime = 0;

export function getDB() {
  return state;
}

export function useDB(): Database {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/**
 * Apply an immutable update. `undoKey` groups rapid edits (typing in one
 * field) into a single undo step.
 */
export function update(recipe: (db: Database) => Database, undoKey = '') {
  const next = recipe(state);
  if (next === state) return;
  const t = Date.now();
  if (!(undoKey && undoKey === lastUndoKey && t - lastUndoTime < 1500)) {
    undoStack.push(state);
    if (undoStack.length > 100) undoStack.shift();
  }
  lastUndoKey = undoKey;
  lastUndoTime = t;
  redoStack.length = 0;
  state = { ...next, savedAt: nowStamp() };
  emit();
  scheduleSave();
}

export function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(state);
  state = { ...prev, savedAt: nowStamp() };
  lastUndoKey = '';
  emit();
  scheduleSave();
}

export function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(state);
  state = { ...next, savedAt: nowStamp() };
  lastUndoKey = '';
  emit();
  scheduleSave();
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

/** Replace everything (import). Undoable. */
export function replaceAll(db: Database) {
  update(() => normalize(db));
}

// ---------------------------------------------------------------------------
// Sync status (shown in the header)
// ---------------------------------------------------------------------------

export type FileStatus = 'none' | 'linked' | 'needs-permission' | 'error' | 'unsupported';
export interface SyncInfo {
  fileStatus: FileStatus;
  fileName: string;
  lastFileWrite: string;
  lastLocalSave: string;
  error: string;
  persisted: boolean;
}

let sync: SyncInfo = {
  fileStatus: 'showSaveFilePicker' in window ? 'none' : 'unsupported',
  fileName: '',
  lastFileWrite: '',
  lastLocalSave: '',
  error: '',
  persisted: false,
};
const syncListeners = new Set<() => void>();
function setSync(patch: Partial<SyncInfo>) {
  sync = { ...sync, ...patch };
  syncListeners.forEach((l) => l());
}
export function useSync(): SyncInfo {
  return useSyncExternalStore(
    (l) => {
      syncListeners.add(l);
      return () => syncListeners.delete(l);
    },
    () => sync,
  );
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let fileHandle: any = null; // FileSystemFileHandle
let fileSavedAt = ''; // savedAt of the copy last read from / written to the file
let localTimer: number | undefined;
let fileTimer: number | undefined;

function scheduleSave() {
  if (!loaded) return;
  clearTimeout(localTimer);
  localTimer = window.setTimeout(async () => {
    try {
      await idbSet('db', state);
      setSync({ lastLocalSave: nowStamp() });
    } catch (e) {
      setSync({ error: `Could not save in this browser: ${(e as Error).message}` });
    }
  }, 250);
  if (fileHandle && sync.fileStatus === 'linked') {
    clearTimeout(fileTimer);
    fileTimer = window.setTimeout(writeFile, 1200);
  }
}

async function readFile(): Promise<Database | null> {
  const f: File = await fileHandle.getFile();
  const text = await f.text();
  if (!text.trim()) return null;
  return normalize(JSON.parse(text));
}

async function writeFile() {
  if (!fileHandle) return;
  try {
    // Pick up edits another device saved to the file since we last looked.
    const remote = await readFile().catch(() => null);
    if (remote && remote.savedAt !== fileSavedAt && remote.savedAt !== state.savedAt) {
      state = mergeDatabases(state, remote);
      emit();
      await idbSet('db', state);
    }
    const w = await fileHandle.createWritable();
    await w.write(JSON.stringify(state));
    await w.close();
    fileSavedAt = state.savedAt;
    setSync({ lastFileWrite: nowStamp(), error: '', fileStatus: 'linked' });
  } catch (e) {
    setSync({ fileStatus: 'error', error: `Could not write ${sync.fileName}: ${(e as Error).message}` });
  }
}

/** Read the linked file and merge in anything newer from other devices. */
export async function pullFromFile() {
  if (!fileHandle || sync.fileStatus !== 'linked') return;
  try {
    const remote = await readFile();
    if (!remote || remote.savedAt === fileSavedAt) return;
    fileSavedAt = remote.savedAt;
    const merged = mergeDatabases(state, remote);
    state = merged;
    emit();
    await idbSet('db', state);
    if (merged.savedAt !== remote.savedAt || JSON.stringify(merged) !== JSON.stringify(remote)) {
      clearTimeout(fileTimer);
      fileTimer = window.setTimeout(writeFile, 1200);
    }
  } catch (e) {
    setSync({ error: `Could not read ${sync.fileName}: ${(e as Error).message}` });
  }
}

async function attachHandle(handle: any, mode: 'merge' | 'overwrite') {
  fileHandle = handle;
  await idbSet('fileHandle', handle);
  setSync({ fileStatus: 'linked', fileName: handle.name, error: '' });
  if (mode === 'merge') {
    const remote = await readFile().catch(() => null);
    if (remote) {
      state = mergeDatabases(state, remote);
      fileSavedAt = remote.savedAt;
      emit();
      await idbSet('db', state);
    }
  }
  await writeFile();
}

const FILE_TYPES = [{ description: 'People data', accept: { 'application/json': ['.people.json', '.json'] } }];

/** Create a new data file (e.g. inside a Dropbox / OneDrive folder). */
export async function linkNewFile() {
  const handle = await (window as any).showSaveFilePicker({
    suggestedName: 'my-people.people.json',
    types: FILE_TYPES,
  });
  await attachHandle(handle, 'overwrite');
}

/** Open an existing data file (e.g. one created on another device) and merge. */
export async function linkExistingFile() {
  const [handle] = await (window as any).showOpenFilePicker({ types: FILE_TYPES });
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new Error('Permission to edit the file was not given.');
  await attachHandle(handle, 'merge');
}

/** After a browser restart the file needs one click to re-grant access. */
export async function reconnectFile() {
  if (!fileHandle) return;
  const perm = await fileHandle.requestPermission({ mode: 'readwrite' });
  if (perm === 'granted') await attachHandle(fileHandle, 'merge');
}

export async function unlinkFile() {
  fileHandle = null;
  await idbDel('fileHandle');
  setSync({ fileStatus: 'none', fileName: '', lastFileWrite: '' });
}

export async function init() {
  try {
    const saved = await idbGet<Database>('db');
    if (saved) state = normalize(saved);
  } catch (e) {
    setSync({ error: `Browser storage unavailable: ${(e as Error).message}` });
  }
  loaded = true;
  emit();

  try {
    if (navigator.storage?.persist) setSync({ persisted: await navigator.storage.persist() });
  } catch {
    /* ignore */
  }

  try {
    const handle = await idbGet<any>('fileHandle');
    if (handle) {
      fileHandle = handle;
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') await attachHandle(handle, 'merge');
      else setSync({ fileStatus: 'needs-permission', fileName: handle.name });
    }
  } catch (e) {
    setSync({ fileStatus: 'error', error: (e as Error).message });
  }

  // Check for edits from other devices whenever the app comes back into view.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pullFromFile();
  });
  window.addEventListener('beforeunload', () => {
    idbSet('db', state);
  });
}
