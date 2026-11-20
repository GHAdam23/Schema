import { FLAGGED_LIST_ID, newPerson, TAG_COLORS } from './defaults';
import { update } from './store';
import type { Database, Lane, Person, Place, Relationship, Tag, TimelineItem } from './types';
import { nowStamp, todayISO, uid } from './util';

const markDeleted = (db: Database, ids: string[]) => {
  const t = nowStamp();
  const deleted = { ...db.deleted };
  for (const id of ids) deleted[id] = t;
  return deleted;
};

// ---- people --------------------------------------------------------------

export function addPerson(patch: Partial<Person> = {}): Person {
  const p = newPerson(patch);
  update((db) => ({ ...db, people: [...db.people, p] }));
  return p;
}

export function updatePerson(id: string, patch: Partial<Person>, undoKey = '') {
  update(
    (db) => ({
      ...db,
      people: db.people.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: nowStamp() } : p)),
    }),
    undoKey ? `${id}:${undoKey}` : '',
  );
}

/** Mark a person as edited (used when their timeline / links change). */
const touch = (db: Database, ...ids: string[]): Person[] =>
  db.people.map((p) => (ids.includes(p.id) ? { ...p, updatedAt: nowStamp() } : p));

export function deletePerson(id: string) {
  update((db) => {
    const rels = db.relationships.filter((r) => r.fromId === id || r.toId === id).map((r) => r.id);
    const items = db.timeline.filter((t) => t.personId === id).map((t) => t.id);
    return {
      ...db,
      people: db.people.filter((p) => p.id !== id),
      relationships: db.relationships.filter((r) => !rels.includes(r.id)),
      timeline: db.timeline.filter((t) => t.personId !== id),
      deleted: markDeleted(db, [id, ...rels, ...items]),
    };
  });
}

export function toggleList(personId: string, listId: string = FLAGGED_LIST_ID) {
  update((db) => ({
    ...db,
    people: db.people.map((p) =>
      p.id !== personId
        ? p
        : {
            ...p,
            listIds: p.listIds.includes(listId) ? p.listIds.filter((l) => l !== listId) : [...p.listIds, listId],
            updatedAt: nowStamp(),
          },
    ),
  }));
}

/** Quick add: a person plus an optional "First met" event, tag and place. */
export function quickAdd(opts: {
  firstName: string;
  lastName: string;
  placeMet: string;
  date: string;
  tagName: string;
  placeName: string;
  note: string;
}): Person {
  const p = newPerson({
    firstName: opts.firstName.trim(),
    lastName: opts.lastName.trim(),
    placeMet: opts.placeMet.trim(),
    notes: opts.note.trim(),
  });
  update((db) => {
    let tags = db.tags;
    let places = db.places;
    const timeline: TimelineItem[] = [...db.timeline];
    const date = opts.date || todayISO();
    timeline.push({
      id: uid(), personId: p.id, laneId: 'lane-events', start: date, end: '',
      eventType: 'First met', text: opts.placeMet.trim(), note: '',
    });
    const tagName = opts.tagName.trim();
    if (tagName) {
      let tag = tags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
      if (!tag) {
        tag = { id: uid(), name: tagName, color: TAG_COLORS[tags.length % TAG_COLORS.length] };
        tags = [...tags, tag];
      }
      timeline.push({ id: uid(), personId: p.id, laneId: 'lane-tags', start: date, end: 'present', tagId: tag.id, note: '' });
    }
    const placeName = opts.placeName.trim();
    if (placeName) {
      let place = places.find((t) => t.name.toLowerCase() === placeName.toLowerCase());
      if (!place) {
        place = { id: uid(), name: placeName };
        places = [...places, place];
      }
      timeline.push({ id: uid(), personId: p.id, laneId: 'lane-locations', start: date, end: 'present', placeId: place.id, note: '' });
    }
    return { ...db, people: [...db.people, p], tags, places, timeline };
  });
  return p;
}

// ---- relationships -------------------------------------------------------

export function addRelationship(fromId: string, toId: string, type: string, alsoInverse: string) {
  update((db) => {
    const pairId = uid();
    const rels: Relationship[] = [
      ...db.relationships,
      { id: uid(), fromId, toId, type, pairId, createdAt: nowStamp() },
    ];
    if (alsoInverse) rels.push({ id: uid(), fromId: toId, toId: fromId, type: alsoInverse, pairId, createdAt: nowStamp() });
    return { ...db, relationships: rels, people: touch(db, fromId, toId) };
  });
}

