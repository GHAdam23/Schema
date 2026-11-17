import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlockObj, Connection, Endpoint, Id, Page, PageObject, Project, RectObj, TextObj } from '../model/types';
import { PAGE_SIZES, drawingArea } from '../model/defaults';
import { blockFor, blockSize, BLK, portAnchor, portRowRect } from '../model/blockGeometry';
import {
  autoBends,
  axisOf,
  objBounds,
  pathLength,
  projectOnPath,
  rawPoints,
  resolveEndpoint,
  resolvePageRoutes,
  simplify,
  STUB,
  type Anchor,
  type Pt,
  type ResolvedRoute,
} from '../model/routing';
import { buildPage, labelBox, labelTAt, TEXT_PAD } from '../render/buildPage';
import { SvgItems } from '../render/SvgRender';
import { checkpoint, currentPage, dropCheckpointIfUnchanged, getState, setState, toast, updateProject, useStore } from '../state/store';
import { addRect, addText, autoStraighten, connect, connectionWarnings, patchConnections, patchObjects, placeBlock, renameDevice } from '../state/actions';
import { hitObject, hitPort, outlinePoint, portZones, type PortHit } from './hitTest';

interface View {
  z: number;
  px: number;
  py: number;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type Drag =
  | { t: 'marquee'; start: Pt; cur: Pt; base: Id[] }
  | { t: 'move'; start: Pt; ids: Id[]; orig: Map<Id, Pt>; moved: boolean; clickId: Id | null; additive: boolean; wasSelected: boolean }
  | { t: 'resize'; id: Id; handle: Handle; start: Pt; orig: PageObject; origSize: { w: number; h: number } }
  | { t: 'connect'; from: Endpoint; start: Pt; cur: Pt; moved: boolean; port: PortHit | null; additive: 'none' | 'shift' | 'ctrl' }
  | { t: 'segment'; connId: Id; seg: number; start: Pt; bends: number[]; moved: boolean }
  | { t: 'label'; connId: Id; moved: boolean }
  | { t: 'pan'; sx: number; sy: number; orig: View };

interface Editing {
  kind: 'text' | 'device' | 'label';
  id: Id;
  /** Text typed to start the edit (replaces the current value). */
  typed?: string;
}

interface Guide {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const DRAG_THRESHOLD = 3;

export function Canvas() {
  const project = useStore((s) => s.project);
  const pageId = useStore((s) => s.pageId);
  const selection = useStore((s) => s.selection);
  const selectedPorts = useStore((s) => s.selectedPorts);
  const prefs = useStore((s) => s.prefs);
  const tool = useStore((s) => s.tool);
  const page = project.pages.find((p) => p.id === pageId) ?? project.pages[0];
  const pageIndex = project.pages.indexOf(page);
  const size = PAGE_SIZES[page.size];

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ z: 1, px: 40, py: 40 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [guides, setGuides] = useState<Guide[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [hoverPort, setHoverPort] = useState<PortHit | null>(null);
  const spaceDown = useRef(false);
  const lastPortClick = useRef<PortHit | null>(null);

  const items = useMemo(() => buildPage(project, page, { pageIndex: pageIndex + 1, pageCount: project.pages.length }), [project, page, pageIndex]);
  const routes = useMemo(() => resolvePageRoutes(project, page), [project, page]);

  // ------------------------------------------------------------------------------------------
  // View

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const z = Math.min((r.width - 40) / size.w, (r.height - 40) / size.h);
    setView({ z, px: (r.width - size.w * z) / 2, py: (r.height - size.h * z) / 2 });
  }, [size.w, size.h]);

  useEffect(() => {
    fit();
  }, [pageId, fit]);

  useEffect(() => {
    const onView = (e: Event) => {
      const d = (e as CustomEvent).detail as string;
      if (d === 'fit') fit();
      else if (d === 'in' || d === 'out' || d === '100') {
        const el = wrapRef.current!;
        const r = el.getBoundingClientRect();
        zoomAt(r.width / 2, r.height / 2, d === 'in' ? 1.25 : d === 'out' ? 0.8 : 1 / viewRef.current.z);
      }
    };
    window.addEventListener('schema:view', onView);
    // Start inline editing from the keyboard (type on a selected line to label it, Enter/F2 to edit).
    const onEdit = (e: Event) => {
      const d = (e as CustomEvent).detail as Editing;
      setEditing(d);
    };
    window.addEventListener('schema:edit', onEdit);
    return () => {
      window.removeEventListener('schema:view', onView);
      window.removeEventListener('schema:edit', onEdit);
    };
  }, [fit]);

