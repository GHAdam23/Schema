// File System Access API helpers (Chrome / Edge).

export const SCHEMA_TYPES: FilePickerAcceptType[] = [{ description: 'Schema project', accept: { 'application/x-schema': ['.schema'] } }];

export function fsaSupported() {
  return typeof window.showOpenFilePicker === 'function';
}

export async function writeHandle(handle: FileSystemFileHandle, data: Blob | Uint8Array) {
  const w = await handle.createWritable();
  await w.write(data as FileSystemWriteChunkType);
  await w.close();
}

/** Save a blob via the save picker (falls back to a download). Returns the handle if any. */
export async function saveAs(data: Blob, suggestedName: string, types: FilePickerAcceptType[]): Promise<FileSystemFileHandle | null> {
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const h = await window.showSaveFilePicker({ suggestedName, types });
      await writeHandle(h, data);
      return h;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') throw e;
      console.warn('Save picker failed, falling back to download', e);
    }
  }
  download(data, suggestedName);
  return null;
}

export function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Simple <input type=file> picker for non-project files. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files?.[0] ?? null);
    inp.oncancel = () => resolve(null);
    inp.click();
  });
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

/** Read an image file as an Asset (PNG/JPG only — what pdf-lib can embed). */
export async function fileToImageAsset(file: File) {
  const mime = file.type === 'image/png' ? 'image/png' : file.type === 'image/jpeg' ? 'image/jpeg' : null;
  if (!mime) throw new Error('Images must be PNG or JPG.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Could not read image'));
    img.src = url;
  });
  URL.revokeObjectURL(url);
  return { mime, data: bytesToB64(bytes), w: img.naturalWidth, h: img.naturalHeight };
}
