import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDB } from '../store';
import type { Database, Lane, Person, TimelineItem } from '../types';
import { dayNum, fmtDate, fromDayNum, itemRange, todayISO } from '../util';
import { TimelineItemEditor } from './TimelineItemEditor';

const LANE_LABEL_W = 120;
const ROW_H = 26;
const LANE_PAD = 6;
const AXIS_H = 34;

const ZOOMS: { name: string; ppd: number }[] = [
  { name: 'Decades', ppd: 0.04 },
  { name: 'Years', ppd: 0.35 },
  { name: 'Months', ppd: 3 },
  { name: 'Weeks', ppd: 12 },
  { name: 'Days', ppd: 40 },
];

export function itemLabel(db: Database, it: TimelineItem): string {
  if (it.tagId) return db.tags.find((t) => t.id === it.tagId)?.name || '(deleted tag)';
  if (it.placeId) return db.places.find((t) => t.id === it.placeId)?.name || '(deleted place)';
  if (it.eventType) return it.text ? `${it.eventType} — ${it.text}` : it.eventType;
  return it.text || '(untitled)';
}

export function itemColor(db: Database, it: TimelineItem, lane?: Lane): string {
  if (it.tagId) return db.tags.find((t) => t.id === it.tagId)?.color || '#888';
  if (lane?.kind === 'locations') return '#3a9d5d';
  if (lane?.kind === 'events') return '#c2414b';
  return '#6b7a8f';
}

export function fmtRange(it: TimelineItem): string {
  if (!it.end) return fmtDate(it.start);
  return `${fmtDate(it.start)} – ${it.end === 'present' ? 'present' : fmtDate(it.end)}`;
}

interface Placed {
  item: TimelineItem;
  s: number;
  e: number;
  row: number;
}

/** Greedy row packing so overlapping items in a lane never cover each other. */
function pack(items: TimelineItem[], ppd: number, db: Database, minDay: number, width: number): { placed: Placed[]; rows: number } {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const rowEnds: number[] = []; // in px
  const placed: Placed[] = [];
  for (const item of sorted) {
    const [s, e] = itemRange(item);
    const barW = (e - s + 1) * ppd;
    const labelW = itemLabel(db, item).length * 6.6 + 22;
    let x0 = (s - minDay) * ppd;
    let x1 = x0 + Math.max(barW, labelW);
    if (!item.end && x0 + labelW + 6 > width) {
      // label will be drawn to the left of the dot (see `flip` below)
      x1 = x0 + 8;
      x0 -= labelW;
    }
    let row = rowEnds.findIndex((end) => end <= x0 - 4);
    if (row < 0) {
      row = rowEnds.length;
      rowEnds.push(0);
    }
    rowEnds[row] = x1;
    placed.push({ item, s, e, row });
  }
  return { placed, rows: Math.max(1, rowEnds.length) };
}

interface Tick {
  day: number;
  label: string;
  major: boolean;
}

function ticksFor(from: number, to: number, ppd: number): Tick[] {
  const ticks: Tick[] = [];
  const startDate = new Date(from * 86400000);
  const yearPx = 365 * ppd;
  if (yearPx < 400) {
    // year ticks, labelled every N years so labels don't collide
    const step = yearPx > 60 ? 1 : yearPx > 25 ? 5 : 10;
    for (let y = startDate.getUTCFullYear(); ; y++) {
      const d = Math.floor(Date.UTC(y, 0, 1) / 86400000);
      if (d > to) break;
      if (d >= from) ticks.push({ day: d, label: y % step === 0 ? String(y) : '', major: y % step === 0 });
    }
  } else if (ppd < 20) {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let y = startDate.getUTCFullYear(), m = startDate.getUTCMonth(); ; m++) {
      const d = Math.floor(Date.UTC(y, m, 1) / 86400000);
      if (d > to) break;
      const mm = ((m % 12) + 12) % 12;
      const yy = y + Math.floor(m / 12);
      if (d >= from) ticks.push({ day: d, label: mm === 0 ? `${names[mm]} ${yy}` : names[mm], major: mm === 0 });
    }
  } else {
    for (let d = from; d <= to; d++) {
      const dt = new Date(d * 86400000);
      const dom = dt.getUTCDate();
      ticks.push({
        day: d,
        label: dom === 1 || d === from ? fmtDate(fromDayNum(d)).replace(/,.*/, '') : String(dom),
        major: dom === 1,
      });
    }
  }
  return ticks;
}

