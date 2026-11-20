import { useMemo, useRef, useState } from 'react';
import type { BlockDef, RackAccessory } from '../model/types';
import { ACCESSORY_NAMES } from '../model/rack';
import { currentPage, getState, setState, toast, useStore } from '../state/store';
import { deleteLibraryDef, placeBlock, placeInstance, renameDevice, setLibrary, setPage, upsertLibraryDef } from '../state/actions';
import { devicePages } from '../model/tags';
import { cloneDef } from '../model/project';
import { exportLibraryCsv, exportLibraryXlsx, importLibraryFile, mergeLibrary } from '../io/libraryIO';
import { download, pickFile } from '../io/files';
import { drawingArea } from '../model/defaults';

export function filterLibrary(lib: BlockDef[], q: string, man = '', sig = '') {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return lib.filter((d) => {
    if (man && d.manufacturer !== man) return false;
    if (sig && ![...d.left, ...d.right].some((p) => p.signal === sig)) return false;
    const hay = `${d.manufacturer} ${d.model}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function sortDefs(a: BlockDef, b: BlockDef) {
  return a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model);
}

export function placeAtPointerOrCenter(def: BlockDef) {
  const s = getState();
  const pg = currentPage(s);
  const area = drawingArea(pg.size);
  const g = s.prefs.gridSize;
  const p = s.pointer && s.pointer.x > area.x && s.pointer.x < area.x + area.w && s.pointer.y > area.y && s.pointer.y < area.y + area.h ? s.pointer : { x: area.x + area.w / 2 - 50, y: area.y + area.h / 2 - 30 };
  placeBlock(def, Math.round(p.x / g) * g, Math.round(p.y / g) * g);
}

function pointOrCentre() {
  const s = getState();
  const area = drawingArea(currentPage(s).size);
  const g = s.prefs.gridSize;
  const p = s.pointer && s.pointer.x > area.x && s.pointer.x < area.x + area.w && s.pointer.y > area.y && s.pointer.y < area.y + area.h ? s.pointer : { x: area.x + area.w / 2 - 50, y: area.y + area.h / 2 - 30 };
  return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
}

export function LibraryPanel() {
  const [tab, setTab] = useState<'library' | 'devices' | 'rack'>('library');
  return (
    <div className="panel library">
      <div className="panel-tabs">
        <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
          Library
        </button>
        <button className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')} title="Devices in this project — place one on more pages">
          Devices in project
        </button>
        <button className={tab === 'rack' ? 'active' : ''} onClick={() => setTab('rack')} title="Racks, and rack hardware: blank, brush and vent panels, drawers, shelves">
          Racks &amp; components
        </button>
      </div>
      {tab === 'library' ? <LibraryTab /> : tab === 'devices' ? <DevicesTab /> : <RackPartsTab />}
    </div>
  );
}

/** Project devices: drag (or double-click) one to place another instance of it on this page. */
function DevicesTab() {
  const project = useStore((s) => s.project);
  const pageId = useStore((s) => s.pageId);
  const [q, setQ] = useState('');
  const here = project.pages.findIndex((p) => p.id === pageId);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = Object.values(project.devices)
    .map((d) => ({ d, def: project.blockDefs[d.defId], pages: devicePages(project, d.id) }))
    .filter(({ d, def }) => terms.every((t) => `${d.name} ${def?.manufacturer} ${def?.model}`.toLowerCase().includes(t)))
    .sort((a, b) => a.d.name.localeCompare(b.d.name, undefined, { numeric: true }));
  return (
    <>
      <input className="search" placeholder="Search devices…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="liblist">
        {list.map(({ d, def, pages }) => (
          <div
            key={d.id}
            className={'libitem' + (pages.includes(here) ? ' here' : '')}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-schema-device', d.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onDoubleClick={() => {
              const p = pointOrCentre();
              placeInstance(d.id, p.x, p.y);
            }}
            title="Drag onto the page (or double-click) to show this same device here too"
          >
            <DeviceName id={d.id} name={d.name} />
            <div className="man">{def ? `${def.manufacturer} ${def.model}` : '(missing definition)'}</div>
            <div className="meta">
              page{' '}
              {pages.map((i) => (
                <button
                  key={i}
                  className={'pagelink' + (i === here ? ' cur' : '')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPage(project.pages[i].id);
                  }}
                  title={project.pages[i].name}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!list.length && <div className="empty">{q ? 'No devices match.' : 'No devices yet — place blocks from the library.'}</div>}
      </div>
      <div className="muted small pad">Renaming or editing a device changes it on every page. Ctrl+C a block, then Ctrl+Shift+V on another page also places the same device.</div>
    </>
  );
}

function LibraryTab() {
  const library = useStore((s) => s.library);
  const [q, setQ] = useState('');
  const [man, setMan] = useState('');
  const [sig, setSig] = useState('');
  // Multi-selection (click, Shift = range, Ctrl = toggle). Export uses the selection.
  const [selIds, setSelIds] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);

  const manufacturers = useMemo(() => [...new Set(library.map((d) => d.manufacturer).filter(Boolean))].sort(), [library]);
  const signals = useMemo(() => [...new Set(library.flatMap((d) => [...d.left, ...d.right].map((p) => p.signal)).filter(Boolean))].sort(), [library]);
  const list = useMemo(() => filterLibrary(library, q, man, sig).sort(sortDefs), [library, q, man, sig]);
  const selSet = new Set(selIds.filter((id) => library.some((d) => d.id === id)));
  const selectedDefs = library.filter((d) => selSet.has(d.id));
  const selected = selectedDefs.length === 1 ? selectedDefs[0] : null;
  const setSel = (id: string | null) => setSelIds(id ? [id] : []);

  const clickItem = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) {
      const a = list.findIndex((d) => d.id === anchor.current);
      const b = list.findIndex((d) => d.id === id);
      if (a >= 0 && b >= 0) {
        setSelIds(list.slice(Math.min(a, b), Math.max(a, b) + 1).map((d) => d.id));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) setSelIds(selSet.has(id) ? [...selSet].filter((x) => x !== id) : [...selSet, id]);
    else setSelIds([id]);
    anchor.current = id;
  };

  const exportName = (ext: string) =>
    selectedDefs.length === 1
      ? `${selectedDefs[0].manufacturer} ${selectedDefs[0].model}`.trim().replace(/[\\/:*?"<>|]+/g, '_') + ext
      : 'schema-library' + ext;
  const exportCount = selectedDefs.length;

  const doImport = async () => {
    const f = await pickFile('.csv,.tsv,.txt,.xlsx,.xls');
    if (!f) return;
    try {
      const incoming = await importLibraryFile(f);
      if (!incoming.length) {
        toast('No blocks found in that file.', 'warn');
        return;
      }
      const r = mergeLibrary(getState().library, incoming);
      setLibrary(r.lib);
      toast(`Imported ${incoming.length} blocks: ${r.added} added, ${r.updated} updated.`);
    } catch (e) {
      toast('Import failed: ' + (e as Error).message, 'error', 6000);
    }
  };

  return (
    <>
      <input className="search" placeholder="Search manufacturer / model…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row">
        <select value={man} onChange={(e) => setMan(e.target.value)}>
          <option value="">All manufacturers</option>
          {manufacturers.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select value={sig} onChange={(e) => setSig(e.target.value)}>
          <option value="">All signals</option>
          {signals.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      <div className="liblist">
        {list.map((d) => (
          <div
            key={d.id}
            className={'libitem' + (selSet.has(d.id) ? ' sel' : '')}
            draggable
            onDragStart={(e) => {
              // Dragging one of several highlighted blocks brings them all.
              const ids = selSet.has(d.id) && selSet.size > 1 ? list.filter((x) => selSet.has(x.id)).map((x) => x.id) : [d.id];
              e.dataTransfer.setData('application/x-schema-block', ids.join(','));
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={(e) => clickItem(e, d.id)}
            onDoubleClick={() => placeAtPointerOrCenter(d)}
            title="Drag onto the page or a rack (with several highlighted, drag one of them to bring them all), or double-click to place"
          >
            <div className="man">{d.manufacturer || '—'}</div>
            <div className="model">{d.model || '(no model)'}</div>
            <div className="meta">
              {d.left.length} in · {d.right.length} out
            </div>
          </div>
        ))}
        {!list.length && <div className="empty">No blocks match.</div>}
      </div>
      <div className="btnrow">
        <button onClick={() => setState({ modal: { kind: 'blockEditor', target: 'library', defId: null } })}>New</button>
        <button disabled={!selected} onClick={() => selected && setState({ modal: { kind: 'blockEditor', target: 'library', defId: selected.id } })}>
          Edit
        </button>
        <button
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            const c = cloneDef(selected);
            c.model += ' (copy)';
            upsertLibraryDef(c);
            setSel(c.id);
          }}
        >
          Duplicate
        </button>
        <button
          disabled={!selectedDefs.length}
          onClick={() => {
            const n = selectedDefs.length;
            const what = n === 1 ? `"${selectedDefs[0].manufacturer} ${selectedDefs[0].model}"` : `${n} blocks`;
            if (n && confirm(`Delete ${what} from the library? Projects keep their own copies.`)) {
              for (const d of selectedDefs) deleteLibraryDef(d.id);
              setSel(null);
            }
          }}
        >
          Delete
        </button>
      </div>
      <div className="btnrow">
        <button onClick={() => void doImport()}>Import…</button>
        <button disabled={!exportCount} title="Export the highlighted blocks" onClick={() => download(exportLibraryCsv(selectedDefs), exportName('.csv'))}>
          Export CSV
        </button>
        <button disabled={!exportCount} title="Export the highlighted blocks" onClick={() => download(exportLibraryXlsx(selectedDefs), exportName('.xlsx'))}>
          Export XLSX
        </button>
      </div>
      <div className="btnrow small">
        <button onClick={() => setSelIds(list.map((d) => d.id))}>Select all{q || man || sig ? ' shown' : ''}</button>
        <button disabled={!exportCount} onClick={() => setSelIds([])}>
          Select none
        </button>
        <span className="muted">{exportCount ? `${exportCount} selected` : 'Ctrl/Shift-click to multi-select'}</span>
      </div>
    </>
  );
}

const PARTS: [RackAccessory, string][] = [
  ['blank', 'Closes an empty space'],
  ['brush', 'Cable pass-through with brush strip'],
  ['vent', 'Perforated / slotted for airflow'],
  ['drawer', 'Storage drawer'],
  ['shelf', 'Holds gear that isn\u2019t rack-mountable'],
];

/** Racks (drag one onto the page) and rack hardware to drag into a rack, each with its height. */
function RackPartsTab() {
  const [sizes, setSizes] = useState<Record<RackAccessory, number>>({ blank: 1, brush: 1, vent: 1, drawer: 2, shelf: 2 });
  const [rackU, setRackU] = useState('12');
  const ru = Math.max(1, Math.min(60, Math.round(Number(rackU)) || 12));
  return (
    <>
      <div className="liblist">
        <div
          className="libitem rackitem"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-schema-rack', String(ru));
            e.dataTransfer.effectAllowed = 'copy';
          }}
          title="Drag onto the page to place a rack"
        >
          <div className="model">Rack</div>
          <div className="man">Numbered rack outline — drag onto the page</div>
          <div className="meta" onMouseDown={(e) => e.stopPropagation()}>
            <label className="rackusize" title="Rack units of mounting space">
              Size <input type="number" min={1} max={60} value={rackU} onChange={(e) => setRackU(e.target.value)} /> U
            </label>
          </div>
        </div>
        <div className="libgroup">Components — drag onto an empty rack space</div>
        {PARTS.map(([type, hint]) => (
          <div
            key={type}
            className="libitem"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-schema-rackpart', JSON.stringify({ type, ru: sizes[type] }));
              e.dataTransfer.effectAllowed = 'copy';
            }}
            title="Drag onto a rack space"
          >
            <div className="model">{ACCESSORY_NAMES[type]}</div>
            <div className="man">{hint}</div>
            <div className="meta" onMouseDown={(e) => e.stopPropagation()}>
              <span className="seg">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button key={n} className={sizes[type] === n ? 'active' : ''} onClick={() => setSizes({ ...sizes, [type]: n })}>
                    {n}U
                  </button>
                ))}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="muted small pad">
        Pick a size, then drag. Heights can be changed later in the properties. Gear that isn&rsquo;t rack-mountable (mounting “Shelf” in its
        size) sits on a shelf. Front-panel images (PNG, JPG, PDF, SVG) can be dropped straight onto a rack space.
      </div>
    </>
  );
}

/** A device's friendly name in the list: click it (or the reminder) to type a name. */
function DeviceName({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <input
        className="devname-edit"
        autoFocus
        onFocus={(e) => e.target.select()}
        defaultValue={name}
        placeholder="friendly name"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          setEditing(false);
          const v = e.target.value.trim();
          if (v !== name) renameDevice(id, v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  return (
    <div
      className="model devname"
      title="Click to edit the friendly name"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {name || <i className="warntext">add friendly name</i>}
    </div>
  );
}
