import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDB } from '../store';
import type { Database, Person } from '../types';
import { ageOn, displayName } from '../util';
import { linksFor } from './Relationships';
import { Avatar } from './ui';

interface FamilyGraph {
  members: Map<string, number>; // personId → generation (0 = focus)
  edges: { a: string; b: string; kind: 'parent' | 'partner' | 'other'; label: string }[];
}

const isFamily = (db: Database, type: string) =>
  db.relationshipTypes.find((t) => t.name.toLowerCase() === type.toLowerCase());

/** Walk family-type links outward from one person, assigning generations. */
export function buildFamily(db: Database, focusId: string): FamilyGraph {
  const members = new Map<string, number>([[focusId, 0]]);
  const queue = [focusId];
  const edges: FamilyGraph['edges'] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    const g = members.get(id)!;
    for (const r of db.relationships) {
      if (r.fromId !== id && r.toId !== id) continue;
      const t = isFamily(db, r.type);
      if (!t?.family) continue;
      // generation of `to` relative to `from` is t.generation
      const otherId = r.fromId === id ? r.toId : r.fromId;
      const otherGen = r.fromId === id ? g + t.generation : g - t.generation;
      if (!members.has(otherId)) {
        members.set(otherId, otherGen);
        queue.push(otherId);
      }
      const key = [r.fromId, r.toId].sort().join('|') + (r.pairId || r.id);
      if (seen.has(key) || (r.pairId && seen.has(r.pairId))) continue;
      seen.add(key);
      if (r.pairId) seen.add(r.pairId);
      if (t.generation === 0) {
        edges.push({ a: r.fromId, b: r.toId, kind: ['Spouse', 'Partner'].includes(t.name) ? 'partner' : 'other', label: t.name });
      } else {
        const [older, younger] = t.generation < 0 ? [r.toId, r.fromId] : [r.fromId, r.toId];
        edges.push({ a: older, b: younger, kind: Math.abs(t.generation) === 1 && !/aunt|niece|step/i.test(t.name) ? 'parent' : 'other', label: t.name });
      }
    }
  }
  return { members, edges };
}

/** All family groups (connected through family links), largest first. */
export function familyGroups(db: Database): { focus: Person; size: number; name: string }[] {
  const done = new Set<string>();
  const out: { focus: Person; size: number; name: string }[] = [];
  for (const p of db.people) {
    if (done.has(p.id)) continue;
    const { members } = buildFamily(db, p.id);
    members.forEach((_, id) => done.add(id));
    if (members.size < 2) continue;
    const people = [...members.keys()].map((id) => db.people.find((x) => x.id === id)!).filter(Boolean);
    const counts = new Map<string, number>();
    people.forEach((x) => x.lastName && counts.set(x.lastName, (counts.get(x.lastName) || 0) + 1));
    const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    // focus on the oldest generation member so the tree reads top-down
    const minGen = Math.min(...members.values());
    const focus = people.find((x) => members.get(x.id) === minGen) || p;
    out.push({ focus, size: members.size, name: names.slice(0, 2).join(' / ') || displayName(focus) });
  }
  return out.sort((a, b) => b.size - a.size);
}

