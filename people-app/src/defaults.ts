import type { Database, Lane, Person, RelationshipType } from './types';
import { nowStamp, uid } from './util';

export const DEFAULT_EVENT_TYPES = [
  'First met',
  'Last contacted',
  'Engagement',
  'Wedding',
  'Child’s birth',
  'Adoption',
  'Graduation',
  'Divorce',
  'Moved',
  'New job',
  'Retirement',
  'Passed away',
];

// name / inverse / family / generation (of the linked person relative to this one)
export const DEFAULT_RELATIONSHIP_TYPES: RelationshipType[] = [
  { name: 'Spouse', inverse: 'Spouse', family: true, generation: 0 },
  { name: 'Partner', inverse: 'Partner', family: true, generation: 0 },
  { name: 'Ex-spouse', inverse: 'Ex-spouse', family: true, generation: 0 },
  { name: 'Parent', inverse: 'Child', family: true, generation: -1 },
  { name: 'Mother', inverse: 'Child', family: true, generation: -1 },
  { name: 'Father', inverse: 'Child', family: true, generation: -1 },
  { name: 'Child', inverse: 'Parent', family: true, generation: 1 },
  { name: 'Daughter', inverse: 'Parent', family: true, generation: 1 },
  { name: 'Son', inverse: 'Parent', family: true, generation: 1 },
  { name: 'Sibling', inverse: 'Sibling', family: true, generation: 0 },
  { name: 'Sister', inverse: 'Sibling', family: true, generation: 0 },
  { name: 'Brother', inverse: 'Sibling', family: true, generation: 0 },
  { name: 'Grandparent', inverse: 'Grandchild', family: true, generation: -2 },
  { name: 'Grandchild', inverse: 'Grandparent', family: true, generation: 2 },
  { name: 'Aunt/Uncle', inverse: 'Niece/Nephew', family: true, generation: -1 },
  { name: 'Niece/Nephew', inverse: 'Aunt/Uncle', family: true, generation: 1 },
  { name: 'Cousin', inverse: 'Cousin', family: true, generation: 0 },
  { name: 'In-law', inverse: 'In-law', family: true, generation: 0 },
  { name: 'Step-parent', inverse: 'Step-child', family: true, generation: -1 },
  { name: 'Step-child', inverse: 'Step-parent', family: true, generation: 1 },
  { name: 'Friend', inverse: 'Friend', family: false, generation: 0 },
  { name: 'Neighbor', inverse: 'Neighbor', family: false, generation: 0 },
  { name: 'Coworker', inverse: 'Coworker', family: false, generation: 0 },
  { name: 'Boss', inverse: 'Employee', family: false, generation: 0 },
  { name: 'Employee', inverse: 'Boss', family: false, generation: 0 },
  { name: 'Classmate', inverse: 'Classmate', family: false, generation: 0 },
  { name: 'Teammate', inverse: 'Teammate', family: false, generation: 0 },
  { name: 'Mentor', inverse: 'Mentee', family: false, generation: 0 },
  { name: 'Mentee', inverse: 'Mentor', family: false, generation: 0 },
];

export const DEFAULT_LANES: Lane[] = [
  { id: 'lane-events', name: 'Life events', kind: 'events', builtIn: true },
  { id: 'lane-tags', name: 'Tags', kind: 'tags', builtIn: true },
  { id: 'lane-locations', name: 'Location', kind: 'locations', builtIn: true },
];

export const TAG_COLORS = [
  '#3b82c4', '#d9822b', '#3a9d5d', '#c2414b', '#8a63d2',
  '#b8860b', '#2a9d9d', '#c65aa8', '#6b7a8f', '#7a9a3a',
];

export const FLAGGED_LIST_ID = 'list-flagged';

export function emptyDatabase(): Database {
  return {
    version: 1,
    people: [],
    relationships: [],
    tags: [],
    places: [],
    lists: [{ id: FLAGGED_LIST_ID, name: 'Flagged' }],
    lanes: DEFAULT_LANES.map((l) => ({ ...l })),
    eventTypes: [...DEFAULT_EVENT_TYPES],
    relationshipTypes: DEFAULT_RELATIONSHIP_TYPES.map((r) => ({ ...r })),
    timeline: [],
    deleted: {},
    savedAt: nowStamp(),
  };
}

export function newPerson(patch: Partial<Person> = {}): Person {
  const t = nowStamp();
  return {
    id: uid(),
    firstName: '',
    middleName: '',
    lastName: '',
    formerName: '',
    nickname: '',
    photo: '',
    phones: [],
    emails: [],
    addresses: [],
    birthday: '',
    placeMet: '',
    favorites: [],
    customFields: [],
    attachments: [],
    notes: '',
    listIds: [],
    createdAt: t,
    updatedAt: t,
    ...patch,
  };
}

/** Fill in anything an older or hand-edited file is missing. */
export function normalize(db: Partial<Database>): Database {
  const base = emptyDatabase();
  const out: Database = { ...base, ...db } as Database;
  out.people = (db.people || []).map((p) => newPerson({ ...p }));
  for (const k of ['relationships', 'tags', 'places', 'timeline'] as const) {
    (out as any)[k] = (db as any)[k] || [];
  }
  if (!db.lists?.length) out.lists = base.lists;
  if (!db.lanes?.length) out.lanes = base.lanes;
  for (const l of DEFAULT_LANES) if (!out.lanes.some((x) => x.id === l.id)) out.lanes.unshift({ ...l });
  if (!db.eventTypes) out.eventTypes = base.eventTypes;
  if (!db.relationshipTypes) out.relationshipTypes = base.relationshipTypes;
  out.deleted = db.deleted || {};
  return out;
}
