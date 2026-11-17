import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlockObj, Connection, Endpoint, Id, LineGlue, Page, PageObject, Project, TagObj, TextualObj } from '../model/types';
import type { Tool } from '../state/store';
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
import { buildPage, calloutTip, withLabelT, fitTextBox, labelBox, labelBoxes, labelTAt, naturalTextSize, TEXT_PAD, textBoxOf } from '../render/buildPage';
import { SvgItems } from '../render/SvgRender';
import { checkpoint, currentPage, labelLast, nextLabel, dropCheckpointIfUnchanged, getState, setState, updateProject, useStore } from '../state/store';
import {
  addCallout,
  addContainer,
  addEllipse,
  addRect,
  addLine,
  defaultTail,
  addTag,
  addText,
  lineBox,
  lineEnds,
  tagsFromElsewhere,
  applyCarry,
  unglueMoved,
  autoStraighten,
  connect,
  connectPairs,
  describeObject,
  connectionWarnings,
  jumpToTag,
  patchBundles,
  patchConnections,
  patchObjects,
  placeBlock,
  placeInstance,
  renameDevice,
  routesToCarry,
  withContents,
  type Carry,
} from '../state/actions';
import { importMedia } from '../state/fileOps';
import { centre, fromLocal, localBox, normDeg, objCorners, rotatePt, rotOf, toLocal } from '../model/geom';
import { tagRowFit, tagSize } from '../model/tags';
import { isMediaFile } from '../io/importMedia';
import { isPortEndpoint } from '../model/types';
import { dotPos, hitObject, hitPort, hitShape, hitShapeDot, outlinePointOf, portZones, SIDE_CENTRES, type PortHit, type ShapeDot } from './hitTest';

interface View {
  z: number;
  px: number;
  py: number;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type Drag =
  | { t: 'marquee'; start: Pt; cur: Pt; base: Id[]; touch: boolean; enclose?: boolean }
  | { t: 'move'; start: Pt; ids: Id[]; orig: Map<Id, Pt>; moved: boolean; clickId: Id | null; additive: boolean; wasSelected: boolean; carry: Carry }
  | { t: 'resize'; id: Id; handle: Handle; start: Pt; orig: PageObject; origSize: { w: number; h: number } }
  | { t: 'rotate'; id: Id; c: Pt; start: number; orig: number }
  | { t: 'tail'; id: Id }
  /** Dragging one end of a drawn line/arrow; `fixed` is the other end. `fresh`: being drawn now. */
  | { t: 'lineEnd'; id: Id; fixed: Pt; fresh: boolean; end: 0 | 1 }
  /** Dragging out a new shape with a drawing tool (created once the drag starts). */
  | { t: 'draw'; tool: Tool; start: Pt; id: Id | null }
  | { t: 'connect'; from: Endpoint; start: Pt; cur: Pt; moved: boolean; port: PortHit | null; additive: 'none' | 'shift' | 'ctrl'; multi?: PortHit[] }
  | { t: 'segment'; connId: Id; seg: number; start: Pt; bends: number[]; moved: boolean }
  | { t: 'label'; connId: Id; idx: number; moved: boolean }
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
  // Shape under the pointer (shows its connection dots) and the dot that would be used.
  const [hoverShape, setHoverShape] = useState<{ id: Id; dot: ShapeDot | null } | null>(null);
  // Object a callout's pointer would glue to while it's being dragged.
  const [tailHover, setTailHover] = useState<Id | null>(null);
  // Where a line/arrow end being dragged has snapped onto a shape.
  const [lineSnap, setLineSnap] = useState<Pt | null>(null);
  const spaceDown = useRef(false);
  const lastPortClick = useRef<PortHit | null>(null);

