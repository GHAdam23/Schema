import type { PageSizeId, StrokeStyle } from './types';

export const PAGE_SIZES: Record<PageSizeId, { label: string; w: number; h: number }> = {
  letter: { label: 'Letter 11×8.5', w: 792, h: 612 },
  tabloid: { label: 'Tabloid 17×11', w: 1224, h: 792 },
};

export const PAGE_MARGIN = 18;
export function titleBlockWidth(size: PageSizeId) {
  return size === 'letter' ? 108 : 132;
}

/** Drawing area (left of the title block, inside margins). */
export function drawingArea(size: PageSizeId) {
  const p = PAGE_SIZES[size];
  return {
    x: PAGE_MARGIN,
    y: PAGE_MARGIN,
    w: p.w - PAGE_MARGIN * 2 - titleBlockWidth(size),
    h: p.h - PAGE_MARGIN * 2,
  };
}

export const DEFAULT_SIGNAL_TYPES = ['SDI', 'RF', 'HDMI', 'DVI', 'DP', 'HDBT', 'NDI', 'AUDIO', 'AES/EBU', 'DANTE', 'MADI', 'DATA', 'FIBER', 'GPIO', 'USB', 'POWER'];

/** The list before Phase 3 round 1 (a stored preference equal to it is updated to the new defaults). */
export const OLD_DEFAULT_SIGNAL_TYPES = ['HDSDI', '12GSDI', 'HDMI', 'DVI', 'DP', 'HDBT', 'AUDIO', 'AES', 'DANTE', 'DATA', 'FIBER', 'RS232', 'GPIO', 'USB', 'AC'];

export const DEFAULT_LINE: StrokeStyle = { color: '#000000', width: 0.75, dash: 'solid' };
export const DEFAULT_BLOCK_BORDER: StrokeStyle = { color: '#000000', width: 1, dash: 'solid' };
export const DEFAULT_RECT_BORDER: StrokeStyle = { color: '#000000', width: 1, dash: 'solid' };

export function dashArray(style: StrokeStyle): number[] {
  const w = Math.max(style.width, 0.5);
  if (style.dash === 'dashed') return [w * 5, w * 3];
  if (style.dash === 'dotted') return [w, w * 2];
  return [];
}
