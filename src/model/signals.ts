// Signal types of lines: optional colour / line style per signal type, and auto-numbered labels.
import type { AutoLabel, Connection, Page, Project, StrokeStyle } from './types';
import { isPortEndpoint } from './types';
import { blockFor, findPort } from './blockGeometry';

/** The signal type a line carries: from its port ends (output end first). */
export function connSignal(project: Project, page: Page, c: Pick<Connection, 'from' | 'to'>): string {
  for (const e of [c.from, c.to]) {
    if (!isPortEndpoint(e)) continue;
    const o = page.objects.find((x) => x.id === e.objId);
    if (o?.kind !== 'block') continue;
    const def = blockFor(project, o).base;
    const sig = def && findPort(def, e.portId)?.port.signal;
    if (sig) return sig.toUpperCase();
  }
  return '';
}

/**
 * The style a line is drawn with. With signal colours on, a line that still has the default black
 * colour takes its signal type's colour (and dash, if set); a line given its own colour keeps it.
 */
export function effectiveStyle(project: Project, page: Page, c: Pick<Connection, 'from' | 'to' | 'style'>): StrokeStyle {
  if (!project.signalColors || !project.signalStyles) return c.style;
  const st = project.signalStyles[connSignal(project, page, c)];
  if (!st || c.style.color.toLowerCase() !== '#000000') return c.style;
  return { ...c.style, color: st.color, dash: st.dash && c.style.dash === 'solid' ? st.dash : c.style.dash };
}

export const DEFAULT_AUTO_LABEL: AutoLabel = { on: false, prefix: 'C-', next: 1, digits: 3 };

export function formatLabel(a: AutoLabel, n: number) {
  return a.prefix + String(n).padStart(Math.max(0, a.digits), '0');
}

/** Suggested colours for common signal types (print-friendly). */
export const SIGNAL_COLOR_SUGGESTIONS: Record<string, string> = {
  SDI: '#0060c0',
  HDSDI: '#0060c0',
  '12GSDI': '#0060c0',
  RF: '#8b4513',
  HDMI: '#7030a0',
  DVI: '#7030a0',
  DP: '#7030a0',
  HDBT: '#8b4513',
  NDI: '#f07800',
  AUDIO: '#00963c',
  'AES/EBU': '#00963c',
  AES: '#00963c',
  DANTE: '#e6b800',
  MADI: '#00963c',
  DATA: '#f07800',
  FIBER: '#d00000',
  GPIO: '#404040',
  RS232: '#404040',
  USB: '#404040',
  POWER: '#d00000',
  AC: '#d00000',
};
