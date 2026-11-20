import type { ISODate, Person, TimelineItem } from './types';

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const nowStamp = () => new Date().toISOString();

export const todayISO = (): ISODate => toISO(new Date());

export function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Days since epoch for a YYYY-MM-DD (UTC, so no DST drift). */
export function dayNum(d: ISODate): number {
  const [y, m, day] = d.split('-').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, day || 1) / 86400000);
}

export function fromDayNum(n: number): ISODate {
  const d = new Date(n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(d: ISODate | 'present' | ''): string {
  if (!d) return '';
  if (d === 'present') return 'present';
  if (d.startsWith('--')) {
    const [, , m, day] = d.split('-');
    return `${MONTHS[Number(m) - 1]} ${Number(day)}`;
  }
  const [y, m, day] = d.split('-').map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
}

export function fmtStamp(s: string): string {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fullName(p: Pick<Person, 'firstName' | 'middleName' | 'lastName'>): string {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || '(no name)';
}

export function displayName(p: Person): string {
  const base = [p.firstName, p.lastName].filter(Boolean).join(' ') || '(no name)';
  return p.nickname ? `${base} “${p.nickname}”` : base;
}

export function initials(p: Person): string {
  return ((p.firstName[0] || '') + (p.lastName[0] || '')).toUpperCase() || '?';
}

export function sortKey(p: Person): string {
  return `${p.lastName || p.firstName} ${p.firstName}`.toLowerCase();
}

/** Age in whole years on a date, or null when the birth year is unknown. */
export function ageOn(birthday: ISODate, on: ISODate = todayISO()): number | null {
  if (!birthday || birthday.startsWith('--')) return null;
  const [by, bm, bd] = birthday.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

/** Days until the next occurrence of a birthday / anniversary (month-day). */
export function daysUntilAnniversary(date: ISODate, from: ISODate = todayISO()): number | null {
  if (!date) return null;
  const parts = date.split('-');
  const m = Number(parts[parts.length - 2]);
  const d = Number(parts[parts.length - 1]);
  if (!m || !d) return null;
  const [fy] = from.split('-').map(Number);
  const f = dayNum(from);
  let next = dayNum(`${fy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  if (next < f) next = dayNum(`${fy + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  return next - f;
}

/** Inclusive day range of a timeline item. */
export function itemRange(it: TimelineItem, today: ISODate = todayISO()): [number, number] {
  const s = dayNum(it.start);
  if (!it.end) return [s, s];
  const e = it.end === 'present' ? dayNum(today) : dayNum(it.end);
  return [s, Math.max(s, e)];
}

export function overlaps(it: TimelineItem, from: number, to: number): boolean {
  const [s, e] = itemRange(it);
  return s <= to && e >= from;
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Downscale an image file to a square-ish JPEG so the database stays small. */
export async function imageToThumb(file: Blob, max = 480): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function download(name: string, data: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
