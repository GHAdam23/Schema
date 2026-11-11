import { useMemo, useState } from 'react';
import type { BlockDef } from '../model/types';
import { currentPage, getState, setState, toast, useStore } from '../state/store';
import { deleteLibraryDef, placeBlock, setLibrary, upsertLibraryDef } from '../state/actions';
import { cloneDef } from '../model/project';
import { exportLibraryCsv, exportLibraryXlsx, importLibraryFile, mergeLibrary } from '../io/libraryIO';
import { download, pickFile } from '../io/files';
import { drawingArea } from '../model/defaults';

export function filterLibrary(lib: BlockDef[], q: string, man = '', sig = '') {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return lib.filter((d) => {
    if (man && d.manufacturer !== man) return false;
    if (sig && ![...d.left, ...d.right].some((p) => p.signal === sig)) return false;
    const hay = `${d.manufacturer} ${d.model} ${d.defaultName}`.toLowerCase();
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

export function LibraryPanel() {
  const library = useStore((s) => s.library);
  const [q, setQ] = useState('');
  const [man, setMan] = useState('');
  const [sig, setSig] = useState('');
  const [sel, setSel] = useState<string | null>(null);

  const manufacturers = useMemo(() => [...new Set(library.map((d) => d.manufacturer).filter(Boolean))].sort(), [library]);
  const signals = useMemo(() => [...new Set(library.flatMap((d) => [...d.left, ...d.right].map((p) => p.signal)).filter(Boolean))].sort(), [library]);
  const list = useMemo(() => filterLibrary(library, q, man, sig).sort(sortDefs), [library, q, man, sig]);
  const selected = library.find((d) => d.id === sel) ?? null;

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
    <div className="panel library">
      <div className="panel-title">Block library</div>
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
            className={'libitem' + (d.id === sel ? ' sel' : '')}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-schema-block', d.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => setSel(d.id)}
            onDoubleClick={() => placeAtPointerOrCenter(d)}
            title="Drag onto the page, or double-click to place"
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
          disabled={!selected}
          onClick={() => {
            if (selected && confirm(`Delete "${selected.manufacturer} ${selected.model}" from the library? Projects keep their own copies.`)) {
              deleteLibraryDef(selected.id);
              setSel(null);
            }
          }}
        >
          Delete
        </button>
      </div>
      <div className="btnrow">
        <button onClick={() => void doImport()}>Import…</button>
        <button onClick={() => download(exportLibraryCsv(library), 'schema-library.csv')}>Export CSV</button>
        <button onClick={() => download(exportLibraryXlsx(library), 'schema-library.xlsx')}>Export XLSX</button>
      </div>
    </div>
  );
}
