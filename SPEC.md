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
- Undo/redo for all edits, plus a **History** list (round 3): every change is named (e.g. "Connect VR-1 SDI OUT 1 → DISP-1 HDMI 1", "Update … from library — 1 connection removed" with the removed lines listed); undo/redo to any point.

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
- Header split by the centre divider: **Manufacturer** centred over the left column, **Model** over the right column.
- A centre divider line runs down the header and port rows (see the reference block from feedback round 1).
- Footer (full width): **IN — Friendly name — OUT** (friendly name is per placed device; the library holds a default)
- Ports, each: port name, signal type, connector type. **Direction is the column** — no per-row setting:
  - IN rows (left column) display `Port - Signal - Connector`, anchor on the left edge.
  - OUT rows (right column) display `Connector - Signal - Port`, anchor on the right edge.
  - (BIDIR was dropped in feedback round 1: e.g. Ethernet is simply placed in whichever column suits the drawing.)

### Editor (subwindow showing a live preview of the final block)
- Spreadsheet-style grid per column: add, delete, move/swap, copy/cut/paste rows; multi-select; undo/redo.
- Paste rows directly from Excel / tab-separated text.
- **Pattern fill**: e.g. `SDI IN {n}`, n = 1–10, with signal + connector → generates rows. Also "duplicate and increment" on selected rows.
- Library browser: search/filter by manufacturer, model, signal type. Multi-select (Ctrl/Shift-click, Select all); export writes only the highlighted blocks (one block → file named after it). Import merges whatever the file contains.

### Signal types
- Fixed, user-editable list (HDSDI, HDMI, AUDIO, DATA, AC, …).
- Optional color/line style per signal type (off by default).
- Soft warning (non-blocking) when connecting mismatched signal types. (No IN→IN / OUT→OUT warnings: network gear and jumpers do that legitimately.)

## 4. Projects, pages, title block

- New project starts with one page. Page tabs: add, duplicate, rearrange (drag), rename, delete.
- Page sizes: Letter 8.5×11 and Tabloid 11×17, **landscape only**.
- Title block column on the right of every page, laid out after the designer's reference sheet (round 3), top to bottom:
  - Logo (≈12% of the column height)
  - **PROJECT ADDRESS** + address lines (all bold)
  - **Designed by** name, **Copyright ©** …, phone, email (all bold), followed by a divider that floats just below however many lines there are
  - Free area — **shared**: text boxes / rectangles placed inside the title block on page 1 are repeated on every page
  - Created / Modified dates (Modified updates on save)
  - Project name, then `Rev. x` right-aligned
  - Page title `(11) Sanctuary Video Schematic` (bold)
  - Page number `11/19` large: number in black, `/19` in light grey
  - Inset grey separators between sections; text ≈ 7% of the column width with ~1.4 line spacing. No "Printed" date.
- **Title block** window (round 4): everything printed in the title block — logo, project address/name/revision/created date, designer name/copyright/phone/email. "Save designer & logo as my default" stores them for new projects; "Use my default" fills them in. **Prefs** holds only app settings (new-project page size, grid, saving/backups, signal types).

## 5. Layout canvas

- PowerPoint-like interaction: select, multi-select, marquee, move, resize, align/distribute, grid + snap, smart guides, copy/paste, z-order, zoom/pan.
- Objects:
  - **Blocks** — scalable, **not rotatable**. Per-block border color/thickness/style.
  - Text boxes, rectangles (rectangles can hold text — double-click to type; text always shrinks to stay inside its box, optional word-wrap), circles/ellipses, containers (labeled grouping frames), callouts — all rotatable.
  - Imported images (JPG/PNG) and single-page PDFs — rotatable. PDFs stay embedded as the original and export as true vector (pdf-lib embedPage). SVG import also accepted.
  - **Reference tags** (see §7).
- **Quick insert**: hotkey opens search; Enter drops the block at the cursor. Drag from library panel also works.
- Style properties for lines, blocks, shapes, text: border thickness, solid/dashed, color.

## 6. Connections (lines)

- Drawn port-to-port by dragging. Endpoints anchor to a block row, a shape, or a reference tag, and stay anchored when objects move.
- Routing: right-angle (default) or curved, selectable per line. New lines get an automatic right-angle path that **goes around blocks, rectangles and text boxes** (feedback rounds 1–2; future shapes too); **the user can drag segments/bends to reroute**, after which the line keeps the manual route.
- Jumpers: a line may run from a device back to another port on the same device.
- **No avoidable jogs** (round 2): moving a block snaps its ports level with the far ends of its lines (generous catch zone, wins over grid snap); a new line with a small jog straightens itself by moving an end that has no other lines; **Straighten** (toolbar / `S`) moves selected blocks — or the input ends of selected lines — so lines run straight.
- Lines to a text box / rectangle attach to the centre of the nearest side; those side centres show as connection dots on hover (drag from a dot to start a line).
- **Line hops** drawn automatically where lines cross.
- **Fan-out**: one output may feed multiple inputs.
- **Labels**: manual by default; optional auto-numbering (prefix + counter). Label sits in a gap in the line (`—DD-301—`), can be slid along the line, and stays with the line when it moves. Click a line and type to label it. Labels can be lined up with each other (align buttons with several lines selected; dragging snaps to other labels).
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
- Library CSV/XLSX: one row per port — `Manufacturer, Model, Default Name, Column (IN/OUT), Port, Signal, Connector` (an old `Direction` column is accepted on import). Blocks with no ports are one row with empty port fields. Import merges by manufacturer+model (replaces existing).
- Library and preferences are stored in the browser (IndexedDB / localStorage); preferences export/import as JSON.
- Autosave: the open project is written to IndexedDB 1.5 s after each change and restored on reload. Rolling backups: a snapshot every 5 minutes while editing and on every save; last 20 kept (pref). Optional pref: also autosave into the open `.schema` file.
- "Modified" date updates on explicit save.

