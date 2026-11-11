// The display list: a flat, ordered list of primitives produced from the document model.
// Both the SVG (screen) and pdf-lib (export) backends draw exactly this list.
import type { FontKey } from '../text/fonts';

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
  | { t: 'path'; d: PathCmd[]; fill: string | null; stroke: DLStroke | null }
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
  | { t: 'image'; x: number; y: number; w: number; h: number; assetId: string };

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
