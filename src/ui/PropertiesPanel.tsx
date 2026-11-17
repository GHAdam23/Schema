import type { BlockDef, BlockObj, Connection, PageObject, RectObj, StrokeStyle, TextObj, TextProps } from '../model/types';
import { setState, useStore, currentPage, type AppState } from '../state/store';
import {
  alignLabels,
  connectionWarnings,
  patchConnections,
  patchObjects,
  portInfo,
  projectDefToLibrary,
  rangeConnect,
  renameDevice,
  setStroke,
  updateFromLibrary,
} from '../state/actions';
import { DEFAULT_LINE } from '../model/defaults';
import { fitTextBox, titleBlockObjects } from '../render/buildPage';

function StrokeEditor({ value, onChange, allowNone }: { value: StrokeStyle | null; onChange: (s: Partial<StrokeStyle> | null) => void; allowNone?: boolean }) {
  const v = value ?? { color: '#000000', width: 0, dash: 'solid' as const };
  return (
    <div className="fieldgroup">
      <label>
        Color <input type="color" value={v.color} onChange={(e) => onChange({ color: e.target.value })} />
      </label>
      <label>
        Width{' '}
        <input type="number" min={0} max={10} step={0.25} value={v.width} onChange={(e) => onChange({ width: Math.max(0, Number(e.target.value)) })} />
      </label>
      <label>
        Style{' '}
        <select value={v.dash} onChange={(e) => onChange({ dash: e.target.value as StrokeStyle['dash'] })}>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </label>
      {allowNone && value && <button onClick={() => onChange(null)}>No border</button>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function PropertiesPanel() {
  const s = useStore((st) => st);
  const page = currentPage(s);
  const objs = page.objects.filter((o) => s.selection.includes(o.id));
  const conns = page.connections.filter((c) => s.selection.includes(c.id));

  return (
    <div className="panel props">
      <div className="panel-title">Properties</div>
      {s.selectedPorts.length > 0 && <PortsSection s={s} />}
      {objs.length === 0 && conns.length === 0 && <PageSection s={s} />}
      {objs.length === 1 && conns.length === 0 && <ObjectSection s={s} o={objs[0]} />}
      {conns.length === 1 && objs.length === 0 && <ConnectionSection s={s} c={conns[0]} />}
      {objs.length + conns.length > 1 && (
        <div className="section">
          <div className="section-title">
            {objs.length} object(s), {conns.length} line(s)
          </div>
          {objs.length === 0 && (
            <div className="btnrow">
              <button title="Put the label centres on one vertical line" onClick={() => alignLabels('hcenter')}>
                Line up labels ↕
              </button>
              <button title="Put the label centres on one horizontal line (labels on vertical runs)" onClick={() => alignLabels('vcenter')}>
                Line up labels ↔
              </button>
            </div>
          )}
          <StrokeEditor value={conns[0]?.style ?? (objs[0] && 'border' in objs[0] ? (objs[0].border as StrokeStyle) : null) ?? DEFAULT_LINE} onChange={(st) => st && setStroke(s.selection, st)} />
        </div>
      )}
    </div>
  );
}

function PageSection({ s }: { s: AppState }) {
  const page = currentPage(s);
  return (
    <div className="section">
      <div className="section-title">Page</div>
      <div className="muted">
        {page.objects.filter((o) => o.kind === 'block').length} blocks · {page.connections.length} lines
      </div>
      <div className="help">
        <p>
          <b>Place blocks:</b> drag from the library, double-click a library entry, or press <kbd>Q</kbd> / <kbd>Ctrl+K</kbd>.
        </p>
        <p>
          <b>Move a block:</b> drag its header, footer or centre. <b>Connect:</b> drag from a port row to another port. Drag from the dots on a text box or rectangle to connect to it.
        </p>
        <p>
          <b>Labels:</b> click a line and just start typing (Enter/F2 to edit an existing label). Drag a label to slide it — it snaps in line
          with other labels. Select several lines and use the align buttons to line their labels up.
        </p>
        <p>
          <b>Reroute:</b> select a line and drag its segments. Lines route around blocks and shapes automatically until you move a segment.
        </p>
        <p>
          <b>Title block:</b> text boxes / rectangles you place inside the title block on page 1 appear on every page.
        </p>
        <p>
          <b>History</b> (toolbar / <kbd>Ctrl+H</kbd>) lists recent changes — including which lines were removed — and can undo to any point.
        </p>
        <p>
          <b>Straight lines:</b> dragging a block snaps its ports level with the blocks it's wired to. <b>Straighten</b> (toolbar, or <kbd>S</kbd>) fixes jogs on the selected blocks or lines.
        </p>
        <p>
          <b>Range connect:</b> click a port, Shift-click to extend the run, Ctrl-click ports on a second block, then <kbd>Shift+C</kbd>.
        </p>
        <p>
          <b>Select:</b> drag on empty space to select what's fully inside (any direction); hold Alt to select anything touched.
          Click anywhere in a rectangle or text box to select it; double-click to type in it. To drag-select inside a frame, hold Alt while you
          start dragging.
        </p>
        <p>
          <b>Pan:</b> right-drag, the Hand tool (<kbd>H</kbd>), drag the grey area, scroll, middle-drag or Space-drag. <b>Zoom:</b> Ctrl+scroll.
        </p>
      </div>
    </div>
  );
}

function PortsSection({ s }: { s: AppState }) {
  const page = currentPage(s);
  const infos = s.selectedPorts.map((p) => portInfo(s.project, page, p)).filter(Boolean);
  const blocks = new Set(s.selectedPorts.map((p) => p.objId)).size;
  return (
    <div className="section">
      <div className="section-title">Selected ports ({infos.length})</div>
      <ul className="portlist">
        {infos.map((i, k) => (
          <li key={k}>
            <b>{i!.device.name}</b> {i!.port.name} <span className="muted">{i!.port.signal}</span>
          </li>
        ))}
      </ul>
      <button disabled={blocks !== 2} onClick={rangeConnect} title="Pairs ports in order (Shift+C)">
        Range connect
      </button>
      {blocks !== 2 && <div className="muted">Select ports on exactly two blocks.</div>}
    </div>
  );
}

function ObjectSection({ s, o }: { s: AppState; o: PageObject }) {
  if (o.kind === 'block') return <BlockSection s={s} o={o} />;
  if (o.kind === 'text') return <TextSection o={o} />;
  return (
    <div className="section">
      <div className="section-title">Rectangle</div>
      <SharedNote o={o} />
      <TextFields o={o} />
      <Geometry o={o} />
      <div className="sub">Border</div>
      <StrokeEditor value={o.border} onChange={(st) => st && setStroke([o.id], st)} />
      <FillEditor value={o.fill} onChange={(f) => patchObjects([o.id], (t) => void (t.kind === 'rect' && (t.fill = f)))} />
    </div>
  );
}

function FillEditor({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="fieldgroup">
      <label>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked ? '#f1f5f9' : null)} /> Fill
      </label>
      {value && <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

function Geometry({ o }: { o: Exclude<PageObject, BlockObj> }) {
  const num = (k: 'x' | 'y' | 'w' | 'h') => (
    <input type="number" step={1} value={Math.round(o[k] * 100) / 100} onChange={(e) => patchObjects([o.id], (t) => void ((t as Exclude<PageObject, BlockObj>)[k] = Number(e.target.value)))} />
  );
  return (
    <div className="grid4">
      <Field label="X">{num('x')}</Field>
      <Field label="Y">{num('y')}</Field>
      <Field label="W">{num('w')}</Field>
      <Field label="H">{num('h')}</Field>
    </div>
  );
}

function BlockSection({ s, o }: { s: AppState; o: BlockObj }) {
  const dev = s.project.devices[o.deviceId];
  const def = dev && s.project.blockDefs[dev.defId];
  if (!dev || !def) return <div className="section">Missing device.</div>;
  const usage = Object.values(s.project.devices).filter((d) => d.defId === def.id).length;
  const lib = s.library.find((l) => l.id === def.libraryId);
  const differs = !!lib && !sameDef(lib, def);
  return (
    <div className="section">
      <div className="section-title">Block</div>
      <Field label="Friendly name">
        <input key={dev.id + dev.name} defaultValue={dev.name} onBlur={(e) => e.target.value.trim() && e.target.value !== dev.name && renameDevice(dev.id, e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </Field>
      <div className="muted">
        {def.manufacturer} | {def.model} · {def.left.length} in / {def.right.length} out
      </div>
      <Field label="Scale">
        <input type="number" min={0.3} max={4} step={0.05} value={o.scale} onChange={(e) => patchObjects([o.id], (t) => void (t.kind === 'block' && (t.scale = Math.min(4, Math.max(0.3, Number(e.target.value) || 1)))))} />
      </Field>
      <div className="sub">Border</div>
      <StrokeEditor value={o.border} onChange={(st) => st && setStroke([o.id], st)} />
      <div className="sub">Definition</div>
      <div className="muted">
        {usage > 1 ? `Used by ${usage} devices in this project. ` : ''}
        {!lib ? 'Not in your library.' : differs ? 'This project’s copy differs from your library.' : 'Matches your library.'}
      </div>
      <div className="btnrow">
        <button onClick={() => setState({ modal: { kind: 'blockEditor', target: 'project', defId: def.id } })}>Edit definition…</button>
        {differs && (
          <>
            <button onClick={() => updateFromLibrary(def.id)} title="Replace this project's copy with your library version">
              Use library version
            </button>
            <button onClick={() => projectDefToLibrary(def.id)} title="Save this project's version into your library for future projects">
              Save to library
            </button>
          </>
        )}
        {!lib && (
          <button onClick={() => projectDefToLibrary(def.id)} title="e.g. a block that came in a project from someone else">
            Add to library
          </button>
        )}
      </div>
    </div>
  );
}

function TextFields({ o }: { o: TextObj | RectObj }) {
  const patch = (fn: (t: TextProps) => void) => patchObjects([o.id], (t) => void ((t.kind === 'text' || t.kind === 'rect') && fn(t as TextProps)));
  return (
    <>
      <textarea
        className="textedit"
        key={o.id + o.text}
        defaultValue={o.text}
        placeholder={o.kind === 'rect' ? 'Text inside the rectangle (or double-click it on the page)' : ''}
        onBlur={(e) => e.target.value !== o.text && patch((t) => (t.text = e.target.value))}
        rows={3}
      />
      <div className="fieldgroup">
        <label>
          Size <input type="number" min={4} max={72} step={0.5} value={o.fontSize} onChange={(e) => patch((t) => (t.fontSize = Number(e.target.value) || 9))} />
        </label>
        {fitTextBox(o).size < o.fontSize && <span className="muted small">shrunk to {fitTextBox(o).size}pt to fit</span>}
        <label>
          <input type="checkbox" checked={o.bold} onChange={(e) => patch((t) => (t.bold = e.target.checked))} /> Bold
        </label>
        <label title="Off: lines break only where you press Enter. Either way, text shrinks to stay inside the box.">
          <input type="checkbox" checked={o.wrap !== false} onChange={(e) => patch((t) => (t.wrap = e.target.checked))} /> Wrap
        </label>
        <label>
          Color <input type="color" value={o.color} onChange={(e) => patch((t) => (t.color = e.target.value))} />
        </label>
      </div>
      <div className="fieldgroup">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button key={a} className={o.align === a ? 'active' : ''} onClick={() => patch((t) => (t.align = a))}>
            {a}
          </button>
        ))}
        {(['top', 'middle', 'bottom'] as const).map((a) => (
          <button key={a} className={o.valign === a ? 'active' : ''} onClick={() => patch((t) => (t.valign = a))}>
            {a}
          </button>
        ))}
      </div>
    </>
  );
}

function SharedNote({ o }: { o: TextObj | RectObj }) {
  const project = useStore((s) => s.project);
  const pageId = useStore((s) => s.pageId);
  if (project.pages[0]?.id !== pageId || !titleBlockObjects(project).some((x) => x.id === o.id)) return null;
  return <div className="muted small">In the title block on page 1 — shown on every page.</div>;
}

function TextSection({ o }: { o: TextObj }) {
  const patch = (fn: (t: TextObj) => void) => patchObjects([o.id], (t) => void (t.kind === 'text' && fn(t as TextObj)));
  return (
    <div className="section">
      <div className="section-title">Text box</div>
      <SharedNote o={o} />
      <TextFields o={o} />
      <Geometry o={o} />
      <div className="sub">Border</div>
      {o.border ? (
        <StrokeEditor
          value={o.border}
          allowNone
          onChange={(st) => (st ? setStroke([o.id], st) : patch((t) => (t.border = null)))}
        />
      ) : (
        <button onClick={() => patch((t) => (t.border = { color: '#000000', width: 0.75, dash: 'solid' }))}>Add border</button>
      )}
      <FillEditor value={o.fill} onChange={(f) => patch((t) => (t.fill = f))} />
    </div>
  );
}

function ConnectionSection({ s, c }: { s: AppState; c: Connection }) {
  const page = currentPage(s);
  const a = portInfo(s.project, page, c.from);
  const b = portInfo(s.project, page, c.to);
  const warns = connectionWarnings(s.project, page, c.from, c.to);
  const desc = (i: typeof a, objId: string) => {
    if (i) return `${i.device.name} · ${i.port.name}${i.port.signal ? ' (' + i.port.signal + ')' : ''}`;
    const o = page.objects.find((x) => x.id === objId);
    return o && o.kind !== 'block' && o.text ? `${o.kind === 'text' ? 'Text' : 'Rectangle'} "${o.text.slice(0, 20)}"` : o?.kind === 'text' ? 'Text box' : 'Rectangle';
  };
  return (
    <div className="section">
      <div className="section-title">Line</div>
      <div className="muted">
        From: {desc(a, c.from.objId)}
        <br />
        To: {desc(b, c.to.objId)}
      </div>
      {warns.length > 0 && <div className="warnbox">{warns.join(' ')}</div>}
      <Field label="Label">
        <input key={c.id + c.label} defaultValue={c.label} placeholder="e.g. DD-301" onBlur={(e) => e.target.value !== c.label && patchConnections([c.id], (x) => void (x.label = e.target.value.trim()))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </Field>
      <Field label="Label position">
        <input type="range" min={0.02} max={0.98} step={0.01} value={c.labelT ?? 0.5} onChange={(e) => patchConnections([c.id], (x) => void (x.labelT = Number(e.target.value)))} />
      </Field>
      {c.labelT !== null && (
        <button onClick={() => patchConnections([c.id], (x) => void (x.labelT = null))}>Auto label position</button>
      )}
      <StrokeEditor value={c.style} onChange={(st) => st && setStroke([c.id], st)} />
      <div className="btnrow">
        <button disabled={!c.bends} onClick={() => patchConnections([c.id], (x) => void (x.bends = null))}>
          Reset route
        </button>
        <button
          onClick={() =>
            patchConnections([c.id], (x) => {
              const f = x.from;
              x.from = x.to;
              x.to = f;
              x.bends = null;
            })
          }
        >
          Reverse
        </button>
      </div>
    </div>
  );
}

function sameDef(a: BlockDef, b: BlockDef) {
  const ports = (d: BlockDef) => JSON.stringify([d.left, d.right].map((col) => col.map((p) => [p.name, p.signal, p.connector])));
  return a.manufacturer === b.manufacturer && a.model === b.model && a.defaultName === b.defaultName && ports(a) === ports(b);
}