  const zoomAt = (sx: number, sy: number, factor: number) => {
    setView((v) => {
      const z = Math.min(8, Math.max(0.1, v.z * factor));
      const f = z / v.z;
      return { z, px: sx - (sx - v.px) * f, py: sy - (sy - v.py) * f };
    });
  };

  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0025));
      else setView((v) => ({ ...v, px: v.px - (e.shiftKey ? e.deltaY : e.deltaX), py: v.py - (e.shiftKey ? 0 : e.deltaY) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea')) spaceDown.current = true;
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  const toPage = (cx: number, cy: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.px) / v.z, y: (cy - r.top - v.py) / v.z };
  };

  const grid = prefs.gridSize;
  const snapV = (v: number) => (prefs.snap ? Math.round(v / grid) * grid : v);

  // ------------------------------------------------------------------------------------------
  // Pointer handling

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing && document.querySelector('.inline-editor')) {
      // Clicking the canvas finishes an inline edit (blur commits it).
      (document.activeElement as HTMLElement | null)?.blur?.();
      setEditing(null);
      return;
    }
    const p = toPage(e.clientX, e.clientY);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      setDrag({ t: 'pan', sx: e.clientX, sy: e.clientY, orig: viewRef.current });
      return;
    }
    if (e.button !== 0) return;
    const s = getState();
    const pg = currentPage(s);
    const target = e.target as Element;
    const hit = (target.closest('[data-hit]') as HTMLElement | null)?.dataset ?? {};
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    if (s.tool === 'text' || s.tool === 'rect') {
      const id = s.tool === 'text' ? addText(snapV(p.x), snapV(p.y)) : addRect(snapV(p.x), snapV(p.y));
      setState({ tool: 'select' });
      if (s.tool === 'text') setEditing({ kind: 'text', id });
      return;
    }

    if (hit.hit === 'handle') {
      const id = s.selection[0];
      const o = pg.objects.find((x) => x.id === id);
      if (!o) return;
      checkpoint();
      const b = objBounds(s.project, o);
      setDrag({ t: 'resize', id, handle: hit.handle as Handle, start: p, orig: o, origSize: { w: b.w, h: b.h } });
      return;
    }
    if (hit.hit === 'label') {
      checkpoint();
      setState({ selection: [hit.id!], selectedPorts: [] });
      setDrag({ t: 'label', connId: hit.id!, moved: false });
      return;
    }
    if (hit.hit === 'seg') {
      const r = routes.get(hit.id!);
      if (!r) return;
      if (additive) {
        toggleSel(hit.id!);
        return;
      }
      if (!s.selection.includes(hit.id!)) setState({ selection: [hit.id!], selectedPorts: [] });
      checkpoint();
      setDrag({ t: 'segment', connId: hit.id!, seg: Number(hit.seg), start: p, bends: [...r.bends], moved: false });
      return;
    }
    const port = hitPort(s.project, pg, p.x, p.y);
    if (port) {
      setDrag({
        t: 'connect',
        from: { objId: port.objId, portId: port.portId },
        start: p,
        cur: p,
        moved: false,
        port,
        additive: e.shiftKey ? 'shift' : e.ctrlKey || e.metaKey ? 'ctrl' : 'none',
      });
      return;
    }
    const obj = hitObject(s.project, pg, p.x, p.y, 0, false, 5 / viewRef.current.z);
    if (obj) {
      // Alt-drag from a shape starts a connection from its outline.
      if (e.altKey && obj.kind !== 'block') {
        const b = objBounds(s.project, obj);
        setDrag({ t: 'connect', from: { objId: obj.id, ...outlinePoint(b, p.x, p.y) }, start: p, cur: p, moved: false, port: null, additive: 'none' });
        return;
      }
      let sel = s.selection;
      const wasSelected = sel.includes(obj.id);
      if (additive) {
        if (!sel.includes(obj.id)) sel = [...sel, obj.id];
      } else if (!sel.includes(obj.id)) sel = [obj.id];
      setState({ selection: sel, selectedPorts: [] });
      const ids = sel.filter((id) => pg.objects.some((o) => o.id === id));
      const orig = new Map<Id, Pt>();
      for (const o of pg.objects) if (ids.includes(o.id)) orig.set(o.id, { x: o.x, y: o.y });
      setDrag({ t: 'move', start: p, ids, orig, moved: false, clickId: obj.id, additive, wasSelected });
      return;
    }
    // Empty space: marquee
    if (!additive) setState({ selection: [], selectedPorts: [] });
    setDrag({ t: 'marquee', start: p, cur: p, base: additive ? s.selection : [] });
  };

  const toggleSel = (id: Id) => {
    const s = getState();
    setState({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toPage(e.clientX, e.clientY);
    setState({ pointer: p });
    const d = dragRef.current;
    const s = getState();
    const pg = currentPage(s);
    if (!d) {
      if (!editing) setHoverPort(hitPort(s.project, pg, p.x, p.y));
      return;
    }
    const z = viewRef.current.z;
    switch (d.t) {
      case 'pan': {
        setView({ ...d.orig, px: d.orig.px + e.clientX - d.sx, py: d.orig.py + e.clientY - d.sy });
        return;
      }
      case 'marquee': {
        const nd = { ...d, cur: p };
        setDrag(nd);
        const r = normRect(d.start, p);
        // Drag left-to-right: select what is fully inside. Right-to-left: anything touched.
        const crossing = p.x < d.start.x;
        const inRect = (q: Pt) => q.x >= r.x && q.y >= r.y && q.x <= r.x + r.w && q.y <= r.y + r.h;
        const inside = pg.objects
          .filter((o) => {
            const b = objBounds(s.project, o);
            if (crossing) return b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y;
            return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
          })
          .map((o) => o.id);
        const conns = pg.connections
          .filter((c) => {
            const rt = routes.get(c.id);
            if (!rt) return false;
            if (!crossing) return rt.pts.every(inRect);
            return rt.pts.some((q, i) => i > 0 && segHitsRect(rt.pts[i - 1], q, r));
          })
          .map((c) => c.id);
        setState({ selection: [...new Set([...d.base, ...inside, ...conns])] });
        return;
      }
      case 'move': {
        let dx = p.x - d.start.x;
        let dy = p.y - d.start.y;
        if (!d.moved) {
          if (Math.hypot(dx * z, dy * z) < DRAG_THRESHOLD) return;
          checkpoint();
          d.moved = true;
        }
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const snapped = snapMove(s.project, pg, d.ids, d.orig, dx, dy, z);
        setGuides(snapped.guides);
        updateProject((dr) => {
          const pgd = dr.pages.find((x) => x.id === pg.id)!;
          for (const o of pgd.objects) {
            const op = d.orig.get(o.id);
            if (op) {
              o.x = op.x + snapped.dx;
              o.y = op.y + snapped.dy;
            }
          }
        }, false);
        return;
      }
      case 'resize': {
        resizeTo(d, p, e.shiftKey);
        return;
      }
      case 'connect': {
        const moved = d.moved || Math.hypot((p.x - d.start.x) * z, (p.y - d.start.y) * z) >= DRAG_THRESHOLD;
        setDrag({ ...d, cur: p, moved });
        const hp = hitPort(s.project, pg, p.x, p.y);
        // Any port except the one we started from (same-device jumpers are allowed).
        setHoverPort(hp && !(hp.objId === d.from.objId && hp.portId === (d.from as { portId?: string }).portId) ? hp : null);
        return;
      }
      case 'segment': {
        const dd = Math.hypot((p.x - d.start.x) * z, (p.y - d.start.y) * z);
        if (!d.moved && dd < DRAG_THRESHOLD) return;
        d.moved = true;
        dragSegment(d, p);
        return;
      }
      case 'label': {
        const r = routes.get(d.connId);
        if (!r) return;
        d.moved = true;
        const L = pathLength(r.pts);
        let t = L > 0 ? projectOnPath(r.pts, p) / L : 0.5;
        // Snap the label centre in line with other labels (same x on horizontal runs, same y on vertical runs).
        const me = labelBox({ ...r, conn: { ...r.conn, labelT: t } });
        const gs: Guide[] = [];
        if (me && s.prefs.smartGuides) {
          const tol = 6 / z;
          let best: { d: number; v: number } | null = null;
          for (const [id, other] of routes) {
            if (id === d.connId) continue;
            const ob = labelBox(other);
            if (!ob || ob.horiz !== me.horiz) continue;
            const v = me.horiz ? ob.p.x : ob.p.y;
            const dd = Math.abs((me.horiz ? me.p.x : me.p.y) - v);
            if (dd < tol && (!best || dd < best.d)) best = { d: dd, v };
          }
          if (best) {
            const st = labelTAt(r, me.horiz ? 'x' : 'y', best.v, me.p);
            if (st !== null) {
              t = st;
              gs.push(me.horiz ? { x1: best.v, y1: 0, x2: best.v, y2: 3000 } : { x1: 0, y1: best.v, x2: 3000, y2: best.v });
            }
          }
        }
        setGuides(gs);
        patchConnections([d.connId], (c) => void (c.labelT = Math.min(0.99, Math.max(0.01, t))), false);
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    setDrag(null);
    setGuides([]);
    if (!d) return;
    const s = getState();
    const pg = currentPage(s);
    const p = toPage(e.clientX, e.clientY);
    switch (d.t) {
      case 'move':
        if (!d.moved && !d.additive && d.clickId) setState({ selection: [d.clickId] });
        if (!d.moved && d.additive && d.clickId && d.wasSelected) toggleSel(d.clickId);
        break;
      case 'resize':
      case 'segment':
      case 'label':
        dropCheckpointIfUnchanged();
        break;
      case 'connect': {
        if (!d.moved) {
          if (d.port) clickPort(d.port, d.additive);
          break;
        }
        const hp = hitPort(s.project, pg, p.x, p.y);
        let to: Endpoint | null = null;
        const fromPort = (d.from as { portId?: string }).portId;
        if (hp && !(hp.objId === d.from.objId && hp.portId === fromPort)) to = { objId: hp.objId, portId: hp.portId };
        else {
          const o = hitObject(s.project, pg, p.x, p.y, 4, true);
          if (o && o.kind !== 'block' && o.id !== d.from.objId) to = { objId: o.id, ...outlinePoint(objBounds(s.project, o), p.x, p.y) };
        }
        if (to) {
          const id = connect(d.from, to);
          if (id) {
            autoStraighten(id);
            setState({ selection: [id], selectedPorts: [] });
          }
        }
        break;
      }
    }
  };

  const clickPort = (ph: PortHit, mode: 'none' | 'shift' | 'ctrl') => {
    const s = getState();
    const pg = currentPage(s);
    let ports = s.selectedPorts;
    if (mode === 'none') ports = [{ objId: ph.objId, portId: ph.portId }];
    else if (mode === 'ctrl') {
      ports = ports.some((x) => x.portId === ph.portId && x.objId === ph.objId)
        ? ports.filter((x) => !(x.portId === ph.portId && x.objId === ph.objId))
        : [...ports, { objId: ph.objId, portId: ph.portId }];
    } else {
      // Shift: select the run from the last clicked port (same block + column) to this one.
      const last = lastPortClick.current;
      const o = pg.objects.find((x) => x.id === ph.objId) as BlockObj | undefined;
      const def = o && blockFor(s.project, o).def;
      if (last && def && last.objId === ph.objId && last.side === ph.side) {
        const col = ph.side === 'L' ? def.left : def.right;
        const [a, b] = [Math.min(last.index, ph.index), Math.max(last.index, ph.index)];
        const run = col.slice(a, b + 1).map((pt) => ({ objId: ph.objId, portId: pt.id }));
        ports = [...ports.filter((x) => !run.some((r) => r.portId === x.portId && r.objId === x.objId)), ...run];
      } else ports = [...ports, { objId: ph.objId, portId: ph.portId }];
    }
    if (mode !== 'shift') lastPortClick.current = ph;
    const objIds = [...new Set(ports.map((x) => x.objId))];
    setState({ selectedPorts: ports, selection: objIds });
  };

  const resizeTo = (d: Extract<Drag, { t: 'resize' }>, p: Pt, keepAspect: boolean) => {
    const o = d.orig;
    const b = { x: o.x, y: o.y, w: d.origSize.w, h: d.origSize.h };
    let x1 = b.x;
    let y1 = b.y;
    let x2 = b.x + b.w;
    let y2 = b.y + b.h;
    const h = d.handle;
    if (h.includes('w')) x1 = snapV(p.x);
    if (h.includes('e')) x2 = snapV(p.x);
    if (h.includes('n')) y1 = snapV(p.y);
    if (h.includes('s')) y2 = snapV(p.y);
    if (o.kind === 'block') {
      // Uniform scale, anchored at the opposite corner.
      const sx = (x2 - x1) / b.w;
      const sy = (y2 - y1) / b.h;
      const f = h === 'e' || h === 'w' ? sx : h === 'n' || h === 's' ? sy : Math.max(sx, sy);
      const scale = Math.min(4, Math.max(0.3, Math.round(o.scale * f * 100) / 100));
      const nw = (b.w / o.scale) * scale;
      const nh = (b.h / o.scale) * scale;
      patchObjects(
        [d.id],
        (t) => {
          if (t.kind !== 'block') return;
          t.scale = scale;
          t.x = h.includes('w') ? b.x + b.w - nw : b.x;
          t.y = h.includes('n') ? b.y + b.h - nh : b.y;
        },
        false,
      );
      return;
    }
    if (keepAspect && b.w > 0 && b.h > 0) {
      const ar = b.w / b.h;
      const w = Math.abs(x2 - x1);
      const hh = Math.abs(y2 - y1);
      if (w / hh > ar) {
        const nh = w / ar;
        if (h.includes('n')) y1 = y2 - nh;
        else y2 = y1 + nh;
      } else {
        const nw = hh * ar;
        if (h.includes('w')) x1 = x2 - nw;
        else x2 = x1 + nw;
      }
    }
    const r = normRect({ x: x1, y: y1 }, { x: x2, y: y2 });
    patchObjects(
      [d.id],
      (t) => {
        if (t.kind === 'block') return;
        t.x = r.x;
        t.y = r.y;
        t.w = Math.max(6, r.w);
        t.h = Math.max(6, r.h);
      },
      false,
    );
  };

  const dragSegment = (d: Extract<Drag, { t: 'segment' }>, p: Pt) => {
    const s = getState();
    const pg = currentPage(s);
    const c = pg.connections.find((x) => x.id === d.connId);
    if (!c) return;
    const sA = resolveEndpoint(s.project, pg, c.from);
    const eA = resolveEndpoint(s.project, pg, c.to);
    if (!sA || !eA) return;
    let bends = [...d.bends];
    let seg = d.seg;
    const n = bends.length;
    const raw = rawPoints(sA, eA, bends);
    const a = raw[seg];
    const b = raw[seg + 1];
    const horiz = Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) > 1e-6;
    const coord = snapV(horiz ? p.y : p.x);
    if (seg === 0) {
      // Dragging the fixed first segment inserts a jog next to the start anchor.
      const stub = axisOf(sA) === 'h' ? sA.x + sA.dx * STUB : sA.y + sA.dy * STUB;
      bends = [stub, coord, ...bends];
      seg = 2;
      d.bends = bends;
      d.seg = seg;
    } else if (seg === n + 1) {
      const stub = axisOf(eA) === 'h' ? eA.x + eA.dx * STUB : eA.y + eA.dy * STUB;
      bends = [...bends, coord, stub];
      seg = n + 1;
      d.bends = bends;
      d.seg = seg;
    } else {
      bends[seg - 1] = coord;
    }
    patchConnections([d.connId], (cc) => void (cc.bends = bends), false);
  };

  // ------------------------------------------------------------------------------------------
  // Drop from library panel

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-schema-block')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-schema-block');
    if (!id) return;
    e.preventDefault();
    const def = getState().library.find((l) => l.id === id);
    if (!def) return;
    const p = toPage(e.clientX, e.clientY);
    placeBlock(def, snapV(p.x), snapV(p.y));
  };

  // ------------------------------------------------------------------------------------------
  // Double-click editing

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toPage(e.clientX, e.clientY);
    const s = getState();
    const pg = currentPage(s);
    const hit = ((e.target as Element).closest('[data-hit]') as HTMLElement | null)?.dataset ?? {};
    if (hit.hit === 'seg' || hit.hit === 'label') {
      setEditing({ kind: 'label', id: hit.id! });
      return;
    }
    const o = hitObject(s.project, pg, p.x, p.y, 0, true);
    if (!o) return;
    if (o.kind === 'text' || o.kind === 'rect') setEditing({ kind: 'text', id: o.id });
    else if (o.kind === 'block') setEditing({ kind: 'device', id: o.id });
  };

  // ------------------------------------------------------------------------------------------
  // Render

  const z = view.z;
  const selSet = new Set(selection);
  const selectedObjs = page.objects.filter((o) => selSet.has(o.id));
  const area = drawingArea(page.size);

  let preview: string | null = null;
  if (drag?.t === 'connect' && drag.moved) {
    const sA = resolveEndpoint(project, page, drag.from);
    if (sA) {
      const hp = hoverPort;
      let eA: Anchor | null = null;
      if (hp) eA = resolveEndpoint(project, page, { objId: hp.objId, portId: hp.portId });
      if (!eA) {
        const horizontal = axisOf(sA) === 'h';
        eA = horizontal
          ? { x: drag.cur.x, y: drag.cur.y, dx: drag.cur.x > sA.x ? -1 : 1, dy: 0 }
          : { x: drag.cur.x, y: drag.cur.y, dx: 0, dy: drag.cur.y > sA.y ? -1 : 1 };
      }
      const pts = simplify(rawPoints(sA, eA, autoBends(sA, eA)));
      preview = pts.map((q, i) => `${i ? 'L' : 'M'}${q.x} ${q.y}`).join('');
    }
  }

  const previewWarn =
    drag?.t === 'connect' && hoverPort ? connectionWarnings(project, page, drag.from, { objId: hoverPort.objId, portId: hoverPort.portId }) : [];

  return (
    <div
      ref={wrapRef}
      className={'canvas-wrap' + (tool !== 'select' ? ' tool-' + tool : '')}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ cursor: drag?.t === 'pan' ? 'grabbing' : undefined }}
    >
      <svg
        ref={svgRef}
        className="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="grid" width={grid} height={grid} patternUnits="userSpaceOnUse" x={area.x} y={area.y}>
            <path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" stroke="#dde3ea" strokeWidth={0.5 / z} />
          </pattern>
          <filter id="pageShadow" x="-5%" y="-5%" width="110%" height="110%">
            <feDropShadow dx="0" dy="1" stdDeviation="3" floodOpacity="0.25" />
          </filter>
        </defs>
        <g transform={`translate(${view.px} ${view.py}) scale(${z})`}>
          <rect x={0} y={0} width={size.w} height={size.h} fill="#fff" filter="url(#pageShadow)" />
          {prefs.showGrid && <rect x={area.x} y={area.y} width={area.w} height={area.h} fill="url(#grid)" />}
          <SvgItems items={items} assets={project.assets} />
          <Overlay
            project={project}
            page={page}
            z={z}
            selection={selSet}
            selectedObjs={selectedObjs}
            routes={routes}
            selectedPorts={selectedPorts}
            hoverPort={hoverPort}
            connecting={drag?.t === 'connect'}
          />
          {preview && <path d={preview} fill="none" stroke={previewWarn.length ? '#d97706' : '#2563eb'} strokeWidth={1 / z} strokeDasharray={`${4 / z} ${3 / z}`} pointerEvents="none" />}
          {drag?.t === 'marquee' && (
            <rect
              x={normRect(drag.start, drag.cur).x}
              y={normRect(drag.start, drag.cur).y}
              width={normRect(drag.start, drag.cur).w}
              height={normRect(drag.start, drag.cur).h}
              fill={drag.cur.x < drag.start.x ? 'rgba(22,163,74,0.08)' : 'rgba(37,99,235,0.08)'}
              stroke={drag.cur.x < drag.start.x ? '#16a34a' : '#2563eb'}
              strokeDasharray={drag.cur.x < drag.start.x ? `${4 / z} ${3 / z}` : undefined}
              strokeWidth={1 / z}
              pointerEvents="none"
            />
          )}
          {guides.map((g, i) => (
            <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#e11d48" strokeWidth={0.75 / z} strokeDasharray={`${3 / z} ${2 / z}`} pointerEvents="none" />
          ))}
        </g>
      </svg>
      {previewWarn.length > 0 && <div className="canvas-hint warn">{previewWarn.join(' ')}</div>}
      {editing && <InlineEditor key={JSON.stringify(editing)} editing={editing} view={view} onDone={() => setEditing(null)} />}
    </div>
  );
}

