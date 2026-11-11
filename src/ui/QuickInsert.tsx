import { useMemo, useState } from 'react';
import { setState, useStore } from '../state/store';
import { filterLibrary, placeAtPointerOrCenter, sortDefs } from './LibraryPanel';

export function QuickInsert() {
  const library = useStore((s) => s.library);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const list = useMemo(() => filterLibrary(library, q).sort(sortDefs).slice(0, 50), [library, q]);
  const close = () => setState({ modal: null });
  const pick = (i: number) => {
    const d = list[i];
    if (!d) return;
    close();
    placeAtPointerOrCenter(d);
  };
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal quick">
        <input
          autoFocus
          className="search big"
          placeholder="Type to search blocks… Enter to place at cursor"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(list.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') pick(idx);
          }}
        />
        <div className="quicklist">
          {list.map((d, i) => (
            <div key={d.id} className={'quickitem' + (i === idx ? ' sel' : '')} onMouseEnter={() => setIdx(i)} onClick={() => pick(i)}>
              <b>{d.manufacturer}</b> {d.model} <span className="muted">{d.defaultName}</span>
            </div>
          ))}
          {!list.length && <div className="empty">No matches.</div>}
        </div>
      </div>
    </div>
  );
}
