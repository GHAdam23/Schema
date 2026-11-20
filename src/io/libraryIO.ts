// Block library import/export as CSV or XLSX.
// One row per port:  Manufacturer, Model, Column (IN/OUT), Port, Signal, Connector, then the rack size
// (Rack Units, Rack Width, Depth, and Width / Height in inches for shelf gear). An old "Default Name" column is ignored.
// (an older 'Direction' column is accepted on import and only used when Column is missing).
// A block with no ports is written as a single row with the port fields empty.
import * as XLSX from 'xlsx';
import type { BlockDef, PortDef } from '../model/types';
import { newId } from '../model/ids';

export const LIB_HEADERS = ['Manufacturer', 'Model', 'Column', 'Port', 'Signal', 'Connector', 'Rack Units', 'Rack Width', 'Depth (in)', 'Width (in)', 'Height (in)'];

export function libraryToRows(lib: BlockDef[]): string[][] {
  const rows: string[][] = [LIB_HEADERS];
  for (const d of lib) {
    const base = [d.manufacturer, d.model];
    // Rack size repeats on every row of the block (so filtering in Excel keeps it).
    const custom = d.rack?.width === 'custom';
    const rack = d.rack
      ? [String(d.rack.ru), d.rack.width ?? 'full', d.rack.depth ? String(d.rack.depth) : '', custom ? String(d.rack.w ?? '') : '', custom ? String(d.rack.h ?? '') : '']
      : ['', '', '', '', ''];
    if (!d.left.length && !d.right.length) rows.push([...base, '', '', '', '', ...rack]);
    for (const p of d.left) rows.push([...base, 'IN', p.name, p.signal, p.connector, ...rack]);
    for (const p of d.right) rows.push([...base, 'OUT', p.name, p.signal, p.connector, ...rack]);
  }
  return rows;
}

export function rowsToLibrary(rows: unknown[][]): BlockDef[] {
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase());
  const hasHeader = header.includes('manufacturer') || header.includes('model');
  // With a header row columns are found by name; without one, the old positional layout is assumed.
  const col = (names: string[], fallback: number) => {
    const i = header.findIndex((h) => names.includes(h));
    return i >= 0 ? i : hasHeader ? -1 : fallback;
  };
  const iMan = col(['manufacturer', 'make', 'mfr'], 0);
  const iModel = col(['model'], 1);
  const iCol = col(['column', 'side'], 3);
  const iW = col(['width (in)'], -1);
  const iH = col(['height (in)'], -1);
  const iPort = col(['port', 'port name'], 4);
  const iSig = col(['signal', 'signal type'], 5);
  const iCon = col(['connector', 'connector type'], 6);
  const iDir = col(['direction', 'dir'], -1);
  const iRu = col(['rack units', 'ru', 'rack unit'], -1);
  const iRw = col(['rack width', 'width'], -1);
  const iDepth = col(['depth (in)', 'depth', 'depth in'], -1);
  const byKey = new Map<string, BlockDef>();
  const out: BlockDef[] = [];
  for (const r of rows.slice(hasHeader ? 1 : 0)) {
    const g = (i: number) => String(r[i] ?? '').trim();
    const man = g(iMan);
    const model = g(iModel);
    if (!man && !model) continue;
    const key = man + '\u0000' + model;
    let def = byKey.get(key);
    if (!def) {
      def = { id: newId('bd'), manufacturer: man, model, left: [], right: [] };
      byKey.set(key, def);
      out.push(def);
    }
    const ru = Math.round(Number(g(iRu)));
    if (!def.rack && ru > 0) {
      const w = g(iRw).toLowerCase();
      const depth = Number(g(iDepth));
      def.rack = { ru, width: w.startsWith('h') || w === '1/2' ? 'half' : w.startsWith('t') || w === '1/3' ? 'third' : w.startsWith('c') || w.startsWith('s') ? 'custom' : 'full', depth: depth > 0 ? depth : undefined };
      if (!def.rack.depth) delete def.rack.depth;
      if (def.rack.width === 'custom') {
        def.rack.w = Number(g(iW)) || 8;
        def.rack.h = Number(g(iH)) || 1.75;
      }
    }
    const portName = g(iPort);
    if (!portName && !g(iSig) && !g(iCon)) continue;
    const dirRaw = g(iDir);
    const colRaw = g(iCol).toUpperCase();
    let side: 'L' | 'R';
    if (colRaw === 'IN' || colRaw === 'L' || colRaw === 'LEFT') side = 'L';
    else if (colRaw === 'OUT' || colRaw === 'R' || colRaw === 'RIGHT') side = 'R';
    else side = dirRaw.toUpperCase() === 'OUT' ? 'R' : 'L';
    const p: PortDef = { id: newId('pt'), name: portName, signal: g(iSig).toUpperCase(), connector: g(iCon), dir: side === 'L' ? 'IN' : 'OUT' };
    (side === 'L' ? def.left : def.right).push(p);
  }
  return out;
}

function csvEscape(v: string) {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export async function importLibraryFile(file: File): Promise<BlockDef[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
    const text = await file.text();
    if (name.endsWith('.tsv') || (!text.includes(',') && text.includes('\t'))) return rowsToLibrary(text.split(/\r?\n/).filter(Boolean).map((l) => l.split('\t')));
    return rowsToLibrary(parseCsv(text.replace(/^﻿/, '')));
  }
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  return rowsToLibrary(rows);
}

export function exportLibraryCsv(lib: BlockDef[]): Blob {
  return new Blob(['﻿' + toCsv(libraryToRows(lib))], { type: 'text/csv' });
}

export function exportLibraryXlsx(lib: BlockDef[]): Blob {
  const ws = XLSX.utils.aoa_to_sheet(libraryToRows(lib));
  ws['!cols'] = [18, 22, 14, 8, 18, 10, 12].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Blocks');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Merge imported definitions into the library; same manufacturer+model replaces (keeping the id). */
export function mergeLibrary(lib: BlockDef[], incoming: BlockDef[]): { lib: BlockDef[]; added: number; updated: number } {
  const out = [...lib];
  let added = 0;
  let updated = 0;
  for (const d of incoming) {
    const i = out.findIndex((l) => l.manufacturer.toLowerCase() === d.manufacturer.toLowerCase() && l.model.toLowerCase() === d.model.toLowerCase());
    if (i >= 0) {
      out[i] = { ...d, id: out[i].id };
      updated++;
    } else {
      out.push(d);
      added++;
    }
  }
  return { lib: out, added, updated };
}
