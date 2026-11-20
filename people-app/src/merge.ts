import type { Database } from './types';

type WithId = { id: string; updatedAt?: string };

function mergeById<T extends WithId>(
  a: T[],
  b: T[],
  deleted: Record<string, string>,
  bIsNewer: boolean,
): T[] {
  const map = new Map<string, T>();
  for (const x of a) map.set(x.id, x);
  for (const y of b) {
    const x = map.get(y.id);
    if (!x) map.set(y.id, y);
    else if (x.updatedAt && y.updatedAt) {
      if (y.updatedAt > x.updatedAt) map.set(y.id, y);
    } else if (bIsNewer) map.set(y.id, y);
  }
  return [...map.values()].filter((x) => !deleted[x.id]);
}

/**
 * Merge two copies of the database (e.g. this device and the synced file
 * edited on another device). People merge per record by updatedAt; other
 * records by id, preferring the copy saved most recently; deletions win.
 */
export function mergeDatabases(local: Database, remote: Database): Database {
  const deleted = { ...remote.deleted, ...local.deleted };
  const remoteNewer = remote.savedAt > local.savedAt;
  const newer = remoteNewer ? remote : local;
  const people = mergeById(local.people, remote.people, deleted, remoteNewer);
  // listIds are stored on people; lists are small settings records
  return {
    version: 1,
    people,
    relationships: mergeById(local.relationships, remote.relationships, deleted, remoteNewer),
    tags: mergeById(local.tags, remote.tags, deleted, remoteNewer),
    places: mergeById(local.places, remote.places, deleted, remoteNewer),
    lists: mergeById(local.lists, remote.lists, deleted, remoteNewer),
    lanes: mergeById(local.lanes, remote.lanes, deleted, remoteNewer),
    timeline: mergeById(local.timeline, remote.timeline, deleted, remoteNewer),
    eventTypes: newer.eventTypes,
    relationshipTypes: newer.relationshipTypes,
    deleted,
    savedAt: newer.savedAt,
  };
}
