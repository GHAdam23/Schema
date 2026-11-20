// Dates are stored as 'YYYY-MM-DD' strings (day resolution, no time zone surprises).
export type ISODate = string;

export interface LabeledValue {
  id: string;
  label: string;
  value: string;
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  addedAt: string;
}

export interface Person {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  formerName: string; // maiden / former name
  nickname: string;
  photo: string; // data URL, downscaled
  phones: LabeledValue[];
  emails: LabeledValue[];
  addresses: LabeledValue[];
  birthday: ISODate; // '' if unknown; '--MM-DD' when year unknown
  placeMet: string;
  favorites: LabeledValue[];
  customFields: LabeledValue[];
  attachments: Attachment[];
  notes: string;
  listIds: string[];
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/** "to is from's <type>"  e.g. from = John Smith, to = Jane, type = Daughter. */
export interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  /** both directions of one link share a pairId and are deleted together */
  pairId: string;
  createdAt: string;
}

export interface RelationshipType {
  name: string;
  inverse: string; // what the other person is called from the other side
  family: boolean; // used to build family views
  generation: number; // -1 = the other person is one generation older, +1 younger, 0 same
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Place {
  id: string;
  name: string;
}

export interface NamedList {
  id: string;
  name: string;
}

export type LaneKind = 'events' | 'tags' | 'locations' | 'custom';

export interface Lane {
  id: string;
  name: string;
  kind: LaneKind;
  builtIn: boolean;
}

export interface TimelineItem {
  id: string;
  personId: string;
  laneId: string;
  start: ISODate;
  /** '' = a single day; 'present' = still ongoing; otherwise an end date */
  end: ISODate | 'present' | '';
  tagId?: string; // tags lane
  placeId?: string; // locations lane
  eventType?: string; // events lane
  text?: string; // custom lanes / extra label
  note: string;
}

export interface Database {
  version: 1;
  people: Person[];
  relationships: Relationship[];
  tags: Tag[];
  places: Place[];
  lists: NamedList[];
  lanes: Lane[];
  eventTypes: string[];
  relationshipTypes: RelationshipType[];
  timeline: TimelineItem[];
  /** id → deletion time; lets two devices merge without bringing deleted records back */
  deleted: Record<string, string>;
  savedAt: string;
}
