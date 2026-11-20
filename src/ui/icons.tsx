// Small line icons (16×16, stroked) for the toolbar and panels.

const PATHS = {
  edit: 'M3 13l1-4 7-7 3 3-7 7-4 1z M9 4l3 3',
  cursor: 'M4 2l9 6-4 1 2 5-2 1-2-5-3 3z',
  plus: 'M8 3v10 M3 8h10',
  eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  tag: 'M2 3h6l6 6-5 5-6-6z M5 6h.01',
  undo: 'M5 2.5L2 5.5l3 3 M2 5.5h7a4 4 0 0 1 0 8H6',
  redo: 'M11 2.5l3 3-3 3 M14 5.5H7a4 4 0 0 0 0 8h3',
  history: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z M8 4.5V8l2.5 2',
  hand: 'M5 9V4.5a1 1 0 0 1 2 0V8 M7 7.5V3a1 1 0 0 1 2 0v4.5 M9 7.5V4a1 1 0 0 1 2 0v4 M11 8V6a1 1 0 0 1 2 0v3.5c0 2.5-2 4.5-4.5 4.5H8c-1.5 0-2.5-.7-3.3-1.8L2.8 9.6a1 1 0 0 1 1.6-1.2L5 9',
  magnet: 'M3 2h3v6a2 2 0 0 0 4 0V2h3v6a5 5 0 0 1-10 0z M3 5h3 M10 5h3',
  guides: 'M1 5h14 M11 1v14 M4 8h4v4H4z',
  text: 'M3 3h10 M8 3v10 M6 13h4',
  rect: 'M2.5 4h11v8h-11z',
  ellipse: 'M8 3.5c3.3 0 6 2 6 4.5s-2.7 4.5-6 4.5S2 10.5 2 8s2.7-4.5 6-4.5z',
  container: 'M2 3h12v10H2z M2 6h12',
  callout: 'M2 3h12v7H7l-3 3v-3H2z',
  bubble: 'M5 10a3 3 0 1 1 .5-5.9A3.5 3.5 0 0 1 12 5a2.5 2.5 0 0 1 0 5z M4 12.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z M2 14.8a.4.4 0 1 0 0 .8.4.4 0 0 0 0-.8z',
  line: 'M3 13L13 3',
  image: 'M2 3h12v10H2z M2 11l3.5-3.5 3 3 2-2L14 12 M10.5 5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  grid: 'M2 2h12v12H2z M6 2v12 M10 2v12 M2 6h12 M2 10h12',
  zoomOut: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M10.5 10.5L14 14 M5 7h4',
  zoomIn: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M10.5 10.5L14 14 M5 7h4 M7 5v4',
  zoom: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M10.5 10.5L14 14',
  fit: 'M2 6V2h4 M10 2h4v4 M14 10v4h-4 M6 14H2v-4',
  number: 'M6.5 2L5 14 M11.5 2L10 14 M2.5 6h11 M2 10h11',
  clear: 'M9 3l4 4-6 6H4l-2-2z M6 6l4 4 M8 13h6',
  bulb: 'M8 1.5a4.5 4.5 0 0 0-2.5 8.2V11.5h5V9.7A4.5 4.5 0 0 0 8 1.5z M6 13.2h4 M6.8 14.8h2.4',
  file: 'M4 1.5h5l3 3v10H4z M9 1.5v3h3',
  export: 'M8 10V2 M5 5l3-3 3 3 M3 9v5h10V9',
  gear: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M8 1v2 M8 13v2 M1 8h2 M13 8h2 M3 3l1.4 1.4 M11.6 11.6L13 13 M3 13l1.4-1.4 M11.6 4.4L13 3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14, className = 'ticon' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
