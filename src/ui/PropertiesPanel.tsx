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
import { devicePages, tagRowFit, tagTargetPage, tagText } from '../model/tags';
import { setPage, makeSeparateDevice, revertInstanceDef, setHiddenPorts, describeObject, describeConnection } from '../state/actions';
import { blockFor } from '../model/blockGeometry';
import { useEffect, useRef, useState } from 'react';
import { calloutTip } from '../render/buildPage';
import { getState } from '../state/store';
import type { CalloutObj, LineObj } from '../model/types';

function describeLine(id: string) {
  const s = getState();
  const pg = currentPage(s);
  const c = pg.connections.find((x) => x.id === id);
  return c ? 'line ' + describeConnection(s.project, pg, c) : 'a deleted line';
}

function describeTarget(id: string) {
  const s = getState();
  const o = currentPage(s).objects.find((x) => x.id === id);
  return o ? describeObject(s.project, o) : 'a deleted object';
}

/** Unglue a callout's pointer, leaving the tip where it is now. */
function detachCallout(o: CalloutObj) {
  const tip = calloutTip(getState().project, o);
  patchObjects([o.id], (t) => {
    if (t.kind !== 'callout') return;
    t.tail = { x: Math.round(tip.x - t.x), y: Math.round(tip.y - t.y) };
    delete t.tailTo;
  });
}

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
          <b>Several lines at once:</b> click a port, Shift-click to extend the run (Ctrl-click to add single ports), then drag one of them onto
          a port of the other block — the others follow onto the next rows. Or Ctrl-click ports on a second block and press <kbd>Shift+C</kbd> (Range connect).
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
          drag the yellow diamond to point it — drop it on an object or a line to glue it there), thought bubble, and drawn lines / arrows (drag
          to draw; their ends snap to shapes, Alt = no snap). Drawing tools stay selected until you pick another tool or press Esc. Drag the round handle above a selected shape, text box or image to rotate it (Shift = 15° steps).
        </p>
        <p>
          <b>Images:</b> drop PNG, JPG, PDF or SVG files on the page, paste an image, or use <b>Image…</b>. PDFs stay vector in the export; SVGs are
          converted to vector shapes.
        </p>
        <p>
          <b>Same device on several pages:</b> copy a block and paste it on another page (or drag it from the <b>Devices</b> tab) — it's the
          same device, with one friendly name. <kbd>Ctrl+Shift+V</kbd> pastes a new device of the same model instead. Renaming a block to an
          existing device's name offers to make them one device. A small blue dot marks ports that are connected on another page — click it to add an off-page reference tag for that connection. In a block's
          properties you can hide rows or edit its ports for that block only.
        </p>
        <p>
          <b>Reference tags:</b> drag a line from a port and let go on empty space, or use the Tag tool (<kbd>G</kbd>). The text
          (<i>TO (3) DISP-1</i>) updates itself; double-click a tag to jump to that device.
        </p>
        <p>
          <b>Snakes:</b> select ≥4 lines of one signal type between the same two devices (or a device and a shape) and press <kbd>B</kbd>; click
          the trunk and type to label it. <b>Curved lines</b> (lines and snakes): in their properties — they route around objects, and the
          square handles on a selected curve reshape it.
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
      <div className="btnrow">
        <button disabled={blocks !== 2} onClick={rangeConnect} title="Pairs ports in order (Shift+C)">
          Range connect
        </button>
        <button
          disabled={blocks !== 1}
          title="Hide these rows on this block only (show them again from the block's properties)"
          onClick={() => {
            const objId = s.selectedPorts[0].objId;
            const o = page.objects.find((x) => x.id === objId);
            if (o?.kind !== 'block') return;
            if (setHiddenPorts(objId, [...new Set([...(o.hidden ?? []), ...s.selectedPorts.map((p) => p.portId)])])) setState({ selectedPorts: [], selection: [objId] });
          }}
        >
          Hide these rows
        </button>
      </div>
      {blocks !== 2 && <div className="muted">Range connect: select ports on exactly two blocks.</div>}
    </div>
  );
}

function ObjectSection({ s, o }: { s: AppState; o: PageObject }) {
  if (o.kind === 'block') return <BlockSection s={s} o={o} />;
  if (o.kind === 'tag') return <TagSection s={s} o={o} />;
  if (o.kind === 'image') return <ImageSection s={s} o={o} />;
  if (o.kind === 'line') return <LineSection o={o} />;
  return <ShapeSection o={o} />;
}

