// Project fonts: upload TTF / OTF files to replace the built-in fonts (embedded in the project and PDFs).
import type { CustomFont } from '../model/types';
import { nextLabel, toast, updateProject, useStore } from '../state/store';
import { bytesToB64, pickFile } from '../io/files';
import { newId } from '../model/ids';
import { parseFontFile } from '../text/fonts';
import { Group } from './controls';
import { gc } from '../state/actions';

type Slot = 'narrow' | 'title';
const SLOTS: [Slot, string, string][] = [
  ['narrow', 'Blocks, labels, shapes', 'Roboto Condensed'],
  ['title', 'Title block, rack titles', 'Carlito'],
];

async function upload(slot: Slot, weight: 'regular' | 'bold') {
  const f = await pickFile('.ttf,.otf,font/ttf,font/otf');
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  let family: string;
  try {
    family = parseFontFile(bytes).family;
  } catch (e) {
    toast(`${f.name}: ${(e as Error).message}`, 'error', 6000);
    return;
  }
  const id = newId('as');
  const mime = f.name.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf';
  nextLabel(`Use font ${family}${weight === 'bold' ? ' (bold)' : ''}`);
  updateProject((d) => {
    d.assets[id] = { mime, data: bytesToB64(bytes), w: 0, h: 0 };
    d.fonts ??= {};
    const cur = d.fonts[slot];
    if (weight === 'regular') d.fonts[slot] = { name: family, regular: id, bold: cur?.bold };
    else if (cur) cur.bold = id;
    else d.fonts[slot] = { name: family, regular: id, bold: id };
    gc(d);
  });
}

function reset(slot: Slot) {
  nextLabel('Use the built-in font');
  updateProject((d) => {
    if (d.fonts) delete d.fonts[slot];
    gc(d);
  });
}

export function FontSettings() {
  const fonts = useStore((s) => s.project.fonts);
  return (
    <Group title="Fonts">
      {SLOTS.map(([slot, what, builtin]) => {
        const f: CustomFont | undefined = fonts?.[slot];
        return (
          <div key={slot} className="fontrow">
            <div>
              <span className="muted small">{what}:</span> <b>{f ? f.name : builtin}</b>
              {f && !f.bold && <span className="muted small"> (no bold file — bold uses regular)</span>}
            </div>
            <div className="btnrow small">
              <button onClick={() => void upload(slot, 'regular')} title="Upload a TrueType / OpenType file (.ttf / .otf). It's saved in the project and embedded in PDFs.">
                {f ? 'Replace…' : 'Upload font…'}
              </button>
              {f && (
                <button onClick={() => void upload(slot, 'bold')} title="The bold weight of the same family">
                  {f.bold && f.bold !== f.regular ? 'Replace bold…' : 'Add bold…'}
                </button>
              )}
              {f && <button onClick={() => reset(slot)}>Use built-in</button>}
            </div>
          </div>
        );
      })}
      <div className="muted small">Only use fonts whose licence allows embedding.</div>
    </Group>
  );
}