  const items = useMemo(() => buildPage(project, page, { pageIndex: pageIndex + 1, pageCount: project.pages.length }), [project, page, pageIndex]);
  const routes = useMemo(() => resolvePageRoutes(project, page), [project, page]);
  const elsewhere = useMemo(() => portsUsedElsewhere(project, pageIndex), [project, pageIndex]);

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
    // Pan: middle or right drag, Space+drag, the Hand tool, or dragging the grey area around the page.
    const offPage = p.x < 0 || p.y < 0 || p.x > size.w || p.y > size.h;
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (spaceDown.current || getState().tool === 'pan' || offPage))) {
      setDrag({ t: 'pan', sx: e.clientX, sy: e.clientY, orig: viewRef.current });
      return;
    }
    if (e.button !== 0) return;
    const s = getState();
    const pg = currentPage(s);
    const target = e.target as Element;
    const hit = (target.closest('[data-hit]') as HTMLElement | null)?.dataset ?? {};
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    if (s.tool !== 'select' && s.tool !== 'pan') {
      const x = snapV(p.x);
      const y = snapV(p.y);
      // A drawing tool is used once, then it's back to Select.
      const tool = s.tool;
      if (tool === 'line' || tool === 'arrow' || tool === 'arrow2') {
        // Drag to draw; a plain click makes a 1-inch horizontal one. Ends snap (and stay glued) to shapes and lines (Alt = off).
        const sn = e.altKey ? null : snapTarget(s.project, pg, routes, p, 8 / viewRef.current.z, null);
        const at = sn?.q ?? { x, y };
        const id = addLine(at.x, at.y, at.x, at.y, tool === 'line' ? 'none' : tool === 'arrow' ? 'end' : 'both');
        if (sn) patchObjects([id], (t) => void (t.kind === 'line' && (t.ends = [sn.glue, null])), false);
        setState({ tool: 'select' });
        setDrag({ t: 'lineEnd', id, fixed: at, fresh: true, end: 1 });
        return;
      }
      if (tool === 'tag') {
        setState({ tool: 'select', modal: { kind: 'tagTarget', objId: addTag(x, y), isNew: true } });
        return;
      }
      // Shapes: drag out to size (Shift = square / circle); a plain click gives the default size.
      setDrag({ t: 'draw', tool, start: { x, y }, id: null });
      return;
    }

    if (hit.hit === 'rotate') {
      const o = pg.objects.find((x) => x.id === hit.id);
      if (!o) return;
      checkpoint('Rotate ' + describeObject(s.project, o));
      const c = centre(localBox(s.project, o));
      setDrag({ t: 'rotate', id: o.id, c, start: angleDeg(c, p), orig: rotOf(o) });
      return;
    }
    if (hit.hit === 'elsewhere') {
      tagsFromElsewhere(hit.id!, hit.port!);
      return;
    }
    if (hit.hit === 'lineEnd') {
      const o = pg.objects.find((x) => x.id === hit.id);
      if (!o || o.kind !== 'line') return;
      checkpoint('Move end of ' + describeObject(s.project, o).toLowerCase());
      const end = hit.end === '0' ? 0 : 1;
      setDrag({ t: 'lineEnd', id: o.id, fixed: lineEnds(o)[1 - end], fresh: false, end });
      return;
    }
    if (hit.hit === 'tail') {
      checkpoint('Move callout pointer');
      setDrag({ t: 'tail', id: hit.id! });
      return;
    }
    if (hit.hit === 'handle') {
      const id = s.selection[0];
      const o = pg.objects.find((x) => x.id === id);
      if (!o) return;
      checkpoint('Resize ' + describeObject(s.project, o));
      const b = localBox(s.project, o);
      setDrag({ t: 'resize', id, handle: hit.handle as Handle, start: p, orig: o, origSize: { w: b.w, h: b.h } });
      return;
    }
    if (hit.hit === 'label') {
      setState({ selection: [hit.id!], selectedPorts: [] });
      // Labels in a snake sit in the middle of their legs.
      if (routes.get(hit.id!)?.legs) return;
      checkpoint('Move line label');
      setDrag({ t: 'label', connId: hit.id!, idx: Number(hit.idx ?? 0), moved: false });
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
      // Curves, snake legs and bars aren't rerouted by dragging.
      if (hit.fixed) return;
      checkpoint(r.trunk ? 'Reroute snake' : 'Reroute line');
      setDrag({ t: 'segment', connId: hit.id!, seg: Number(hit.seg), start: p, bends: [...r.bends], moved: false });
      return;
    }
    // Dragging from a rectangle / text box connection dot starts a line from that side.
    const dot = hitShapeDot(s.project, pg, p.x, p.y, 7 / viewRef.current.z);
    if (dot && !hitPort(s.project, pg, p.x, p.y)) {
      setDrag({ t: 'connect', from: { objId: dot.objId, fx: dot.fx, fy: dot.fy }, start: p, cur: p, moved: false, port: null, additive: 'none' });
      return;
    }
    const port = hitPort(s.project, pg, p.x, p.y);
    if (port) {
      // Dragging one of several selected ports on a block takes them all along (Q-SYS style).
      const sel = s.selectedPorts;
      const blockObj = pg.objects.find((o) => o.id === port.objId);
      const multi =
        !e.shiftKey && !e.ctrlKey && !e.metaKey && sel.length > 1 && sel.every((x) => x.objId === port.objId) && sel.some((x) => x.portId === port.portId) && blockObj?.kind === 'block'
          ? portZones(s.project, blockObj).map((zz) => zz.hit).filter((h) => sel.some((x) => x.portId === h.portId))
          : undefined;
      setDrag({
        t: 'connect',
        from: { objId: port.objId, portId: port.portId },
        start: p,
        cur: p,
        moved: false,
        port,
        additive: e.shiftKey ? 'shift' : e.ctrlKey || e.metaKey ? 'ctrl' : 'none',
        multi,
      });
      return;
    }
    const obj = hitObject(s.project, pg, p.x, p.y);
    if (obj) {
      // Alt-drag starting on an object (e.g. inside a rack / room frame) draws a selection box
      // instead of moving it; it selects what's fully inside.
      if (e.altKey) {
        if (!additive) setState({ selection: [], selectedPorts: [] });
        setDrag({ t: 'marquee', start: p, cur: p, base: additive ? s.selection : [], touch: false, enclose: true });
        return;
      }
      let sel = s.selection;
      const wasSelected = sel.includes(obj.id);
      if (additive) {
        if (!sel.includes(obj.id)) sel = [...sel, obj.id];
      } else if (!sel.includes(obj.id)) sel = [obj.id];
      setState({ selection: sel, selectedPorts: [] });
      // Containers carry what's inside them; manual routes between moving objects move along.
      const ids = withContents(s.project, pg, sel.filter((id) => pg.objects.some((o) => o.id === id)));
      const orig = new Map<Id, Pt>();
      for (const o of pg.objects) if (ids.includes(o.id)) orig.set(o.id, { x: o.x, y: o.y });
      setDrag({ t: 'move', start: p, ids, orig, moved: false, clickId: obj.id, additive, wasSelected, carry: routesToCarry(s.project, pg, ids) });
      return;
    }
    // Empty space: marquee
    if (!additive) setState({ selection: [], selectedPorts: [] });
    setDrag({ t: 'marquee', start: p, cur: p, base: additive ? s.selection : [], touch: e.altKey });
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
      if (!editing && s.tool === 'select') {
        const hp = hitPort(s.project, pg, p.x, p.y);
        setHoverPort(hp);
        const z0 = viewRef.current.z;
        const dot = hp ? null : hitShapeDot(s.project, pg, p.x, p.y, 7 / z0);
        const sh = hp ? null : dot ? { id: dot.objId } : hitShape(s.project, pg, p.x, p.y, 10 / z0);
        setHoverShape(sh ? { id: sh.id, dot } : null);
      }
      return;
    }
    const z = viewRef.current.z;
    switch (d.t) {
      case 'pan': {
        setView({ ...d.orig, px: d.orig.px + e.clientX - d.sx, py: d.orig.py + e.clientY - d.sy });
        return;
      }
      case 'marquee': {
        const nd = { ...d, cur: p, touch: e.altKey && !d.enclose };
        setDrag(nd);
        const r = normRect(d.start, p);
        // Like PowerPoint: select what is fully inside, in any drag direction. Hold Alt to select anything touched.
        const crossing = nd.touch;
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
          const movedObjs = pg.objects.filter((o) => d.ids.includes(o.id));
          checkpoint(movedObjs.length === 1 ? 'Move ' + describeObject(s.project, movedObjs[0]) : `Move ${movedObjs.length} objects`);
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
          applyCarry(pgd, d.carry, snapped.dx, snapped.dy);
          unglueMoved(pgd, new Set(d.ids));
        }, false);
        return;
      }
      case 'rotate': {
        let r = d.orig + angleDeg(d.c, p) - d.start;
        if (e.shiftKey) r = Math.round(r / 15) * 15;
        else {
          // Gentle pull to square angles.
          const sq = Math.round(r / 90) * 90;
          if (Math.abs(r - sq) < 4) r = sq;
        }
        r = Math.round(normDeg(r) * 10) / 10;
        patchObjects([d.id], (o) => void (o.kind !== 'block' && o.kind !== 'tag' && (o.rot = r)), false);
        return;
      }
      case 'lineEnd': {
        let q = e.shiftKey ? p : { x: snapV(p.x), y: snapV(p.y) };
        if (e.shiftKey) {
          // 15° steps around the fixed end.
          const len = Math.hypot(p.x - d.fixed.x, p.y - d.fixed.y);
          const a = (Math.round((Math.atan2(p.y - d.fixed.y, p.x - d.fixed.x) * 180) / Math.PI / 15) * 15 * Math.PI) / 180;
          q = { x: d.fixed.x + Math.cos(a) * len, y: d.fixed.y + Math.sin(a) * len };
        }
        // Snap the end onto a shape (corner, side centre, outline) or a line, and glue it there (Alt = free).
        const sn = e.altKey ? null : snapTarget(s.project, pg, routes, p, 8 / z, d.id);
        setLineSnap(sn?.q ?? null);
        if (sn) q = sn.q;
        const box = d.end === 0 ? lineBox(q.x, q.y, d.fixed.x, d.fixed.y) : lineBox(d.fixed.x, d.fixed.y, q.x, q.y);
        patchObjects(
          [d.id],
          (t) => {
            if (t.kind !== 'line') return;
            Object.assign(t, box);
            const ends: [LineGlue | null, LineGlue | null] = [...(t.ends ?? [null, null])] as [LineGlue | null, LineGlue | null];
            ends[d.end] = sn?.glue ?? null;
            t.ends = ends[0] || ends[1] ? ends : undefined;
          },
          false,
        );
        return;
      }
      case 'draw': {
        const z0 = viewRef.current.z;
        if (!d.id && Math.hypot(p.x - d.start.x, p.y - d.start.y) * z0 < DRAG_THRESHOLD * 2) return;
        // Shift: equal sides (circle / square).
        let w = snapV(p.x) - d.start.x;
        let h = snapV(p.y) - d.start.y;
        if (e.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * m;
          h = Math.sign(h || 1) * m;
        }
        const r = normRect(d.start, { x: d.start.x + w, y: d.start.y + h });
        r.w = Math.max(6, r.w);
        r.h = Math.max(6, r.h);
        if (!d.id) {
          const t = d.tool;
          d.id =
            t === 'text' ? addText(r.x, r.y, 'Text', r.w, r.h)
            : t === 'rect' ? addRect(r.x, r.y, r.w, r.h)
            : t === 'ellipse' ? addEllipse(r.x, r.y, r.w, r.h)
            : t === 'container' ? addContainer(r.x, r.y, r.w, r.h)
            : addCallout(r.x, r.y, t === 'cloud' ? 'cloud' : 'box', r.w, r.h);
          return;
        }
        patchObjects([d.id], (o) => void (o.kind !== 'block' && o.kind !== 'tag' && Object.assign(o, r)), false);
        return;
      }
      case 'tail': {
        const o = pg.objects.find((x) => x.id === d.id);
        if (!o || o.kind !== 'callout') return;
        // The tip follows the pointer; over another object (or a line) it will glue to it on release.
        const target = hitObjectExcept(s.project, pg, p, o.id)?.id ?? nearestLine(routes, p, 6 / z)?.id ?? null;
        setTailHover(target);
        patchObjects(
          [d.id],
          (t) => {
            if (t.kind !== 'callout') return;
            t.tail = { x: Math.round(p.x - t.x), y: Math.round(p.y - t.y) };
            delete t.tailTo;
          },
          false,
        );
        return;
      }
      case 'resize': {
        resizeTo(d, p, e.shiftKey, e.altKey);
        return;
      }
      case 'connect': {
        const moved = d.moved || Math.hypot((p.x - d.start.x) * z, (p.y - d.start.y) * z) >= DRAG_THRESHOLD;
        setDrag({ ...d, cur: p, moved });
        const hp = hitPort(s.project, pg, p.x, p.y);
        // Any port except the one we started from (same-device jumpers are allowed).
        const okPort = hp && !(hp.objId === d.from.objId && hp.portId === (d.from as { portId?: string }).portId) ? hp : null;
        setHoverPort(okPort);
        // Over a rectangle / text box: show its dots and the side the line will attach to.
        const sh = okPort ? null : hitShape(s.project, pg, p.x, p.y, 6 / z);
        if (sh && sh.id !== d.from.objId) setHoverShape({ id: sh.id, dot: { objId: sh.id, ...outlinePointOf(s.project, sh, p.x, p.y) } });
        else setHoverShape(null);
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
        const me = labelBoxes({ ...r, conn: withLabelT(r.conn, d.idx, t) })[d.idx];
        const gs: Guide[] = [];
        if (me && s.prefs.smartGuides) {
          const tol = 6 / z;
          let best: { d: number; v: number } | null = null;
          for (const [id, other] of routes) {
            if (id === d.connId) continue;
            for (const ob of labelBoxes(other)) {
              if (ob.horiz !== me.horiz) continue;
              const v = me.horiz ? ob.p.x : ob.p.y;
              const dd = Math.abs((me.horiz ? me.p.x : me.p.y) - v);
              if (dd < tol && (!best || dd < best.d)) best = { d: dd, v };
            }
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
        const tt = Math.min(0.99, Math.max(0.01, t));
        patchConnections([d.connId], (c) => void Object.assign(c, withLabelT(c, d.idx, tt)), false);
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    setDrag(null);
    setGuides([]);
    if (d?.t === 'connect') setHoverShape(null);
    if (!d) return;
    const s = getState();
    const pg = currentPage(s);
    const p = toPage(e.clientX, e.clientY);
    switch (d.t) {
      case 'move':
        if (!d.moved && !d.additive && d.clickId) setState({ selection: [d.clickId] });
        if (!d.moved && d.additive && d.clickId && d.wasSelected) toggleSel(d.clickId);
        break;
      case 'tail': {
        setTailHover(null);
        const o = pg.objects.find((x) => x.id === d.id);
        const target = o && hitObjectExcept(s.project, pg, p, o.id);
        const line = o && !target ? nearestLine(routes, p, 6 / viewRef.current.z) : null;
        if (target) {
          const b = localBox(s.project, target);
          const q = toLocal(s.project, target, p);
          patchObjects([d.id], (t) => void (t.kind === 'callout' && (t.tailTo = { objId: target.id, fx: (q.x - b.x) / b.w, fy: (q.y - b.y) / b.h })), false);
          labelLast('Point callout at ' + describeObject(s.project, target));
        } else if (line && !line.trunk) {
          patchObjects([d.id], (t) => void (t.kind === 'callout' && (t.tailTo = { connId: line.id, t: line.t })), false);
          labelLast('Point callout at a line');
        }
        dropCheckpointIfUnchanged();
        break;
      }
      case 'draw': {
        setState({ tool: 'select' });
        let id = d.id;
        const t = d.tool;
        if (!id) {
          // A click: the default size at that point.
          const { x, y } = d.start;
          id =
            t === 'text' ? addText(x, y)
            : t === 'rect' ? addRect(x, y)
            : t === 'ellipse' ? addEllipse(x, y)
            : t === 'container' ? addContainer(x, y)
            : addCallout(x, y, t === 'cloud' ? 'cloud' : 'box');
        } else if (t === 'callout' || t === 'cloud') {
          // Point the new callout from its final size.
          patchObjects([id], (o) => void (o.kind === 'callout' && (o.tail = defaultTail(t === 'cloud', o.w, o.h))), false);
        }
        if (t === 'text' || t === 'callout' || t === 'cloud') setEditing({ kind: 'text', id });
        break;
      }
      case 'lineEnd': {
        setLineSnap(null);
        const o = pg.objects.find((x) => x.id === d.id);
        if (d.fresh && o?.kind === 'line' && o.w < 4) {
          const box = lineBox(d.fixed.x, d.fixed.y, d.fixed.x + 72, d.fixed.y);
          patchObjects([d.id], (t) => void (t.kind === 'line' && Object.assign(t, box)), false);
        }
        if (!d.fresh) dropCheckpointIfUnchanged();
        break;
      }
      case 'resize':
      case 'segment':
      case 'label':
      case 'rotate':
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
          const o = hitShape(s.project, pg, p.x, p.y, 6 / viewRef.current.z);
          if (o && o.id !== d.from.objId) to = { objId: o.id, ...outlinePointOf(s.project, o, p.x, p.y) };
        }
        if (d.multi && hp && d.port) {
          const pairs = multiPairs(s.project, pg, d.multi, d.port, hp);
          connectPairs(pairs.pairs, pairs.skipped);
          break;
        }
        if (to) {
          const id = connect(d.from, to);
          if (id) {
            autoStraighten(id);
            setState({ selection: [id], selectedPorts: [] });
          }
        } else if (isPortEndpoint(d.from) && !hitObject(s.project, pg, p.x, p.y) && Math.hypot(p.x - d.start.x, p.y - d.start.y) * viewRef.current.z > 30) {
          // Released on empty space: end the line in a reference tag and ask where it goes.
          tagAtLineEnd(d.from, p);
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

  const tagAtLineEnd = (from: Endpoint, p: Pt) => {
    const s = getState();
    const pg = currentPage(s);
    const a = resolveEndpoint(s.project, pg, from);
    if (!a) return;
    // Level with the port when close, so the line runs straight.
    const y = Math.abs(p.y - a.y) < 24 ? a.y : p.y;
    const leftOfPort = p.x < a.x;
    const id = addTag(snapV(p.x), y, null);
    // From a port: as tall as its row (in the row's font size), so tags on neighbouring rows don't overlap.
    const blk = pg.objects.find((o) => o.id === from.objId);
    if (blk?.kind === 'block' && Math.abs(p.y - a.y) < 24) updateProject((dr) => void Object.assign(dr.pages.find((x) => x.id === pg.id)!.objects.find((o) => o.id === id)!, tagRowFit(blk.scale)), false);
    const tag = getState().project.pages.find((x) => x.id === pg.id)!.objects.find((o) => o.id === id) as TagObj;
    const sz = tagSize(getState().project, tag);
    updateProject((dr) => {
      const t = dr.pages.find((x) => x.id === pg.id)!.objects.find((o) => o.id === id)!;
      t.y = y - sz.h / 2;
      if (leftOfPort) t.x = snapV(p.x) - sz.w;
    }, false);
    const cid = connect(from, { objId: id, fx: leftOfPort ? 1 : 0, fy: 0.5 }, { record: false, quiet: true });
    if (cid) setState({ selection: [id] });
    setState({ modal: { kind: 'tagTarget', objId: id, isNew: true } });
  };

  const resizeTo = (d: Extract<Drag, { t: 'resize' }>, p: Pt, keepAspect: boolean, altKey = false) => {
    const o = d.orig;
    const b = { x: o.x, y: o.y, w: d.origSize.w, h: d.origSize.h };
    const rot = rotOf(o);
    const c0 = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    // Rotated shapes resize in their own frame; snapping only applies when upright.
    const q = rotatePt(p, c0, -rot);
    const sv = (v: number) => (rot ? v : snapV(v));
    let x1 = b.x;
    let y1 = b.y;
    let x2 = b.x + b.w;
    let y2 = b.y + b.h;
    const h = d.handle;
    if (h.includes('w')) x1 = sv(q.x);
    if (h.includes('e')) x2 = sv(q.x);
    if (h.includes('n')) y1 = sv(q.y);
    if (h.includes('s')) y2 = sv(q.y);
    // Images keep their proportions on the corner handles (Shift frees them).
    if (o.kind === 'image' && h.length === 2) keepAspect = !keepAspect;
    if (o.kind === 'block') {
      // Uniform scale, anchored at the opposite corner.
      const sx = (x2 - x1) / b.w;
      const sy = (y2 - y1) / b.h;
      const f = h === 'e' || h === 'w' ? sx : h === 'n' || h === 's' ? sy : Math.max(sx, sy);
      // Snap to other blocks' scales (so rows stay level with them), else to 5% steps; Alt = free.
      let scale = Math.min(4, Math.max(0.3, o.scale * f));
      if (!altKey) {
        const near = currentPage().objects.filter((x): x is BlockObj => x.kind === 'block' && x.id !== o.id).map((x) => x.scale).find((v) => Math.abs(v - scale) < 0.03);
        scale = near ?? Math.round(scale * 20) / 20;
      } else scale = Math.round(scale * 100) / 100;
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
    r.w = Math.max(6, r.w);
    r.h = Math.max(6, r.h);
    // Keep the opposite side fixed on the page: place the new centre through the rotation.
    const cp = rotatePt({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, c0, rot);
    const nx = cp.x - r.w / 2;
    const ny = cp.y - r.h / 2;
    patchObjects(
      [d.id],
      (t) => {
        if (t.kind === 'block' || t.kind === 'tag') return;
        if (t.kind === 'callout' && o.kind === 'callout') {
          // The pointer's tip stays where it is.
          t.tail = { x: Math.round(o.x + o.tail.x - nx), y: Math.round(o.y + o.tail.y - ny) };
        }
        t.x = nx;
        t.y = ny;
        t.w = r.w;
        t.h = r.h;
      },
      false,
    );
  };

  const dragSegment = (d: Extract<Drag, { t: 'segment' }>, p: Pt) => {
    const s = getState();
    const pg = currentPage(s);
    // Lines and snake trunks share the route model; the anchors come from the resolved route.
    const rr = resolvePageRoutes(s.project, pg).get(d.connId);
    if (!rr) return;
    const sA = rr.s;
    const eA = rr.e;
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
    if (rr.trunk) patchBundles([d.connId], (b) => void (b.bends = bends), false);
    else patchConnections([d.connId], (cc) => void (cc.bends = bends), false);
  };

  // ------------------------------------------------------------------------------------------
  // Drop from library panel

  const onDragOver = (e: React.DragEvent) => {
    const t = e.dataTransfer.types;
    if (t.includes('application/x-schema-block') || t.includes('application/x-schema-device') || t.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent) => {
    const p = toPage(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files].filter(isMediaFile);
    if (files.length) {
      e.preventDefault();
      void importMedia(files, { x: snapV(p.x), y: snapV(p.y) });
      return;
    }
    const dev = e.dataTransfer.getData('application/x-schema-device');
    if (dev) {
      e.preventDefault();
      placeInstance(dev, snapV(p.x), snapV(p.y));
      return;
    }
    const id = e.dataTransfer.getData('application/x-schema-block');
    if (!id) return;
    e.preventDefault();
    const def = getState().library.find((l) => l.id === id);
    if (!def) return;
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
    const o = hitObject(s.project, pg, p.x, p.y);
    if (!o) return;
    if (o.kind === 'block') setEditing({ kind: 'device', id: o.id });
    else if (o.kind === 'tag') jumpToTag(o);
    else if ('text' in o) setEditing({ kind: 'text', id: o.id });
  };

  // ------------------------------------------------------------------------------------------
  // Render

  const z = view.z;
  const selSet = new Set(selection);
  const selectedObjs = page.objects.filter((o) => selSet.has(o.id));
  const area = drawingArea(page.size);

  let preview: string | null = null;
  if (drag?.t === 'connect' && drag.moved && drag.multi && drag.port && hoverPort) {
    // Every selected port's line, to consecutive rows from the one under the pointer.
    preview = multiPairs(project, page, drag.multi, drag.port, hoverPort)
      .pairs.map(([a, b]) => {
        const sA = resolveEndpoint(project, page, a);
        const eA = resolveEndpoint(project, page, b);
        return sA && eA ? polyD(simplify(rawPoints(sA, eA, autoBends(sA, eA)))) : '';
      })
      .join('');
  } else if (drag?.t === 'connect' && drag.moved) {
    const sA = resolveEndpoint(project, page, drag.from);
    if (sA) {
      const hp = hoverPort;
      let eA: Anchor | null = null;
      if (hp) eA = resolveEndpoint(project, page, { objId: hp.objId, portId: hp.portId });
      else if (hoverShape?.dot) eA = resolveEndpoint(project, page, hoverShape.dot);
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
      style={{ cursor: drag?.t === 'pan' ? 'grabbing' : tool === 'pan' ? 'grab' : undefined }}
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
            hoverShape={hoverShape}
            connecting={drag?.t === 'connect'}
            elsewhere={elsewhere}
            tailHover={tailHover}
          />
          {preview && <path d={preview} fill="none" stroke={previewWarn.length ? '#d97706' : '#2563eb'} strokeWidth={1 / z} strokeDasharray={`${4 / z} ${3 / z}`} pointerEvents="none" />}
          {drag?.t === 'marquee' && (
            <rect
              x={normRect(drag.start, drag.cur).x}
              y={normRect(drag.start, drag.cur).y}
              width={normRect(drag.start, drag.cur).w}
              height={normRect(drag.start, drag.cur).h}
              fill={drag.touch ? 'rgba(22,163,74,0.08)' : 'rgba(37,99,235,0.08)'}
              stroke={drag.touch ? '#16a34a' : '#2563eb'}
              strokeDasharray={drag.touch ? `${4 / z} ${3 / z}` : undefined}
              strokeWidth={1 / z}
              pointerEvents="none"
            />
          )}
          {lineSnap && <circle cx={lineSnap.x} cy={lineSnap.y} r={4 / z} fill="none" stroke="#16a34a" strokeWidth={1.5 / z} pointerEvents="none" />}
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
    // Bounds can be offset from x/y (rotated shapes).
    return { ...b, x: b.x - o.x + op.x, y: b.y - o.y + op.y, o };
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
    for (const b of bounds) if (b.o.kind === 'block') myPortY.push(...blockPortYs(project, { ...b.o, ...orig.get(b.o.id)! } as BlockObj));

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
// Ports connected on other pages (shown with a small marker; screen only)

type Elsewhere = Map<Id, Map<Id, number[]>>; // deviceId → portId → page numbers (1-based)

function portsUsedElsewhere(project: Project, pageIndex: number): Elsewhere {
  const out: Elsewhere = new Map();
  // Device-level key of a line end ("device:port", or the object for shapes/tags).
  const endKey = (pg: Page, e: Endpoint) => {
    const o = pg.objects.find((x) => x.id === e.objId);
    return o?.kind === 'block' && isPortEndpoint(e) ? `${o.deviceId}:${e.portId}` : e.objId;
  };
  // Connections drawn on this page too (e.g. a copied jumper) aren't "elsewhere".
  const here = new Set<string>();
  const cur = project.pages[pageIndex];
  for (const c of cur?.connections ?? []) {
    const a = endKey(cur, c.from);
    const b = endKey(cur, c.to);
    here.add(a + '|' + b).add(b + '|' + a);
  }
  project.pages.forEach((pg, i) => {
    if (i === pageIndex) return;
    const dev = new Map<Id, Id>();
    for (const o of pg.objects) if (o.kind === 'block') dev.set(o.id, o.deviceId);
    for (const c of pg.connections) {
      if (here.has(endKey(pg, c.from) + '|' + endKey(pg, c.to))) continue;
      for (const e of [c.from, c.to]) {
        if (!isPortEndpoint(e)) continue;
        const d = dev.get(e.objId);
        if (!d) continue;
        if (!out.has(d)) out.set(d, new Map());
        const m = out.get(d)!;
        const list = m.get(e.portId) ?? [];
        if (!list.includes(i + 1)) list.push(i + 1);
        m.set(e.portId, list);
      }
    }
  });
  return out;
}

/** The line (or snake trunk) nearest to a point within `tol`, with the fraction of its length there. */
function nearestLine(routes: Map<Id, ResolvedRoute>, p: Pt, tol: number): { id: Id; t: number; trunk: boolean } | null {
  let best: { id: Id; t: number; trunk: boolean; d: number } | null = null;
  for (const [id, r] of routes) {
    const L = pathLength(r.pts);
    if (!L) continue;
    const dd = projectOnPath(r.pts, p);
    const q = pointAtDist(r.pts, dd);
    const dist = Math.hypot(q.x - p.x, q.y - p.y);
    if (dist <= tol && (!best || dist < best.d)) best = { id, t: dd / L, trunk: !!r.trunk, d: dist };
  }
  return best;
}

function pointAtDist(pts: Pt[], d: number): Pt {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + len >= d) {
      const f = len ? (d - acc) / len : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
    }
    acc += len;
  }
  return pts[pts.length - 1];
}

/** Topmost object under a point other than `except` (blocks, shapes, container frames). */
function hitObjectExcept(project: Project, page: Page, p: Pt, except: Id): PageObject | null {
  const others = { ...page, objects: page.objects.filter((o) => o.id !== except) };
  return hitObject(project, others, p.x, p.y, 2);
}

/**
 * Lines for a multi-port drag: the selected ports in row order go to consecutive rows of the
 * target column, lined up so the dragged port lands on the port under the pointer.
 */
function multiPairs(project: Project, page: Page, multi: PortHit[], dragged: PortHit, target: PortHit) {
  const src = [...multi].sort((a, b) => (a.side === b.side ? a.index - b.index : a.side === 'L' ? -1 : 1));
  const k = src.findIndex((x) => x.portId === dragged.portId);
  const tObj = page.objects.find((o) => o.id === target.objId);
  const def = tObj?.kind === 'block' ? blockFor(project, tObj).def : undefined;
  const col = def ? (target.side === 'L' ? def.left : def.right) : [];
  const pairs: [Endpoint, Endpoint][] = [];
  let skipped = 0;
  src.forEach((x, i) => {
    const p = col[target.index + i - k];
    if (!p) skipped++;
    else pairs.push([{ objId: x.objId, portId: x.portId }, { objId: target.objId, portId: p.id }]);
  });
  return { pairs, skipped };
}

/**
 * Snap target for a drawn line's end, and how it stays glued there: a corner or side centre of a
 * shape / container / block / image, or a drawn line's end (within `tol`); else the nearest point
 * of a shape's outline (ellipses: along the ray from the centre), a drawn line or a connector.
 */
function snapTarget(project: Project, page: Page, routes: Map<Id, ResolvedRoute>, p: Pt, tol: number, except: Id | null): { q: Pt; glue: LineGlue } | null {
  let best: { q: Pt; glue: LineGlue; d: number; prio: number } | null = null;
  const consider = (q: Pt, glue: LineGlue, prio: number) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= tol && (!best || prio < best.prio || (prio === best.prio && d < best.d))) best = { q, glue, d, prio };
  };
  for (const o of page.objects) {
    if (o.id === except) continue;
    const b = localBox(project, o);
    const at = (fx: number, fy: number) => fromLocal(project, o, { x: b.x + fx * b.w, y: b.y + fy * b.h });
    if (o.kind === 'line') {
      // Its two ends, else anywhere along it.
      consider(at(0, 0.5), { objId: o.id, fx: 0, fy: 0.5 }, 0);
      consider(at(1, 0.5), { objId: o.id, fx: 1, fy: 0.5 }, 0);
      const l = toLocal(project, o, p);
      const fx = Math.min(1, Math.max(0, (l.x - b.x) / b.w));
      consider(at(fx, 0.5), { objId: o.id, fx, fy: 0.5 }, 1);
      continue;
    }
    const round = o.kind === 'ellipse';
    for (const [fx, fy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
      if (round && fx !== 0.5 && fy !== 0.5) continue; // an ellipse has no corners
      consider(at(fx, fy), { objId: o.id, fx, fy }, 0);
    }
    // Outline.
    const l = toLocal(project, o, p);
    let on: Pt;
    if (round) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const f = 1 / Math.hypot((l.x - cx) / (b.w / 2), (l.y - cy) / (b.h / 2) || 1e-9);
      on = { x: cx + (l.x - cx) * f, y: cy + (l.y - cy) * f };
    } else {
      const inside = l.x > b.x && l.x < b.x + b.w && l.y > b.y && l.y < b.y + b.h;
      if (inside) {
        const dl = l.x - b.x;
        const dr = b.x + b.w - l.x;
        const dt = l.y - b.y;
        const db = b.y + b.h - l.y;
        const m = Math.min(dl, dr, dt, db);
        on = m === dl ? { x: b.x, y: l.y } : m === dr ? { x: b.x + b.w, y: l.y } : m === dt ? { x: l.x, y: b.y } : { x: l.x, y: b.y + b.h };
      } else on = { x: Math.min(b.x + b.w, Math.max(b.x, l.x)), y: Math.min(b.y + b.h, Math.max(b.y, l.y)) };
    }
    consider(fromLocal(project, o, on), { objId: o.id, fx: (on.x - b.x) / b.w, fy: (on.y - b.y) / b.h }, 1);
  }
  // Connectors (and snake trunks).
  const nl = nearestLine(routes, p, tol);
  if (nl) {
    const r = routes.get(nl.id)!;
    consider(pointAtDist(r.pts, nl.t * pathLength(r.pts)), { connId: nl.id, t: nl.t }, 1);
  }
  return best ? { q: (best as { q: Pt }).q, glue: (best as { glue: LineGlue }).glue } : null;
}

function angleDeg(c: Pt, p: Pt) {
  return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
}

// ---------------------------------------------------------------------------------------------
// Overlay: hit targets + selection visuals

const polyD = (pts: Pt[]) => pts.map((q, i) => `${i ? 'L' : 'M'}${q.x} ${q.y}`).join('');

function Overlay(props: {
  project: Project;
  page: Page;
  z: number;
  selection: Set<Id>;
  selectedObjs: PageObject[];
  routes: Map<Id, ResolvedRoute>;
  selectedPorts: { objId: Id; portId: Id }[];
  hoverPort: PortHit | null;
  hoverShape: { id: Id; dot: ShapeDot | null } | null;
  connecting: boolean;
  elsewhere: Elsewhere;
  tailHover: Id | null;
}) {
  const { project, page, z, selection, selectedObjs, routes, selectedPorts, hoverPort, hoverShape, connecting, elsewhere, tailHover } = props;
  const hs = 6 / z;
  const sw = 1 / z;
  const segHit = (id: Id, a: Pt, b: Pt, i: number, fixed: boolean, cursor?: string) =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 1e-6 ? null : (
      <line
        key={id + ':' + i}
        data-hit="seg"
        data-id={id}
        data-seg={i}
        data-fixed={fixed ? '1' : undefined}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="transparent"
        strokeWidth={8 / z}
        style={{ cursor: cursor ?? 'pointer' }}
      />
    );
  return (
    <g>
      {/* Connection hit targets */}
      {[...routes.values()].map((r) => {
        const id = r.conn.id;
        if (r.legs) return <g key={id}>{r.legs.map((leg, i) => segHit(id, leg[0], leg[1], i, true))}</g>;
        if (r.curve)
          return (
            <g key={id}>
              {r.pts.slice(1).map((b, i) => segHit(id, r.pts[i], b, i, true))}
              {r.trunk?.bars.map((bar, i) => segHit(id, bar[0], bar[1], 1000 + i, true))}
            </g>
          );
        return (
          <g key={id}>
            {r.raw.slice(1).map((b, i) => segHit(id, r.raw[i], b, i, false, segCursor(r, i)))}
            {r.trunk?.bars.map((bar, i) => segHit(id, bar[0], bar[1], 1000 + i, true))}
          </g>
        );
      })}
      {/* Selected connections / snakes */}
      {[...routes.values()]
        .filter((r) => selection.has(r.conn.id))
        .map((r) => {
          const lbs = labelBoxes(r);
          const editable = !r.legs;
          return (
            <g key={r.conn.id} pointerEvents="none">
              <path d={polyD(r.pts)} fill="none" stroke="#2563eb" strokeOpacity={0.45} strokeWidth={(r.trunk ? 5 : 3) / z} />
              {r.trunk?.bars.map((bar, i) => <path key={i} d={polyD(bar)} fill="none" stroke="#2563eb" strokeOpacity={0.45} strokeWidth={5 / z} />)}
              {editable &&
                r.raw.slice(1).map((b, i) => {
                  const a = r.raw[i];
                  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 4 / z) return null;
                  // On a curve the handles (which sit on the curve) are what you drag to reshape it.
                  const drag = r.curve ? { 'data-hit': 'seg', 'data-id': r.conn.id, 'data-seg': i, pointerEvents: 'all', style: { cursor: segCursor(r, i) } } : {};
                  return <rect key={i} x={(a.x + b.x) / 2 - hs / 2} y={(a.y + b.y) / 2 - hs / 2} width={hs} height={hs} fill="#fff" stroke="#2563eb" strokeWidth={sw} {...drag} />;
                })}
              {!r.trunk && <circle cx={r.s.x} cy={r.s.y} r={2.5 / z} fill="#2563eb" />}
              {!r.trunk && <circle cx={r.e.x} cy={r.e.y} r={2.5 / z} fill="#2563eb" />}
              {lbs.map((lb, i) => (
                <rect key={'l' + i} x={lb.box.x} y={lb.box.y} width={lb.box.w} height={lb.box.h} fill="none" stroke="#2563eb" strokeWidth={sw} strokeDasharray={`${2 / z} ${2 / z}`} />
              ))}
            </g>
          );
        })}
      {/* Label hit targets (above segments) */}
      {[...routes.values()].map((r) =>
        labelBoxes(r).map((lb, i) => (
          <rect key={r.conn.id + ':' + i} data-hit="label" data-id={r.conn.id} data-idx={i} x={lb.box.x} y={lb.box.y} width={lb.box.w} height={lb.box.h} fill="transparent" style={{ cursor: r.legs ? 'pointer' : 'move' }} />
        )),
      )}
      {/* (above the line hit targets so they stay clickable) "Used elsewhere": a port of this device is connected on another page */}
      {page.objects.map((o) => {
        if (o.kind !== 'block') return null;
        const m = elsewhere.get(o.deviceId);
        if (!m) return null;
        return [...m.entries()].map(([portId, pages]) => {
          const a = portAnchor(project, o, portId);
          if (!a) return null;
          const r = 1.8 * o.scale;
          const x = a.x + a.dir[0] * (r + 0.8 * o.scale);
          return (
            <circle key={o.id + portId} data-hit="elsewhere" data-id={o.id} data-port={portId} cx={x} cy={a.y} r={Math.max(r, 2.2 / z)} fill="#0ea5e9" stroke="#fff" strokeWidth={0.4 * o.scale} style={{ cursor: 'pointer' }}>
              <title>{`${a.port.name}: also connected on page ${pages.join(', ')} — click to add an off-page reference tag here`}</title>
            </circle>
          );
        });
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
      {hoverShape &&
        (() => {
          const o = page.objects.find((x) => x.id === hoverShape.id);
          if (!o) return null;
          return (
            <g pointerEvents="none">
              {SIDE_CENTRES.map((c, i) => {
                const on = hoverShape.dot && hoverShape.dot.fx === c.fx && hoverShape.dot.fy === c.fy;
                const q = dotPos(project, o, c);
                return (
                  <circle
                    key={i}
                    cx={q.x}
                    cy={q.y}
                    r={(on ? 3.5 : 2.5) / z}
                    fill={on ? (connecting ? '#16a34a' : '#2563eb') : '#fff'}
                    stroke={connecting ? '#16a34a' : '#2563eb'}
                    strokeWidth={1 / z}
                  />
                );
              })}
            </g>
          );
        })()}
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
      {tailHover &&
        (() => {
          const o = page.objects.find((x) => x.id === tailHover);
          const r = !o && routes.get(tailHover);
          if (r) return <path d={polyD(r.pts)} fill="none" stroke="#ca8a04" strokeOpacity={0.6} strokeWidth={4 / z} pointerEvents="none" />;
          return o ? <path d={polyD(objCorners(project, o)) + 'Z'} fill="rgba(250,204,21,0.12)" stroke="#ca8a04" strokeWidth={1.5 / z} strokeDasharray={`${4 / z} ${2 / z}`} pointerEvents="none" /> : null;
        })()}
      {/* Selected objects (outline follows rotation) */}
      {selectedObjs.map((o) =>
        o.kind === 'line' ? (
          <path key={o.id} d={polyD(lineEnds(o))} fill="none" stroke="#2563eb" strokeOpacity={0.45} strokeWidth={3 / z} pointerEvents="none" />
        ) : (
          <path key={o.id} d={polyD(objCorners(project, o)) + 'Z'} fill="none" stroke="#2563eb" strokeWidth={sw} pointerEvents="none" />
        ),
      )}
      {selectedObjs.length === 1 && <Handles project={project} o={selectedObjs[0]} z={z} />}
    </g>
  );
}

function segCursor(r: ResolvedRoute, i: number) {
  const a = r.raw[i];
  const b = r.raw[i + 1];
  return Math.abs(a.y - b.y) < 1e-6 ? 'ns-resize' : 'ew-resize';
}

const HANDLE_CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];

function Handles({ project, o, z }: { project: Project; o: PageObject; z: number }) {
  if (o.kind === 'tag') return null;
  if (o.kind === 'line')
    return (
      <g>
        {lineEnds(o).map((q, i) => (
          <circle key={i} data-hit="lineEnd" data-id={o.id} data-end={i} cx={q.x} cy={q.y} r={4 / z} fill="#fff" stroke="#2563eb" strokeWidth={1 / z} style={{ cursor: 'crosshair' }} />
        ))}
      </g>
    );
  const b = localBox(project, o);
  const rot = rotOf(o);
  const hs = 7 / z;
  const all: [Handle, number, number, number][] = [
    // handle, local x, local y, compass direction (0 = n, 45° steps)
    ['nw', b.x, b.y, 7],
    ['n', b.x + b.w / 2, b.y, 0],
    ['ne', b.x + b.w, b.y, 1],
    ['e', b.x + b.w, b.y + b.h / 2, 2],
    ['se', b.x + b.w, b.y + b.h, 3],
    ['s', b.x + b.w / 2, b.y + b.h, 4],
    ['sw', b.x, b.y + b.h, 5],
    ['w', b.x, b.y + b.h / 2, 6],
  ];
  const hs2 = o.kind === 'block' ? all.filter((h) => h[0].length === 2) : all;
  const at = (x: number, y: number) => fromLocal(project, o, { x, y });
  const rotH = at(b.x + b.w / 2, b.y - 20 / z);
  const topC = at(b.x + b.w / 2, b.y);
  return (
    <g>
      {o.kind !== 'block' && (
        <>
          <line x1={topC.x} y1={topC.y} x2={rotH.x} y2={rotH.y} stroke="#2563eb" strokeWidth={1 / z} pointerEvents="none" />
          <circle data-hit="rotate" data-id={o.id} cx={rotH.x} cy={rotH.y} r={4 / z} fill="#fff" stroke="#2563eb" strokeWidth={1 / z} style={{ cursor: 'grab' }}>
            <title>Rotate (Shift: 15° steps)</title>
          </circle>
        </>
      )}
      {hs2.map(([h, x, y, dir]) => {
        const q = at(x, y);
        const cur = HANDLE_CURSORS[(dir + Math.round(rot / 45)) % 4];
        return (
          <rect
            key={h}
            data-hit="handle"
            data-handle={h}
            x={q.x - hs / 2}
            y={q.y - hs / 2}
            width={hs}
            height={hs}
            fill="#fff"
            stroke="#2563eb"
            strokeWidth={1 / z}
            transform={rot ? `rotate(${rot} ${q.x} ${q.y})` : undefined}
            style={{ cursor: cur }}
          />
        );
      })}
      {o.kind === 'callout' &&
        (() => {
          const q = calloutTip(project, o);
          const r = 4.5 / z;
          return (
            <path
              data-hit="tail"
              data-id={o.id}
              d={`M${q.x} ${q.y - r}L${q.x + r} ${q.y}L${q.x} ${q.y + r}L${q.x - r} ${q.y}Z`}
              fill="#facc15"
              stroke="#a16207"
              strokeWidth={1 / z}
              style={{ cursor: 'move' }}
            >
              <title>{o.tailTo ? 'Glued to an object — drag to move' : 'Drag to point the callout; drop on an object to glue it there'}</title>
            </path>
          );
        })()}
    </g>
  );
}

// ---------------------------------------------------------------------------------------------
// Inline editor (text in shapes, device names, line labels)

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
  let rotate: { deg: number; origin: string } | null = null;
  let commit: (v: string) => void = () => {};
  const tr = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x * view.z + view.px, y: r.y * view.z + view.py, w: r.w * view.z, h: r.h * view.z });

  if (editing.kind === 'text') {
    const o = pg.objects.find((x) => x.id === editing.id) as TextualObj | undefined;
    if (!o || !('text' in o)) return null;
    const tb = o.kind === 'container' ? { ...textBoxOf(o), h: Math.max(textBoxOf(o).h, o.fontSize * 1.2 + TEXT_PAD * 2) } : o;
    rect = tr({ x: tb.x, y: tb.y, w: tb.w, h: Math.max(tb.h, 20) });
    const rot = rotOf(o);
    if (rot) {
      const c = centre(localBox(s.project, o));
      rotate = { deg: rot, origin: `${(c.x - tb.x) * view.z}px ${(c.y - tb.y) * view.z}px` };
    }
    initial = o.text;
    fontSize = fitTextBox(textBoxOf(o)).size * view.z;
    commit = (v) => {
      nextLabel('Edit text');
      patchObjects([o.id], (t) => {
        if (!('text' in t)) return;
        t.text = v;
        // Text boxes grow to fit what was typed (like PowerPoint); shrinking the box later scales the text.
        if (t.kind === 'text' && o.kind === 'text') {
          const n = naturalTextSize({ ...o, text: v });
          if (t.wrap === false && n.w > t.w) t.w = Math.ceil(n.w);
          if (n.h > t.h) t.h = Math.ceil(n.h);
        }
      });
    };
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
      if (name && dev && name !== dev.name) renameDevice(dev.id, name);
    };
  } else {
    // A line, or a snake (its trunk route carries the snake's label).
    const r = resolvePageRoutes(s.project, pg).get(editing.id);
    if (!r) return null;
    const c = r.conn as Connection;
    const lb = labelBox({ ...r, conn: { ...c, label: c.label || 'X' } });
    const at = lb?.p ?? r.pts[Math.floor(r.pts.length / 2)];
    rect = tr({ x: at.x - 40, y: at.y - 7, w: 80, h: 14 });
    initial = editing.typed ?? c.label;
    fontSize = Math.max(11, 7 * view.z);
    commit = (v) => {
      if (r.trunk) {
        nextLabel(v.trim() ? `Label snake "${v.trim()}"` : 'Clear snake label');
        patchBundles([c.id], (b) => void (b.label = v.trim()));
      } else {
        nextLabel(v.trim() ? `Label line "${v.trim()}"` : 'Clear line label');
        patchConnections([c.id], (cc) => void (cc.label = v.trim()));
      }
    };
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
    transform: rotate ? `rotate(${rotate.deg}deg)` : undefined,
    transformOrigin: rotate?.origin,
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
        if (editing.kind === 'label' && e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          e.preventDefault();
          const dir = e.key === 'ArrowDown' ? 1 : -1;
          finish(true);
          window.dispatchEvent(new CustomEvent('schema:nextline', { detail: dir }));
        }
      }}
    />
  );
}