function LineSection({ o }: { o: LineObj }) {
  return (
    <div className="section">
      <div className="section-title">{o.arrows === 'none' ? 'Line' : 'Arrow'}</div>
      <SharedNote o={o} />
      <div className="fieldgroup">
        <label>
          Arrowheads{' '}
          <select value={o.arrows} onChange={(e) => patchObjects([o.id], (t) => void (t.kind === 'line' && (t.arrows = e.target.value as LineObj['arrows'])))}>
            <option value="none">None (line)</option>
            <option value="end">At the end</option>
            <option value="start">At the start</option>
            <option value="both">Both ends</option>
          </select>
        </label>
      </div>
      <div className="fieldgroup">
        <label>
          Length{' '}
          <input type="number" min={1} step={1} value={Math.round(o.w * 10) / 10} onChange={(e) => patchObjects([o.id], (t) => {
            if (t.kind !== 'line') return;
            const w = Math.max(1, Number(e.target.value) || 1);
            t.x -= (w - t.w) / 2;
            t.w = w;
          })} />
        </label>
        <label>
          Angle <input type="number" step={15} value={Math.round((o.rot ?? 0) * 10) / 10} onChange={(e) => setRotation([o.id], Number(e.target.value) || 0)} />°
        </label>
      </div>
      <div className="sub">Line</div>
      <StrokeEditor value={o.border} onChange={(st) => st && setStroke([o.id], st)} />
      <div className="muted small">Drag the round handles at the ends to move them (Shift: 15° steps).</div>
    </div>
  );
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
      {o.kind === 'container' && <FillEditor label="Label band" value={o.headerFill} onChange={(f) => patch((t) => t.kind === 'container' && (t.headerFill = f))} />}
      {o.kind === 'callout' && o.tailTo && (
        <div className="btnrow small">
          <span className="muted">Pointer glued to {'connId' in o.tailTo ? describeLine(o.tailTo.connId) : describeTarget(o.tailTo.objId)}.</span>
          <button onClick={() => detachCallout(o)}>Detach</button>
        </div>
      )}
      {o.kind === 'callout' && !o.tailTo && <div className="muted small">Drop the yellow diamond on an object or a line to glue the pointer to it.</div>}
      {o.kind === 'callout' && (
        <div className="fieldgroup">
          <label>
            Shape{' '}
            <select value={o.shape ?? 'box'} onChange={(e) => patch((t) => t.kind === 'callout' && (t.shape = e.target.value === 'cloud' ? 'cloud' : undefined))}>
              <option value="box">Callout (box)</option>
              <option value="cloud">Thought bubble</option>
            </select>
          </label>
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
  // The block whose port this tag is wired to (if any).
  const pg = currentPage(s);
  const portBlock = (() => {
    const c = pg.connections.find((x) => x.from.objId === o.id || x.to.objId === o.id);
    const other = c && (c.from.objId === o.id ? c.to : c.from);
    const b = other && pg.objects.find((x) => x.id === other.objId);
    return b?.kind === 'block' ? b : null;
  })();
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
        <label title="Fixed height, e.g. a block's row height so tags at neighbouring ports line up. Empty = from the font size.">
          Height{' '}
          <input
            type="number"
            min={4}
            max={72}
            step={0.5}
            placeholder="auto"
            value={o.height ?? ''}
            onChange={(e) => patch((t) => (t.height = e.target.value === '' ? undefined : Math.max(4, Number(e.target.value))))}
          />
        </label>
      </div>
      {portBlock && (
        <button title="As tall as the row of the port it's attached to, in that row's font size — tags at neighbouring ports then don't overlap" onClick={() => patch((t) => Object.assign(t, tagRowFit(portBlock.scale)), 'Fit tag to row')}>
          Match row height
        </button>
      )}
      <button disabled={pi < 0} onClick={() => jumpToTag(o)} title="Double-clicking the tag does the same">
        {pi >= 0 ? `Go to page ${pi + 1}` : 'Go to device'}
      </button>
      <div className="sub">Border</div>
      <StrokeEditor value={o.border} onChange={(st) => st && setStroke([o.id], st)} />
      <FillEditor value={o.fill} onChange={(f) => patch((t) => (t.fill = f))} />
    </div>
  );
}

const SWATCHES = [
  '#ffffff', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#475569', '#1e293b', '#000000',
  '#fee2e2', '#fecaca', '#fca5a5', '#ef4444', '#ffedd5', '#fed7aa', '#fb923c', '#ea580c',
  '#fef9c3', '#fde68a', '#facc15', '#ca8a04', '#dcfce7', '#bbf7d0', '#4ade80', '#16a34a',
  '#dbeafe', '#bfdbfe', '#60a5fa', '#2563eb', '#ede9fe', '#ddd6fe', '#a78bfa', '#7c3aed',
];

/** Colour swatch that is always visible; click for a palette with "No fill" and a custom colour. */
function ColorSwatch({ value, onChange, noneLabel = 'No fill' }: { value: string | null; onChange: (v: string | null) => void; noneLabel?: string }) {
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const pick = (v: string | null) => {
    onChange(v);
    setOpen(null);
  };
  return (
    <span className="swatchwrap" ref={ref}>
      <button className={'swatch' + (value ? '' : ' none')} style={value ? { background: value } : undefined} title={value ?? noneLabel}
        onClick={(e) => {
          // Fixed position so the palette isn't clipped by the scrolling panel.
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { left: Math.max(4, Math.min(r.left, window.innerWidth - 236)), top: Math.min(r.bottom + 4, window.innerHeight - 200) });
        }}
      />
      {open && (
        <div className="swatchpop" style={open}>
          <button className="swatchnone" onClick={() => pick(null)}>
            <span className="swatch none" /> {noneLabel}
          </button>
          <div className="swatchgrid">
            {SWATCHES.map((c) => (
              <button key={c} className={'swatch' + (c === value ? ' cur' : '')} style={{ background: c }} title={c} onClick={() => pick(c)} />
            ))}
          </div>
          <label className="swatchcustom">
            Custom <input type="color" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} />
          </label>
        </div>
      )}
    </span>
  );
}