export function Timeline({ person }: { person: Person }) {
  const db = useDB();
  const [ppd, setPpd] = useState(0.35);
  const [editing, setEditing] = useState<TimelineItem | null>(null);
  const [view, setView] = useState<'lanes' | 'list'>('lanes');
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 800 });
  const pendingAnchor = useRef<{ day: number; px: number } | null>(null);

  const items = useMemo(() => db.timeline.filter((t) => t.personId === person.id), [db.timeline, person.id]);
  const today = dayNum(todayISO());

  // Visible span: earliest of items / birthday / entry creation, through today (+ margin).
  const [minDay, maxDay] = useMemo(() => {
    let lo = dayNum(person.createdAt.slice(0, 10));
    let hi = today;
    if (person.birthday && !person.birthday.startsWith('--')) lo = Math.min(lo, dayNum(person.birthday));
    for (const it of items) {
      const [s, e] = itemRange(it);
      lo = Math.min(lo, s);
      hi = Math.max(hi, e);
    }
    return [lo - 60, hi + 90];
  }, [items, person.birthday, person.createdAt, today]);

  const width = (maxDay - minDay + 1) * ppd;

  const lanes = db.lanes.map((lane) => {
    const laneItems = items.filter((i) => i.laneId === lane.id);
    const { placed, rows } = pack(laneItems, ppd, db, minDay, width);
    return { lane, placed, rows };
  });

  // Track the visible window so we only render ticks that are on screen.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => setViewport({ left: el.scrollLeft, width: el.clientWidth });
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  // Open each person zoomed to fit their whole timeline.
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id]);

  // Keep the day under the cursor / centre fixed while zooming.
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = pendingAnchor.current;
    if (el && a) {
      el.scrollLeft = (a.day - minDay) * ppd - a.px;
      pendingAnchor.current = null;
    }
  }, [ppd, minDay]);

  const zoomTo = (next: number, anchorPx?: number) => {
    const el = scroller.current;
    if (!el) return setPpd(next);
    const px = anchorPx ?? el.clientWidth / 2;
    pendingAnchor.current = { day: minDay + (el.scrollLeft + px) / ppd, px };
    setPpd(Math.min(80, Math.max(0.01, next)));
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomTo(ppd * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX - rect.left);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  function fit() {
    const el = scroller.current;
    if (!el) return;
    const next = (el.clientWidth - 10) / (maxDay - minDay + 1);
    pendingAnchor.current = { day: minDay, px: 0 };
    setPpd(Math.min(40, next));
  }

  const visFrom = minDay + Math.floor(viewport.left / ppd) - 2;
  const visTo = minDay + Math.ceil((viewport.left + viewport.width) / ppd) + 2;
  const ticks = ticksFor(Math.max(minDay, visFrom), Math.min(maxDay, visTo), ppd);
  const x = (day: number) => (day - minDay) * ppd;

  const newItem = (lane: Lane, day: number): TimelineItem => ({
    id: '',
    personId: person.id,
    laneId: lane.id,
    start: fromDayNum(day),
    end: lane.kind === 'events' ? '' : 'present',
    note: '',
    ...(lane.kind === 'events' ? { eventType: '' } : {}),
  });

  const sortedItems = [...items].sort((a, b) => b.start.localeCompare(a.start));
  const birthdayDay = person.birthday && !person.birthday.startsWith('--') ? dayNum(person.birthday) : null;

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <div className="seg">
          <button className={view === 'lanes' ? 'on' : ''} onClick={() => setView('lanes')}>Lanes</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
        </div>
        {view === 'lanes' && (
          <>
            <div className="seg">
              {ZOOMS.map((z) => (
                <button key={z.name} className={Math.abs(Math.log(ppd / z.ppd)) < 0.4 ? 'on' : ''} onClick={() => zoomTo(z.ppd)}>
                  {z.name}
                </button>
              ))}
            </div>
            <button onClick={() => zoomTo(ppd * 0.6)} title="Zoom out">−</button>
            <button onClick={() => zoomTo(ppd * 1.6)} title="Zoom in">+</button>
            <button onClick={fit}>Fit</button>
            <span className="muted small hide-narrow">Ctrl + scroll to zoom · click a lane to add</span>
          </>
        )}
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing(newItem(db.lanes[0], today))}>+ Add to timeline</button>
      </div>

      {view === 'lanes' ? (
        <div className="tl-frame">
          <div className="tl-labels" style={{ width: LANE_LABEL_W }}>
            <div style={{ height: AXIS_H }} />
            {lanes.map(({ lane, rows }) => (
              <div key={lane.id} className="tl-lane-label" style={{ height: rows * ROW_H + LANE_PAD * 2 }}>
                {lane.name}
              </div>
            ))}
          </div>
          <div className="tl-scroll" ref={scroller}>
            <div className="tl-canvas" style={{ width }}>
              <div className="tl-axis" style={{ height: AXIS_H }}>
                {ticks.map((t) => (
                  <div key={t.day} className={`tl-tick ${t.major ? 'major' : ''}`} style={{ left: x(t.day) }}>
                    {t.label && <span>{t.label}</span>}
                  </div>
                ))}
                {birthdayDay !== null && birthdayDay >= minDay && (
                  <div className="tl-marker birth" style={{ left: x(birthdayDay) }} title={`Born ${fmtDate(person.birthday)}`}>★</div>
                )}
              </div>
              {ticks.filter((t) => t.major).map((t) => (
                <div key={`g${t.day}`} className="tl-grid" style={{ left: x(t.day), top: AXIS_H }} />
              ))}
              <div className="tl-today" style={{ left: x(today) + ppd / 2, top: AXIS_H }} title="Today" />
              {lanes.map(({ lane, placed, rows }) => (
                <div
                  key={lane.id}
                  className="tl-lane"
                  style={{ height: rows * ROW_H + LANE_PAD * 2 }}
                  onClick={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    setEditing(newItem(lane, minDay + Math.floor((e.clientX - rect.left) / ppd)));
                  }}
                >
                  {placed.map(({ item, s, e, row }) => {
                    const point = !item.end;
                    const label = itemLabel(db, item);
                    const color = itemColor(db, item, lane);
                    const w = Math.max((e - s + 1) * ppd, point ? 0 : 3);
                    const labelW = label.length * 6.6 + 12;
                    const packW = label.length * 6.6 + 22;
                    // Keep a long bar's label in view while its start is scrolled off to the left.
                    const shift = point ? 0 : Math.max(0, Math.min(viewport.left - x(s), w - labelW));
                    // Point labels near the right edge go on the left of the dot.
                    const flip = point && x(s) + packW + 6 > width;
                    return (
                      <button
                        key={item.id}
                        className={`tl-item ${point ? 'point' : 'bar'} ${item.end === 'present' ? 'ongoing' : ''} ${flip ? 'flip' : ''}`}
                        style={{ left: x(s), top: LANE_PAD + row * ROW_H, ['--c' as string]: color, ['--w' as string]: `${w}px`, ['--shift' as string]: `${shift}px` }}
                        title={`${label}\n${fmtRange(item)}${item.note ? `\n${item.note}` : ''}`}
                        onClick={() => setEditing(item)}
                      >
                        {point ? <span className="tl-dot" /> : <span className="tl-bar" />}
                        <span className="tl-text">{label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="tl-list">
          {sortedItems.length === 0 && <p className="muted">Nothing on the timeline yet.</p>}
          {sortedItems.map((it) => {
            const lane = db.lanes.find((l) => l.id === it.laneId);
            return (
              <button key={it.id} className="tl-list-row" onClick={() => setEditing(it)}>
                <span className="dot" style={{ background: itemColor(db, it, lane) }} />
                <span className="tl-list-date">{fmtRange(it)}</span>
                <span className="tl-list-lane muted">{lane?.name}</span>
                <span className="tl-list-label">{itemLabel(db, it)}</span>
                {it.note && <span className="muted small">{it.note}</span>}
              </button>
            );
          })}
        </div>
      )}

      {editing && <TimelineItemEditor item={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
