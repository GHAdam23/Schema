// Font loading + text measurement. The same TTF files are used for on-screen SVG (via @font-face)
// and embedded into exported PDFs, and all text layout is computed here from the font's own
// advance widths (no kerning / ligatures), so screen and PDF match exactly.
import fontkit from '@pdf-lib/fontkit';
import type { Font as FkFont } from '@pdf-lib/fontkit';

export type FontKey = 'narrow' | 'narrowBold' | 'title' | 'titleBold';

export const FONT_FILES: Record<FontKey, string> = {
  narrow: 'fonts/narrow-regular.ttf',
  narrowBold: 'fonts/narrow-bold.ttf',
  title: 'fonts/title-regular.ttf',
  titleBold: 'fonts/title-bold.ttf',
};

/** CSS font-family + weight used by the SVG renderer for each key. */
export const FONT_CSS: Record<FontKey, { family: string; weight: number }> = {
  narrow: { family: 'SchemaNarrow', weight: 400 },
  narrowBold: { family: 'SchemaNarrow', weight: 700 },
  title: { family: 'SchemaTitle', weight: 400 },
  titleBold: { family: 'SchemaTitle', weight: 700 },
};

interface LoadedFont {
  bytes: Uint8Array;
  font: FkFont;
  widths: Map<string, number>; // per-char advance in em
}

const loaded: Partial<Record<FontKey, LoadedFont>> = {};

export async function loadFonts(): Promise<void> {
  const keys = Object.keys(FONT_FILES) as FontKey[];
  await Promise.all(
    keys.map(async (k) => {
      const res = await fetch(new URL(FONT_FILES[k], document.baseURI));
      if (!res.ok) throw new Error(`Failed to load font ${FONT_FILES[k]}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      loaded[k] = { bytes, font: fontkit.create(bytes), widths: new Map() };
    }),
  );
  // Register the same files for the screen renderer.
  const faces: FontFace[] = keys.map((k) => {
    const css = FONT_CSS[k];
    return new FontFace(css.family, loaded[k]!.bytes.slice().buffer, { weight: String(css.weight) });
  });
  for (const f of faces) {
    await f.load();
    document.fonts.add(f);
  }
}

export function fontBytes(k: FontKey): Uint8Array {
  const f = loaded[k];
  if (!f) throw new Error('Fonts not loaded');
  return f.bytes;
}

export function fontsReady() {
  return !!loaded.narrow;
}

function charWidthEm(f: LoadedFont, ch: string): number {
  let w = f.widths.get(ch);
  if (w === undefined) {
    const glyphs = f.font.glyphsForString(ch);
    w = glyphs.reduce((s, g) => s + g.advanceWidth, 0) / f.font.unitsPerEm;
    f.widths.set(ch, w);
  }
  return w;
}

export function measureText(text: string, font: FontKey, size: number): number {
  const f = loaded[font];
  if (!f) return text.length * size * 0.5;
  let w = 0;
  for (const ch of text) w += charWidthEm(f, ch);
  return w * size;
}

/** Ascent (above baseline) as a fraction of size; used to place baselines consistently. */
export function ascentEm(font: FontKey): number {
  const f = loaded[font];
  if (!f) return 0.8;
  return f.font.ascent / f.font.unitsPerEm;
}

export function capHeightEm(font: FontKey): number {
  const f = loaded[font];
  if (!f) return 0.7;
  return (f.font.capHeight || f.font.ascent * 0.7) / f.font.unitsPerEm;
}

/** Word-wrap text to a width. Explicit newlines are honoured. */
export function wrapText(text: string, font: FontKey, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const tok of words) {
      if (tok === '') continue;
      const cand = line + tok;
      if (line !== '' && /\S/.test(tok) && measureText(cand.trimEnd(), font, size) > width) {
        out.push(line.trimEnd());
        line = tok;
        // Break overly long single words.
        while (measureText(line, font, size) > width && line.length > 1) {
          let i = line.length - 1;
          while (i > 1 && measureText(line.slice(0, i), font, size) > width) i--;
          out.push(line.slice(0, i));
          line = line.slice(i);
        }
      } else {
        line = cand;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Truncate with an ellipsis so the text fits in `width`. */
export function fitText(text: string, font: FontKey, size: number, width: number): string {
  if (measureText(text, font, size) <= width) return text;
  let t = text;
  while (t.length > 0 && measureText(t + '…', font, size) > width) t = t.slice(0, -1);
  return t + '…';
}
