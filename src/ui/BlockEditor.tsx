import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockDef, BlockObj, Direction, PortDef, Project } from '../model/types';
import { newId } from '../model/ids';
import { cloneDef, emptyBlockDef } from '../model/project';
import { blockLayout } from '../model/blockGeometry';
import { drawObject } from '../render/buildPage';
import type { DLItem } from '../render/displayList';
import { SvgItems } from '../render/SvgRender';
import { setState, toast, useStore } from '../state/store';
import { saveInstanceDef, saveProjectDef, upsertLibraryDef } from '../state/actions';
import { blockFor } from '../model/blockGeometry';

type Col = 'left' | 'right';
const COLS: Col[] = ['left', 'right'];
const FIELDS = ['name', 'signal', 'connector'] as const;
type FieldKey = (typeof FIELDS)[number];

interface RowClip {
  rows: PortDef[];
}
let rowClipboard: RowClip | null = null;

/** Direction is defined by the column: left = IN, right = OUT. */
const colDir = (col: Col): Direction => (col === 'left' ? 'IN' : 'OUT');

function parseTsv(text: string): string[][] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l, i, a) => !(i === a.length - 1 && l === ''))
    .map((l) => l.split('\t'));
}

function rowsToTsv(rows: PortDef[]) {
  return rows.map((r) => [r.name, r.signal, r.connector].join('\t')).join('\n');
}

function incrementName(name: string, by: number): string {
  const m = name.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return name + ' ' + (1 + by);
  const n = String(parseInt(m[2], 10) + by).padStart(m[2].length, '0');
  return m[1] + n + m[3];
}

