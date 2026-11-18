import { useEffect } from 'react';
import { Canvas } from './Canvas';
import { Toolbar } from './Toolbar';
import { PageTabs } from './PageTabs';
import { LibraryPanel } from './LibraryPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { BlockEditor } from './BlockEditor';
import { PrefsDialog, TitleBlockDialog, ExportPdfDialog, BackupsDialog, SignalTypesDialog, SignalColorsDialog, ProjectSettingsDialog, HistoryDialog, TagTargetDialog } from './Dialogs';
import { isMediaFile } from '../io/importMedia';
import { currentPage, getState, redo, setState, undo, useStore } from '../state/store';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  moveObjects,
  paste,
  selectAll,
  selectNextLine,
  zOrder,
} from '../state/actions';
import { importMedia, openProjectCmd, saveCmd } from '../state/fileOps';

let pendingTyped: { id: string; text: string; at: number } | null = null;
/** Ctrl+V waits a moment for the paste event: an image on the clipboard is imported instead. */
let pendingPaste: number | undefined;

export function App() {
  const modal = useStore((s) => s.modal);
  const toasts = useStore((s) => s.toasts);
  const dirty = useStore((s) => s.dirty);
  const fileName = useStore((s) => s.fileName);
  const projectName = useStore((s) => s.project.info.name);

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${fileName || projectName || 'Untitled'} — Schema`;
  }, [dirty, fileName, projectName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable=true]')) return;
      // An inline editor that hasn't taken focus yet (fast typing): send the keystroke to it.
      const ed = document.querySelector<HTMLInputElement>('.inline-editor');
      if (ed) {
        ed.focus();
        return;
      }
      const s = getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') {
        e.preventDefault();
        void saveCmd(e.shiftKey);
        return;
      }
      if (mod && k === 'o') {
        e.preventDefault();
        void openProjectCmd();
        return;
      }
      if (s.modal) return;
      // Single selected line / text / rectangle / block: type (lines) or Enter to edit in place.
      if (s.selection.length === 1 && !mod && !e.altKey) {
        const pg = currentPage(s);
        const id = s.selection[0];
        // A line or a snake: typing labels it.
        const conn = pg.connections.find((c) => c.id === id) ?? (pg.bundles ?? []).find((b) => b.id === id);
        const obj = pg.objects.find((o) => o.id === id);
        const edit = (detail: object) => {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('schema:edit', { detail }));
        };
        if (conn && e.key.length === 1 && e.key !== ' ') {
          // Keys typed before the editor has appeared are collected so nothing is lost.
          const now = performance.now();
          const p = pendingTyped;
          pendingTyped = p && p.id === id && now - p.at < 400 ? { id, text: p.text + e.key, at: now } : { id, text: e.key, at: now };
          return edit({ kind: 'label', id, typed: pendingTyped.text });
        }
        if (e.key === 'Enter') {
          if (conn) return edit({ kind: 'label', id });
          if (obj?.kind === 'block') return edit({ kind: 'device', id });
          if (obj && 'text' in obj) return edit({ kind: 'text', id });
        }
      }
      if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        // Stacking order, as in PowerPoint: Ctrl+] / Ctrl+[ one step, with Shift all the way.
        e.preventDefault();
        const up = e.code === 'BracketRight';
        zOrder(e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward');
        return;
      }
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && k === 'c') copySelection();
      else if (mod && k === 'x') cutSelection();
      else if (mod && k === 'v') {
        if (e.shiftKey) paste(true);
        else {
          clearTimeout(pendingPaste);
          pendingPaste = window.setTimeout(paste, 80);
        }
      }
      else if (mod && k === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && k === 'h') {
        e.preventDefault();
        setState({ modal: { kind: 'history' } });
      } else if (mod && k === 'a') {
        e.preventDefault();
        selectAll();
      } else if (mod && (k === '0' || k === '=' || k === '+' || k === '-')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('schema:view', { detail: k === '0' ? 'fit' : k === '-' ? 'out' : 'in' }));
      } else if (k === 'delete' || k === 'backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (k === 'escape') {
        // First Esc leaves a drawing tool (keeping what was just drawn selected); the next clears the selection.
        if (s.tool !== 'select') setState({ tool: 'select' });
        else setState({ selection: [], selectedPorts: [] });
      }
      else if (!mod && k === 'v') setState({ tool: 'select' });
      else if (!mod && k === 't') setState({ tool: 'text' });
      else if (!mod && k === 'r') setState({ tool: 'rect' });
      else if (!mod && k === 'e') setState({ tool: 'ellipse' });
      else if (!mod && k === 'f') setState({ tool: 'container' });
      else if (!mod && k === 'l') setState({ tool: 'callout' });
      else if (!mod && k === 'h') setState({ tool: 'pan' });
      else if (!mod && k === 'k') setState({ tool: 'rack' });
      else if (e.shiftKey && (k === 'arrowdown' || k === 'arrowup') && s.selection.length === 1 && currentPage(s).connections.some((c) => c.id === s.selection[0])) {
        // A line is selected: step to the next / previous line (then just type to label it).
        e.preventDefault();
        selectNextLine(k === 'arrowdown' ? 1 : -1);
      } else if (k.startsWith('arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? s.prefs.gridSize : 1;
        const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
        const dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
        const ids = s.selection;
        if (ids.length) moveObjects(ids, dx, dy);
      }
    };
    window.addEventListener('keydown', onKey);
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('input, textarea, [contenteditable=true]') || getState().modal) return;
      const files = [...(e.clipboardData?.files ?? [])].filter(isMediaFile);
      if (!files.length) return;
      e.preventDefault();
      clearTimeout(pendingPaste);
      void importMedia(files);
    };
    window.addEventListener('paste', onPaste);
    // From the label editor: Shift+↓ / Shift+↑ saves the label and moves on to the next line.
    const onNext = (e: Event) => {
      selectNextLine((e as CustomEvent).detail as 1 | -1);
      const id = getState().selection[0];
      window.dispatchEvent(new CustomEvent('schema:edit', { detail: { kind: 'label', id } }));
    };
    window.addEventListener('schema:nextline', onNext);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // The autosave keeps work safe, but warn if the file on disk is out of date.
      if (getState().dirty && getState().fileHandle) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('schema:nextline', onNext);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <LibraryPanel />
        <div className="center">
          <Canvas />
          <PageTabs />
        </div>
        <PropertiesPanel />
      </div>
      {modal?.kind === 'blockEditor' && <BlockEditor target={modal.target} defId={modal.defId} objId={modal.objId} />}
      {modal?.kind === 'prefs' && <PrefsDialog />}
      {modal?.kind === 'titleBlock' && <TitleBlockDialog />}
      {modal?.kind === 'exportPdf' && <ExportPdfDialog />}
      {modal?.kind === 'backups' && <BackupsDialog />}
      {modal?.kind === 'signalTypes' && <SignalTypesDialog scope={modal.scope} />}
      {modal?.kind === 'signalColors' && <SignalColorsDialog />}
      {modal?.kind === 'projectSettings' && <ProjectSettingsDialog />}
      {modal?.kind === 'history' && <HistoryDialog />}
      {modal?.kind === 'tagTarget' && <TagTargetDialog key={modal.objId} objId={modal.objId} isNew={modal.isNew} />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.kind}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
