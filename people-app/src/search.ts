import type { Database, Person, TimelineItem } from './types';
import { dayNum, overlaps } from './util';

export interface Query {
  text: string;
  tagIds: string[];
  placeIds: string[];
  eventTypes: string[];
  listIds: string[];
  relTypes: string[];
  /** YYYY, YYYY-MM or YYYY-MM-DD; empty = open-ended */
  from: string;
  to: string;
  /** what the date range applies to */
  dateField: 'timeline' | 'created' | 'edited' | 'birthday';
  birthdayMonth: number; // 0 = any, 1-12
  hasPhoto: 'any' | 'yes' | 'no';
}

export const emptyQuery = (): Query => ({
  text: '',
  tagIds: [],
  placeIds: [],
  eventTypes: [],
  listIds: [],
  relTypes: [],
  from: '',
  to: '',
  dateField: 'timeline',
  birthdayMonth: 0,
  hasPhoto: 'any',
});

export function isEmptyQuery(q: Query) {
  return (
    !q.text.trim() && !q.tagIds.length && !q.placeIds.length && !q.eventTypes.length &&
    !q.listIds.length && !q.relTypes.length && !q.from && !q.to && !q.birthdayMonth && q.hasPhoto === 'any'
  );
}

/** Expand a partial date to the first or last day it covers. */
export function expandDate(s: string, edge: 'start' | 'end'): number | null {
  s = s.trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : edge === 'start' ? 1 : 12;
  if (m[3]) return dayNum(`${y}-${String(mo).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`);
  if (edge === 'start') return dayNum(`${y}-${String(mo).padStart(2, '0')}-01`);
  // last day of month
  return Math.floor(Date.UTC(y, mo, 0) / 86400000);
}

export function personText(p: Person, db: Database): string {
  const lv = (xs: { label: string; value: string }[]) => xs.map((x) => `${x.label} ${x.value}`).join(' ');
  const items = db.timeline.filter((t) => t.personId === p.id);
  return [
    p.firstName, p.middleName, p.lastName, p.formerName, p.nickname, p.placeMet, p.notes,
    lv(p.phones), lv(p.emails), lv(p.addresses), lv(p.favorites), lv(p.customFields),
    p.attachments.map((a) => a.name).join(' '),
    items.map((t) => `${t.text || ''} ${t.note} ${t.eventType || ''}`).join(' '),
  ].join(' ').toLowerCase();
}

export interface Hit {
  person: Person;
  /** timeline items that satisfied the timeline filters (for "why it matched") */
  items: TimelineItem[];
}

export function runQuery(db: Database, q: Query): Hit[] {
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
  const from = expandDate(q.from, 'start') ?? -Infinity;
  const to = expandDate(q.to, 'end') ?? Infinity;
  const hasRange = from !== -Infinity || to !== Infinity;
  const timelineFilters = q.tagIds.length || q.placeIds.length || q.eventTypes.length;

  const byPerson = new Map<string, TimelineItem[]>();
  for (const t of db.timeline) {
    const arr = byPerson.get(t.personId);
    if (arr) arr.push(t);
    else byPerson.set(t.personId, [t]);
  }

  const hits: Hit[] = [];
  for (const p of db.people) {
    if (words.length) {
      const text = personText(p, db);
      if (!words.every((w) => text.includes(w))) continue;
    }
    if (q.listIds.length && !q.listIds.some((l) => p.listIds.includes(l))) continue;
    if (q.hasPhoto === 'yes' && !p.photo) continue;
    if (q.hasPhoto === 'no' && p.photo) continue;
    if (q.birthdayMonth) {
      const parts = p.birthday.split('-');
      if (!p.birthday || Number(parts[parts.length - 2]) !== q.birthdayMonth) continue;
    }
    if (q.relTypes.length) {
      const has = db.relationships.some(
        (r) => (r.fromId === p.id || r.toId === p.id) && q.relTypes.includes(r.type),
      );
      if (!has) continue;
    }

    let items: TimelineItem[] = [];
    const own = byPerson.get(p.id) || [];
    const inRange = (t: TimelineItem) => !hasRange || q.dateField !== 'timeline' || overlaps(t, from, to);

    if (timelineFilters) {
      // Each kind of filter must be met by at least one item inside the date range.
      const tagOk = !q.tagIds.length || own.some((t) => t.tagId && q.tagIds.includes(t.tagId) && inRange(t));
      const placeOk = !q.placeIds.length || own.some((t) => t.placeId && q.placeIds.includes(t.placeId) && inRange(t));
      const evOk = !q.eventTypes.length || own.some((t) => t.eventType && q.eventTypes.includes(t.eventType) && inRange(t));
      if (!(tagOk && placeOk && evOk)) continue;
      items = own.filter(
        (t) =>
          inRange(t) &&
          ((t.tagId && q.tagIds.includes(t.tagId)) ||
            (t.placeId && q.placeIds.includes(t.placeId)) ||
            (t.eventType && q.eventTypes.includes(t.eventType))),
      );
    } else if (hasRange && q.dateField === 'timeline') {
      items = own.filter(inRange);
      if (!items.length) continue;
    }

    if (hasRange && q.dateField !== 'timeline') {
      let d: number | null = null;
      if (q.dateField === 'created') d = dayNum(p.createdAt.slice(0, 10));
      if (q.dateField === 'edited') d = dayNum(p.updatedAt.slice(0, 10));
      if (q.dateField === 'birthday' && p.birthday && !p.birthday.startsWith('--')) d = dayNum(p.birthday);
      if (d === null || d < from || d > to) continue;
    }

    hits.push({ person: p, items });
  }
  return hits;
}