export function BlockEditor({ target, defId, objId }: { target: 'library' | 'project' | 'instance'; defId: string | null; objId?: string }) {
  const library = useStore((s) => s.library);
  const project = useStore((s) => s.project);
  const signalTypes = useStore((s) => (target === 'library' ? s.prefs.signalTypes : s.project.signalTypes ?? s.prefs.signalTypes));
  const initial = useMemo<BlockDef>(() => {
    if (target === 'library') {
      const d = library.find((l) => l.id === defId);
      return d ? cloneDef(d, d.id) : emptyBlockDef();
    }
    if (target === 'instance') {
      // This block's own ports, or (first time) a copy of the device's — port ids kept so lines stay.
      const o = project.pages.flatMap((p) => p.objects).find((x) => x.id === objId);
      const base = o?.kind === 'block' ? blockFor(project, o).base : undefined;
      return base ? { ...cloneDef(base, base.id), libraryId: base.libraryId } : emptyBlockDef();
    }
    const d = defId ? project.blockDefs[defId] : null;
    return d ? { ...cloneDef(d, d.id), libraryId: d.libraryId } : emptyBlockDef();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [def, setDef] = useState<BlockDef>(initial);
  const instObj = target === 'instance' ? project.pages.flatMap((p) => p.objects).find((x) => x.id === objId) : undefined;
  const instName = instObj?.kind === 'block' ? project.devices[instObj.deviceId]?.name : '';
  const [past, setPast] = useState<BlockDef[]>([]);
  const [future, setFuture] = useState<BlockDef[]>([]);
  const [activeCol, setActiveCol] = useState<Col>('left');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [pattern, setPattern] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const commit = (next: BlockDef) => {
    setPast((p) => [...p.slice(-100), def]);
    setFuture([]);
    setDef(next);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [def, ...f]);
    setDef(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, def]);
    setDef(future[0]);
    setFuture((f) => f.slice(1));
  };

  const selectedRows = (col: Col) => def[col].filter((r) => sel.has(r.id));
  const close = () => setState({ modal: null });

  const save = () => {
    if (!def.manufacturer.trim() && !def.model.trim()) {
      toast('Enter a manufacturer and/or model.', 'warn');
      return;
    }
    const clean: BlockDef = {
      ...def,
      manufacturer: def.manufacturer.trim(),
      model: def.model.trim(),
      left: def.left.filter((p) => p.name || p.signal || p.connector).map((p) => ({ ...p, dir: colDir('left') })),
      right: def.right.filter((p) => p.name || p.signal || p.connector).map((p) => ({ ...p, dir: colDir('right') })),
    };
    if (target === 'library') upsertLibraryDef(clean);
    else if (target === 'instance') {
      const lost = saveInstanceDef(objId!, clean);
      if (lost.length) toast(`${lost.length} connection(s) removed because their ports were deleted — see History for details.`, 'warn', 8000);
    } else {
      const lost = saveProjectDef(clean);
      if (lost.length) toast(`${lost.length} connection(s) removed because their ports were deleted — see History for details.`, 'warn', 8000);
    }
    close();
  };

  // ---- row operations ---------------------------------------------------------------------
  const setCell = (col: Col, id: string, k: FieldKey, v: string) => {
    commit({ ...def, [col]: def[col].map((r) => (r.id === id ? { ...r, [k]: k === 'signal' ? v.toUpperCase() : v } : r)) });
  };
  const newRow = (col: Col, src?: Partial<PortDef>): PortDef => ({
    id: newId('pt'),
    name: '',
    signal: '',
    connector: '',
    dir: colDir(col),
    ...src,
  });
  const addRow = (col: Col) => {
    const rows = def[col];
    const selIdx = rows.map((r, i) => (sel.has(r.id) ? i : -1)).filter((i) => i >= 0);
    const at = selIdx.length ? Math.max(...selIdx) + 1 : rows.length;
    const r = newRow(col);
    commit({ ...def, [col]: [...rows.slice(0, at), r, ...rows.slice(at)] });
    setSel(new Set([r.id]));
    setActiveCol(col);
  };
  const deleteRows = () => {
    if (!sel.size) return;
    commit({ ...def, left: def.left.filter((r) => !sel.has(r.id)), right: def.right.filter((r) => !sel.has(r.id)) });
    setSel(new Set());
  };
  const moveRows = (delta: -1 | 1) => {
    const next = { ...def };
    for (const col of COLS) {
      const rows = [...def[col]];
      const idx = rows.map((r, i) => (sel.has(r.id) ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) continue;
      if (delta < 0 ? idx[0] === 0 : idx[idx.length - 1] === rows.length - 1) continue;
      const order = delta < 0 ? idx : [...idx].reverse();
      for (const i of order) [rows[i], rows[i + delta]] = [rows[i + delta], rows[i]];
      next[col] = rows;
    }
    commit(next);
  };
  const moveToOtherColumn = () => {
    const toRight = def.left.filter((r) => sel.has(r.id)).map((r) => ({ ...r, dir: colDir('right') }));
    const toLeft = def.right.filter((r) => sel.has(r.id)).map((r) => ({ ...r, dir: colDir('left') }));
    if (!toRight.length && !toLeft.length) return;
    commit({
      ...def,
      left: [...def.left.filter((r) => !sel.has(r.id)), ...toLeft],
      right: [...def.right.filter((r) => !sel.has(r.id)), ...toRight],
    });
  };
  const copyRows = async (cut = false) => {
    const rows = [...selectedRows('left'), ...selectedRows('right')];
    if (!rows.length) return;
    rowClipboard = { rows };
    try {
      await navigator.clipboard.writeText(rowsToTsv(rows));
    } catch {
      /* clipboard may be unavailable; internal clipboard still works */
    }
    if (cut) deleteRows();
  };
  const insertRows = (col: Col, rows: PortDef[]) => {
    const cur = def[col];
    const selIdx = cur.map((r, i) => (sel.has(r.id) ? i : -1)).filter((i) => i >= 0);
    const at = selIdx.length ? Math.max(...selIdx) + 1 : cur.length;
    commit({ ...def, [col]: [...cur.slice(0, at), ...rows, ...cur.slice(at)] });
    setSel(new Set(rows.map((r) => r.id)));
  };
  const pasteRows = async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      /* ignore */
    }
    if (text && (text.includes('\t') || text.includes('\n'))) {
      insertRows(activeCol, parseTsv(text).map((cells) => tsvRow(activeCol, cells)));
    } else if (rowClipboard) {
      insertRows(activeCol, rowClipboard.rows.map((r) => ({ ...r, id: newId('pt'), dir: colDir(activeCol) })));
    }
  };
  const tsvRow = (col: Col, cells: string[]) =>
    newRow(col, {
      name: (cells[0] ?? '').trim(),
      signal: (cells[1] ?? '').trim().toUpperCase(),
      connector: (cells[2] ?? '').trim(),
      dir: colDir(col),
    });
  const duplicateIncrement = () => {
    const next = { ...def };
    const newSel = new Set<string>();
    for (const col of COLS) {
      const rows = def[col].filter((r) => sel.has(r.id));
      if (!rows.length) continue;
      const lastIdx = Math.max(...def[col].map((r, i) => (sel.has(r.id) ? i : -1)));
      const copies = rows.map((r) => ({ ...r, id: newId('pt'), name: incrementName(r.name, rows.length) }));
      copies.forEach((c) => newSel.add(c.id));
      next[col] = [...def[col].slice(0, lastIdx + 1), ...copies, ...def[col].slice(lastIdx + 1)];
    }
    if (!newSel.size) return;
    commit(next);
    setSel(newSel);
  };

  /** Paste tab-separated text into a cell: fills cells to the right/down, extending rows as needed. */
  const onCellPaste = (e: React.ClipboardEvent, col: Col, rowIdx: number, field: FieldKey) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const grid = parseTsv(text);
    const rows = [...def[col]];
    const f0 = FIELDS.indexOf(field);
    grid.forEach((cells, i) => {
      const ri = rowIdx + i;
      const r: PortDef = rows[ri] ? { ...rows[ri] } : newRow(col);
      cells.forEach((v, j) => {
        const k = FIELDS[f0 + j];
        if (!k) return;
        r[k] = k === 'signal' ? v.trim().toUpperCase() : v.trim();
      });
      rows[ri] = r;
    });
    commit({ ...def, [col]: rows });
  };

  const clickRowHeader = (e: React.MouseEvent, col: Col, id: string) => {
    setActiveCol(col);
    const rows = def[col];
    if (e.shiftKey && anchor.current) {
      const a = rows.findIndex((r) => r.id === anchor.current);
      const b = rows.findIndex((r) => r.id === id);
      if (a >= 0 && b >= 0) {
        const [x, y] = [Math.min(a, b), Math.max(a, b)];
        setSel(new Set(rows.slice(x, y + 1).map((r) => r.id)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const n = new Set(sel);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      setSel(n);
    } else setSel(new Set([id]));
    anchor.current = id;
  };

  // Keyboard shortcuts while the editor is open (when not typing in a cell).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select');
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (k === 'escape' && !typing) {
        close();
        return;
      }
      if (mod && k === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === 'y' && !typing) {
        e.preventDefault();
        redo();
        return;
      }
      if (typing) return;
      if (mod && k === 'c') void copyRows();
      else if (mod && k === 'x') void copyRows(true);
      else if (mod && k === 'v') void pasteRows();
      else if (mod && k === 'd') {
        e.preventDefault();
        duplicateIncrement();
      } else if (k === 'delete' || k === 'backspace') {
        e.preventDefault();
        deleteRows();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Paste anywhere in the dialog (not inside a cell) inserts rows.
  const onRootPaste = (e: React.ClipboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    insertRows(activeCol, parseTsv(text).map((cells) => tsvRow(activeCol, cells)));
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal block-editor" ref={rootRef} onPaste={onRootPaste}>
        <div className="modal-title">
          {target === 'library' ? 'Library block' : target === 'instance' ? `Ports of this instance${instName ? ` (${instName})` : ''}` : `Ports of every ${def.manufacturer} ${def.model} in this project`}
          {target === 'project' && <span className="muted"> — all blocks of this model in this project (not your library)</span>}
          {target === 'instance' && <span className="muted"> — other pages, other devices and your library don't change</span>}
        </div>
        <div className="be-body">
          <div className="be-left">
            <div className="be-header">
              <label>
                Manufacturer
                <input value={def.manufacturer} onChange={(e) => commit({ ...def, manufacturer: e.target.value })} autoFocus />
              </label>
              <label>
                Model
                <input value={def.model} onChange={(e) => commit({ ...def, model: e.target.value })} />
              </label>
            </div>
            {target !== 'instance' && (
              <RackSizeFields rack={def.rack} onChange={(rack) => commit({ ...def, rack })} />
            )}
            <div className="be-tools">
              <button onClick={() => addRow(activeCol)}>+ Row</button>
              <button disabled={!sel.size} onClick={deleteRows}>
                Delete
              </button>
              <button disabled={!sel.size} onClick={() => moveRows(-1)}>
                ↑
              </button>
              <button disabled={!sel.size} onClick={() => moveRows(1)}>
                ↓
              </button>
              <button disabled={!sel.size} onClick={moveToOtherColumn} title="Move selected rows to the other column">
                ⇄ Column
              </button>
              <button disabled={!sel.size} onClick={() => void copyRows()}>
                Copy
              </button>
              <button disabled={!sel.size} onClick={() => void copyRows(true)}>
                Cut
              </button>
              <button onClick={() => void pasteRows()} title="Paste rows (also accepts tab-separated text from Excel)">
                Paste
              </button>
              <button disabled={!sel.size} onClick={duplicateIncrement} title="Duplicate selected rows, incrementing numbers (Ctrl+D)">
                Dup +1
              </button>
              <button onClick={() => setPattern(true)}>Pattern fill…</button>
              <button disabled={!past.length} onClick={undo}>
                ↶
              </button>
              <button disabled={!future.length} onClick={redo}>
                ↷
              </button>
            </div>
            <datalist id="signal-types">
              {signalTypes.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <div className="be-grids">
              {COLS.map((col) => (
                <div key={col} className={'be-grid' + (activeCol === col ? ' active' : '')} onMouseDown={() => setActiveCol(col)}>
                  <div className="be-grid-title">{col === 'left' ? 'IN column (left)' : 'OUT column (right)'}</div>
                  <table>
                    <thead>
                      <tr>
                        <th />
                        <th>Port</th>
                        <th>Signal</th>
                        <th>Connector</th>
                      </tr>
                    </thead>
                    <tbody>
                      {def[col].map((r, i) => (
                        <tr key={r.id} className={sel.has(r.id) ? 'sel' : ''}>
                          <td className="rowhead" onMouseDown={(e) => clickRowHeader(e, col, r.id)}>
                            {i + 1}
                          </td>
                          {(['name', 'signal', 'connector'] as const).map((k) => (
                            <td key={k}>
                              <input
                                value={r[k]}
                                list={k === 'signal' ? 'signal-types' : undefined}
                                onChange={(e) => setCell(col, r.id, k, e.target.value)}
                                onPaste={(e) => onCellPaste(e, col, i, k)}
                                onFocus={() => setActiveCol(col)}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button className="addrow" onClick={() => addRow(col)}>
                    + add row
                  </button>
                </div>
              ))}
            </div>
            <div className="muted small">
              Click row numbers to select (Shift = range, Ctrl = toggle). Paste rows copied from Excel (Port, Signal, Connector) into a cell or
              anywhere in the grid.
            </div>
          </div>
          <div className="be-preview">
            <div className="be-grid-title">Preview</div>
            <BlockPreview def={def} />
          </div>
        </div>
        <div className="modal-buttons">
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </div>
        {pattern && (
          <PatternFill
            col={activeCol}
            signalTypes={signalTypes}
            onCancel={() => setPattern(false)}
            onApply={(col, rows) => {
              setPattern(false);
              setActiveCol(col);
              commit({ ...def, [col]: [...def[col], ...rows] });
              setSel(new Set(rows.map((r) => r.id)));
            }}
          />
        )}
      </div>
    </div>
  );
}


function BlockPreview({ def }: { def: BlockDef }) {
  const name = 'FRIENDLY NAME';
  const L = blockLayout(def, name);
  const items: DLItem[] = [];
  const proj: Project = {
    version: 1,
    info: {} as Project['info'],
    pages: [],
    devices: { d: { id: 'd', defId: def.id, name } },
    blockDefs: { [def.id]: def },
    assets: {},
  };
  const o: BlockObj = { id: 'o', kind: 'block', deviceId: 'd', x: 0, y: 0, scale: 1, border: { color: '#000000', width: 1, dash: 'solid' } };
  drawObject(items, proj, o);
  const pad = 10;
  return (
    <div className="preview-box">
      <svg viewBox={`${-pad} ${-pad} ${L.w + pad * 2} ${L.h + pad * 2}`} width={(L.w + pad * 2) * 1.6} style={{ maxWidth: '100%' }}>
        <SvgItems items={items} assets={{}} />
      </svg>
    </div>
  );
}

function PatternFill({
  col,
  signalTypes,
  onCancel,
  onApply,
}: {
  col: Col;
  signalTypes: string[];
  onCancel: () => void;
  onApply: (col: Col, rows: PortDef[]) => void;
}) {
  const [c, setC] = useState<Col>(col);
  const [tpl, setTpl] = useState('SDI IN {n}');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(8);
  const [signal, setSignal] = useState('HDSDI');
  const [connector, setConnector] = useState('BNC');
  const [pad, setPad] = useState(false);
  const count = Math.max(0, Math.abs(to - from) + 1);
  const make = (): PortDef[] => {
    const step = to >= from ? 1 : -1;
    const width = String(Math.max(from, to)).length;
    const out: PortDef[] = [];
    for (let n = from; step > 0 ? n <= to : n >= to; n += step) {
      const ns = pad ? String(n).padStart(width, '0') : String(n);
      out.push({ id: newId('pt'), name: tpl.includes('{n}') ? tpl.split('{n}').join(ns) : `${tpl} ${ns}`, signal: signal.toUpperCase(), connector, dir: colDir(c) });
    }
    return out;
  };
  return (
    <div className="modal-bg inner" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal small">
        <div className="modal-title">Pattern fill</div>
        <div className="form">
          <label>
            Name pattern <input value={tpl} onChange={(e) => setTpl(e.target.value)} autoFocus />
          </label>
          <div className="muted small">Use {'{n}'} for the number.</div>
          <label>
            n from <input type="number" value={from} onChange={(e) => setFrom(parseInt(e.target.value, 10) || 0)} />
          </label>
          <label>
            to <input type="number" value={to} onChange={(e) => setTo(parseInt(e.target.value, 10) || 0)} />
          </label>
          <label>
            <input type="checkbox" checked={pad} onChange={(e) => setPad(e.target.checked)} /> Zero-pad numbers
          </label>
          <label>
            Signal <input value={signal} list="signal-types" onChange={(e) => setSignal(e.target.value)} />
          </label>
          <datalist id="signal-types-pf">
            {signalTypes.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <label>
            Connector <input value={connector} onChange={(e) => setConnector(e.target.value)} />
          </label>
          <label>
            Column{' '}
            <select value={c} onChange={(e) => setC(e.target.value as Col)}>
              <option value="left">IN (left)</option>
              <option value="right">OUT (right)</option>
            </select>
          </label>
        </div>
        <div className="muted small">Generates {count} rows.</div>
        <div className="modal-buttons">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={count === 0 || count > 512} onClick={() => onApply(c, make())}>
            Add rows
          </button>
        </div>
      </div>
    </div>
  );
}

type Mount = 'none' | 'rack' | 'shelf';

/** Physical size for rack elevations: rack-mount (U, width, depth) or not rack-mountable (W × H × D, sits on a shelf). */
function RackSizeFields({ rack, onChange }: { rack: BlockDef['rack']; onChange: (r: BlockDef['rack']) => void }) {
  const mount: Mount = !rack ? 'none' : rack.width === 'custom' ? 'shelf' : 'rack';
  const num = (v: string) => (v === '' ? undefined : Number(v) > 0 ? Number(v) : undefined);
  return (
    <div className="be-header be-rack" title="Physical size for rack elevations">
      <label>
        Mounting
        <select
          value={mount}
          onChange={(e) => {
            const m = e.target.value as Mount;
            if (m === 'none') onChange(undefined);
            else if (m === 'rack') onChange({ ru: rack?.ru ?? 1, depth: rack?.depth, width: 'full' });
            else onChange({ ru: 1, width: 'custom', w: rack?.w ?? 8, h: rack?.h ?? 1.75, depth: rack?.depth });
          }}
        >
          <option value="none">— not set —</option>
          <option value="rack">Rack-mounted</option>
          <option value="shelf">Not rack-mounted (shelf, W × H × D)</option>
        </select>
      </label>
      {mount === 'rack' && (
        <>
          <label>
            Height (U)
            <input type="number" min={1} max={20} value={rack!.ru} onChange={(e) => onChange({ ...rack!, ru: Math.max(1, Math.round(Number(e.target.value)) || 1) })} />
          </label>
          <label>
            Width
            <select value={rack!.width ?? 'full'} onChange={(e) => onChange({ ...rack!, width: e.target.value as 'full' })}>
              <option value="full">Full (19″)</option>
              <option value="half">Half</option>
              <option value="third">Third</option>
            </select>
          </label>
        </>
      )}
      {mount === 'shelf' && (
        <>
          <label>
            Width (in)
            <input type="number" min={0.25} max={19} step={0.25} value={rack!.w ?? ''} onChange={(e) => onChange({ ...rack!, w: num(e.target.value) })} />
          </label>
          <label>
            Height (in)
            <input type="number" min={0.25} max={40} step={0.25} value={rack!.h ?? ''} onChange={(e) => onChange({ ...rack!, h: num(e.target.value) })} />
          </label>
        </>
      )}
      {mount !== 'none' && (
        <label>
          Depth (in)
          <input type="number" min={0} max={60} step={0.25} placeholder="—" value={rack!.depth ?? ''} onChange={(e) => onChange({ ...rack!, depth: num(e.target.value) })} />
        </label>
      )}
    </div>
  );
}
