# Schema — Specification

Lightweight editor for audio/video/network system schematics. Combines the useful parts of D-Tools SI, Visio and PowerPoint without the bloat. Output is vector PDF; projects are editable files.

Owner/designer: Adam Rollin. Target: Chrome / Edge (desktop). Landscape pages only.

---

## 1. Platform & architecture

- Browser app: Vite + TypeScript + React (UI panels), SVG for the page canvas.
- **One drawing pipeline**: document model → display list (rects, paths, text, images, embedded PDF pages) → two backends: SVG (screen) and pdf-lib (export). Screen and PDF are always identical; z-order is preserved.
- Fonts embedded in every PDF (pdf-lib + fontkit):
  - Blocks, labels, tags: Arial Narrow look-alike (Liberation Sans Narrow; fallback Roboto Condensed).
  - Title block: Calibri look-alike (Carlito).
- File access via the File System Access API (direct open/save). Chrome/Edge only — no Safari fallback.
- Autosave + rolling backups (last N versions) of the open project.
- Undo/redo for all edits.

## 2. Files

| File | Format | Contents |
|---|---|---|
| Project | `.schema` (zipped JSON + embedded assets) | Pages, devices, objects, connections, title-block data, embedded copies of all block definitions, imported images/PDFs |
| Block library | `.csv` / `.xlsx` (import/export), cached in browser | Global, shared across projects |
| Preferences | browser storage + export | Designer info, logo, defaults |

- Placed blocks keep a project-local copy of their definition. Library edits do **not** change existing projects unless the user runs "Update from library".

## 3. Block library & editor

### Block definition
- Header: **Manufacturer | Model**
- Footer: **IN — Friendly name — OUT** (friendly name is per placed device; the library holds a default)
- Ports, each: port name, signal type, connector type, direction (**IN**, **OUT**, **BIDIR**).
  - IN rows (left column) display `Port – Signal – Connector`, anchor on the left edge.
  - OUT rows (right column) display `Connector – Signal – Port`, anchor on the right edge.
  - BIDIR ports may be placed in either column and connect in either direction.

### Editor (subwindow showing a live preview of the final block)
- Spreadsheet-style grid per column: add, delete, move/swap, copy/cut/paste rows; multi-select; undo/redo.
- Paste rows directly from Excel / tab-separated text.
- **Pattern fill**: e.g. `SDI IN {n}`, n = 1–10, with signal + connector → generates rows. Also "duplicate and increment" on selected rows.
- Library browser: search/filter by manufacturer, model, signal type.

### Signal types
- Fixed, user-editable list (HDSDI, HDMI, AUDIO, DATA, AC, …).
- Optional color/line style per signal type (off by default).
- Soft warning (non-blocking) when connecting mismatched signal types.

## 4. Projects, pages, title block

- New project starts with one page. Page tabs: add, duplicate, rearrange (drag), rename, delete.
- Page sizes: Letter 8.5×11 and Tabloid 11×17, **landscape only**.
- Title block column on the right of every page:
  - Logo, project name, project address, designer name / copyright / phone / email
  - Created date (project), Modified date (auto, updates on save), Revision (project-level), shown on every page
  - Page number and name, e.g. `(11) Sanctuary Video Schematic`, and `11/19` auto-computed
  - No "Printed" date.
- Designer info + logo stored as app preferences and pre-filled into new projects.

## 5. Layout canvas

- PowerPoint-like interaction: select, multi-select, marquee, move, resize, align/distribute, grid + snap, smart guides, copy/paste, z-order, zoom/pan.
- Objects:
  - **Blocks** — scalable, **not rotatable**. Per-block border color/thickness/style.
  - Text boxes, rectangles, circles/ellipses, containers (labeled grouping frames), callouts — all rotatable.
  - Imported images (JPG/PNG) and single-page PDFs — rotatable. PDFs stay embedded as the original and export as true vector (pdf-lib embedPage). SVG import also accepted.
  - **Reference tags** (see §7).
- **Quick insert**: hotkey opens search; Enter drops the block at the cursor. Drag from library panel also works.
- Style properties for lines, blocks, shapes, text: border thickness, solid/dashed, color.

## 6. Connections (lines)

- Drawn port-to-port by dragging. Endpoints anchor to a block row, a shape, or a reference tag, and stay anchored when objects move.
- Routing: right-angle (default) or curved, selectable per line. New lines get a simple automatic right-angle path; **the user can drag segments/bends to reroute**. No full obstacle-avoiding autorouter.
- **Line hops** drawn automatically where lines cross.
- **Fan-out**: one output may feed multiple inputs.
- **Labels**: manual by default; optional auto-numbering (prefix + counter). Label sits in a gap in the line (`—DD-301—`), can be slid along the line, and stays with the line when it moves.
- **Range connect**: select a run of ports on block A and a run on block B → connect them pairwise in order.
- **Snakes** (bundles): manual "Bundle" command on selected lines. Allowed only when: same signal type, ≥4 lines, same two devices. Each line keeps its own short leg + full label at each end; only the trunk between breakouts becomes one heavier line.

## 7. Devices across pages & reference tags

- A placed block is an instance of a **project device**. The same device can appear on multiple pages; renaming it updates every instance. Ports connected on another page show a small "used elsewhere" marker.
- **Reference tag**: a box at the end of a line, linked to a device (optionally a port) anywhere in the project. Text auto-generates as `TO|FROM (page#) FRIENDLY NAME` plus optional free text (e.g. "(VIA ADAPTER)"). It updates automatically when pages are reordered/renamed or devices renamed. Clicking it jumps to the linked device's page.
- This covers the "show only the network connection to a mostly-audio device" case: a line from the switch to a tag pointing to the full device on its own page.

