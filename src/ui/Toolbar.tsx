import { useEffect, useRef, useState } from 'react';
import { currentPage, redo, setState, undo, useStore } from '../state/store';
import { alignLabels, alignSelection, bundleProblem, bundleSelection, clearLabels, distributeSelection, numberLines, straighten, type AlignMode } from '../state/actions';
import { exportCableListCmd, exportEquipmentListCmd, importMedia, newProjectCmd, openProjectCmd, saveCmd } from '../state/fileOps';
import { pickFile } from '../io/files';
import { MEDIA_ACCEPT } from '../io/importMedia';
import { savePrefs } from '../state/prefs';
import { getState } from '../state/store';
import type { Tool } from '../state/store';

/** Toolbar button with an optional keyboard-shortcut reminder underneath. */
function Btn(props: { label: string; keys?: string; title?: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean; active?: boolean }) {
  return (
    <button className={'tb' + (props.active ? ' active' : '')} title={props.title ?? props.label} disabled={props.disabled} onClick={props.onClick}>
      <span className="tb-label">{props.label}</span>
      <span className="tb-keys">{props.keys ?? ' '}</span>
    </button>
  );
}

/** A titled toolbar section (caption underneath, like an Office ribbon group). */
function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={'tsection' + (className ? ' ' + className : '')}>
      <div className="tsection-body">{children}</div>
      <div className="tsection-title">{title}</div>
    </div>
  );
}

