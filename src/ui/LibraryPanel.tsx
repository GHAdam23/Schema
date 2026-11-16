import { useMemo, useRef, useState } from 'react';
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
            className={'libitem' + (selSet.has(d.id) ? ' sel' : '')}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-schema-block', d.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={(e) => clickItem(e, d.id)}
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
    </div>
  );
}
