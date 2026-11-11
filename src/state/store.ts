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

export type Tool = 'select' | 'text' | 'rect';

export type Modal =
  | { kind: 'blockEditor'; target: 'library' | 'project'; defId: Id | null }
  | { kind: 'quickInsert' }
  | { kind: 'prefs' }
  | { kind: 'projectInfo' }
  | { kind: 'exportPdf' }
  | { kind: 'backups' }
  | { kind: 'signalTypes' };

const MAX_HISTORY = 200;

const prefs = loadPrefs();
const initialProject = newProject(prefs);

let state: AppState = {
  project: freeze(initialProject, true),
  past: [],
  future: [],
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

/** Modify the project. `record` = push the previous version onto the undo stack. */
export function updateProject(recipe: (d: Draft<Project>) => void, record = true) {
  const prev = state.project;
  const next = produce(prev, recipe);
  if (next === prev) return;
  setState((s) => ({
    project: next,
    past: record ? [...s.past.slice(-MAX_HISTORY + 1), prev] : s.past,
    future: record ? [] : s.future,
    dirty: true,
    revision: s.revision + 1,
  }));
}

/** Push the current project onto the undo stack (start of a drag). Subsequent updates use record=false. */
export function checkpoint() {
  setState((s) => ({ past: [...s.past.slice(-MAX_HISTORY + 1), s.project], future: [] }));
}

/** Drop the last checkpoint if nothing changed (e.g. a click without drag). */
export function dropCheckpointIfUnchanged() {
  const s = state;
  if (s.past.length && s.past[s.past.length - 1] === s.project) setState({ past: s.past.slice(0, -1) });
}

export function undo() {
  const s = state;
  if (!s.past.length) return;
  const prev = s.past[s.past.length - 1];
  setState({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], dirty: true, revision: s.revision + 1 });
  fixPageAndSelection();
}

export function redo() {
  const s = state;
  if (!s.future.length) return;
  const next = s.future[0];
  setState({ project: next, past: [...s.past, s.project], future: s.future.slice(1), dirty: true, revision: s.revision + 1 });
  fixPageAndSelection();
}

function fixPageAndSelection() {
  const s = state;
  let page = s.project.pages.find((p) => p.id === s.pageId);
  if (!page) page = s.project.pages[0];
  const ids = new Set([...page.objects.map((o) => o.id), ...page.connections.map((c) => c.id)]);
  setState({ pageId: page.id, selection: s.selection.filter((id) => ids.has(id)), selectedPorts: s.selectedPorts.filter((p) => ids.has(p.objId)) });
}

/** Replace the whole project (open / new). Clears history. */
export function replaceProject(project: Project, handle: FileSystemFileHandle | null, fileName: string) {
  setState({
    project: freeze(project, true),
    past: [],
    future: [],
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