## 8. Exports

- Vector PDF: all pages or a selected range, fonts embedded.
- Equipment list (CSV): manufacturer, model, friendly name, page(s).
- Cable list (CSV/PDF page): label, from device/port, to device/port, signal type — Phase 3.

## 9. Phases

**Phase 1** — ✅ implemented (first cut, awaiting test feedback)
- [x] Block editor + library (grid editing, Excel paste, pattern fill, CSV/XLSX import/export)
- [x] Project model with project devices (groundwork for multi-page instances)
- [x] Pages + tabs, Letter/Tabloid landscape, title block, preferences
- [x] Blocks (scalable), text boxes, rectangles
- [x] Anchored right-angle lines with user-adjustable segments, line hops, sliding gap labels, fan-out
- [x] Range connect, soft signal-type warnings
- [x] Style properties, grid/snap/guides, undo/redo
- [x] Save/open project, autosave/backups, vector PDF export

**Phase 2**
- Curved lines, snakes
- Circles, containers, callouts, rotation for shapes/text/images
- Image/PDF/SVG import
- Multi-page device instances + reference tags
- Equipment list export

**Phase 3**
- Cable list, optional signal-type colors, auto-label numbering, quality-of-life polish

## 10. Implementation notes (decisions made while building)

### Code layout
- `src/model/` — document types, block geometry, orthogonal routing. `src/render/` — display list, page builder, SVG + pdf-lib backends. `src/state/` — store (undo/redo), actions, file ops, prefs. `src/io/` — zip project files, library CSV/XLSX, IndexedDB. `src/ui/` — React panels, canvas, dialogs.
- Units are PDF points (1/72"), page origin top-left. Text is laid out with the font's own advance widths (no kerning/ligatures, on screen and in the PDF), so screen and PDF match.

### Fonts
- Liberation Sans Narrow could not be fetched in the build environment, so the narrow font is the spec's fallback **Roboto Condensed** (`public/fonts/narrow-*.ttf`, OFL). To switch to Liberation Sans Narrow, replace those two files (same names) — nothing else changes.
- Title block uses **Carlito**. pdf-lib's subsetter drops Carlito glyphs, so Carlito is embedded whole (adds ~0.6 MB per PDF); the narrow font is subset.

### Files
- `.schema` = zip with `project.json` + `assets/<id>` (logo images). Plain JSON is also accepted on open.
- Library CSV/XLSX: one row per port — `Manufacturer, Model, Default Name, Column (IN/OUT), Port, Signal, Connector, Direction`. Blocks with no ports are one row with empty port fields. Import merges by manufacturer+model (replaces existing).
- Library and preferences are stored in the browser (IndexedDB / localStorage); preferences export/import as JSON.
- Autosave: the open project is written to IndexedDB 1.5 s after each change and restored on reload. Rolling backups: a snapshot every 5 minutes while editing and on every save; last 20 kept (pref). Optional pref: also autosave into the open `.schema` file.
- "Modified" date updates on explicit save.

### Canvas interaction
- Blocks move by dragging the header, footer or centre; the outer ~45% of each port row (plus a few points outside the edge) starts a line. Click a port row to select it, Shift-click to extend a run, Ctrl-click to toggle; `Shift+C` = range connect (side with more OUTs becomes the source; pairs in display order; warns if counts differ).
- Alt-drag from a text box or rectangle starts a line from its outline; lines can also end on a shape outline.
- Lines are drawn OUT → IN (endpoints are swapped automatically). Mismatched signal types, IN→IN and OUT→OUT only warn.
- Route model: a line stores alternating bend coordinates (null = automatic). The end segments always stretch to the anchors, so lines stay attached when blocks move while keeping manual edits. Dragging a middle segment moves it; dragging an end segment inserts a jog. "Reset route" returns to automatic.
- Automatic Z-routes that would overlap are spread into 6 pt lanes, ordered so they don't cross; lines leaving the same port share a trunk (fan-out).
- Hops: horizontal segments hop over vertical segments of other lines (not over lines from the same source port).
- Labels: double-click a line to edit; default position is the middle of the longest horizontal run; drag to slide (then it's fixed until "Auto label position"). Labels on vertical segments are rotated.
- Smart guides snap object edges/centres and **port rows** (so lines come out straight); otherwise grid snap (default 9 pt = 1/8"). Arrow keys nudge 1 pt (Shift = grid).
- Copy/paste of blocks creates new devices (Phase 2 will add "place another instance of this device").
- Quick insert: `Q` or `Ctrl+K`, Enter drops the block at the cursor.
- Shortcuts: V/T/R tools, Ctrl+Z/Y, Ctrl+C/X/V/D/A, Delete, Ctrl+S / Ctrl+Shift+S / Ctrl+O, Ctrl+0 fit, Ctrl+± zoom, Space/middle-drag pan, Ctrl+wheel zoom.

### Not in Phase 1 (by design / later phases)
- No obstacle-avoiding autorouter (spec). "Used elsewhere" port markers and reference tags are Phase 2.

## 11. Working process

- Code + this spec live in the GitHub repo. Each new conversation starts from the repo; refer to "the spec" rather than re-describing features.
- One conversation per phase or major feature. Feedback sent in batches (one list per test round, screenshots for visual issues).