function segHitsRect(a: Pt, b: Pt, r: { x: number; y: number; w: number; h: number }) {
  // Orthogonal segment vs rectangle.
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 >= r.x && x0 <= r.x + r.w && y1 >= r.y && y0 <= r.y + r.h;
}

function normRect(a: Pt, b: Pt) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// ---------------------------------------------------------------------------------------------
// Snapping: smart guides (edges, centres, port rows) then grid.

function snapMove(project: Project, page: Page, ids: Id[], orig: Map<Id, Pt>, dx: number, dy: number, z: number) {
  const s = getState();
  const prefs = s.prefs;
  const idSet = new Set(ids);
  const moving = page.objects.filter((o) => idSet.has(o.id));
  if (!moving.length) return { dx, dy, guides: [] as Guide[] };
  const bounds = moving.map((o) => {
    const op = orig.get(o.id)!;
    const b = objBounds(project, o);
    return { ...b, x: op.x, y: op.y, o };
  });
  const bx = Math.min(...bounds.map((b) => b.x));
  const by = Math.min(...bounds.map((b) => b.y));
  const bx2 = Math.max(...bounds.map((b) => b.x + b.w));
  const by2 = Math.max(...bounds.map((b) => b.y + b.h));
  const guides: Guide[] = [];
  let sdx = dx;
  let sdy = dy;
  let snappedX = false;
  let snappedY = false;

  // 1) Lines attached to what's moving: snap so they come out perfectly straight. This wins
  //    over everything else and has a generous catch zone, so small jogs are never left behind.
  if (prefs.snap || prefs.smartGuides) {
    const tol = Math.max(10 / z, BLK.rowH * 0.8);
    let best: { d: number; v: number; at: number; x1: number; x2: number } | null = null;
    for (const c of page.connections) {
      const fromMoving = idSet.has(c.from.objId);
      const toMoving = idSet.has(c.to.objId);
      if (fromMoving === toMoving) continue;
      const sA = resolveEndpoint(project, page, c.from);
      const eA = resolveEndpoint(project, page, c.to);
      if (!sA || !eA || axisOf(sA) !== 'h' || axisOf(eA) !== 'h') continue;
      const mine = fromMoving ? sA : eA;
      const other = fromMoving ? eA : sA;
      const movedObj = page.objects.find((o) => o.id === (fromMoving ? c.from.objId : c.to.objId))!;
      const op = orig.get(movedObj.id)!;
      const myY0 = mine.y - (movedObj.y - op.y); // anchor y at drag start
      const d = Math.abs(myY0 + dy - other.y);
      if (d < tol && (!best || d < best.d)) best = { d, v: other.y - myY0, at: other.y, x1: Math.min(mine.x, other.x), x2: Math.max(mine.x, other.x) };
    }
    if (best) {
      sdy = best.v;
      snappedY = true;
      guides.push({ x1: best.x1 - 20, y1: best.at, x2: best.x2 + 20, y2: best.at });
    }
  }

  if (prefs.smartGuides) {
    const tol = 6 / z;
    const others = page.objects.filter((o) => !idSet.has(o.id)).map((o) => ({ o, b: objBounds(project, o) }));
    const xs: number[] = [];
    const ys: number[] = [];
    const portYs: number[] = [];
    for (const { o, b } of others) {
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
      if (o.kind === 'block') portYs.push(...blockPortYs(project, o));
    }
    // Also align ports with the far ends of lines attached to the moving blocks.
    const myX = [bx, (bx + bx2) / 2, bx2];
    const myY = [by, (by + by2) / 2, by2];
    const myPortY: number[] = [];
    for (const b of bounds) if (b.o.kind === 'block') myPortY.push(...blockPortYs(project, { ...b.o, x: b.x, y: b.y } as BlockObj));

    let best = { d: tol, v: 0, at: 0 };
    for (const mx of myX) for (const ox of xs) {
      const d = Math.abs(mx + dx - ox);
      if (d < best.d) best = { d, v: ox - mx, at: ox };
    }
    if (best.d < tol) {
      sdx = best.v;
      snappedX = true;
      guides.push({ x1: best.at, y1: 0, x2: best.at, y2: 2000 });
    }
    best = { d: tol, v: 0, at: 0 };
    if (!snappedY) {
    // Port rows first (they matter most for straight lines).
    for (const my of myPortY) for (const oy of portYs) {
      const d = Math.abs(my + dy - oy);
      if (d < best.d) best = { d, v: oy - my, at: oy };
    }
    if (best.d >= tol)
      for (const my of myY) for (const oy of ys) {
        const d = Math.abs(my + dy - oy);
        if (d < best.d) best = { d, v: oy - my, at: oy };
      }
      if (best.d < tol) {
        sdy = best.v;
        snappedY = true;
        guides.push({ x1: 0, y1: best.at, x2: 3000, y2: best.at });
      }
    }
  }
  if (prefs.snap) {
    const g = prefs.gridSize;
    if (!snappedX) sdx = Math.round((bx + dx) / g) * g - bx;
    if (!snappedY) sdy = Math.round((by + dy) / g) * g - by;
  }
  return { dx: sdx, dy: sdy, guides };
}

