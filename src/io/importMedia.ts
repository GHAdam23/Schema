// Import images (PNG/JPG), single PDF pages and SVG drawings as project assets.
import type { Asset } from '../model/types';
import { bytesToB64, fileToImageAsset } from './files';
import { svgToVector } from './svgImport';

export const MEDIA_ACCEPT = '.png,.jpg,.jpeg,.pdf,.svg,image/png,image/jpeg,application/pdf,image/svg+xml';

export function isMediaFile(f: File) {
  return /\.(png|jpe?g|pdf|svg)$/i.test(f.name) || ['image/png', 'image/jpeg', 'application/pdf', 'image/svg+xml'].includes(f.type);
}

export interface Imported {
  asset: Asset;
  name: string;
  warnings: string[];
}

export async function importMediaFile(f: File): Promise<Imported> {
  const name = f.name || 'image';
  if (f.type === 'application/pdf' || /\.pdf$/i.test(name)) return { ...(await importPdf(f)), name };
  if (f.type === 'image/svg+xml' || /\.svg$/i.test(name)) {
    const text = await f.text();
    const r = svgToVector(text);
    return {
      name,
      warnings: r.warnings,
      asset: { mime: 'image/svg+xml', data: bytesToB64(new TextEncoder().encode(text)), w: r.w, h: r.h, vector: r.paths },
    };
  }
  return { asset: await fileToImageAsset(f), name, warnings: [] };
}

/**
 * A PDF page: the original file is kept and embedded as vector on export (pdf-lib embedPage).
 * pdf.js renders a raster preview for the screen. Multi-page files: the user picks one page.
 */
async function importPdf(f: File): Promise<{ asset: Asset; warnings: string[] }> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  // Make sure the export will be able to embed it (e.g. encrypted files can't be).
  const { PDFDocument } = await import('pdf-lib');
  try {
    const d = await PDFDocument.load(bytes, { updateMetadata: false });
    if (d.getPageCount() < 1) throw new Error('The PDF has no pages.');
  } catch (e) {
    throw new Error('This PDF can’t be embedded (' + (e as Error).message + ').');
  }
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  let pageNo = 1;
  if (doc.numPages > 1) {
    const ans = prompt(`This PDF has ${doc.numPages} pages. Which page should be placed?`, '1');
    if (ans === null) throw new DOMException('cancelled', 'AbortError');
    pageNo = Math.min(doc.numPages, Math.max(1, parseInt(ans, 10) || 1));
  }
  const page = await doc.getPage(pageNo);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(4, 4000 / Math.max(vp1.width, vp1.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const png = canvas.toDataURL('image/png').split(',')[1];
  await doc.destroy();
  return {
    asset: { mime: 'application/pdf', data: bytesToB64(bytes), w: vp1.width, h: vp1.height, page: pageNo - 1, preview: { mime: 'image/png', data: png } },
    warnings: [],
  };
}