function FamilyTree({ focusId }: { focusId: string }) {
  const db = useDB();
  const { members, edges } = useMemo(() => buildFamily(db, focusId), [db, focusId]);
  const focus = db.people.find((p) => p.id === focusId)!;
  const focusName = focus.firstName || displayName(focus);
  const box = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; kind: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Group by generation; keep partners next to each other.
  const rows = useMemo(() => {
    const byGen = new Map<number, string[]>();
    for (const [id, g] of members) byGen.set(g, [...(byGen.get(g) || []), id]);
    const partnerOf = new Map<string, string>();
    edges.filter((e) => e.kind === 'partner').forEach((e) => { partnerOf.set(e.a, e.b); partnerOf.set(e.b, e.a); });
    return [...byGen.entries()].sort((a, b) => a[0] - b[0]).map(([g, ids]) => {
      const ordered: string[] = [];
      const name = (id: string) => displayName(db.people.find((p) => p.id === id)!);
      for (const id of ids.sort((a, b) => (a === focusId ? -1 : b === focusId ? 1 : name(a).localeCompare(name(b))))) {
        if (ordered.includes(id)) continue;
        ordered.push(id);
        const partner = partnerOf.get(id);
        if (partner && ids.includes(partner) && !ordered.includes(partner)) ordered.push(partner);
      }
      return { g, ids: ordered };
    });
  }, [members, edges, db.people, focusId]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const pos = (id: string) => {
        const n = el.querySelector<HTMLElement>(`[data-pid="${id}"]`);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { cx: r.left - base.left + r.width / 2, top: r.top - base.top, bottom: r.bottom - base.top, left: r.left - base.left, right: r.right - base.left, cy: r.top - base.top + r.height / 2 };
      };
      const ls: typeof lines = [];
      const partners = new Set(edges.filter((e) => e.kind === 'partner').map((e) => [e.a, e.b].sort().join('|')));
      // A child of a couple hangs from the middle of the couple's line, not from each parent.
      const parentsOf = new Map<string, string[]>();
      edges.filter((e) => e.kind === 'parent').forEach((e) => parentsOf.set(e.b, [...(parentsOf.get(e.b) || []), e.a]));
      for (const [child, ps] of parentsOf) {
        const c = pos(child);
        if (!c) continue;
        const uniq = [...new Set(ps)];
        if (uniq.length === 2 && partners.has([...uniq].sort().join('|'))) {
          const a = pos(uniq[0]), b = pos(uniq[1]);
          if (a && b) {
            const mx = (a.cx < b.cx ? (a.right + b.left) / 2 : (b.right + a.left) / 2);
            ls.push({ x1: mx, y1: a.cy, x2: c.cx, y2: c.top, kind: 'parent' });
            continue;
          }
        }
        for (const pid of uniq) {
          const a = pos(pid);
          if (a) ls.push({ x1: a.cx, y1: a.bottom, x2: c.cx, y2: c.top, kind: 'parent' });
        }
      }
      for (const e of edges) {
        const a = pos(e.a), b = pos(e.b);
        if (!a || !b) continue;
        if (e.kind === 'partner') {
          const [l, r] = a.cx < b.cx ? [a, b] : [b, a];
          ls.push({ x1: l.right, y1: l.cy, x2: r.left, y2: r.cy, kind: e.kind });
        }
      }
      setLines(ls);
      setSize({ w: el.scrollWidth, h: el.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows, edges]);

  const genName = (g: number) =>
    ({ [-3]: 'Great-grandparents’ generation', [-2]: 'Grandparents’ generation', [-1]: 'Parents’ generation', 0: `${focusName}’s generation`, 1: 'Children’s generation', 2: 'Grandchildren’s generation', 3: 'Great-grandchildren’s generation' } as Record<number, string>)[g]
    ?? (g < 0 ? `${-g} generations up` : `${g} generations down`);

  const linkLabels = new Map(linksFor(db, focusId).map((l) => [l.other.id, l.label]));

  return (
    <div className="family-tree" ref={box}>
      <svg className="family-lines" width={size.w} height={size.h}>
        {lines.map((l, i) =>
          l.kind === 'parent' ? (
            <path key={i} d={`M${l.x1},${l.y1} C${l.x1},${(l.y1 + l.y2) / 2} ${l.x2},${(l.y1 + l.y2) / 2} ${l.x2},${l.y2}`} />
          ) : (
            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="partner" />
          ),
        )}
      </svg>
      {rows.map(({ g, ids }) => (
        <div className="family-row" key={g}>
          <div className="gen-label muted small">{genName(g)}</div>
          <div className="family-cards">
            {ids.map((id) => {
              const p = db.people.find((x) => x.id === id);
              if (!p) return null;
              const age = ageOn(p.birthday);
              return (
                <button key={id} data-pid={id} className={`family-card ${id === focusId ? 'focus' : ''}`} onClick={() => (location.hash = `#/families/${id}`)}
                  onDoubleClick={() => (location.hash = `#/person/${id}`)} title="Click to centre · double-click to open">
                  <Avatar person={p} size={44} />
                  <span>
                    <strong>{displayName(p)}</strong>
                    <span className="muted small">
                      {[id === focusId ? 'Selected' : linkLabels.get(id) && `${focusName}’s ${linkLabels.get(id)}`, age !== null && `age ${age}`]
                        .filter(Boolean).join(' · ') || '\u00a0'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {members.size < 2 && (
        <p className="muted">No family links yet. On the person’s page, use “Link to another person” and pick a family relationship (Spouse, Daughter, Parent…).</p>
      )}
      {edges.some((e) => e.kind === 'other') && (
        <div className="other-links small">
          <strong>Other family links: </strong>
          {edges.filter((e) => e.kind === 'other').map((e, i) => {
            const a = db.people.find((p) => p.id === e.a), b = db.people.find((p) => p.id === e.b);
            return a && b ? <span key={i}>{displayName(a)} ↔ {displayName(b)} ({e.label}) </span> : null;
          })}
        </div>
      )}
    </div>
  );
}

export function FamilyView({ focusId }: { focusId?: string }) {
  const db = useDB();
  const groups = useMemo(() => familyGroups(db), [db]);
  const focus = focusId ? db.people.find((p) => p.id === focusId) : undefined;
  return (
    <div className="family-view">
      <aside className="family-index card">
        <h2>Families</h2>
        <p className="muted small">Built from family links (spouse, parent, child, sibling…). Edit relationship types in Settings.</p>
        {groups.length === 0 && <p className="muted">No families yet.</p>}
        <ul>
          {groups.map((g) => (
            <li key={g.focus.id}>
              <a href={`#/families/${g.focus.id}`} className={focus && buildFamily(db, g.focus.id).members.has(focus.id) ? 'selected' : ''}>
                {g.name} <span className="muted">· {g.size}</span>
              </a>
            </li>
          ))}
        </ul>
      </aside>
      <div className="family-main card">
        {focus ? (
          <>
            <div className="row">
              <h2>Family of {displayName(focus)}</h2>
              <span className="spacer" />
              <a className="button" href={`#/person/${focus.id}`}>Open {focus.firstName || 'person'}</a>
            </div>
            <p className="muted small">Click anyone to centre the tree on them · double-click to open their page.</p>
            <FamilyTree focusId={focus.id} />
          </>
        ) : (
          <p className="muted">Choose a family on the left{groups.length ? '' : ', or link family members on a person’s page'}.</p>
        )}
      </div>
    </div>
  );
}
