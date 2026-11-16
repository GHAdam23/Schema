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
}

export interface TextObj extends ObjBase, TextProps {
  kind: 'text';
  w: number;
  h: number;
  border: StrokeStyle | null;
  fill: string | null;
}

export interface RectObj extends ObjBase, TextProps {
  kind: 'rect';
  w: number;
  h: number;
  border: StrokeStyle;
  fill: string | null;
}

export type PageObject = BlockObj | TextObj | RectObj;

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
}

export type PageSizeId = 'letter' | 'tabloid';

export interface Page {
  id: Id;
  name: string;
  size: PageSizeId;
  objects: PageObject[];
  connections: Connection[];
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
  /** Natural pixel size, used to keep the aspect ratio. */
  w: number;
  h: number;
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
