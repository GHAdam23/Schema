import { useEffect, useRef, useState } from 'react';
import { currentPage, nextLabel, redo, setState, undo, updateProject, useStore } from '../state/store';
import { clearLabels, numberLines } from '../state/actions';
import { DEFAULT_AUTO_LABEL, formatLabel } from '../model/signals';
import { NumberField } from './controls';
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

/** Small line icons for the section titles. */
const ICONS: Record<string, string> = {
  edit: 'M3 13l1-4 7-7 3 3-7 7-4 1z M9 4l3 3',
  cursor: 'M4 2l9 6-4 1 2 5-2 1-2-5-3 3z',
  plus: 'M8 3v10 M3 8h10',
  eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  tag: 'M2 3h6l6 6-5 5-6-6z M5 6h.01',
};

export function Icon({ name }: { name: string }) {
  return (
    <svg className="ticon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** A titled toolbar section: caption with an icon on top, buttons below. */
function Section({ title, icon, children, className, extra }: { title: string; icon: string; children: React.ReactNode; className?: string; extra?: React.ReactNode }) {
  return (
    <div className={'tsection' + (className ? ' ' + className : '')}>
      <div className="tsection-title">
        <Icon name={icon} /> {title}
        {extra}
      </div>
      <div className="tsection-body">{children}</div>
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
  const lineIds = page.connections.filter((c) => sel.has(c.id)).map((c) => c.id);
  const toolBtn = (t: Tool, label: string, keys: string | undefined, title: string) => <Btn label={label} keys={keys} title={title} active={tool === t} onClick={() => setState({ tool: t })} />;
  const auto = project.autoLabel ?? DEFAULT_AUTO_LABEL;
  const setAuto = (patch: Partial<typeof auto>, label: string) => {
    nextLabel(label);
    updateProject((d) => void (d.autoLabel = { ...auto, ...patch }));
  };

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
              ['Project settings…', 'signals, fonts', () => setState({ modal: { kind: 'projectSettings' } })],
              ['Title block…', '', () => setState({ modal: { kind: 'titleBlock' } })],
              null,
              ['Backups…', '', () => setState({ modal: { kind: 'backups' } })],
              ['Preferences…', 'app', () => setState({ modal: { kind: 'prefs' } })],
            ]}
          />
        </div>
      </div>
      <Section title="Edit" icon="edit">
        <Btn label="↶" keys="Ctrl+Z" title="Undo" onClick={undo} disabled={!canUndo} />
        <Btn label="↷" keys="Ctrl+Y" title="Redo" onClick={redo} disabled={!canRedo} />
        <Btn label="History" keys="Ctrl+H" title="Recent changes — see what changed and undo to any point" onClick={() => setState({ modal: { kind: 'history' } })} />
      </Section>
      <Section title="Tools" icon="cursor">
        {toolBtn('select', 'Select', 'V', 'Select and move objects')}
        {toolBtn('pan', 'Move', 'H', 'Move around the page by dragging (also right-drag, middle-drag, Space-drag, or drag the grey area)')}
        <Btn label="Snap" keys="to grid" active={prefs.snap} title="Snap to the grid while placing and moving" onClick={() => togglePref('snap')} />
        <Btn label="Guides" keys="smart" active={prefs.smartGuides} title="Smart guides: snap to other objects' edges, centres and port rows while moving" onClick={() => togglePref('smartGuides')} />
      </Section>
      <Section title="Insert" icon="plus">
        {toolBtn('text', 'Text', 'T', 'Text box: click, or drag out a box')}
        {toolBtn('rect', 'Rect', 'R', 'Rectangle (Shift: square)')}
        {toolBtn('ellipse', 'Ellipse', 'E', 'Ellipse (Shift: circle)')}
        {toolBtn('container', 'Container', 'F', "Container: a labelled frame that moves what's inside it")}
        {toolBtn('callout', 'Callout', 'L', 'Callout: text with a pointer')}
        {toolBtn('cloud', 'Bubble', undefined, 'Thought bubble — drag the yellow diamond to point it')}
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
      <Section title="View" icon="eye">
        <Btn label="Grid" keys="show" active={prefs.showGrid} title="Show the grid" onClick={() => togglePref('showGrid')} />
        <Btn label="−" keys="Ctrl+−" title="Zoom out" onClick={() => view('out')} />
        <Btn label="Fit" keys="Ctrl+0" title="Fit the page" onClick={() => view('fit')} />
        <Btn label="100%" title="Actual size" onClick={() => view('100')} />
        <Btn label="+" keys="Ctrl++" title="Zoom in" onClick={() => view('in')} />
      </Section>
      <Section title="Line labels" icon="tag" extra={<span className="tnext" title="The next label">next {formatLabel(auto, auto.next)}</span>}>
        <div className="tlabels">
          <label className="tcheck" title="Every new line gets the next label">
            <input type="checkbox" checked={auto.on} onChange={(e) => setAuto({ on: e.target.checked }, e.target.checked ? 'Auto-number line labels' : 'Stop auto-numbering line labels')} /> Auto
          </label>
          <label className="tfield" title="Label prefix, e.g. DD-3 or SDI-">
            <span>Prefix</span>
            <input key={'p' + auto.prefix} defaultValue={auto.prefix} onBlur={(e) => e.target.value !== auto.prefix && setAuto({ prefix: e.target.value }, 'Label prefix')} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} style={{ width: 56 }} />
          </label>
          <label className="tfield" title="Next number to hand out">
            <span>Next</span>
            <NumberField min={0} step={1} width={46} value={auto.next} onCommit={(v) => setAuto({ next: Math.round(v) }, 'Next label number')} />
          </label>
          <label className="tfield" title="Pad the number with zeros to this many digits">
            <span>Digits</span>
            <NumberField min={0} max={6} step={1} width={36} value={auto.digits} onCommit={(v) => setAuto({ digits: Math.round(v) }, 'Label digits')} />
          </label>
        </div>
        <div className="tstack">
          <button disabled={!lineIds.length} title="Number the selected lines: give them the next labels (top to bottom). Lines that already have a label keep it; Shift-click to renumber them too." onClick={(e) => numberLines(lineIds, e.shiftKey)}>
            Number
          </button>
          <button disabled={!lineIds.length} title="Clear the labels of the selected lines" onClick={() => clearLabels(lineIds)}>
            Clear
          </button>
        </div>
      </Section>
    </div>
  );
}
