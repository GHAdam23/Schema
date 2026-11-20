import { emptyDatabase, newPerson } from './defaults';
import type { Database, TimelineItem } from './types';
import { nowStamp, uid } from './util';

/** A small demo database built from the examples in the brief. */
export function sampleDatabase(): Database {
  const db = emptyDatabase();
  const tag = (name: string, color: string) => { const t = { id: uid(), name, color }; db.tags.push(t); return t.id; };
  const place = (name: string) => { const p = { id: uid(), name }; db.places.push(p); return p.id; };
  const tHMS = tag('Hermantown Middle School', '#3b82c4');
  const tUNW = tag('UNW', '#d9822b');
  const tVC = tag('Van Cleve Community Center', '#3a9d5d');
  const tPB = tag('Pickleball Team', '#c2414b');
  const tIL = tag('Israel Trip', '#8a63d2');
  const tNb = tag('Neighbor', '#b8860b');
  const pH = place('Hermantown, MN');
  const pD = place('Duluth, MN');
  const pTC = place('Twin Cities, MN');
  db.lists.push({ id: uid(), name: 'Christmas cards' });

  const person = (first: string, last: string, extra: Partial<ReturnType<typeof newPerson>> = {}) => {
    const p = newPerson({ firstName: first, lastName: last, ...extra });
    db.people.push(p);
    return p.id;
  };
  const item = (personId: string, laneId: string, start: string, end: TimelineItem['end'], extra: Partial<TimelineItem>) =>
    db.timeline.push({ id: uid(), personId, laneId, start, end, note: '', ...extra });
  const link = (fromId: string, toId: string, type: string, inverse: string) => {
    const pairId = uid();
    db.relationships.push({ id: uid(), fromId, toId, type, pairId, createdAt: nowStamp() });
    db.relationships.push({ id: uid(), fromId: toId, toId: fromId, type: inverse, pairId, createdAt: nowStamp() });
  };

  const john = person('John', 'Smith', {
    birthday: '1978-04-12', placeMet: 'Hermantown Middle School',
    phones: [{ id: uid(), label: 'Mobile', value: '218-555-0142' }],
    favorites: [{ id: uid(), label: 'Food', value: 'Walleye' }, { id: uid(), label: 'Color', value: 'Green' }],
  });
  const mary = person('Mary', 'Smith', { formerName: 'Mary Olson', birthday: '1980-09-03', placeMet: 'John’s 30th birthday' });
  const jane = person('Jane', 'Smith', { birthday: '2009-06-21' });
  const sam = person('Sam', 'Smith', { birthday: '2012-11-02' });
  const gail = person('Gail', 'Olson', { birthday: '--02-14' });
  const priya = person('Priya', 'Nair', { placeMet: 'Van Cleve pickleball open play', notes: 'Left-handed. Coaches juniors on Saturdays.' });
  const dave = person('Dave', '', { placeMet: 'Israel trip — tour bus', notes: 'Only know his first name. Retired teacher from Edina?' });
  const lena = person('Lena', 'Berg', { placeMet: 'UNW dorm', birthday: '1979-01-30', listIds: [db.lists[1].id] });

  link(john, mary, 'Spouse', 'Spouse');
  link(john, jane, 'Daughter', 'Parent');
  link(mary, jane, 'Daughter', 'Parent');
  link(john, sam, 'Son', 'Parent');
  link(mary, sam, 'Son', 'Parent');
  link(mary, gail, 'Mother', 'Child');
  link(jane, sam, 'Brother', 'Sibling');
  link(john, lena, 'Friend', 'Friend');

  item(john, 'lane-events', '1990-09-04', '', { eventType: 'First met', text: 'homeroom' });
  item(john, 'lane-tags', '1990-09-04', '1993-06-04', { tagId: tHMS });
  item(john, 'lane-tags', '2005-06-01', '2011-08-15', { tagId: tNb, note: 'Lived next door on Arrowhead Rd' });
  item(john, 'lane-locations', '1990-09-04', '1996-08-20', { placeId: pH });
  item(john, 'lane-locations', '1996-08-20', '2004-05-01', { placeId: pTC });
  item(john, 'lane-locations', '2004-05-01', 'present', { placeId: pD });
  item(john, 'lane-events', '2007-07-14', '', { eventType: 'Wedding', text: 'Enger Tower' });
  item(john, 'lane-events', '2009-06-21', '', { eventType: 'Child’s birth', text: 'Jane' });
  item(john, 'lane-events', '2012-11-02', '', { eventType: 'Child’s birth', text: 'Sam' });
  item(john, 'lane-events', '2026-10-30', '', { eventType: 'Last contacted' });
  item(mary, 'lane-events', '2008-04-12', '', { eventType: 'First met', text: 'John’s 30th' });
  item(mary, 'lane-events', '2007-07-14', '', { eventType: 'Wedding' });
  item(mary, 'lane-tags', '2005-06-01', '2011-08-15', { tagId: tNb });
  item(mary, 'lane-locations', '2004-05-01', 'present', { placeId: pD });
  item(priya, 'lane-events', '2023-05-10', '', { eventType: 'First met' });
  item(priya, 'lane-tags', '2023-05-10', 'present', { tagId: tVC });
  item(priya, 'lane-tags', '2024-03-01', 'present', { tagId: tPB });
  item(priya, 'lane-events', '2025-08-23', '', { eventType: 'Engagement' });
  item(dave, 'lane-events', '2019-03-11', '', { eventType: 'First met' });
  item(dave, 'lane-tags', '2019-03-10', '2019-03-21', { tagId: tIL });
  item(lena, 'lane-tags', '1996-09-01', '2000-05-15', { tagId: tUNW });
  item(lena, 'lane-locations', '1996-09-01', '2000-05-15', { placeId: pTC });
  item(lena, 'lane-events', '1996-09-02', '', { eventType: 'First met', text: 'move-in day' });
  item(lena, 'lane-events', '2000-05-13', '', { eventType: 'Graduation' });
  return db;
}