/** Removes the link in both directions. */
export function deleteRelationship(id: string) {
  update((db) => {
    const r = db.relationships.find((x) => x.id === id);
    if (!r) return db;
    const ids = db.relationships.filter((x) => x.id === id || (r.pairId && x.pairId === r.pairId)).map((x) => x.id);
    return {
      ...db,
      relationships: db.relationships.filter((x) => !ids.includes(x.id)),
      people: touch(db, r.fromId, r.toId),
      deleted: markDeleted(db, ids),
    };
  });
}

// ---- timeline ------------------------------------------------------------

export function saveTimelineItem(item: TimelineItem) {
  update((db) => {
    const exists = db.timeline.some((t) => t.id === item.id);
    return {
      ...db,
      timeline: exists ? db.timeline.map((t) => (t.id === item.id ? item : t)) : [...db.timeline, item],
      people: touch(db, item.personId),
    };
  });
}

export function deleteTimelineItem(id: string) {
  update((db) => ({
    ...db,
    timeline: db.timeline.filter((t) => t.id !== id),
    deleted: markDeleted(db, [id]),
  }));
}

// ---- settings: tags, places, lists, lanes, types -------------------------

export function addTag(name: string): Tag {
  const t: Tag = { id: uid(), name: name.trim(), color: '' };
  update((db) => {
    t.color = TAG_COLORS[db.tags.length % TAG_COLORS.length];
    return { ...db, tags: [...db.tags, t] };
  });
  return t;
}
export function updateTag(id: string, patch: Partial<Tag>) {
  update((db) => ({ ...db, tags: db.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), `tag:${id}`);
}
export function deleteTag(id: string) {
  update((db) => {
    const items = db.timeline.filter((t) => t.tagId === id).map((t) => t.id);
    return {
      ...db,
      tags: db.tags.filter((t) => t.id !== id),
      timeline: db.timeline.filter((t) => t.tagId !== id),
      deleted: markDeleted(db, [id, ...items]),
    };
  });
}

export function addPlace(name: string): Place {
  const p: Place = { id: uid(), name: name.trim() };
  update((db) => ({ ...db, places: [...db.places, p] }));
  return p;
}
export function updatePlace(id: string, name: string) {
  update((db) => ({ ...db, places: db.places.map((t) => (t.id === id ? { ...t, name } : t)) }), `place:${id}`);
}
export function deletePlace(id: string) {
  update((db) => {
    const items = db.timeline.filter((t) => t.placeId === id).map((t) => t.id);
    return {
      ...db,
      places: db.places.filter((t) => t.id !== id),
      timeline: db.timeline.filter((t) => t.placeId !== id),
      deleted: markDeleted(db, [id, ...items]),
    };
  });
}

export function addList(name: string) {
  update((db) => ({ ...db, lists: [...db.lists, { id: uid(), name: name.trim() }] }));
}
export function renameList(id: string, name: string) {
  update((db) => ({ ...db, lists: db.lists.map((l) => (l.id === id ? { ...l, name } : l)) }), `list:${id}`);
}
export function deleteList(id: string) {
  update((db) => ({
    ...db,
    lists: db.lists.filter((l) => l.id !== id),
    people: db.people.map((p) => (p.listIds.includes(id) ? { ...p, listIds: p.listIds.filter((x) => x !== id) } : p)),
    deleted: markDeleted(db, [id]),
  }));
}

export function addLane(name: string) {
  const lane: Lane = { id: uid(), name: name.trim(), kind: 'custom', builtIn: false };
  update((db) => ({ ...db, lanes: [...db.lanes, lane] }));
}
export function renameLane(id: string, name: string) {
  update((db) => ({ ...db, lanes: db.lanes.map((l) => (l.id === id ? { ...l, name } : l)) }), `lane:${id}`);
}
export function moveLane(id: string, dir: -1 | 1) {
  update((db) => {
    const lanes = [...db.lanes];
    const i = lanes.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= lanes.length) return db;
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
    return { ...db, lanes };
  });
}
export function deleteLane(id: string) {
  update((db) => {
    const items = db.timeline.filter((t) => t.laneId === id).map((t) => t.id);
    return {
      ...db,
      lanes: db.lanes.filter((l) => l.id !== id),
      timeline: db.timeline.filter((t) => t.laneId !== id),
      deleted: markDeleted(db, [id, ...items]),
    };
  });
}

export function setEventTypes(eventTypes: string[]) {
  update((db) => ({ ...db, eventTypes }), 'eventTypes');
}
export function setRelationshipTypes(relationshipTypes: Database['relationshipTypes']) {
  update((db) => ({ ...db, relationshipTypes }), 'relTypes');
}
