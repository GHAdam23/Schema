import { useMemo, useState } from 'react';
import { FLAGGED_LIST_ID } from '../defaults';
import { personText } from '../search';
import { useDB } from '../store';
import { displayName, sortKey } from '../util';
import { Avatar } from './ui';

type Sort = 'name' | 'added' | 'edited';

export function PeopleList({ selectedId, onSelect }: { selectedId?: string; onSelect: (id: string) => void }) {
  const db = useDB();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [listId, setListId] = useState('');

  const people = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    let ps = db.people.filter((p) => !listId || p.listIds.includes(listId));
    if (words.length) ps = ps.filter((p) => { const t = personText(p, db); return words.every((w) => t.includes(w)); });
    return [...ps].sort((a, b) =>
      sort === 'name' ? sortKey(a).localeCompare(sortKey(b))
      : sort === 'added' ? b.createdAt.localeCompare(a.createdAt)
      : b.updatedAt.localeCompare(a.updatedAt));
  }, [db, filter, sort, listId]);

  let lastLetter = '';
  return (
    <aside className="people-list">
      <div className="pl-controls">
        <input type="search" placeholder="Filter people…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="row">
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="name">By name</option>
            <option value="added">Recently added</option>
            <option value="edited">Recently edited</option>
          </select>
          <select value={listId} onChange={(e) => setListId(e.target.value)} aria-label="List">
            <option value="">Everyone</option>
            {db.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="muted small">{people.length} of {db.people.length} {db.people.length === 1 ? 'person' : 'people'}</div>
      </div>
      <ul>
        {people.map((p) => {
          const letter = sort === 'name' ? (p.lastName || p.firstName || '#')[0].toUpperCase() : '';
          const header = letter !== lastLetter ? letter : '';
          lastLetter = letter;
          return (
            <li key={p.id}>
              {header && <div className="pl-letter">{header}</div>}
              <button className={p.id === selectedId ? 'pl-item selected' : 'pl-item'} onClick={() => onSelect(p.id)}>
                <Avatar person={p} size={32} />
                <span className="pl-name">
                  {displayName(p)}
                  {p.placeMet && <span className="muted small">{p.placeMet}</span>}
                </span>
                {p.listIds.includes(FLAGGED_LIST_ID) && <span className="flag-mark" title="Flagged">⚑</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
