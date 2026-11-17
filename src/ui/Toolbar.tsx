import { redo, setState, undo, useStore } from '../state/store';
import { alignSelection, distributeSelection, rangeConnect, straighten, zOrder, type AlignMode } from '../state/actions';
import { newProjectCmd, openProjectCmd, saveCmd } from '../state/fileOps';
import { savePrefs } from '../state/prefs';
import { getState } from '../state/store';

function Btn(props: { label: string; title?: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button className={'tb' + (props.active ? ' active' : '')} title={props.title ?? props.label} disabled={props.disabled} onClick={props.onClick}>
      {props.label}
    </button>
  );
}

const view = (d: string) => window.dispatchEvent(new CustomEvent('schema:view', { detail: d }));

function togglePref(k: 'snap' | 'showGrid' | 'smartGuides') {
  const p = { ...getState().prefs, [k]: !getState().prefs[k] };
  savePrefs(p);
  setState({ prefs: p });
}

export function Toolbar() {
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const tool = useStore((s) => s.tool);
  const selCount = useStore((s) => s.selection.length);
  const portObjs = useStore((s) => new Set(s.selectedPorts.map((p) => p.objId)).size);
  const portCount = useStore((s) => s.selectedPorts.length);
  const prefs = useStore((s) => s.prefs);
  const dirty = useStore((s) => s.dirty);
  const fileName = useStore((s) => s.fileName);

  const align = (m: AlignMode) => () => alignSelection(m);
  return (
    <div className="toolbar">
      <span className="brand">Schema</span>
      <div className="group">
        <Btn label="New" onClick={newProjectCmd} />
        <Btn label="Open" title="Open project (Ctrl+O)" onClick={() => void openProjectCmd()} />
        <Btn label="Save" title="Save (Ctrl+S)" onClick={() => void saveCmd()} />
        <Btn label="Save As" title="Save As (Ctrl+Shift+S)" onClick={() => void saveCmd(true)} />
        <Btn label="PDF" title="Export vector PDF" onClick={() => setState({ modal: { kind: 'exportPdf' } })} />
      </div>
      <div className="group">
        <Btn label="↶" title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
        <Btn label="↷" title="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo} />
        <Btn label="History" title="Recent changes — see what changed and undo to any point (Ctrl+H)" onClick={() => setState({ modal: { kind: 'history' } })} />
      </div>
      <div className="group">
        <Btn label="Select" title="Select (V)" active={tool === 'select'} onClick={() => setState({ tool: 'select' })} />
        <Btn label="Text" title="Text box (T)" active={tool === 'text'} onClick={() => setState({ tool: 'text' })} />
        <Btn label="Rect" title="Rectangle (R)" active={tool === 'rect'} onClick={() => setState({ tool: 'rect' })} />
        <Btn label="Hand" title="Pan by dragging (H). You can also right-drag, middle-drag, Space-drag, or drag the grey area." active={tool === 'pan'} onClick={() => setState({ tool: 'pan' })} />
        <Btn label="Insert…" title="Quick insert block (Ctrl+K or Q)" onClick={() => setState({ modal: { kind: 'quickInsert' } })} />
      </div>
      <div className="group">
        <Btn label="Range connect" title="Connect selected port runs pairwise (Shift+C). Shift-click port rows on two blocks first." disabled={portObjs !== 2 || portCount < 2} onClick={rangeConnect} />
      </div>
      <div className="group">
        <Btn label="⇤" title="Align left" disabled={selCount < 2} onClick={align('left')} />
        <Btn label="↔" title="Align centres horizontally" disabled={selCount < 2} onClick={align('hcenter')} />
        <Btn label="⇥" title="Align right" disabled={selCount < 2} onClick={align('right')} />
        <Btn label="⤒" title="Align top" disabled={selCount < 2} onClick={align('top')} />
        <Btn label="↕" title="Align middles vertically" disabled={selCount < 2} onClick={align('vcenter')} />
        <Btn label="⤓" title="Align bottom" disabled={selCount < 2} onClick={align('bottom')} />
        <Btn label="Straighten" title="Move blocks so their lines run straight (S). Works on selected blocks or lines." disabled={!selCount} onClick={straighten} />
        <Btn label="⋯H" title="Distribute horizontally" disabled={selCount < 3} onClick={() => distributeSelection('h')} />
        <Btn label="⋮V" title="Distribute vertically" disabled={selCount < 3} onClick={() => distributeSelection('v')} />
      </div>
      <div className="group">
        <Btn label="Front" title="Bring to front" disabled={!selCount} onClick={() => zOrder('front')} />
        <Btn label="Fwd" title="Bring forward" disabled={!selCount} onClick={() => zOrder('forward')} />
        <Btn label="Bwd" title="Send backward" disabled={!selCount} onClick={() => zOrder('backward')} />
        <Btn label="Back" title="Send to back" disabled={!selCount} onClick={() => zOrder('back')} />
      </div>
      <div className="group">
        <Btn label="Grid" active={prefs.showGrid} onClick={() => togglePref('showGrid')} />
        <Btn label="Snap" active={prefs.snap} onClick={() => togglePref('snap')} />
        <Btn label="Guides" title="Smart guides" active={prefs.smartGuides} onClick={() => togglePref('smartGuides')} />
      </div>
      <div className="group">
        <Btn label="−" title="Zoom out (Ctrl+-)" onClick={() => view('out')} />
        <Btn label="Fit" title="Fit page (Ctrl+0)" onClick={() => view('fit')} />
        <Btn label="100%" onClick={() => view('100')} />
        <Btn label="+" title="Zoom in (Ctrl++)" onClick={() => view('in')} />
      </div>
      <div className="spacer" />
      <span className="filename">
        {fileName || 'not saved'}
        {dirty ? ' •' : ''}
      </span>
      <div className="group">
        <Btn label="Project" title="Project / title block info" onClick={() => setState({ modal: { kind: 'projectInfo' } })} />
        <Btn label="Backups" onClick={() => setState({ modal: { kind: 'backups' } })} />
        <Btn label="Prefs" title="Preferences" onClick={() => setState({ modal: { kind: 'prefs' } })} />
      </div>
    </div>
  );
}
