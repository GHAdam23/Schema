import {
  PDFDocument,
  rgb,
  degrees,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type PDFEmbeddedPage,
  PDFOperator,
  PDFOperatorNames,
  concatTransformationMatrix,
  pushGraphicsState,
  popGraphicsState,
  setLineWidth,
  setDashPattern,
  setStrokingRgbColor,
  setFillingRgbColor,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  rectangle,
  stroke,
  fill,
  fillAndStroke,
  setLineCap,
  setLineJoin,
  LineCapStyle,
  LineJoinStyle,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Project } from '../model/types';
import { PAGE_SIZES } from '../model/defaults';
import { fontBytes, isCustomFont, syncProjectFonts, type FontKey } from '../text/fonts';
import type { DLItem, DLStroke } from './displayList';
import { buildPage } from './buildPage';

function hex(c: string): [number, number, number] {
  let h = c.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h, 16);
  if (isNaN(n)) return [0, 0, 0];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Export the given page indices (0-based) to a vector PDF. */
export async function exportPdf(project: Project, pageIndices: number[]): Promise<Uint8Array> {
  syncProjectFonts(project);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(project.info.name || 'Schema');
  doc.setCreator('Schema');
  doc.setProducer('Schema (pdf-lib)');

  const fonts = new Map<FontKey, PDFFont>();
  const getFont = async (k: FontKey) => {
    let f = fonts.get(k);
    if (!f) {
      // pdf-lib's subsetter drops glyphs from Carlito, so the title-block font is embedded whole.
      f = await doc.embedFont(fontBytes(k), {
        // Uploaded fonts are embedded whole too (subsetting can drop glyphs of unusual fonts).
        subset: (k === 'narrow' || k === 'narrowBold') && !isCustomFont(k),
        // Layout must match measureText(): no kerning or ligatures.
        features: { liga: false, clig: false, dlig: false, calt: false, kern: false },
      });
      fonts.set(k, f);
    }
    return f;
  };
  const images = new Map<string, PDFImage | PDFEmbeddedPage>();
  const getImage = async (id: string) => {
    let im = images.get(id);
    if (!im) {
      const a = project.assets[id];
      if (!a) return null;
      const bytes = b64ToBytes(a.data);
      if (a.mime === 'application/pdf') {
        // Imported PDFs stay vector: the original page is embedded as a form XObject.
        [im] = await doc.embedPdf(bytes, [a.page ?? 0]);
      } else im = a.mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      images.set(id, im);
    }
    return im;
  };

  for (const idx of pageIndices) {
    const page = project.pages[idx];
    const size = PAGE_SIZES[page.size];
    const pdfPage = doc.addPage([size.w, size.h]);
    const items = buildPage(project, page, { pageIndex: idx + 1, pageCount: project.pages.length });
    for (const it of items) await drawItem(pdfPage, it, size.h, getFont, getImage);
  }
  return doc.save();
}

async function drawItem(
  pg: PDFPage,
  it: DLItem,
  H: number,
  getFont: (k: FontKey) => Promise<PDFFont>,
  getImage: (id: string) => Promise<PDFImage | PDFEmbeddedPage | null>,
) {
  const Y = (y: number) => H - y;
  switch (it.t) {
    case 'group': {
      // Page matrix (y down) → PDF space (y up): conjugate by the flip (x, y) → (x, H - y).
      const [a, b, c, d, e, f] = it.m;
      pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, -b, -c, d, c * H + e, H - d * H - f));
      for (const sub of it.items) await drawItem(pg, sub, H, getFont, getImage);
      pg.pushOperators(popGraphicsState());
      return;
    }
    case 'rect': {
      const ops = [pushGraphicsState()];
      applyPaint(ops, it.fill, it.stroke);
      ops.push(rectangle(it.x, Y(it.y + it.h), it.w, it.h));
      ops.push(paintOp(it.fill, it.stroke));
      ops.push(popGraphicsState());
      if (it.fill || it.stroke) pg.pushOperators(...ops);
      return;
    }
    case 'path': {
      if (!it.fill && !it.stroke) return;
      const ops = [pushGraphicsState()];
      applyPaint(ops, it.fill, it.stroke);
      for (const p of it.d) {
        if (p.c === 'M') ops.push(moveTo(p.x, Y(p.y)));
        else if (p.c === 'L') ops.push(lineTo(p.x, Y(p.y)));
        else if (p.c === 'C') ops.push(appendBezierCurve(p.x1, Y(p.y1), p.x2, Y(p.y2), p.x, Y(p.y)));
        else ops.push(closePath());
      }
      ops.push(paintOp(it.fill, it.stroke, it.evenOdd));
      ops.push(popGraphicsState());
      pg.pushOperators(...ops);
      return;
    }
    case 'text': {
      const font = await getFont(it.font);
      const [r, g, b] = hex(it.color);
      pg.drawText(it.text, { x: it.x, y: Y(it.y), size: it.size, font, color: rgb(r, g, b), rotate: degrees(it.rot ? -it.rot : 0) });
      return;
    }
    case 'image': {
      const im = await getImage(it.assetId);
      if (!im) return;
      if (isEmbeddedPage(im)) pg.drawPage(im, { x: it.x, y: Y(it.y + it.h), width: it.w, height: it.h });
      else pg.drawImage(im, { x: it.x, y: Y(it.y + it.h), width: it.w, height: it.h });
      return;
    }
  }
}

function applyPaint(ops: ReturnType<typeof pushGraphicsState>[], fillC: string | null, s: DLStroke | null) {
  if (fillC) ops.push(setFillingRgbColor(...hex(fillC)));
  if (s) {
    ops.push(setStrokingRgbColor(...hex(s.color)));
    ops.push(setLineWidth(s.width));
    ops.push(setDashPattern(s.dash, 0));
    ops.push(setLineCap(LineCapStyle.Butt));
    ops.push(setLineJoin(LineJoinStyle.Miter));
  }
}

function isEmbeddedPage(x: PDFImage | PDFEmbeddedPage): x is PDFEmbeddedPage {
  return typeof (x as PDFImage).scaleToFit !== 'function';
}

function paintOp(fillC: string | null, s: DLStroke | null, evenOdd = false) {
  if (fillC && s) return evenOdd ? PDFOperator.of(PDFOperatorNames.FillEvenOddAndStroke) : fillAndStroke();
  if (fillC) return evenOdd ? PDFOperator.of(PDFOperatorNames.FillEvenOdd) : fill();
  return stroke();
}
