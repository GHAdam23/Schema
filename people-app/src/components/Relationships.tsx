import { useId, useMemo, useState } from 'react';
import { addPerson, addRelationship, deleteRelationship, setRelationshipTypes } from '../actions';
import { getDB, useDB } from '../store';
import type { Database, Person, Relationship } from '../types';
import { displayName, sortKey } from '../util';
import { Avatar } from './ui';

export interface LinkView {
  rel: Relationship;
  other: Person;
  /** what the other person is to this one */
  label: string;
}

export function inverseOf(db: Database, type: string): string {
  return db.relationshipTypes.find((t) => t.name.toLowerCase() === type.toLowerCase())?.inverse || '';
}

/** All links for a person, from their point of view, one row per pair. */
export function linksFor(db: Database, personId: string): LinkView[] {
  const out: LinkView[] = [];
  const seenPairs = new Set<string>();
  const byId = new Map(db.people.map((p) => [p.id, p]));
  for (const r of db.relationships) {
    if (r.fromId !== personId) continue;
    const other = byId.get(r.toId);
    if (!other) continue;
    if (r.pairId) seenPairs.add(r.pairId);
    out.push({ rel: r, other, label: r.type });
  }
  for (const r of db.relationships) {
    if (r.toId !== personId || (r.pairId && seenPairs.has(r.pairId))) continue;
    const other = byId.get(r.fromId);
    if (!other) continue;
    const inv = inverseOf(db, r.type);
    out.push({ rel: r, other, label: inv || `(${displayName(other)}’s ${r.type})` });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Typeahead to pick an existing person or create one by name. */
export function PersonPicker(props: {
  excludeId?: string;
  onPick: (p: Person) => void;
  placeholder?: string;
  allowCreate?: boolean;
}) {
  const db = useDB();
  const [text, setText] = useState('');
  const matches = useMemo(() => {
    const q = text.toLowerCase().trim();
    if (!q) return [];
    return db.people
      .filter((p) => p.id !== props.excludeId)
      .filter((p) => `${p.firstName} ${p.middleName} ${p.lastName} ${p.nickname} ${p.formerName}`.toLowerCase().includes(q))
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      .slice(0, 8);
  }, [db.people, text, props.excludeId]);
  const create = () => {
    const [first, ...rest] = text.trim().split(/\s+/);
    if (!first) return;
    const p = addPerson({ firstName: first, lastName: rest.join(' ') });
    props.onPick(p);
    setText('');
  };
  return (
    <div className="person-picker">
      <input value={text} placeholder={props.placeholder || 'Type a name…'} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (matches[0]) { props.onPick(matches[0]); setText(''); } else if (props.allowCreate) create();
          }
        }} />
      {text.trim() && (
        <div className="picker-menu">
          {matches.map((p) => (
            <button key={p.id} onClick={() => { props.onPick(p); setText(''); }}>
              <Avatar person={p} size={22} /> {displayName(p)}
            </button>
          ))}
          {props.allowCreate && (
            <button className="create" onClick={create}>+ New person “{text.trim()}”</button>
          )}
        </div>
      )}
    </div>
  );
}

export function Relationships({ person, onOpen }: { person: Person; onOpen: (id: string) => void }) {
  const db = useDB();
  const typeList = useId();
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<Person | null>(null);
  const [type, setType] = useState('');
  const [inverse, setInverse] = useState('');
  const [inverseTouched, setInverseTouched] = useState(false);
  const links = linksFor(db, person.id);

  const chooseType = (t: string) => {
    setType(t);
    if (!inverseTouched) setInverse(inverseOf(db, t));
  };

  const save = () => {
    if (!target || !type.trim()) return;
    const t = type.trim();
    const inv = inverse.trim();
    const cur = getDB();
    // Remember new relationship words for next time.
    if (!cur.relationshipTypes.some((r) => r.name.toLowerCase() === t.toLowerCase())) {
      setRelationshipTypes([...cur.relationshipTypes, { name: t, inverse: inv, family: false, generation: 0 }]);
    }
    addRelationship(person.id, target.id, t, inv);
    setTarget(null);
    setType('');
    setInverse('');
    setInverseTouched(false);
    setAdding(false);
  };

  return (
    <div className="relationships">
      {links.length === 0 && !adding && <p className="muted">No linked people yet.</p>}
      <ul className="link-list">
        {links.map(({ rel, other, label }) => (
          <li key={rel.id}>
            <button className="link-person" onClick={() => onOpen(other.id)}>
              <Avatar person={other} size={28} />
              <span>{displayName(other)}</span>
            </button>
            <span className="rel-label">{label}</span>
            <button className="icon" title="Remove link (both directions)" onClick={() => deleteRelationship(rel.id)}>×</button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="add-link">
          {target ? (
            <div className="picked">
              <Avatar person={target} size={24} /> {displayName(target)}
              <button className="icon" onClick={() => setTarget(null)}>×</button>
            </div>
          ) : (
            <PersonPicker excludeId={person.id} onPick={setTarget} allowCreate placeholder="Link to… (type a name)" />
          )}
          <datalist id={typeList}>{db.relationshipTypes.map((r) => <option key={r.name} value={r.name} />)}</datalist>
          <label className="field">
            <span>{target ? `${target.firstName || 'They'} is ${person.firstName || 'this person'}’s…` : 'Relationship'}</span>
            <input value={type} list={typeList} placeholder="e.g. Daughter" onChange={(e) => chooseType(e.target.value)} />
          </label>
          <label className="field">
            <span>{`…and ${person.firstName || 'this person'} is ${target?.firstName ? `${target.firstName}’s` : 'their'}`}</span>
            <input value={inverse} list={typeList} placeholder="e.g. Parent (leave blank for one-way)"
              onChange={(e) => { setInverse(e.target.value); setInverseTouched(true); }} />
          </label>
          <div className="row">
            <button onClick={() => setAdding(false)}>Cancel</button>
            <button className="primary" disabled={!target || !type.trim()} onClick={save}>Link</button>
          </div>
        </div>
      ) : (
        <button className="link" onClick={() => setAdding(true)}>+ Link to another person</button>
      )}
    </div>
  );
}
