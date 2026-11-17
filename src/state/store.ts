// Minimal global store with undo/redo over the project document.
import { useSyncExternalStore } from 'react';
import { produce, freeze, type Draft } from 'immer';
import type { BlockDef, Id, Project } from '../model/types';
import { newProject } from '../model/project';
import { loadPrefs, type Prefs } from './prefs';

export interface PortRef {
  objId: Id;
  portId: Id;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'warn' | 'error';
}

export interface AppState {
  project: Project;
  past: Project[];
  future: Project[];
  /** Descriptions aligned with past/future: pastLog[i] describes past[i] → next state; futureLog[0] describes now → future[0]. */
  pastLog: HistoryEntry[];
  futureLog: HistoryEntry[];
  pageId: Id;
  /** Selected object and connection ids on the current page. */
  selection: Id[];
  selectedPorts: PortRef[];
  fileHandle: FileSystemFileHandle | null;
  fileName: string;
  dirty: boolean;
  /** Global block library. */
  library: BlockDef[];
  prefs: Prefs;
  toasts: Toast[];
  /** Bumped on every project change, used by autosave. */
  revision: number;
  tool: Tool;
  /** Last pointer position on the page (for quick insert / paste). */
  pointer: { x: number; y: number } | null;
  /** Open modal, if any. */
  modal: Modal | null;
}

export interface HistoryEntry {
  label: string;
  details?: string[];
  at: number;
}

export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'container' | 'callout' | 'tag' | 'pan';

export type Modal =
  /** library: a library block; project: the ports shared by a model's devices; instance: one placed block only. */
  | { kind: 'blockEditor'; target: 'library' | 'project' | 'instance'; defId: Id | null; objId?: Id }
  | { kind: 'quickInsert' }
  | { kind: 'prefs' }
  | { kind: 'titleBlock' }
  | { kind: 'exportPdf' }
  | { kind: 'backups' }
  | { kind: 'signalTypes' }
  | { kind: 'history' }
  /** Choose the device (and port) a reference tag points to. `isNew`: cancelling removes the tag again. */
  | { kind: 'tagTarget'; objId: Id; isNew: boolean };

const MAX_HISTORY = 200;

const prefs = loadPrefs();
const initialProject = newProject(prefs);

let state: AppState = {
  project: freeze(initialProject, true),
  past: [],
  future: [],
  pastLog: [],
  futureLog: [],
  pageId: initialProject.pages[0].id,
  selection: [],
  selectedPorts: [],
  fileHandle: null,
  fileName: '',
  dirty: false,
  library: [],
  prefs,
  toasts: [],
  revision: 0,
  tool: 'select',
  pointer: null,
  modal: null,
};

const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

const entry = (label: string, details?: string[]): HistoryEntry => ({ label, details, at: Date.now() });

let pendingLabel: { label: string; details?: string[] } | null = null;
/** Describe the next recorded change (used by actions; expires at the end of the current task). */
export function nextLabel(label: string, details?: string[]) {
  pendingLabel = { label, details };
  queueMicrotask(() => (pendingLabel = null));
}
/** Like nextLabel, but only if no more specific description is already pending. */
export function defaultLabel(label: string) {
  if (!pendingLabel) nextLabel(label);
}
function takeLabel(fallback = 'Edit') {
  const p = pendingLabel;
  pendingLabel = null;
  return entry(p?.label ?? fallback, p?.details);
}

/**
 * Modify the project. `record` = push the previous version onto the undo stack; pass a string to
 * record it with that description in the history log.
 */
export function updateProject(recipe: (d: Draft<Project>) => void, record: boolean | string = true) {
  const prev = state.project;
  const next = produce(prev, recipe);
  if (next === prev) return;
  const rec = record !== false;
  setState((s) => ({
    project: next,
    past: rec ? [...s.past.slice(-MAX_HISTORY + 1), prev] : s.past,
    pastLog: rec ? [...s.pastLog.slice(-MAX_HISTORY + 1), typeof record === 'string' ? entry(record) : takeLabel()] : s.pastLog,
    future: rec ? [] : s.future,
    futureLog: rec ? [] : s.futureLog,
    dirty: true,
    revision: s.revision + 1,
  }));
}

/** Name (and optionally explain) the most recent history step. */
export function labelLast(label: string, details?: string[]) {
  setState((s) => {
    if (!s.pastLog.length) return {};
    const log = [...s.pastLog];
    log[log.length - 1] = { ...log[log.length - 1], label, details: details ?? log[log.length - 1].details };
    return { pastLog: log };
  });
}

/** Push the current project onto the undo stack (start of a drag). Subsequent updates use record=false. */
export function checkpoint(label = 'Edit') {
  setState((s) => ({
    past: [...s.past.slice(-MAX_HISTORY + 1), s.project],
    pastLog: [...s.pastLog.slice(-MAX_HISTORY + 1), takeLabel(label)],
    future: [],
    futureLog: [],
  }));
}

/** Drop the last checkpoint if nothing changed (e.g. a click without drag). */
export function dropCheckpointIfUnchanged() {
  const s = state;
  if (s.past.length && s.past[s.past.length - 1] === s.project) setState({ past: s.past.slice(0, -1), pastLog: s.pastLog.slice(0, -1) });
}

export function undo() {
  const s = state;
  if (!s.past.length) return;
  const prev = s.past[s.past.length - 1];
  setState({
    project: prev,
    past: s.past.slice(0, -1),
    pastLog: s.pastLog.slice(0, -1),
    future: [s.project, ...s.future],
    futureLog: [s.pastLog[s.pastLog.length - 1] ?? entry('Edit'), ...s.futureLog],
    dirty: true,
    revision: s.revision + 1,
  });
  fixPageAndSelection();
}

export function redo() {
  const s = state;
  if (!s.future.length) return;
  const next = s.future[0];
  setState({
    project: next,
    past: [...s.past, s.project],
    pastLog: [...s.pastLog, s.futureLog[0] ?? entry('Edit')],
    future: s.future.slice(1),
    futureLog: s.futureLog.slice(1),
    dirty: true,
    revision: s.revision + 1,
  });
  fixPageAndSelection();
}

function fixPageAndSelection() {
  const s = state;
  let page = s.project.pages.find((p) => p.id === s.pageId);
  if (!page) page = s.project.pages[0];
  const ids = new Set([...page.objects.map((o) => o.id), ...page.connections.map((c) => c.id), ...(page.bundles ?? []).map((b) => b.id)]);
  setState({ pageId: page.id, selection: s.selection.filter((id) => ids.has(id)), selectedPorts: s.selectedPorts.filter((p) => ids.has(p.objId)) });
}

/** Replace the whole project (open / new). Clears history. */
export function replaceProject(project: Project, handle: FileSystemFileHandle | null, fileName: string) {
  setState({
    project: freeze(project, true),
    past: [],
    future: [],
    pastLog: [],
    futureLog: [],
    pageId: project.pages[0].id,
    selection: [],
    selectedPorts: [],
    fileHandle: handle,
    fileName,
    dirty: false,
    revision: state.revision + 1,
  });
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

export function currentPage(s: AppState = state) {
  return s.project.pages.find((p) => p.id === s.pageId) ?? s.project.pages[0];
}