function blockPortYs(project: Project, o: BlockObj): number[] {
  const { def } = blockFor(project, o);
  if (!def) return [];
  const n = Math.max(def.left.length, def.right.length);
  return Array.from({ length: n }, (_, i) => o.y + (BLK.headerH + i * BLK.rowH + BLK.rowH / 2) * o.scale);
}

// ---------------------------------------------------------------------------------------------
// Overlay: hit targets + selection visuals

function Overlay(props: {
  project: Project;
  page: Page;
  z: number;
  selection: Set<Id>;
  selectedObjs: PageObject[];
  routes: Map<Id, ResolvedRoute>;
  selectedPorts: { objId: Id; portId: Id }[];
  hoverPort: PortHit | null;
  connecting: boolean;
}) {
  const { project, page, z, selection, selectedObjs, routes, selectedPorts, hoverPort, connecting } = props;
  const hs = 6 / z;
  const sw = 1 / z;
  return (
    <g>
      {/* Connection hit targets */}
      {page.connections.map((c) => {
        const r = routes.get(c.id);
        if (!r) return null;
        return (
          <g key={c.id}>
            {r.raw.slice(1).map((b, i) => {
              const a = r.raw[i];
              if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 1e-6) return null;
              return <line key={i} data-hit="seg" data-id={c.id} data-seg={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={8 / z} style={{ cursor: segCursor(r, i) }} />;
            })}
          </g>
        );
      })}
      {/* Selected connections */}
      {page.connections
        .filter((c) => selection.has(c.id))
        .map((c) => {
          const r = routes.get(c.id);
          if (!r) return null;
          const lb = labelBox(r);
          return (
            <g key={c.id} pointerEvents="none">
              <path d={r.pts.map((q, i) => `${i ? 'L' : 'M'}${q.x} ${q.y}`).join('')} fill="none" stroke="#2563eb" strokeOpacity={0.45} strokeWidth={3 / z} />
              {r.raw.slice(1).map((b, i) => {
                const a = r.raw[i];
                if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 4 / z) return null;
                return <rect key={i} x={(a.x + b.x) / 2 - hs / 2} y={(a.y + b.y) / 2 - hs / 2} width={hs} height={hs} fill="#fff" stroke="#2563eb" strokeWidth={sw} />;
              })}
              <circle cx={r.s.x} cy={r.s.y} r={2.5 / z} fill="#2563eb" />
              <circle cx={r.e.x} cy={r.e.y} r={2.5 / z} fill="#2563eb" />
              {lb && <rect x={lb.box.x} y={lb.box.y} width={lb.box.w} height={lb.box.h} fill="none" stroke="#2563eb" strokeWidth={sw} strokeDasharray={`${2 / z} ${2 / z}`} />}
            </g>
          );
        })}
      {/* Label hit targets (above segments) */}
      {page.connections.map((c) => {
        const r = routes.get(c.id);
        const lb = r && labelBox(r);
        if (!lb) return null;
        return <rect key={c.id} data-hit="label" data-id={c.id} x={lb.box.x} y={lb.box.y} width={lb.box.w} height={lb.box.h} fill="transparent" style={{ cursor: 'move' }} />;
      })}
      {/* Port hover / selection */}
      {selectedPorts.map((sp) => {
        const o = page.objects.find((x) => x.id === sp.objId);
        if (!o || o.kind !== 'block') return null;
        const zone = portZones(project, o).find((zz) => zz.hit.portId === sp.portId);
        if (!zone) return null;
        const rr = portRowRect(project, o, zone.hit.side, zone.hit.index);
        return rr && <rect key={sp.objId + sp.portId} {...rr} width={rr.w} height={rr.h} fill="rgba(37,99,235,0.18)" stroke="#2563eb" strokeWidth={sw} pointerEvents="none" />;
      })}
      {hoverPort &&
        (() => {
          const o = page.objects.find((x) => x.id === hoverPort.objId) as BlockObj | undefined;
          if (!o) return null;
          const a = portAnchor(project, o, hoverPort.portId);
          const rr = portRowRect(project, o, hoverPort.side, hoverPort.index);
          return (
            <g pointerEvents="none">
              {rr && <rect x={rr.x} y={rr.y} width={rr.w} height={rr.h} fill={connecting ? 'rgba(22,163,74,0.18)' : 'rgba(37,99,235,0.08)'} />}
              {a && <circle cx={a.x} cy={a.y} r={3 / z} fill={connecting ? '#16a34a' : '#2563eb'} />}
            </g>
          );
        })()}
      {/* Selected objects */}
      {selectedObjs.map((o) => {
        const b = objBounds(project, o);
        return <rect key={o.id} x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="#2563eb" strokeWidth={sw} pointerEvents="none" />;
      })}
      {selectedObjs.length === 1 && <Handles project={project} o={selectedObjs[0]} z={z} />}
    </g>
  );
}

