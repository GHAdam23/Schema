import type { BlockDef, BlockObj, BoxObj, Bundle, Connection, ImageObj, PageObject, StrokeStyle, TagObj, TextObj, TextProps, TextualObj } from '../model/types';
import { setState, useStore, currentPage, type AppState } from '../state/store';
import {
  alignLabels,
  bundleProblem,
  bundleSelection,
  connectionWarnings,
  jumpToTag,
  kindName,
  patchBundles,
  patchConnections,
  patchObjects,
  patchTag,
  portInfo,
  projectDefToLibrary,
  rangeConnect,
  renameDevice,
  setCurved,
  setRotation,
  setStroke,
  setTagTarget,
  unbundle,
  updateFromLibrary,
} from '../state/actions';
import { DEFAULT_LINE } from '../model/defaults';
import { fitTextBox, textBoxOf, titleBlockObjects } from '../render/buildPage';
import { devicePages, tagTargetPage, tagText } from '../model/tags';
import { setPage } from '../state/actions';

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
  const bundles = (page.bundles ?? []).filter((b) => s.selection.includes(b.id));
  const nSel = objs.length + conns.length + bundles.length;

  return (
    <div className="panel props">
      <div className="panel-title">Properties</div>
      {s.selectedPorts.length > 0 && <PortsSection s={s} />}
      {nSel === 0 && <PageSection s={s} />}
      {objs.length === 1 && nSel === 1 && <ObjectSection s={s} o={objs[0]} />}
      {conns.length === 1 && nSel === 1 && <ConnectionSection s={s} c={conns[0]} />}
      {bundles.length === 1 && nSel === 1 && <BundleSection b={bundles[0]} />}
      {nSel > 1 && (
        <div className="section">
          <div className="section-title">
            {objs.length} object(s), {conns.length} line(s){bundles.length ? `, ${bundles.length} snake(s)` : ''}
          </div>
          {conns.length > 0 && objs.length === 0 && (
            <>
              <div className="btnrow">
                <button
                  disabled={!!bundleProblem(s.project, page, conns.map((c) => c.id))}
                  title={bundleProblem(s.project, page, conns.map((c) => c.id)) ?? 'Draw these lines as one heavier trunk with short labelled legs at each end (B)'}
                  onClick={bundleSelection}
                >
                  Bundle into snake
                </button>
                <button onClick={() => setCurved(conns.map((c) => c.id), true)}>Curved</button>
                <button onClick={() => setCurved(conns.map((c) => c.id), false)}>Right-angle</button>
              </div>
              {conns.length >= 4 && bundleProblem(s.project, page, conns.map((c) => c.id)) && (
                <div className="muted small">Snake: {bundleProblem(s.project, page, conns.map((c) => c.id))}</div>
              )}
            </>
          )}
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
        <p>
          <b>Shapes:</b> ellipse (<kbd>E</kbd>), container (<kbd>F</kbd>) — a labelled frame that moves what's inside it — and callout (<kbd>L</kbd>,
          drag the yellow diamond to point it). Drag the round handle above a selected shape, text box or image to rotate it (Shift = 15° steps).
        </p>
        <p>
          <b>Images:</b> drop PNG, JPG, PDF or SVG files on the page, paste an image, or use <b>Image…</b>. PDFs stay vector in the export; SVGs are
          converted to vector shapes.
        </p>
        <p>
          <b>Same device on several pages:</b> drag it from the <b>Devices</b> tab of the library, or copy it and press <kbd>Ctrl+Shift+V</kbd>.
          A small blue dot marks ports that are connected on another page.
        </p>
        <p>
          <b>Reference tags:</b> drag a line from a port and let go on empty space, or use the Tag tool (<kbd>G</kbd>). The text
          (<i>TO (3) DISP-1</i>) updates itself; double-click a tag to jump to that device.
        </p>
        <p>
          <b>Snakes:</b> select ≥4 lines of one signal type between the same two devices and press <kbd>B</kbd>. <b>Curved lines:</b> in the line's
          properties.
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
  if (o.kind === 'tag') return <TagSection s={s} o={o} />;
  if (o.kind === 'image') return <ImageSection s={s} o={o} />;
  return <ShapeSection o={o} />;
}

function ShapeSection({ o }: { o: TextualObj }) {
  const patch = (fn: (t: TextualObj) => void) => patchObjects([o.id], (t) => void (t.kind === o.kind && fn(t as TextualObj)));
  return (
    <div className="section">
      <div className="section-title">{kindName(o)}</div>
      <SharedNote o={o} />
      <TextFields o={o} />
      <Geometry o={o} />
      <div className="sub">Border</div>
      {o.kind === 'text' ? (
        o.border ? (
          <StrokeEditor value={o.border} allowNone onChange={(st) => (st ? setStroke([o.id], st) : patch((t) => ((t as TextObj).border = null)))} />
        ) : (
          <button onClick={() => patch((t) => ((t as TextObj).border = { color: '#000000', width: 0.75, dash: 'solid' }))}>Add border</button>
        )
      ) : (
        <StrokeEditor value={o.border} onChange={(st) => st && setStroke([o.id], st)} />
      )}
      <FillEditor value={o.fill} onChange={(f) => patch((t) => (t.fill = f))} />
      {o.kind === 'container' && (
        <div className="fieldgroup">
          <label>
            <input
              type="checkbox"
              checked={!!o.headerFill}
              onChange={(e) => patch((t) => t.kind === 'container' && (t.headerFill = e.target.checked ? '#e2e8f0' : null))}
            />{' '}
            Label band fill
          </label>
          {o.headerFill && <input type="color" value={o.headerFill} onChange={(e) => patch((t) => t.kind === 'container' && (t.headerFill = e.target.value))} />}
        </div>
      )}
      {o.kind === 'container' && <div className="muted small">Moving the container moves everything inside it. Click inside it to select what's there.</div>}
    </div>
  );
}

function ImageSection({ s, o }: { s: AppState; o: ImageObj }) {
  const a = s.project.assets[o.assetId];
  const type = !a ? 'missing' : a.mime === 'application/pdf' ? `PDF page ${(a.page ?? 0) + 1} (vector)` : a.vector ? 'SVG (vector)' : a.mime.replace('image/', '').toUpperCase();
  return (
    <div className="section">
      <div className="section-title">Image</div>
      <SharedNote o={o} />
      <div className="muted">{type}</div>
      <Geometry o={o} />
      {a && (
        <button
          title="Restore the original proportions (keeps the width)"
          onClick={() => patchObjects([o.id], (t) => void (t.kind === 'image' && (t.h = Math.round(((t.w * a.h) / a.w) * 100) / 100)))}
        >
          Original proportions
        </button>
      )}
      <div className="sub">Border</div>
      {o.border ? (
        <StrokeEditor value={o.border} allowNone onChange={(st) => (st ? setStroke([o.id], st) : patchObjects([o.id], (t) => void (t.kind === 'image' && (t.border = null))))} />
      ) : (
        <button onClick={() => patchObjects([o.id], (t) => void (t.kind === 'image' && (t.border = { color: '#000000', width: 0.75, dash: 'solid' })))}>Add border</button>
      )}
      <div className="muted small">Corner handles keep the proportions (hold Shift to stretch).</div>
    </div>
  );
}

function TagSection({ s, o }: { s: AppState; o: TagObj }) {
  const devices = Object.values(s.project.devices).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const dev = o.target ? s.project.devices[o.target.deviceId] : undefined;
  const def = dev && s.project.blockDefs[dev.defId];
  const pi = tagTargetPage(s.project, o);
  const patch = (fn: (t: TagObj) => void, label?: string) => patchTag(o.id, fn, label);
  return (
    <div className="section">
      <div className="section-title">Reference tag</div>
      <div className="tagpreview">{tagText(s.project, o)}</div>
      <Field label="Device">
        <select value={o.target?.deviceId ?? ''} onChange={(e) => setTagTarget(o.id, e.target.value ? { deviceId: e.target.value } : null)}>
          <option value="">— choose —</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} (p. {devicePages(s.project, d.id).map((i) => i + 1).join(', ') || '–'})
            </option>
          ))}
        </select>
      </Field>
      {def && (
        <Field label="Port">
          <select value={o.target?.portId ?? ''} onChange={(e) => setTagTarget(o.id, { deviceId: dev!.id, portId: e.target.value || undefined })}>
            <option value="">(whole device)</option>
            {[...def.left, ...def.right].map((p) => (
              <option key={p.id} value={p.id}>
                {p.dir} · {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="fieldgroup">
        <label>
          Direction{' '}
          <select value={o.dir} onChange={(e) => patch((t) => (t.dir = e.target.value as TagObj['dir']))}>
            <option value="auto">Auto (from the line)</option>
            <option value="TO">TO</option>
            <option value="FROM">FROM</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={o.showPort} onChange={(e) => patch((t) => (t.showPort = e.target.checked))} /> Show port
        </label>
      </div>
      <Field label="Extra text">
        <input key={o.id + o.note} defaultValue={o.note} placeholder="e.g. (VIA ADAPTER)" onBlur={(e) => e.target.value !== o.note && patch((t) => (t.note = e.target.value))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </Field>
      <div className="fieldgroup">
        <label>
          Size <input type="number" min={4} max={24} step={0.5} value={o.fontSize} onChange={(e) => patch((t) => (t.fontSize = Math.max(4, Number(e.target.value) || 7)))} />
        </label>
      </div>
      <button disabled={pi < 0} onClick={() => jumpToTag(o)} title="Double-clicking the tag does the same">
        {pi >= 0 ? `Go to page ${pi + 1}` : 'Go to device'}
      </button>
      <div className="sub">Border</div>
      <StrokeEditor value={o.border} onChange={(st) => st && setStroke([o.id], st)} />
      <FillEditor value={o.fill} onChange={(f) => patch((t) => (t.fill = f))} />
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

function Geometry({ o }: { o: BoxObj }) {
  const num = (k: 'x' | 'y' | 'w' | 'h') => (
    <input type="number" step={1} value={Math.round(o[k] * 100) / 100} onChange={(e) => patchObjects([o.id], (t) => void (t.kind !== 'block' && t.kind !== 'tag' && (t[k] = Number(e.target.value))))} />
  );
  return (
    <>
      <div className="grid4">
        <Field label="X">{num('x')}</Field>
        <Field label="Y">{num('y')}</Field>
        <Field label="W">{num('w')}</Field>
        <Field label="H">{num('h')}</Field>
      </div>
      <div className="fieldgroup">
        <label>
          Rotation{' '}
          <input type="number" step={15} value={Math.round((o.rot ?? 0) * 10) / 10} onChange={(e) => setRotation([o.id], Number(e.target.value) || 0)} />°
        </label>
        <button title="Rotate 90° counter-clockwise" onClick={() => setRotation([o.id], (r) => r - 90)}>
          ⟲
        </button>
        <button title="Rotate 90° clockwise" onClick={() => setRotation([o.id], (r) => r + 90)}>
          ⟳
        </button>
      </div>
    </>
  );
}

function BlockSection({ s, o }: { s: AppState; o: BlockObj }) {
  const dev = s.project.devices[o.deviceId];
  const def = dev && s.project.blockDefs[dev.defId];
  if (!dev || !def) return <div className="section">Missing device.</div>;
  const usage = Object.values(s.project.devices).filter((d) => d.defId === def.id).length;
  const pages = devicePages(s.project, dev.id);
  const here = s.project.pages.findIndex((p) => p.id === s.pageId);
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
      {pages.length > 1 && (
        <div className="btnrow small">
          <span className="muted">Also on page</span>
          {pages
            .filter((i) => i !== here)
            .map((i) => (
              <button key={i} title={s.project.pages[i].name} onClick={() => setPage(s.project.pages[i].id)}>
                {i + 1}
              </button>
            ))}
        </div>
      )}
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

function TextFields({ o }: { o: TextualObj }) {
  const patch = (fn: (t: TextProps) => void) => patchObjects([o.id], (t) => void ('text' in t && fn(t as TextProps)));
  const fitted = fitTextBox(textBoxOf(o)).size;
  const container = o.kind === 'container';
  return (
    <>
      <textarea
        className="textedit"
        key={o.id + o.text}
        defaultValue={o.text}
        placeholder={container ? 'Label (leave empty for a plain frame)' : o.kind !== 'text' ? 'Text inside the shape (or double-click it on the page)' : ''}
        onBlur={(e) => e.target.value !== o.text && patch((t) => (t.text = e.target.value))}
        rows={3}
      />
      <div className="fieldgroup">
        <label>
          Size <input type="number" min={4} max={72} step={0.5} value={o.fontSize} onChange={(e) => patch((t) => (t.fontSize = Number(e.target.value) || 9))} />
        </label>
        {fitted < o.fontSize && <span className="muted small">shrunk to {fitted}pt to fit</span>}
        <label>
          <input type="checkbox" checked={o.bold} onChange={(e) => patch((t) => (t.bold = e.target.checked))} /> Bold
        </label>
        {!container && (
          <label title="Off: lines break only where you press Enter. Either way, text shrinks to stay inside the box.">
            <input type="checkbox" checked={o.wrap !== false} onChange={(e) => patch((t) => (t.wrap = e.target.checked))} /> Wrap
          </label>
        )}
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
        {!container && (['top', 'middle', 'bottom'] as const).map((a) => (
          <button key={a} className={o.valign === a ? 'active' : ''} onClick={() => patch((t) => (t.valign = a))}>
            {a}
          </button>
        ))}
      </div>
    </>
  );
}

function SharedNote({ o }: { o: BoxObj }) {
  const project = useStore((s) => s.project);
  const pageId = useStore((s) => s.pageId);
  if (project.pages[0]?.id !== pageId || !titleBlockObjects(project).some((x) => x.id === o.id)) return null;
  return <div className="muted small">In the title block on page 1 — shown on every page.</div>;
}

function ConnectionSection({ s, c }: { s: AppState; c: Connection }) {
  const page = currentPage(s);
  const a = portInfo(s.project, page, c.from);
  const b = portInfo(s.project, page, c.to);
  const warns = connectionWarnings(s.project, page, c.from, c.to);
  const bundle = (page.bundles ?? []).find((b) => b.connIds.includes(c.id));
  const desc = (i: typeof a, objId: string) => {
    if (i) return `${i.device.name} · ${i.port.name}${i.port.signal ? ' (' + i.port.signal + ')' : ''}`;
    const o = page.objects.find((x) => x.id === objId);
    if (!o) return '?';
    if (o.kind === 'tag') return `Tag "${tagText(s.project, o)}"`;
    return 'text' in o && o.text ? `${kindName(o)} "${o.text.slice(0, 20)}"` : kindName(o);
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
      {bundle && (
        <div className="btnrow">
          <span className="muted">In a snake of {bundle.connIds.length} lines.</span>
          <button onClick={() => setState({ selection: [bundle.id] })}>Select snake</button>
          <button onClick={() => unbundle([bundle.id])}>Unbundle</button>
        </div>
      )}
      {!bundle && (
        <div className="fieldgroup">
          <label>
            Routing{' '}
            <select value={c.curved ? 'curved' : 'orth'} onChange={(e) => setCurved([c.id], e.target.value === 'curved')}>
              <option value="orth">Right-angle</option>
              <option value="curved">Curved</option>
            </select>
          </label>
        </div>
      )}
      <Field label="Label">
        <input key={c.id + c.label} defaultValue={c.label} placeholder="e.g. DD-301" onBlur={(e) => e.target.value !== c.label && patchConnections([c.id], (x) => void (x.label = e.target.value.trim()))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </Field>
      {!bundle && (
        <Field label="Label position">
          <input type="range" min={0.02} max={0.98} step={0.01} value={c.labelT ?? 0.5} onChange={(e) => patchConnections([c.id], (x) => void (x.labelT = Number(e.target.value)))} />
        </Field>
      )}
      {!bundle && c.labelT !== null && (
        <button onClick={() => patchConnections([c.id], (x) => void (x.labelT = null))}>Auto label position</button>
      )}
      <StrokeEditor value={c.style} onChange={(st) => st && setStroke([c.id], st)} />
      <div className="btnrow">
        <button disabled={!c.bends || !!c.curved || !!bundle} onClick={() => patchConnections([c.id], (x) => void (x.bends = null))}>
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

function BundleSection({ b }: { b: Bundle }) {
  return (
    <div className="section">
      <div className="section-title">Snake ({b.connIds.length} lines)</div>
      <Field label="Label">
        <input key={b.id + b.label} defaultValue={b.label} placeholder="e.g. SNAKE-1 (optional)" onBlur={(e) => e.target.value !== b.label && patchBundles([b.id], (x) => void (x.label = e.target.value.trim()))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </Field>
      <div className="muted small">Each line keeps its own label on its legs at both ends. Drag trunk segments to reroute.</div>
      <div className="sub">Trunk</div>
      <StrokeEditor value={b.style} onChange={(st) => st && setStroke([b.id], st)} />
      <div className="btnrow">
        <button disabled={!b.bends} onClick={() => patchBundles([b.id], (x) => void (x.bends = null))}>
          Reset route
        </button>
        <button onClick={() => setState({ selection: [...b.connIds] })}>Select lines</button>
        <button onClick={() => unbundle([b.id])} title="Back to separate lines (U)">
          Unbundle
        </button>
      </div>
    </div>
  );
}

function sameDef(a: BlockDef, b: BlockDef) {
  const ports = (d: BlockDef) => JSON.stringify([d.left, d.right].map((col) => col.map((p) => [p.name, p.signal, p.connector])));
  return a.manufacturer === b.manufacturer && a.model === b.model && a.defaultName === b.defaultName && ports(a) === ports(b);
}
