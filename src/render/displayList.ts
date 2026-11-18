// The display list: a flat, ordered list of primitives produced from the document model.
// Both the SVG (screen) and pdf-lib (export) backends draw exactly this list.
import type { FontKey } from '../text/fonts';
import type { Matrix } from '../model/geom';

export type PathCmd =
  | { c: 'M'; x: number; y: number }
  | { c: 'L'; x: number; y: number }
  | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: 'Z' };

export interface DLStroke {
  color: string;
  width: number;
  dash: number[];
}

export type DLItem =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string | null; stroke: DLStroke | null }
  | { t: 'path'; d: PathCmd[]; fill: string | null; stroke: DLStroke | null; evenOdd?: boolean }
  | {
      t: 'text';
      x: number; // left of the text run
      y: number; // baseline
      text: string;
      font: FontKey;
      size: number;
      color: string;
      /** -90 = rotated to read bottom-to-top, around (x, y). */
      rot?: -90;
    }
  /** Raster image, or a PDF page (vector in the export, preview on screen). */
  | { t: 'image'; x: number; y: number; w: number; h: number; assetId: string }
  /** Items drawn through a transform (rotation). */
  | { t: 'group'; m: Matrix; items: DLItem[] };

/** Parse absolute M/L/C/Z path data (as stored for imported SVGs). */
export function parsePathData(d: string): PathCmd[] {
  const out: PathCmd[] = [];
  const re = /([MLCZ])([^MLCZ]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const n = (m[2].match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const c = m[1].toUpperCase();
    if (c === 'Z') out.push({ c: 'Z' });
    else if (c === 'C') for (let i = 0; i + 5 < n.length; i += 6) out.push({ c: 'C', x1: n[i], y1: n[i + 1], x2: n[i + 2], y2: n[i + 3], x: n[i + 4], y: n[i + 5] });
    else for (let i = 0; i + 1 < n.length; i += 2) out.push({ c: i === 0 ? (c as 'M' | 'L') : 'L', x: n[i], y: n[i + 1] });
  }
  return out;
}

export function pathToSvg(d: PathCmd[]): string {
  return d
    .map((p) => {
      switch (p.c) {
        case 'M':
          return `M${fmt(p.x)} ${fmt(p.y)}`;
        case 'L':
          return `L${fmt(p.x)} ${fmt(p.y)}`;
        case 'C':
          return `C${fmt(p.x1)} ${fmt(p.y1)} ${fmt(p.x2)} ${fmt(p.y2)} ${fmt(p.x)} ${fmt(p.y)}`;
        case 'Z':
          return 'Z';
      }
    })
    .join('');
}

function fmt(n: number) {
  return Math.round(n * 1000) / 1000;
}
