import { useState } from 'react';
import { useStore } from '../state/store';
import { addPage, deletePage, duplicatePage, movePage, renamePage, setPage, setPageSize } from '../state/actions';
import { PAGE_SIZES } from '../model/defaults';
import type { PageSizeId } from '../model/types';

export function PageTabs() {
  const pages = useStore((s) => s.project.pages);
  const pageId = useStore((s) => s.pageId);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const cur = pages.find((p) => p.id === pageId) ?? pages[0];

  return (
    <div className="pagetabs" onClick={() => setMenu(null)}>
      {pages.map((p, i) => (
        <div
          key={p.id}
          className={'tab' + (p.id === cur.id ? ' active' : '') + (overIdx === i && dragIdx !== null && dragIdx !== i ? ' dropover' : '')}
          draggable={editing !== p.id}
          onDragStart={(e) => {
            setDragIdx(i);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(i));
          }}
          onDragOver={(e) => {
            if (dragIdx === null) return;
            e.preventDefault();
            setOverIdx(i);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragIdx !== null && dragIdx !== i) movePage(dragIdx, i);
            setDragIdx(null);
            setOverIdx(null);
          }}
          onDragEnd={() => {
            setDragIdx(null);
            setOverIdx(null);
          }}
          onClick={() => setPage(p.id)}
          onDoubleClick={() => setEditing(p.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setPage(p.id);
            setMenu({ id: p.id, x: e.clientX, y: e.clientY });
          }}
          title="Double-click to rename, drag to reorder, right-click for more"
        >
          <span className="num">{i + 1}</span>
          {editing === p.id ? (
            <input
              autoFocus
              defaultValue={p.name}
              onBlur={(e) => {
                renamePage(p.id, e.target.value.trim() || p.name);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <span>{p.name}</span>
          )}
        </div>
      ))}
      <button className="tb" title="Add page" onClick={addPage}>
        +
      </button>
      <div className="spacer" />
      <label className="pagesize">
        Size{' '}
        <select value={cur.size} onChange={(e) => setPageSize(cur.id, e.target.value as PageSizeId)}>
          {Object.entries(PAGE_SIZES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      {menu && (
        <div className="ctxmenu" style={{ left: menu.x, top: menu.y - 110 }}>
          <button onClick={() => setEditing(menu.id)}>Rename</button>
          <button onClick={() => duplicatePage(menu.id)}>Duplicate</button>
          <button
            onClick={() => {
              const p = pages.find((x) => x.id === menu.id);
              if (p && (p.objects.length === 0 || confirm(`Delete page "${p.name}"?`))) deletePage(menu.id);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
