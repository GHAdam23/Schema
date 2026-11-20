import { useMemo, useState } from 'react';
import { update, useDB } from '../store';
import { emptyQuery, isEmptyQuery, runQuery, type Query } from '../search';
import type { Database, Person } from '../types';
import { displayName, download, fmtDate, nowStamp, sortKey } from '../util';
import { fmtRange, itemColor, itemLabel } from './Timeline';
import { Avatar, ChipPicker } from './ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type GroupBy = 'none' | 'tag' | 'location' | 'list' | 'lastName';

function csvCell(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function peopleToCsv(db: Database, people: Person[]): string {
  const head = ['First', 'Middle', 'Last', 'Nickname', 'Former name', 'Birthday', 'Place met', 'Phones', 'Emails', 'Addresses', 'Tags', 'Locations', 'Lists', 'Added', 'Edited'];
  const rows = people.map((p) => {
    const items = db.timeline.filter((t) => t.personId === p.id);
    const tags = [...new Set(items.filter((t) => t.tagId).map((t) => itemLabel(db, t)))];
    const places = [...new Set(items.filter((t) => t.placeId).map((t) => itemLabel(db, t)))];
    const lv = (xs: { label: string; value: string }[]) => xs.map((x) => `${x.label}: ${x.value}`).join('; ');
    return [
      p.firstName, p.middleName, p.lastName, p.nickname, p.formerName, p.birthday, p.placeMet,
      lv(p.phones), lv(p.emails), lv(p.addresses), tags.join('; '), places.join('; '),
      db.lists.filter((l) => p.listIds.includes(l.id)).map((l) => l.name).join('; '),
      p.createdAt, p.updatedAt,
    ].map((v) => csvCell(String(v))).join(',');
  });
  return [head.join(','), ...rows].join('\n');
}

export function SearchView({ onOpen, initialListId }: { onOpen: (id: string) => void; initialListId?: string }) {
  const db = useDB();
  const [q, setQ] = useState<Query>(() => ({ ...emptyQuery(), listIds: initialListId ? [initialListId] : [] }));
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [listTarget, setListTarget] = useState('');
  const set = (patch: Partial<Query>) => setQ({ ...q, ...patch });

  const hits = useMemo(
    () => runQuery(db, q).sort((a, b) => sortKey(a.person).localeCompare(sortKey(b.person))),
    [db, q],
  );

  const groups = useMemo(() => {
    if (groupBy === 'none') return [];
    const counts = new Map<string, number>();
    const bump = (k: string) => counts.set(k, (counts.get(k) || 0) + 1);
    for (const { person } of hits) {
      const items = db.timeline.filter((t) => t.personId === person.id);
      let keys: string[] = [];
      if (groupBy === 'tag') keys = [...new Set(items.filter((t) => t.tagId).map((t) => itemLabel(db, t)))];
      if (groupBy === 'location') keys = [...new Set(items.filter((t) => t.placeId).map((t) => itemLabel(db, t)))];
      if (groupBy === 'list') keys = db.lists.filter((l) => person.listIds.includes(l.id)).map((l) => l.name);
      if (groupBy === 'lastName') keys = [person.lastName || '(no last name)'];
      if (!keys.length) keys = ['(none)'];
      keys.forEach(bump);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [hits, groupBy, db]);

  const addAllToList = () => {
    if (!listTarget) return;
    const ids = new Set(hits.map((h) => h.person.id));
    update((d) => ({
      ...d,
      people: d.people.map((p) =>
        ids.has(p.id) && !p.listIds.includes(listTarget) ? { ...p, listIds: [...p.listIds, listTarget], updatedAt: nowStamp() } : p),
    }));
  };

  const yearOptions = (() => {
    const ys = new Set<number>();
    for (const t of db.timeline) ys.add(Number(t.start.slice(0, 4)));
    return [...ys].sort((a, b) => b - a);
  })();

  return (
    <div className="search-view">
      <div className="search-filters card">
        <h2>Search</h2>
        <label className="field">
          <span>Name or any text</span>
          <input type="search" autoFocus value={q.text} onChange={(e) => set({ text: e.target.value })}
            placeholder="Name, place met, notes, favorites, phone…" />
        </label>
        <label className="field"><span>Tags</span>
          <ChipPicker options={db.tags} selected={q.tagIds} onChange={(tagIds) => set({ tagIds })} placeholder="Any tag" />
        </label>
        <label className="field"><span>Locations</span>
          <ChipPicker options={db.places} selected={q.placeIds} onChange={(placeIds) => set({ placeIds })} placeholder="Any location" />
        </label>
        <label className="field"><span>Life events</span>
          <ChipPicker options={db.eventTypes.map((e) => ({ id: e, name: e }))} selected={q.eventTypes}
            onChange={(eventTypes) => set({ eventTypes })} placeholder="Any event" />
        </label>
        <label className="field"><span>Relationship</span>
          <ChipPicker options={db.relationshipTypes.map((e) => ({ id: e.name, name: e.name }))} selected={q.relTypes}
            onChange={(relTypes) => set({ relTypes })} placeholder="Any relationship" />
        </label>
        <label className="field"><span>Lists</span>
          <ChipPicker options={db.lists} selected={q.listIds} onChange={(listIds) => set({ listIds })} placeholder="Any list" />
        </label>

        <fieldset className="field">
          <span>Dates</span>
          <select value={q.dateField} onChange={(e) => set({ dateField: e.target.value as Query['dateField'] })}>
            <option value="timeline">On their timeline during…</option>
            <option value="created">Added to the app during…</option>
            <option value="edited">Last edited during…</option>
            <option value="birthday">Born during…</option>
          </select>
          <div className="row">
            <input value={q.from} onChange={(e) => set({ from: e.target.value })} placeholder="From: 2007 or 2007-06" list="years" />
            <input value={q.to} onChange={(e) => set({ to: e.target.value })} placeholder="To: 2007-12-31" list="years" />
          </div>
          <datalist id="years">{yearOptions.map((y) => <option key={y} value={y} />)}</datalist>
          <span className="muted small">Type a year, a year-month, or a full date. One year alone (From 2007, To 2007) covers the whole year.</span>
        </fieldset>

        <div className="row">
          <label className="field"><span>Birthday month</span>
            <select value={q.birthdayMonth} onChange={(e) => set({ birthdayMonth: Number(e.target.value) })}>
              <option value={0}>Any</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label className="field"><span>Photo</span>
            <select value={q.hasPhoto} onChange={(e) => set({ hasPhoto: e.target.value as Query['hasPhoto'] })}>
              <option value="any">Any</option><option value="yes">Has photo</option><option value="no">No photo</option>
            </select>
          </label>
        </div>
        <button onClick={() => setQ(emptyQuery())} disabled={isEmptyQuery(q)}>Clear all</button>
      </div>

      <div className="search-results">
        <div className="results-head card">
          <div className="total">
            <strong>{hits.length}</strong> {hits.length === 1 ? 'person matches' : 'people match'}
            {!isEmptyQuery(q) && <span className="muted"> of {db.people.length}</span>}
          </div>
          <div className="row wrap">
            <label className="inline">Count by
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="none">—</option><option value="tag">Tag</option><option value="location">Location</option>
                <option value="list">List</option><option value="lastName">Last name</option>
              </select>
            </label>
            <span className="spacer" />
            <select value={listTarget} onChange={(e) => setListTarget(e.target.value)} aria-label="List to add to">
              <option value="">Add all to list…</option>
              {db.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button disabled={!listTarget || !hits.length} onClick={addAllToList}>Add</button>
            <button disabled={!hits.length} onClick={() => download(`people-search-${fmtDate(new Date().toISOString().slice(0, 10)).replace(/[ ,]+/g, '-')}.csv`, peopleToCsv(db, hits.map((h) => h.person)), 'text/csv')}>
              Export CSV
            </button>
          </div>
          {groups.length > 0 && (
            <table className="totals">
              <tbody>
                {groups.map(([k, n]) => (
                  <tr key={k}><td>{k}</td><td className="num">{n}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <ul className="result-list">
          {hits.map(({ person, items }) => (
            <li key={person.id}>
              <button className="result" onClick={() => onOpen(person.id)}>
                <Avatar person={person} size={36} />
                <span className="result-main">
                  <strong>{displayName(person)}</strong>
                  {person.placeMet && <span className="muted small">Met: {person.placeMet}</span>}
                  {items.length > 0 && (
                    <span className="why">
                      {items.slice(0, 4).map((it) => (
                        <span key={it.id} className="why-item">
                          <span className="dot" style={{ background: itemColor(db, it, db.lanes.find((l) => l.id === it.laneId)) }} />
                          {itemLabel(db, it)} <span className="muted">({fmtRange(it)})</span>
                        </span>
                      ))}
                      {items.length > 4 && <span className="muted small">+{items.length - 4} more</span>}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {hits.length === 0 && <p className="muted center">No one matches. Try removing a filter.</p>}
      </div>
    </div>
  );
}