/** Dropdown menu button (File, Export). */
function Menu({ label, items }: { label: string; items: ([string, string, () => void] | null)[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="tmenu" ref={ref}>
      <button className={'tb menu-btn' + (open ? ' active' : '')} onClick={() => setOpen(!open)}>
        {label} ▾
      </button>
      {open && (
        <div className="tmenu-pop">
          {items.map((it, i) =>
            it ? (
              <button
                key={i}
                onClick={() => {
                  setOpen(false);
                  it[2]();
                }}
              >
                <span>{it[0]}</span>
                <kbd>{it[1]}</kbd>
              </button>
            ) : (
              <hr key={i} />
            ),
          )}
        </div>
      )}
    </div>
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
  const selection = useStore((s) => s.selection);
  const page = useStore((s) => currentPage(s));
  const project = useStore((s) => s.project);
  const prefs = useStore((s) => s.prefs);
  const dirty = useStore((s) => s.dirty);
  const fileName = useStore((s) => s.fileName);

  const sel = new Set(selection);
  const objCount = page.objects.filter((o) => sel.has(o.id)).length;
  const lineIds = page.connections.filter((c) => sel.has(c.id)).map((c) => c.id);
  const bundleWhy = lineIds.length ? bundleProblem(project, page, lineIds) : null;
  const toolBtn = (t: Tool, label: string, keys: string | undefined, title: string) => <Btn label={label} keys={keys} title={title} active={tool === t} onClick={() => setState({ tool: t })} />;
  const align = (m: AlignMode) => () => alignSelection(m);

  return (
    <div className="toolbar">
      <div className="tfile">
        <div className="filename" title={fileName || 'Not saved yet'}>
          {fileName || 'not saved'}
          {dirty ? ' •' : ''}
        </div>
        <div className="tfile-menus">
          <Menu
            label="File"
            items={[
              ['New', '', newProjectCmd],
              ['Open…', 'Ctrl+O', () => void openProjectCmd()],
              null,
              ['Save', 'Ctrl+S', () => void saveCmd()],
              ['Save As…', 'Ctrl+Shift+S', () => void saveCmd(true)],
            ]}
          />
          <Menu
            label="Export"
            items={[
              ['PDF…', '', () => setState({ modal: { kind: 'exportPdf' } })],
              null,
              ['Equipment list (CSV)', '', () => void exportEquipmentListCmd()],
              ['Cable list (CSV)', '', () => void exportCableListCmd()],
            ]}
          />
          <Menu
            label="Settings"
            items={[
              ['Project settings…', 'labels, colours, fonts', () => setState({ modal: { kind: 'projectSettings' } })],
              ['Title block…', '', () => setState({ modal: { kind: 'titleBlock' } })],
              null,
              ['Backups…', '', () => setState({ modal: { kind: 'backups' } })],
              ['Preferences…', 'app', () => setState({ modal: { kind: 'prefs' } })],
            ]}
          />
        </div>
      </div>
      <Section title="Edit">
        <Btn label="↶" keys="Ctrl+Z" title="Undo" onClick={undo} disabled={!canUndo} />
        <Btn label="↷" keys="Ctrl+Y" title="Redo" onClick={redo} disabled={!canRedo} />
        <Btn label="History" keys="Ctrl+H" title="Recent changes — see what changed and undo to any point" onClick={() => setState({ modal: { kind: 'history' } })} />
      </Section>
      <Section title="Tools">
        {toolBtn('select', 'Select', 'V', 'Select and move objects')}
        {toolBtn('pan', 'Move', 'H', 'Move around the page by dragging (also right-drag, middle-drag, Space-drag, or drag the grey area)')}
      </Section>
      <Section title="Insert">
        {toolBtn('text', 'Text', 'T', 'Text box: click, or drag out a box')}
        {toolBtn('rect', 'Rect', 'R', 'Rectangle (Shift: square)')}
        {toolBtn('ellipse', 'Ellipse', 'E', 'Ellipse (Shift: circle)')}
        {toolBtn('container', 'Container', 'F', "Container: a labelled frame that moves what's inside it")}
        {toolBtn('callout', 'Callout', 'L', 'Callout: text with a pointer')}
        {toolBtn('cloud', 'Bubble', undefined, 'Thought bubble — drag the yellow diamond to point it')}
        {toolBtn('rack', 'Rack', 'K', 'Rack elevation: click to place a rack, then drag blocks, devices, rack parts or panel images onto its spaces')}
        {toolBtn('line', 'Line', undefined, 'Draw a line or arrow (drag; Shift = 15° steps). Arrowheads are set in its properties.')}
        <Btn
          label="Image"
          title="Import PNG / JPG / PDF / SVG (or drop files on the page, or paste an image)"
          onClick={async () => {
            const f = await pickFile(MEDIA_ACCEPT);
            if (f) void importMedia([f]);
          }}
        />
      </Section>
      <Section title="View">
        <Btn label="Grid" active={prefs.showGrid} title="Show the grid" onClick={() => togglePref('showGrid')} />
        <Btn label="Snap" active={prefs.snap} title="Snap to the grid" onClick={() => togglePref('snap')} />
        <Btn label="Guides" active={prefs.smartGuides} title="Smart guides: snap to other objects' edges, centres and port rows" onClick={() => togglePref('smartGuides')} />
        <Btn label="−" keys="Ctrl+−" title="Zoom out" onClick={() => view('out')} />
        <Btn label="Fit" keys="Ctrl+0" title="Fit the page" onClick={() => view('fit')} />
        <Btn label="100%" title="Actual size" onClick={() => view('100')} />
        <Btn label="+" keys="Ctrl++" title="Zoom in" onClick={() => view('in')} />
      </Section>
      {(objCount > 0 || !lineIds.length) && (
      <Section title="Arrange">
        <Btn label="⇤" title="Align left edges" disabled={objCount < 2} onClick={align('left')} />
        <Btn label="↔" title="Align centres horizontally" disabled={objCount < 2} onClick={align('hcenter')} />
        <Btn label="⇥" title="Align right edges" disabled={objCount < 2} onClick={align('right')} />
        <Btn label="⤒" title="Align top edges" disabled={objCount < 2} onClick={align('top')} />
        <Btn label="↕" title="Align middles vertically" disabled={objCount < 2} onClick={align('vcenter')} />
        <Btn label="⤓" title="Align bottom edges" disabled={objCount < 2} onClick={align('bottom')} />
        <Btn label="⋯" title="Distribute horizontally (3 or more)" disabled={objCount < 3} onClick={() => distributeSelection('h')} />
        <Btn label="⋮" title="Distribute vertically (3 or more)" disabled={objCount < 3} onClick={() => distributeSelection('v')} />
        <Btn label="Straighten" title="Move blocks so their lines run straight. Works on selected blocks or lines." disabled={!selection.length} onClick={straighten} />
      </Section>
      )}
      {lineIds.length > 0 && (
        <Section title={`Lines (${lineIds.length} selected)`} className="tsection-lines">
          <div className="tsub">
            <Btn label="Number" keys="labels" title="Give the selected lines the next auto-numbers (top to bottom). Lines that already have a label keep it; Shift-click to renumber them too." onClick={(e) => numberLines(lineIds, e.shiftKey)} />
            <Btn label="Clear" keys="labels" title="Remove the labels of the selected lines" onClick={() => clearLabels(lineIds)} />
          </div>
          {lineIds.length > 1 && (
            <div className="tsub">
              <div className="tgridwrap">
              <div className="tgrid" title="Line up the labels with the first selected line's label">
                {(
                  [
                    ['⇤', 'left', 'Left edges in line (labels on horizontal runs)'],
                    ['↔', 'hcenter', 'Centres in line (labels on horizontal runs)'],
                    ['⇥', 'right', 'Right edges in line (labels on horizontal runs)'],
                    ['⤒', 'top', 'Tops in line (labels on vertical runs)'],
                    ['↕', 'vcenter', 'Middles in line (labels on vertical runs)'],
                    ['⤓', 'bottom', 'Bottoms in line (labels on vertical runs)'],
                  ] as const
                ).map(([l, m, t]) => (
                  <button key={m} title={t + ' — with the first selected line'} onClick={() => alignLabels(m)}>
                    {l}
                  </button>
                ))}
              </div>
              <div className="tgrid-cap">line up labels</div>
              </div>
            </div>
          )}
          <div className="tsub">
            <Btn label="Straighten" keys="lines" title="Move blocks so these lines run straight" onClick={straighten} />
            <Btn label="Bundle" keys="into snake" title={bundleWhy ?? 'Draw these lines as one heavier trunk with short labelled legs at each end'} disabled={!!bundleWhy} onClick={bundleSelection} />
          </div>
        </Section>
      )}
    </div>
  );
}
