// Document model. All geometry is in PDF points (1/72 in), page origin top-left, y down.

export type Id = string;

export type Direction = 'IN' | 'OUT' | 'BIDIR';
export type Side = 'L' | 'R';

export interface PortDef {
  id: Id;
  name: string;
  signal: string;
  connector: string;
  dir: Direction;
}

/** A block definition. `left` holds the IN column, `right` the OUT column (a port's direction is its column). */
export interface BlockDef {
  id: Id;
  manufacturer: string;
  model: string;
  /** Default friendly name used when a new device is placed. */
  defaultName: string;
  left: PortDef[];
  right: PortDef[];
  /** For project-local copies: the library definition this was copied from. */
  libraryId?: Id;
}

export type DashStyle = 'solid' | 'dashed' | 'dotted';

export interface StrokeStyle {
  color: string;
  width: number;
  dash: DashStyle;
}

export interface ProjectDevice {
  id: Id;
  /** Project-local block definition id (key into Project.blockDefs). */
  defId: Id;
  name: string;
}

interface ObjBase {
  id: Id;
  x: number;
  y: number;
}

export interface BlockObj extends ObjBase {
  kind: 'block';
  deviceId: Id;
  scale: number;
  border: StrokeStyle;
  /** This block's own port list (edited for this block only); otherwise the device's definition. */
  defId?: Id;
  /** Rows hidden on this block (e.g. the audio ports on a network page). */
  hidden?: Id[];
}

export type TextAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

/** Text content shared by text boxes and rectangles (a rectangle can hold text too). */
export interface TextProps {
  text: string;
  fontSize: number;
  bold: boolean;
  align: TextAlign;
  valign: VAlign;
  color: string;
  /** Word-wrap long lines (otherwise only explicit line breaks). Text always shrinks to fit its box. */
  wrap?: boolean;
}

/** Objects with a box that can be rotated about their centre (everything except blocks and tags). */
interface BoxBase extends ObjBase {
  w: number;
  h: number;
  /** Rotation in degrees, clockwise, about the box centre. */
  rot?: number;
}

export interface TextObj extends BoxBase, TextProps {
  kind: 'text';
  border: StrokeStyle | null;
  fill: string | null;
}

export interface RectObj extends BoxBase, TextProps {
  kind: 'rect';
  border: StrokeStyle;
  fill: string | null;
}

export interface EllipseObj extends BoxBase, TextProps {
  kind: 'ellipse';
  border: StrokeStyle;
  fill: string | null;
}

/** Labelled grouping frame: moving it moves what's inside. Label in a band along the top (`text`). */
export interface ContainerObj extends BoxBase, TextProps {
  kind: 'container';
  border: StrokeStyle;
  fill: string | null;
  /** Fill of the label band (null = none). */
  headerFill: string | null;
}

/**
 * Text box with a pointer. The pointer's tip is `tail` (offset from the box's x/y, page-oriented,
 * so rotating the callout doesn't move it), or glued to a point of another object (`tailTo`).
 */
export interface CalloutObj extends BoxBase, TextProps {
  kind: 'callout';
  border: StrokeStyle;
  fill: string | null;
  tail: { x: number; y: number };
  /** Glued to a point of an object (fractions of its box) or of a line (fraction of its length). */
  tailTo?: { objId: Id; fx: number; fy: number } | { connId: Id; t: number };
  /** Outline: a box with a wedge (default) or a thought-bubble cloud with trailing bubbles. */
  shape?: 'box' | 'cloud';
}

export type ArrowEnds = 'none' | 'start' | 'end' | 'both';

/**
 * A drawn line / arrow (not a connection): runs along the middle of its box, from (x, y+h/2) to
 * (x+w, y+h/2), turned by `rot` — so length = w and direction = rot.
 */
export interface LineObj extends BoxBase {
  kind: 'line';
  border: StrokeStyle;
  arrows: ArrowEnds;
}

/** Imported image (PNG/JPG), single PDF page (stays vector) or SVG (converted to vector paths). */
export interface ImageObj extends BoxBase {
  kind: 'image';
  assetId: Id;
  border: StrokeStyle | null;
}

export type TagDir = 'auto' | 'TO' | 'FROM';

