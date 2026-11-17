import type { Project } from '../model/types';
import { newProject } from '../model/project';
import { deserializeProject, serializeProject } from '../io/projectFile';
import { download, fsaSupported, saveAs, SCHEMA_TYPES, writeHandle } from '../io/files';
import { idbGet, idbSet } from '../io/idb';
import { exportPdf } from '../render/pdfExport';
import { getState, replaceProject, setState, subscribe, toast, updateProject } from './store';

// ---------------------------------------------------------------------------------------------
// New / open / save

function confirmDiscard(): boolean {
  return !getState().dirty || confirm('Discard unsaved changes to the current project?');
}

export function newProjectCmd() {
  if (!confirmDiscard()) return;
  replaceProject(newProject(getState().prefs), null, '');
}

export async function openProjectCmd() {
  if (!confirmDiscard()) return;
  try {
    if (fsaSupported()) {
      const [h] = await window.showOpenFilePicker!({ types: SCHEMA_TYPES });
      const f = await h.getFile();
      const p = deserializeProject(new Uint8Array(await f.arrayBuffer()));
      replaceProject(p, h, f.name);
    } else {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.schema';
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        replaceProject(deserializeProject(new Uint8Array(await f.arrayBuffer())), null, f.name);
      };
      inp.click();
      return;
    }
    toast('Project opened.');
  } catch (e) {
    if ((e as DOMException).name !== 'AbortError') toast('Could not open project: ' + (e as Error).message, 'error', 6000);
  }
}

function stampModified() {
  updateProject((d) => {
    d.info.modified = new Date().toISOString();
  }, false);
}

function suggestedName() {
  const s = getState();
  return s.fileName || (s.project.info.name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '_') + '.schema';
}

export async function saveCmd(forceAs = false) {
  const s = getState();
  try {
    stampModified();
    const bytes = serializeProject(getState().project);
    const blob = new Blob([bytes as BlobPart], { type: 'application/x-schema' });
    let handle = forceAs ? null : s.fileHandle;
    if (handle && handle.requestPermission) {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') handle = null;
    }
    if (handle) {
      await writeHandle(handle, blob);
    } else {
      handle = await saveAs(blob, suggestedName(), SCHEMA_TYPES);
    }
    setState({ fileHandle: handle, fileName: handle?.name ?? suggestedName(), dirty: false });
    await addBackup('save');
    await writeAutosave();
    toast('Saved.');
  } catch (e) {
    if ((e as DOMException).name !== 'AbortError') toast('Save failed: ' + (e as Error).message, 'error', 6000);
  }
}

export async function exportPdfCmd(pageIndices: number[]) {
  try {
    const bytes = await exportPdf(getState().project, pageIndices);
    const name = (getState().project.info.name || 'Schema').replace(/[\\/:*?"<>|]+/g, '_') + '.pdf';
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    await saveAs(blob, name, [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]);
  } catch (e) {
    if ((e as DOMException).name !== 'AbortError') {
      console.error(e);
      toast('PDF export failed: ' + (e as Error).message, 'error', 6000);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Autosave + rolling backups (IndexedDB)

interface AutosaveRecord {
  project: Project;
  fileName: string;
  handle: FileSystemFileHandle | null;
  dirty: boolean;
  at: string;
}

export interface BackupRecord {
  at: string;
  reason: 'auto' | 'save';
  name: string;
  fileName: string;
  bytes: Uint8Array;
}

const AUTOSAVE_KEY = 'autosave.v1';
const BACKUPS_KEY = 'backups.v1';
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;

async function writeAutosave() {
  const s = getState();
  const rec: AutosaveRecord = { project: s.project, fileName: s.fileName, handle: s.fileHandle, dirty: s.dirty, at: new Date().toISOString() };
  try {
    await idbSet(AUTOSAVE_KEY, rec);
  } catch (e) {
    // Handles are not always cloneable (e.g. in some embedded contexts); retry without.
    await idbSet(AUTOSAVE_KEY, { ...rec, handle: null });
    void e;
  }
}

export async function listBackups(): Promise<BackupRecord[]> {
  return (await idbGet<BackupRecord[]>(BACKUPS_KEY)) ?? [];
}

async function addBackup(reason: BackupRecord['reason']) {
  const s = getState();
  const list = await listBackups();
  const rec: BackupRecord = {
    at: new Date().toISOString(),
    reason,
    name: s.project.info.name,
    fileName: s.fileName,
    bytes: serializeProject(s.project),
  };
  const keep = Math.max(1, s.prefs.backupsToKeep);
  await idbSet(BACKUPS_KEY, [rec, ...list].slice(0, keep));
}

export function restoreBackup(b: BackupRecord) {
  if (!confirmDiscard()) return;
  replaceProject(deserializeProject(b.bytes), null, '');
  setState({ dirty: true });
  toast(`Restored backup from ${new Date(b.at).toLocaleString()}. Use Save As to keep it.`);
}

export function downloadBackup(b: BackupRecord) {
  download(new Blob([b.bytes as BlobPart]), (b.name || 'backup') + ' ' + b.at.replace(/[:.]/g, '-') + '.schema');
}

let lastBackupAt = 0;
let autosaveTimer: number | undefined;
let fileTimer: number | undefined;

export async function initAutosave() {
  // Restore the last session.
  try {
    const rec = await idbGet<AutosaveRecord>(AUTOSAVE_KEY);
    if (rec?.project) {
      replaceProject(rec.project, rec.handle ?? null, rec.fileName ?? '');
      setState({ dirty: rec.dirty });
    }
    const backups = await listBackups();
    if (backups[0]) lastBackupAt = new Date(backups[0].at).getTime();
  } catch (e) {
    console.warn('Autosave restore failed', e);
  }
  let lastRev = getState().revision;
  subscribe(() => {
    const s = getState();
    if (s.revision === lastRev) return;
    lastRev = s.revision;
    clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(async () => {
      await writeAutosave();
      if (Date.now() - lastBackupAt > BACKUP_INTERVAL_MS && getState().dirty) {
        lastBackupAt = Date.now();
        await addBackup('auto');
      }
    }, 1500);
    if (s.prefs.autosaveToFile && s.fileHandle && s.dirty) {
      clearTimeout(fileTimer);
      fileTimer = window.setTimeout(async () => {
        const st = getState();
        if (!st.fileHandle) return;
        try {
          const perm = st.fileHandle.queryPermission ? await st.fileHandle.queryPermission({ mode: 'readwrite' }) : 'granted';
          if (perm !== 'granted') return;
          await writeHandle(st.fileHandle, new Blob([serializeProject(st.project) as BlobPart]));
          setState({ dirty: false });
        } catch (e) {
          console.warn('Autosave to file failed', e);
        }
      }, 5000);
    }
  });
}