function segCursor(r: ResolvedRoute, i: number) {
  const a = r.raw[i];
  const b = r.raw[i + 1];
  return Math.abs(a.y - b.y) < 1e-6 ? 'ns-resize' : 'ew-resize';
}

function Handles({ project, o, z }: { project: Project; o: PageObject; z: number }) {
  const b = objBounds(project, o);
  const hs = 7 / z;
  const all: [Handle, number, number, string][] = [
    ['nw', b.x, b.y, 'nwse-resize'],
    ['n', b.x + b.w / 2, b.y, 'ns-resize'],
    ['ne', b.x + b.w, b.y, 'nesw-resize'],
    ['e', b.x + b.w, b.y + b.h / 2, 'ew-resize'],
    ['se', b.x + b.w, b.y + b.h, 'nwse-resize'],
    ['s', b.x + b.w / 2, b.y + b.h, 'ns-resize'],
    ['sw', b.x, b.y + b.h, 'nesw-resize'],
    ['w', b.x, b.y + b.h / 2, 'ew-resize'],
  ];
  const hs2 = o.kind === 'block' ? all.filter((h) => h[0].length === 2) : all;
  return (
    <g>
      {hs2.map(([h, x, y, cur]) => (
        <rect key={h} data-hit="handle" data-handle={h} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} fill="#fff" stroke="#2563eb" strokeWidth={1 / z} style={{ cursor: cur }} />
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------------------------
// Inline editor (text boxes, device names, line labels)

function InlineEditor({ editing, view, onDone }: { editing: Editing; view: View; onDone: () => void }) {
  const s = getState();
  const pg = currentPage(s);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (editing.typed !== undefined) el.setSelectionRange(el.value.length, el.value.length);
    else el.select();
  }, []);
  let rect = { x: 0, y: 0, w: 120, h: 20 };
  let initial = '';
  let fontSize = 9;
  let commit: (v: string) => void = () => {};
  const tr = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x * view.z + view.px, y: r.y * view.z + view.py, w: r.w * view.z, h: r.h * view.z });

  if (editing.kind === 'text') {
    const o = pg.objects.find((x) => x.id === editing.id) as TextObj | RectObj | undefined;
    if (!o) return null;
    rect = tr({ x: o.x, y: o.y, w: o.w, h: Math.max(o.h, 20) });
    initial = o.text;
    fontSize = o.fontSize * view.z;
    commit = (v) => patchObjects([o.id], (t) => void ((t.kind === 'text' || t.kind === 'rect') && (t.text = v)));
  } else if (editing.kind === 'device') {
    const o = pg.objects.find((x) => x.id === editing.id) as BlockObj | undefined;
    if (!o) return null;
    const dev = s.project.devices[o.deviceId];
    const sz = blockSize(s.project, o);
    const fh = BLK.footerH * o.scale;
    rect = tr({ x: o.x, y: o.y + sz.h - fh, w: sz.w, h: fh });
    initial = dev?.name ?? '';
    fontSize = Math.max(10, BLK.footerSize * o.scale * view.z);
    commit = (v) => {
      const name = v.trim();
      if (name && dev && name !== dev.name) {
        if (Object.values(getState().project.devices).some((d) => d.name === name && d.id !== dev.id)) toast(`Another device is already named "${name}".`, 'warn');
        renameDevice(dev.id, name);
      }
    };
  } else {
    const c = pg.connections.find((x) => x.id === editing.id) as Connection | undefined;
    const r = c && resolvePageRoutes(s.project, pg).get(c.id);
    if (!c || !r) return null;
    const lb = labelBox({ ...r, conn: { ...c, label: c.label || 'X' } });
    const at = lb?.p ?? r.pts[0];
    rect = tr({ x: at.x - 40, y: at.y - 7, w: 80, h: 14 });
    initial = editing.typed ?? c.label;
    fontSize = Math.max(11, 7 * view.z);
    commit = (v) => patchConnections([c.id], (cc) => void (cc.label = v.trim()));
  }

  const finish = (save: boolean) => {
    if (save && ref.current) commit(ref.current.value);
    onDone();
  };

  const style: React.CSSProperties = {
    left: rect.x,
    top: rect.y,
    width: Math.max(rect.w, 80),
    height: editing.kind === 'text' ? Math.max(rect.h, 24) : undefined,
    fontSize,
    padding: editing.kind === 'text' ? TEXT_PAD * view.z : 2,
  };
  if (editing.kind === 'text')
    return (
      <textarea
        ref={ref}
        className="inline-editor"
        style={style}
        defaultValue={initial}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') finish(false);
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true);
        }}
      />
    );
  return (
    <input
      ref={ref}
      className="inline-editor"
      style={{ ...style, textAlign: 'center' }}
      defaultValue={initial}
      placeholder={editing.kind === 'label' ? 'Label' : 'Device name'}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish(false);
        if (e.key === 'Enter') finish(true);
      }}
    />
  );
}