/**
 * Reference tag: a box at the end of a line pointing to a device (optionally one of its ports)
 * anywhere in the project. Its text is generated: `TO|FROM (page#) NAME [PORT] [note]`. Size is automatic.
 */
export interface TagObj extends ObjBase {
  kind: 'tag';
  target: { deviceId: Id; portId?: Id } | null;
  dir: TagDir;
  showPort: boolean;
  note: string;
  fontSize: number;
  border: StrokeStyle;
  fill: string | null;
  /** Fixed height (e.g. the row height of the port it sits at, so stacked tags line up); none = from the font. */
  height?: number;
  /** The matching tag at the far end (on the other page), kept in step automatically. */
  pairId?: Id;
  /** Created automatically as the far end of another tag. */
  auto?: boolean;
}

export type PageObject = BlockObj | TextObj | RectObj | EllipseObj | ContainerObj | CalloutObj | ImageObj | TagObj | LineObj;
/** Objects that have a free box (x, y, w, h, rot). */
export type BoxObj = Exclude<PageObject, BlockObj | TagObj>;
/** Objects that hold editable text in their box. */
export type TextualObj = TextObj | RectObj | EllipseObj | ContainerObj | CalloutObj;

/** Where a connection ends. For blocks a port; for shapes a point on the outline (fractions of w/h). */
export type Endpoint =
  | { objId: Id; portId: Id }
  | { objId: Id; fx: number; fy: number };

export interface Connection {
  id: Id;
  from: Endpoint;
  to: Endpoint;
  /**
   * Orthogonal route as alternating bend coordinates (see routing.ts). null = automatic.
   */
  bends: number[] | null;
  label: string;
  /** Label position along the line, 0..1 of total length. null = automatic (middle of the longest horizontal run). */
  labelT: number | null;
  style: StrokeStyle;
  /** Curved: the right-angle route smoothed. */
  curved?: boolean;
  /** Show the label near both ends instead of once along the line. */
  labelEnds?: boolean;
  /** With labelEnds: positions of the start / end label (0..1 of length); null = automatic, near that end. */
  labelEndsT?: [number | null, number | null];
}

/**
 * Snake: ≥4 lines of one signal type between the same two blocks drawn as one heavier trunk.
 * Each line keeps a short leg (with its full label) at each end; legs join a bar, bars join the trunk.
 */
export interface Bundle {
  id: Id;
  connIds: Id[];
  label: string;
  /** Trunk route (same encoding as Connection.bends). null = automatic. */
  bends: number[] | null;
  style: StrokeStyle;
  /** Curved trunk. */
  curved?: boolean;
}

export type PageSizeId = 'letter' | 'tabloid';

export interface Page {
  id: Id;
  name: string;
  size: PageSizeId;
  objects: PageObject[];
  connections: Connection[];
  bundles: Bundle[];
}

export interface ProjectInfo {
  name: string;
  address: string;
  designerName: string;
  copyright: string;
  phone: string;
  email: string;
  /** Asset id of the logo, if any. */
  logoAssetId: string | null;
  created: string; // ISO date
  modified: string; // ISO date, updated on save
  revision: string;
}

export interface Asset {
  mime: string;
  /** base64 data (no data: prefix) */
  data: string;
  /** Natural size (pixels for images, points for PDF/SVG), used to keep the aspect ratio. */
  w: number;
  h: number;
  /** PDF: page index used (0-based). */
  page?: number;
  /** PDF: raster preview for the screen (the export embeds the original page as vector). */
  preview?: { mime: string; data: string };
  /** SVG: the drawing converted to vector paths in a w×h box (drawn on screen and in the PDF). */
  vector?: VectorPath[];
}

export interface VectorPath {
  /** SVG path data, absolute M/L/C/Z only. */
  d: string;
  fill: string | null;
  stroke: string | null;
  width: number;
  evenOdd?: boolean;
}

export interface Project {
  version: 1;
  info: ProjectInfo;
  pages: Page[];
  devices: Record<Id, ProjectDevice>;
  blockDefs: Record<Id, BlockDef>;
  assets: Record<Id, Asset>;
  /** Label auto-numbering is Phase 3; the counter lives here for later. */
}

export function isPortEndpoint(e: Endpoint): e is { objId: Id; portId: Id } {
  return (e as { portId?: Id }).portId !== undefined;
}