### Canvas interaction
- Blocks move by dragging the header, footer or centre (the area next to the divider); the outer ~45% of each port row (plus a few points outside the edge) starts a line. Click a port row to select it, Shift-click to extend a run, Ctrl-click to toggle; `Shift+C` = range connect (side with more OUTs becomes the source; pairs in display order; warns if counts differ).
- Alt-drag from a text box or rectangle starts a line from it; lines attach to the centre of the nearest side.
- Lines are drawn OUT → IN where possible (endpoints are swapped automatically). Mismatched signal types only warn.
- Unfilled rectangles are only grabbed by their outline or text, so you can click and drag-select inside them.
- Marquee (round 3): selects what is fully inside, in any drag direction (PowerPoint); hold Alt for touch-select (green, dashed).
- Pan: right-drag, middle-drag, Space-drag, Hand tool (`H`), or drag the grey area outside the page; wheel scrolls. Left-drag on blank page space stays marquee-select.
- Text boxes grow to fit after typing. Shrinking a box first eats the 3 pt padding; the font only shrinks once the text would touch the edge (0.75 pt), never below 2 pt (round 4). New text boxes don't word-wrap (Wrap checkbox); rectangles do.
- History labels: actions call `nextLabel()` before recording; drags name their checkpoint; `labelLast()` adds details afterwards.
- Route model: a line stores alternating bend coordinates (null = automatic). The end segments always stretch to the anchors, so lines stay attached when blocks move while keeping manual edits. Dragging a middle segment moves it; dragging an end segment inserts a jog. "Reset route" returns to automatic.
- Automatic routing: the simple Z/L route is used when it's clear of obstacles; otherwise a shortest orthogonal path around them (8 pt clearance, penalty per bend) is found on a grid built from obstacle edges (A*, cached). Obstacles = every object on the page (blocks, rectangles, text boxes). A shape that encloses a line's end (a rack/room frame) doesn't block that line. When something sits closer than the 12 pt stub, the stub and clearance shrink so the line still goes around.
- Straightening: block drags snap to connected ports first (catch zone max(10 px, 8 pt)), then smart guides, then grid. Auto-straighten after drawing a line only moves an end with no other lines and only for jogs ≤ 24 pt (one undo step with the line).
- Automatic Z-routes that would overlap are spread into 6 pt lanes, ordered so they don't cross; lines leaving the same port share a trunk (fan-out). Lines routed around blocks are not yet laned, so two of them can share or cross a channel — drag a segment to tidy.
- Hops: horizontal segments hop over vertical segments of other lines (not over lines from the same source port).
- Labels: click a line and type (or double-click / Enter / F2 to edit); default position is the middle of the longest horizontal run; drag to slide (then it's fixed until "Auto label position"). Labels on vertical segments are rotated.
- Smart guides snap object edges/centres and **port rows** (so lines come out straight); otherwise grid snap (default 9 pt = 1/8"). Arrow keys nudge 1 pt (Shift = grid).
- "Definition" buttons on a block: *Use library version* / *Save to library* appear only when the project's copy differs from the library (e.g. you fixed a port name while drawing and want that fix for future projects); *Add to library* appears for blocks that aren't in your library (e.g. a project from someone else).
- Copy/paste of blocks creates new devices (Phase 2 will add "place another instance of this device").
- Quick insert: `Q` or `Ctrl+K`, Enter drops the block at the cursor.
- Shortcuts: V/T/R tools, Ctrl+Z/Y, Ctrl+C/X/V/D/A, Delete, Ctrl+S / Ctrl+Shift+S / Ctrl+O, Ctrl+0 fit, Ctrl+± zoom, Space/middle-drag pan, Ctrl+wheel zoom.

### Not in Phase 1 (by design / later phases)
- No obstacle-avoiding autorouter (spec). "Used elsewhere" port markers and reference tags are Phase 2.

## 11. Feedback log

**Round 4** (all addressed): floating divider under the designer section · Title block window vs. app-only Prefs · text shrinks only on physical overlap with the box edge.

**Round 3** (all addressed): change History with details (e.g. which connections a block update removed) · text shrinks with its box · connection dots on rectangles/text boxes · drag-select works the same in every direction (Alt = touch) · pan by right-drag / Hand tool / grey area · title block rebuilt from the reference sheet, with a shared free area copied from page 1.

**Round 2** (all addressed): rectangles/text boxes (and future shapes) are routing obstacles · easy alignment so lines stay straight (port snap while dragging, auto-straighten on connect, Straighten command).

**Round 1** (all addressed): no IN/OUT dropdown (column = direction) · centre divider + split header per reference block · export only highlighted library blocks · text inside rectangles · same-device jumpers · lines snap to the centre of a text box/rectangle side · click a line and type to label · line labels up with each other · drag-select (marquee rectangle was invisible — fixed; plus crossing selection) · auto lines avoid blocks · "push to library" reworked into context-dependent buttons · Prefs designer info now updates the open project (superseded in round 4 by the Title block window).

## 12. Working process

- Code + this spec live in the GitHub repo. Each new conversation starts from the repo; refer to "the spec" rather than re-describing features.
- One conversation per phase or major feature. Feedback sent in batches (one list per test round, screenshots for visual issues).