function FillEditor({ value, onChange, label = 'Fill' }: { value: string | null; onChange: (v: string | null) => void; label?: string }) {
  return (
    <div className="fieldgroup">
      <label>
        {label} <ColorSwatch value={value} onChange={onChange} />
      </label>
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
  const { dev, def: shown, base } = blockFor(s.project, o);
  const def = dev && s.project.blockDefs[dev.defId];
  if (!dev || !def || !base) return <div className="section">Missing device.</div>;
  const usage = Object.values(s.project.devices).filter((d) => d.defId === def.id).length;
  const pages = devicePages(s.project, dev.id);
  const here = s.project.pages.findIndex((p) => p.id === s.pageId);
  const lib = s.library.find((l) => l.id === def.libraryId);
  const differs = !!lib && !sameDef(lib, def);
  const hidden = new Set(o.hidden ?? []);
  const all = [...base.left, ...base.right];
  const signals = [...new Set(all.map((p) => p.signal).filter(Boolean))].sort();
  const toggle = (ids: string[], hide: boolean) => setHiddenPorts(o.id, hide ? [...new Set([...hidden, ...ids])] : [...hidden].filter((h) => !ids.includes(h)));
  const model = `${def.manufacturer} ${def.model}`.trim();
  return (
    <div className="section">
      <div className="section-title">Block</div>
      <Field label="Friendly name">
        <input key={dev.id + dev.name} defaultValue={dev.name} onBlur={(e) => e.target.value.trim() && e.target.value !== dev.name && renameDevice(dev.id, e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </Field>
      <div className="muted">
        {def.manufacturer} | {def.model} · {shown!.left.length} in / {shown!.right.length} out{hidden.size ? ` (${hidden.size} hidden)` : ''}
      </div>
      {pages.length > 1 && (
        <div className="btnrow small">
          <span className="muted">Same device on page</span>
          {pages
            .filter((i) => i !== here)
            .map((i) => (
              <button key={i} title={s.project.pages[i].name} onClick={() => setPage(s.project.pages[i].id)}>
                {i + 1}
              </button>
            ))}
          <button
            title="This one is actually another unit of the same model: give it its own name"
            onClick={() => {
              const n = prompt(`New friendly name for this ${model} (the one on the other page${pages.length > 2 ? 's' : ''} stays "${dev.name}"):`, '');
              if (n?.trim()) makeSeparateDevice(o.id, n.trim());
            }}
          >
            Make separate device…
          </button>
        </div>
      )}
      <div className="fieldgroup">
        <label>
          Scale{' '}
          <input
            type="number"
            min={30}
            max={400}
            step={5}
            value={Math.round(o.scale * 1000) / 10}
            onChange={(e) => patchObjects([o.id], (t) => void (t.kind === 'block' && (t.scale = Math.min(4, Math.max(0.3, (Number(e.target.value) || 100) / 100)))))}
          />
          %
        </label>
        {o.scale !== 1 && (
          <button title="Back to 100% (rows then line up with other 100% blocks)" onClick={() => patchObjects([o.id], (t) => void (t.kind === 'block' && (t.scale = 1)))}>
            Reset to 100%
          </button>
        )}
      </div>
      <div className="sub">Border</div>
      <StrokeEditor value={o.border} onChange={(st) => st && setStroke([o.id], st)} />
      <div className="sub">Rows shown on this block</div>
      {signals.length > 1 && (
        <div className="btnrow small">
          {signals.map((sig) => {
            const ids = all.filter((p) => p.signal === sig).map((p) => p.id);
            const off = ids.every((id) => hidden.has(id));
            return (
              <button key={sig} className={off ? '' : 'active'} title={off ? `Show the ${sig} rows` : `Hide the ${sig} rows on this block`} onClick={() => toggle(ids, !off)}>
                {sig}
              </button>
            );
          })}
        </div>
      )}
      <details className="rows">
        <summary>
          {all.length - hidden.size} of {all.length} rows shown
        </summary>
        {(['left', 'right'] as const).map((col) =>
          base[col].map((p) => (
            <label key={p.id} className="rowcheck">
              <input type="checkbox" checked={!hidden.has(p.id)} onChange={(e) => toggle([p.id], !e.target.checked)} /> {col === 'left' ? 'IN' : 'OUT'} · {p.name}
              <span className="muted"> {p.signal}</span>
            </label>
          )),
        )}
      </details>
      <div className="muted small">Hiding rows only affects this block; the device keeps its ports everywhere else.</div>
      <div className="sub">Ports</div>
      {o.defId && <div className="muted small">This block has its own port list (edited for this block only).</div>}
      <div className="btnrow">
        <button title="Add, delete or rename rows on this block only — other pages, other devices and your library don't change" onClick={() => setState({ modal: { kind: 'blockEditor', target: 'instance', defId: null, objId: o.id } })}>
          Edit ports — this block only…
        </button>
        <button
          title={`Changes every ${model} in this project${o.defId ? ' (except blocks with their own port list, like this one)' : ''}; your library stays as it is`}
          onClick={() => setState({ modal: { kind: 'blockEditor', target: 'project', defId: def.id } })}
        >
          Edit ports — every {def.model || 'block of this model'}{usage > 1 ? ` (${usage} devices)` : ''}…
        </button>
        {o.defId && (
          <button onClick={() => revertInstanceDef(o.id)} title="Drop this block's own port list and use the device's again">
            Use shared ports
          </button>
        )}
      </div>
      <div className="sub">Library</div>
      <div className="muted">{!lib ? 'Not in your library.' : differs ? 'This project’s ports differ from your library.' : 'Matches your library.'}</div>
      <div className="btnrow">
        {differs && (
          <>
            <button onClick={() => updateFromLibrary(def.id)} title="Replace this project's ports for this model with your library version">
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
        <label className="check" title="Repeat the label near each end instead of once along the line — handy for tracing long lines">
          <input type="checkbox" checked={!!c.labelEnds} onChange={(e) => patchConnections([c.id], (x) => void (x.labelEnds = e.target.checked || undefined))} /> Label at both ends
        </label>
      )}
      {!bundle && !c.labelEnds && (
        <Field label="Label position">
          <input type="range" min={0.02} max={0.98} step={0.01} value={c.labelT ?? 0.5} onChange={(e) => patchConnections([c.id], (x) => void (x.labelT = Number(e.target.value)))} />
        </Field>
      )}
      {!bundle && c.labelEnds && c.labelEndsT && (
        <button onClick={() => patchConnections([c.id], (x) => void (x.labelEndsT = undefined))}>Auto label positions</button>
      )}
      {!bundle && !c.labelEnds && c.labelT !== null && (
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
      <div className="fieldgroup">
        <label>
          Routing{' '}
          <select value={b.curved ? 'curved' : 'orth'} onChange={(e) => setCurved([b.id], e.target.value === 'curved')}>
            <option value="orth">Right-angle</option>
            <option value="curved">Curved</option>
          </select>
        </label>
      </div>
      <div className="sub">Trunk</div>
      <StrokeEditor value={b.style} onChange={(st) => st && setStroke([b.id], st)} />
      <div className="btnrow">
        <button disabled={!b.bends} onClick={() => patchBundles([b.id], (x) => void (x.bends = null))}>
          Reset route
        </button>
        <button onClick={() => setState({ selection: [...b.connIds] })}>Select lines</button>
        <button onClick={() => unbundle([b.id])} title="Back to separate lines (Ctrl+Shift+B)">
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
