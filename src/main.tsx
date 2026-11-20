import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { loadFonts } from './text/fonts';
import { loadLibrary } from './io/libraryStore';
import { setLibrary } from './state/actions';
import { initAutosave } from './state/fileOps';
import './styles.css';
import { getState, setState, updateProject } from './state/store';
import * as actions from './state/actions';
import { exportPdf } from './render/pdfExport';
import { serializeProject, deserializeProject } from './io/projectFile';
import { cableListCsv } from './model/cableList';
import * as rackActions from './state/rackActions';

// Small debugging/automation hook (used by smoke tests).
(window as unknown as { __schema: unknown }).__schema = { getState, setState, updateProject, actions, exportPdf, serializeProject, deserializeProject, cableListCsv, rackActions };

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  root.render(<div className="boot">Loading…</div>);
  try {
    await loadFonts();
  } catch (e) {
    root.render(<div className="boot error">Could not load fonts: {(e as Error).message}</div>);
    return;
  }
  try {
    setLibrary(await loadLibrary(), false);
  } catch (e) {
    console.warn('Library load failed', e);
  }
  await initAutosave();
  root.render(<App />);
}

void boot();
