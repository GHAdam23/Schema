import { redo, setState, undo, useStore } from '../state/store';
import { alignSelection, bundleSelection, distributeSelection, straighten, type AlignMode } from '../state/actions';
import { exportCableListCmd, exportEquipmentListCmd, importMedia, newProjectCmd, openProjectCmd, saveCmd } from '../state/fileOps';
import { pickFile } from '../io/files';
import { MEDIA_ACCEPT } from '../io/importMedia';
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
        <Btn label="Equipment" title="Export the equipment list (CSV): manufacturer, model, friendly name, pages, rack position" onClick={() => void exportEquipmentListCmd()} />
        <Btn label="Cables" title="Export the cable list (CSV): label, signal, from device/port, to device/port, pages. Lines through reference tags are listed once." onClick={() => void exportCableListCmd()} />
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
        <Btn label="Ellipse" title="Ellipse / circle (E)" active={tool === 'ellipse'} onClick={() => setState({ tool: 'ellipse' })} />
        <Btn label="Container" title="Container: a labelled frame that moves what's inside it (F)" active={tool === 'container'} onClick={() => setState({ tool: 'container' })} />
        <Btn label="Callout" title="Callout: text with a pointer (L)" active={tool === 'callout'} onClick={() => setState({ tool: 'callout' })} />
        <Btn label="Thought" title="Thought bubble: a cloud with trailing bubbles — drag the yellow diamond to point it" active={tool === 'cloud'} onClick={() => setState({ tool: 'cloud' })} />
        <Btn label="Rack" title="Rack elevation: click to place a rack, then drag blocks from the library (or devices from the Devices tab) into it" active={tool === 'rack'} onClick={() => setState({ tool: 'rack' })} />
        <Btn label="Line" title="Draw a line or arrow (drag; Shift = 15° steps). Arrowheads are set in its properties." active={tool === 'line'} onClick={() => setState({ tool: 'line' })} />
        <Btn
          label="Image…"
          title="Import PNG / JPG / PDF / SVG (or drop files on the page, or paste an image)"
          onClick={async () => {
            const f = await pickFile(MEDIA_ACCEPT);
            if (f) void importMedia([f]);
          }}
        />
        <Btn label="Hand" title="Pan by dragging (H). You can also right-drag, middle-drag, Space-drag, or drag the grey area." active={tool === 'pan'} onClick={() => setState({ tool: 'pan' })} />
        <Btn label="Insert…" title="Quick insert: search the library and place a block" onClick={() => setState({ modal: { kind: 'quickInsert' } })} />
      </div>
      <div className="group">
        <Btn label="Bundle" title="Bundle the selected lines into a snake: ≥4 lines, same signal, same two devices" disabled={selCount < 4} onClick={bundleSelection} />
      </div>
      <div className="group">
        <Btn label="⇤" title="Align left" disabled={selCount < 2} onClick={align('left')} />
        <Btn label="↔" title="Align centres horizontally" disabled={selCount < 2} onClick={align('hcenter')} />
        <Btn label="⇥" title="Align right" disabled={selCount < 2} onClick={align('right')} />
        <Btn label="⤒" title="Align top" disabled={selCount < 2} onClick={align('top')} />
        <Btn label="↕" title="Align middles vertically" disabled={selCount < 2} onClick={align('vcenter')} />
        <Btn label="⤓" title="Align bottom" disabled={selCount < 2} onClick={align('bottom')} />
        <Btn label="Straighten" title="Move blocks so their lines run straight. Works on selected blocks or lines." disabled={!selCount} onClick={straighten} />
        <Btn label="⋯H" title="Distribute horizontally" disabled={selCount < 3} onClick={() => distributeSelection('h')} />
        <Btn label="⋮V" title="Distribute vertically" disabled={selCount < 3} onClick={() => distributeSelection('v')} />
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
        <Btn label="Title block" title="Logo, project and designer info printed in the title block" onClick={() => setState({ modal: { kind: 'titleBlock' } })} />
        <Btn label="Backups" onClick={() => setState({ modal: { kind: 'backups' } })} />
        <Btn label="Prefs" title="App preferences (grid, defaults, saving, signal types)" onClick={() => setState({ modal: { kind: 'prefs' } })} />
      </div>
    </div>
  );
}
