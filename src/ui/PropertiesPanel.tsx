import type { BlockDef, BlockObj, BoxObj, Bundle, Connection, ImageObj, PageObject, StrokeStyle, TagObj, TextObj, TextProps, TextualObj } from '../model/types';
import { setState, useStore, currentPage, type AppState } from '../state/store';
import {
  alignLabels,
  numberLines,
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
import { nextLabel, updateProject } from '../state/store';
import { connSignal, DEFAULT_AUTO_LABEL, formatLabel } from '../model/signals';
import { setPage, makeSeparateDevice, revertInstanceDef, setHiddenPorts, describeObject, describeConnection } from '../state/actions';
import { blockFor } from '../model/blockGeometry';
import { isBox } from '../model/geom';
import { RackSection, RackUnitSection } from './RackProps';
import { ColorSwatch, Field, FillEditor, Group, NumberField, StrokeEditor } from './controls';
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
          {conns.length + bundles.length > 0 && (
            <>
              <div className="sub">
                {conns.length ? `Lines (${conns.length})` : ''}
                {conns.length && bundles.length ? ' · ' : ''}
                {bundles.length ? `Snakes (${bundles.length})` : ''}
              </div>
              <div className="fieldgroup">
                <label>
                  Routing{' '}
                  {(() => {
                    const all = [...conns.map((c) => !!c.curved), ...bundles.map((b) => !!b.curved)];
                    const v = all.every((x) => x) ? 'curved' : all.every((x) => !x) ? 'orth' : 'mixed';
                    return (
                      <select value={v} onChange={(e) => e.target.value !== 'mixed' && setCurved([...conns.map((c) => c.id), ...bundles.map((b) => b.id)], e.target.value === 'curved')}>
                        {v === 'mixed' && <option value="mixed">Mixed</option>}
                        <option value="orth">Right-angle</option>
                        <option value="curved">Curved</option>
                      </select>
                    );
                  })()}
                </label>
              </div>
              {conns.length > 0 && (
                <label
                  className="check"
                  title="Repeat each label near both ends instead of once along the line"
                  ref={(el) => {
                    const box = el?.querySelector('input');
                    if (box) box.indeterminate = conns.some((c) => c.labelEnds) && !conns.every((c) => c.labelEnds);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={conns.every((c) => c.labelEnds)}
                    onChange={(e) => {
                      nextLabel(e.target.checked ? 'Labels at both ends' : 'Labels once along the line');
                      patchConnections(conns.map((c) => c.id), (x) => void (x.labelEnds = e.target.checked || undefined));
                    }}
                  />{' '}
                  Label at both ends
                </label>
              )}
              <div className="btnrow">
                <button title="Label the selected lines with the next numbers (top to bottom); lines that already have a label keep it — Shift-click to renumber them too" onClick={(e) => numberLines(conns.map((c) => c.id), e.shiftKey)} disabled={!conns.length}>
                  Number these lines
                </button>
                <button
                  disabled={!!bundleProblem(s.project, page, conns.map((c) => c.id))}
                  title={bundleProblem(s.project, page, conns.map((c) => c.id)) ?? 'Draw these lines as one heavier trunk with short labelled legs at each end'}
                  onClick={bundleSelection}
                >
                  Bundle into snake
                </button>
              </div>
              {conns.length >= 4 && bundleProblem(s.project, page, conns.map((c) => c.id)) && (
                <div className="muted small">Snake: {bundleProblem(s.project, page, conns.map((c) => c.id))}</div>
              )}
            </>
          )}
          {conns.length > 1 && (
            <>
              <div className="sub">Line up labels (with the first line selected)</div>
              <div className="btnrow">
                <button title="Left edges in line with the first selected line's label" onClick={() => alignLabels('left')}>
                  ⇤ Left
                </button>
                <button title="Centres in line with the first selected line's label" onClick={() => alignLabels('hcenter')}>
                  Centre
                </button>
                <button title="Right edges in line with the first selected line's label" onClick={() => alignLabels('right')}>
                  Right ⇥
                </button>
              </div>
              <div className="btnrow small">
                <span className="muted">Labels on vertical runs:</span>
                <button onClick={() => alignLabels('top')}>Top</button>
                <button onClick={() => alignLabels('vcenter')}>Middle</button>
                <button onClick={() => alignLabels('bottom')}>Bottom</button>
              </div>
            </>
          )}
          <Group title={conns.length + bundles.length && !objs.length ? 'Line style' : 'Border / line style'}>
            <StrokeEditor value={conns[0]?.style ?? (objs[0] && 'border' in objs[0] ? (objs[0].border as StrokeStyle) : null) ?? DEFAULT_LINE} onChange={(st) => st && setStroke(s.selection, st)} />
          </Group>
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
      <LineSettings s={s} />
      <div className="help">
        <p>
          <b>Place blocks:</b> drag from the library, double-click a library entry,, or use <b>Insert…</b> to search.
        </p>
        <p>
          <b>Move a block:</b> drag its header, footer or centre. <b>Connect:</b> drag from a port row to another port. Drag from the dots on a text box or rectangle to connect to it.
        </p>
        <p>
          <b>Labels:</b> click a line and just start typing (Enter to edit an existing label); <kbd>Shift+↓</kbd> / <kbd>Shift+↑</kbd> moves on to the next line. Drag a label to slide it — it snaps in line
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
          <b>Straight lines:</b> dragging a block snaps its ports level with the blocks it's wired to. <b>Straighten</b> (toolbar) fixes jogs on the selected blocks or lines.
        </p>
        <p>
          <b>Several lines at once:</b> click a port, Shift-click to extend the run (Ctrl-click to add single ports), then drag one of them onto
          a port of the other block — the others follow onto the next rows.
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
          drag the yellow diamond to point it — drop it on an object or a line to glue it there), thought bubble, and lines (drag
          to draw; set arrowheads in the line's properties; ends snap and stay glued to shapes and lines, Alt = no snap). Shapes can be dragged out to size (Shift = circle / square). Drag the round handle above a selected shape, text box or image to rotate it (Shift = 15° steps).
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
          <b>Reference tags:</b> drag a line from a port and let go on empty space, or click a blue dot. The text
          (<i>TO (3) DISP-1</i>) updates itself; double-click a tag to jump to that device.
        </p>
        <p>
          <b>Snakes:</b> select ≥4 lines of one signal type between the same two devices (or a device and a shape) and use <b>Bundle</b>; click
          the trunk and type to label it. <b>Curved lines</b> (lines and snakes): in their properties — they route around objects, and the
          square handles on a selected curve reshape it.
        </p>
      </div>
    </div>
  );
}

/** Project-wide line settings: auto-numbered labels and signal colours. */
function LineSettings({ s }: { s: AppState }) {
  const auto = s.project.autoLabel ?? DEFAULT_AUTO_LABEL;
  const setAuto = (patch: Partial<typeof auto>, label: string) => {
    nextLabel(label);
    updateProject((d) => void (d.autoLabel = { ...auto, ...patch }));
  };
  const nStyles = Object.keys(s.project.signalStyles ?? {}).length;
  return (
    <>
      <Group title="Line labels">
        <label className="check" title="Every new line gets the next number as its label">
          <input type="checkbox" checked={auto.on} onChange={(e) => setAuto({ on: e.target.checked }, e.target.checked ? 'Auto-number line labels' : 'Stop auto-numbering line labels')} /> Number new lines automatically
        </label>
        <div className="fieldgroup">
          <label>
            Prefix <input style={{ width: 60 }} key={auto.prefix} defaultValue={auto.prefix} onBlur={(e) => e.target.value !== auto.prefix && setAuto({ prefix: e.target.value }, 'Label prefix')} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </label>
          <label>
            Next <NumberField min={0} step={1} width={60} value={auto.next} onCommit={(v) => setAuto({ next: Math.round(v) }, 'Next label number')} />
          </label>
          <label title="Pad with zeros to this many digits">
            Digits <NumberField min={0} max={6} step={1} width={44} value={auto.digits} onCommit={(v) => setAuto({ digits: Math.round(v) }, 'Label digits')} />
          </label>
        </div>
        <div className="muted small">
          Next label: <b>{formatLabel(auto, auto.next)}</b>. To number existing lines, select them and use “Number these lines”.
        </div>
      </Group>
      <Group title="Signal colours">
        <label className="check">
          <input
            type="checkbox"
            checked={!!s.project.signalColors}
            onChange={(e) => {
              if (e.target.checked && !nStyles) {
                setState({ modal: { kind: 'signalColors' } });
                return;
              }
              nextLabel(e.target.checked ? 'Colour lines by signal type' : 'Black lines');
              updateProject((d) => void (d.signalColors = e.target.checked));
            }}
          />{' '}
          Colour lines by signal type
        </label>
        <button onClick={() => setState({ modal: { kind: 'signalColors' } })}>Edit colours…{nStyles ? ` (${nStyles} set)` : ''}</button>
      </Group>
    </>
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
        <button disabled={blocks !== 2} onClick={rangeConnect} title="Pairs the ports picked on two blocks, in order — for destinations that aren't consecutive rows (dragging covers consecutive ones)">
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
  if (o.kind === 'rack') return <RackSection s={s} o={o} />;
  if (o.kind === 'rackunit') return <RackUnitSection s={s} o={o} />;
  return <ShapeSection o={o} />;
}

function LineSection({ o }: { o: LineObj }) {
  return (
    <div className="section">
      <div className="section-title">{o.arrows === 'none' ? 'Line' : 'Arrow'}</div>
      <SharedNote o={o} />
      <div className="fieldgroup">
        <span>Arrowheads</span>
        {(
          [
            ['none', '—', 'No arrowheads (plain line)'],
            ['end', '→', 'Arrowhead at the end'],
            ['start', '←', 'Arrowhead at the start'],
            ['both', '↔', 'Arrowheads at both ends'],
          ] as const
        ).map(([v, label, title]) => (
          <button key={v} className={o.arrows === v ? 'active' : ''} title={title} onClick={() => patchObjects([o.id], (t) => void (t.kind === 'line' && (t.arrows = v)))}>
            {label}
          </button>
        ))}
      </div>
      <div className="fieldgroup">
        <label>
          Length{' '}
          <NumberField
            min={1}
            step={1}
            value={Math.round(o.w * 10) / 10}
            onCommit={(v) =>
              patchObjects([o.id], (t) => {
                if (t.kind !== 'line') return;
                const w = Math.max(1, v);
                t.x -= (w - t.w) / 2;
                t.w = w;
                // A typed length lets go of what the ends are glued to (it would pull them back).
                delete t.ends;
              })
            }
          />
        </label>
        <label>
          Angle <NumberField step={15} value={Math.round((o.rot ?? 0) * 10) / 10} onCommit={(v) => setRotation([o.id], v)} />°
        </label>
      </div>
      <Group title="Line style">
        <StrokeEditor value={o.border} onChange={(st) => st && setStroke([o.id], st)} />
      </Group>
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
      <Group title={o.kind === 'container' ? 'Label' : 'Text'}>
        <TextFields o={o} />
      </Group>
      <Group title="Border">
        {o.kind === 'text' ? (
          <StrokeEditor value={o.border} allowNone onChange={(st) => (st ? (o.border ? setStroke([o.id], st) : patch((t) => ((t as TextObj).border = { color: '#000000', width: 0.75, dash: 'solid', ...st }))) : patch((t) => ((t as TextObj).border = null)))} />
        ) : (
          <StrokeEditor value={o.border} onChange={(st) => st && setStroke([o.id], st)} />
        )}
      </Group>
      <Group title="Fill">
        <FillEditor label={o.kind === 'container' ? 'Frame' : 'Colour'} value={o.fill} onChange={(f) => patch((t) => (t.fill = f))} />
        {o.kind === 'container' && <FillEditor label="Label band" value={o.headerFill} onChange={(f) => patch((t) => t.kind === 'container' && (t.headerFill = f))} />}
      </Group>
      {o.kind === 'callout' && (
        <Group title="Pointer">
          <div className="fieldgroup">
            <label>
              Shape{' '}
              <select value={o.shape ?? 'box'} onChange={(e) => patch((t) => t.kind === 'callout' && (t.shape = e.target.value === 'cloud' ? 'cloud' : undefined))}>
                <option value="box">Callout (box)</option>
                <option value="cloud">Thought bubble</option>
              </select>
            </label>
          </div>
          {o.tailTo ? (
            <div className="btnrow small">
              <span className="muted">Glued to {'connId' in o.tailTo ? describeLine(o.tailTo.connId) : describeTarget(o.tailTo.objId)}.</span>
              <button onClick={() => detachCallout(o)}>Detach</button>
            </div>
          ) : (
            <div className="muted small">Drop the yellow diamond on an object or a line to glue the pointer to it.</div>
          )}
        </Group>
      )}
      <Group title="Position & size">
        <Geometry o={o} />
        {(o.kind === 'ellipse' || o.kind === 'rect') && o.w !== o.h && (
          <button
            title="Make the width and height equal (keeps the centre). Tip: hold Shift while dragging out a new shape."
            onClick={() =>
              patchObjects([o.id], (t) => {
                if (t.kind !== 'ellipse' && t.kind !== 'rect') return;
                const m = Math.max(t.w, t.h);
                t.x -= (m - t.w) / 2;
                t.y -= (m - t.h) / 2;
                t.w = t.h = m;
              })
            }
          >
            {o.kind === 'ellipse' ? 'Make a circle' : 'Make a square'}
          </button>
        )}
      </Group>
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
      <Group title="Border">
        <StrokeEditor
          value={o.border}
          allowNone
          onChange={(st) =>
            st
              ? o.border
                ? setStroke([o.id], st)
                : patchObjects([o.id], (t) => void (t.kind === 'image' && (t.border = { color: '#000000', width: 0.75, dash: 'solid', ...st })))
              : patchObjects([o.id], (t) => void (t.kind === 'image' && (t.border = null)))
          }
        />
      </Group>
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
      <Group title="Border">
        <StrokeEditor value={o.border} onChange={(st) => st && setStroke([o.id], st)} />
      </Group>
      <Group title="Fill">
        <FillEditor value={o.fill} onChange={(f) => patch((t) => (t.fill = f))} />
      </Group>
    </div>
  );
}

function Geometry({ o }: { o: BoxObj }) {
  const num = (k: 'x' | 'y' | 'w' | 'h') => (
    <NumberField step={1} value={Math.round(o[k] * 100) / 100} onCommit={(v) => patchObjects([o.id], (t) => void (isBox(t) && (t[k] = v)))} />
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
          <NumberField step={15} value={Math.round((o.rot ?? 0) * 10) / 10} onCommit={(v) => setRotation([o.id], v)} />°
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
      <Group title="Border">
        <StrokeEditor value={o.border} onChange={(st) => st && setStroke([o.id], st)} />
      </Group>
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
          Colour <ColorSwatch value={o.color} defaultColor="#000000" onChange={(c) => patch((t) => (t.color = c ?? '#000000'))} />
        </label>
        <label>
          Size <NumberField min={2} max={72} step={0.5} width={52} value={o.fontSize} onCommit={(v) => patch((t) => (t.fontSize = v))} />
        </label>
        <label>
          <input type="checkbox" checked={o.bold} onChange={(e) => patch((t) => (t.bold = e.target.checked))} /> Bold
        </label>
        {!container && (
          <label title="Off: lines break only where you press Enter. Either way, text shrinks to stay inside the box.">
            <input type="checkbox" checked={o.wrap !== false} onChange={(e) => patch((t) => (t.wrap = e.target.checked))} /> Wrap
          </label>
        )}
      </div>
      {fitted < o.fontSize && <div className="muted small">Shrunk to {fitted} pt to fit the box.</div>}
      <div className="fieldgroup">
        <span className="seg">
          {(
            [
              ['left', 'Left'],
              ['center', 'Centre'],
              ['right', 'Right'],
            ] as const
          ).map(([a, l]) => (
            <button key={a} className={o.align === a ? 'active' : ''} title={'Align ' + a} onClick={() => patch((t) => (t.align = a))}>
              {l}
            </button>
          ))}
        </span>
        {!container && (
          <span className="seg">
            {(
              [
                ['top', 'Top'],
                ['middle', 'Middle'],
                ['bottom', 'Bottom'],
              ] as const
            ).map(([a, l]) => (
              <button key={a} className={o.valign === a ? 'active' : ''} title={'Vertical: ' + a} onClick={() => patch((t) => (t.valign = a))}>
                {l}
              </button>
            ))}
          </span>
        )}
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
      <Group title="Line style">
        <StrokeEditor value={c.style} onChange={(st) => st && setStroke([c.id], st)} />
        {(() => {
          const sig = connSignal(s.project, page, c);
          const st = s.project.signalColors && s.project.signalStyles?.[sig];
          if (!st) return null;
          return c.style.color.toLowerCase() === '#000000' ? (
            <div className="muted small">Drawn in the {sig} signal colour. Pick a colour here to override it.</div>
          ) : (
            <div className="btnrow small">
              <span className="muted">Own colour (instead of the {sig} colour).</span>
              <button onClick={() => setStroke([c.id], { color: '#000000' })}>Use signal colour</button>
            </div>
          );
        })()}
      </Group>
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
      <Group title="Trunk style">
        <StrokeEditor value={b.style} onChange={(st) => st && setStroke([b.id], st)} />
      </Group>
      <div className="btnrow">
        <button disabled={!b.bends} onClick={() => patchBundles([b.id], (x) => void (x.bends = null))}>
          Reset route
        </button>
        <button onClick={() => setState({ selection: [...b.connIds] })}>Select lines</button>
        <button onClick={() => unbundle([b.id])} title="Back to separate lines">
          Unbundle
        </button>
      </div>
    </div>
  );
}

function sameDef(a: BlockDef, b: BlockDef) {
  const ports = (d: BlockDef) => JSON.stringify([d.left, d.right].map((col) => col.map((p) => [p.name, p.signal, p.connector])));
  const rack = (d: BlockDef) => JSON.stringify(d.rack ? [d.rack.ru, d.rack.width ?? 'full', d.rack.depth ?? 0] : null);
  return a.manufacturer === b.manufacturer && a.model === b.model && a.defaultName === b.defaultName && ports(a) === ports(b) && rack(a) === rack(b);
}
