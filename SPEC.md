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
  - **Racks** and **rack units** (rack elevations, Phase 3 — see §10).
- **Quick insert**: hotkey opens search; Enter drops the block at the cursor. Drag from library panel also works.
- Style properties for lines, blocks, shapes, text: border thickness, solid/dashed, color.

## 6. Connections (lines)

- Drawn port-to-port by dragging. Endpoints anchor to a block row, a shape, or a reference tag, and stay anchored when objects move.
- Routing: right-angle (default) or curved, selectable per line. New lines get an automatic right-angle path that **goes around blocks, rectangles and text boxes** (feedback rounds 1–2; future shapes too); **the user can drag segments/bends to reroute**, after which the line keeps the manual route.
- Jumpers: a line may run from a device back to another port on the same device.
- **No avoidable jogs** (round 2): moving a block snaps its ports level with the far ends of its lines (generous catch zone, wins over grid snap); a new line with a small jog straightens itself by moving an end that has no other lines; **Straighten** (toolbar) moves selected blocks — or the input ends of selected lines — so lines run straight.
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
- Equipment list (CSV): manufacturer, model, friendly name, page(s), rack + RU (Phase 3).
- Cable list (CSV): label, signal, from device/port/connector, to device/port/connector, page(s) — Phase 3 ✅. (A printable cable-list PDF page is still open.)

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

**Phase 2** — ✅ implemented; feedback rounds 1–6 addressed
- [x] Curved lines, snakes
- [x] Circles/ellipses, containers, callouts, rotation for shapes/text/images
- [x] Image/PDF/SVG import
- [x] Multi-page device instances + reference tags
- [x] Equipment list export

**Phase 3** — in progress (first cut implemented, awaiting test feedback)
- [x] Cable list (CSV)
- [x] Optional signal-type colours (per project)
- [x] Auto-label numbering (prefix + counter)
- [x] Quality of life: z-order in a right-click menu; grouped Text / Border / Fill properties with print-friendly colour swatches for text, borders and fills
- [x] Custom font upload (project setting, embedded in PDFs)
- [x] **Rack elevations**:
  - [x] Equipment dimensions in the block definition: RU count, width (full / half / third), depth. (Height = RU × 1.75″.)
  - [x] Rack tool: rack outline from an RU count, numbered spaces.
  - [x] Drag equipment into the rack; it snaps to the nearest free space (occupying its RU count).
  - [x] Front view shows manufacturer, model and friendly name on each unit's face.
  - [x] Side view of the same rack from the depth data.
  - [x] Rack units are the same project devices as on the schematics.
- [ ] Open: cable list as a printable PDF page; UI friction review with the designer (ongoing).

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
- Blocks move by dragging the header, footer or centre (the area next to the divider); the outer ~45% of each port row (plus a few points outside the edge) starts a line. Click a port row to select it, Shift-click to extend a run, Ctrl-click to toggle; Range connect (selected-ports properties; side with more OUTs becomes the source; pairs in display order; warns if counts differ).
- Drag from a connection dot on a text box or rectangle to start a line from it; lines attach to the centre of the nearest side.
- Lines are drawn OUT → IN where possible (endpoints are swapped automatically). Mismatched signal types only warn.
- Clicking anywhere inside a rectangle / text box selects it, like a block (round 5). Alt+drag starting on an object draws a selection box instead (e.g. to select blocks inside a rack/room frame).
- Selection (round 6): selected objects get a soft halo and an outline 3 px outside the object (so it doesn't merge with the object's own border), plus corner markers when several are selected.
- Marquee (round 3): selects what is fully inside, in any drag direction (PowerPoint); hold Alt for touch-select (green, dashed).
- Pan: right-drag, middle-drag, Space-drag, Hand tool (`H`), or drag the grey area outside the page; wheel scrolls. Left-drag on blank page space stays marquee-select.
- Text boxes grow to fit after typing. Shrinking a box first eats the 3 pt padding; the font only shrinks once the text would touch the edge (0.75 pt), never below 2 pt (round 4). Shrunk text scales about the box centre like a block, whatever its vertical alignment; vertical centring is optical (cap height to last baseline) (round 5). New text boxes don't word-wrap (Wrap checkbox); rectangles do.
- History labels: actions call `nextLabel()` before recording; drags name their checkpoint; `labelLast()` adds details afterwards.
- Route model: a line stores alternating bend coordinates (null = automatic). The end segments always stretch to the anchors, so lines stay attached when blocks move while keeping manual edits. Dragging a middle segment moves it; dragging an end segment inserts a jog. "Reset route" returns to automatic.
- Automatic routing: the simple Z/L route is used when it's clear of obstacles; otherwise a shortest orthogonal path around them (8 pt clearance, penalty per bend) is found on a grid built from obstacle edges (A*, cached). Obstacles = every object on the page (blocks, rectangles, text boxes). A shape that encloses a line's end (a rack/room frame) doesn't block that line. When something sits closer than the 12 pt stub, the stub and clearance shrink so the line still goes around.
- Straightening (round 2): lines between two blocks can only all be level if both blocks have the same scale (row spacing). Straighten first gives a block with ≥2 lines to the same other block that block's scale (top-left fixed), then moves it — one history step, with a toast. Resizing a block snaps its scale to other blocks' scales on the page (within 3%), else to 5% steps (Alt = free). Properties show scale in % with "Reset to 100%".
- Straightening: block drags snap to connected ports first (catch zone max(10 px, 8 pt)), then smart guides, then grid. Auto-straighten after drawing a line only moves an end with no other lines and only for jogs ≤ 24 pt (one undo step with the line).
- Jumpers / U-shaped routes (both ends facing the same way) that share a lane are nested (round 2): the shortest span at the normal stub distance, each enclosing one 6 pt further out — none ends up flat against the block. Curved lines take part in laning too.
- Automatic Z-routes that would overlap are spread into 6 pt lanes, ordered so they don't cross; lines leaving the same port share a trunk (fan-out). Lines routed around blocks are not yet laned, so two of them can share or cross a channel — drag a segment to tidy.
- Hops: horizontal segments hop over vertical segments of other lines (not over lines from the same source port).
- Labels: click a line and type (or double-click / Enter / F2 to edit); default position is the middle of the longest horizontal run; drag to slide (then it's fixed until "Auto label position"). Labels on vertical segments are rotated.
- Smart guides snap object edges/centres and **port rows** (so lines come out straight); otherwise grid snap (default 9 pt = 1/8"). Arrow keys nudge 1 pt (Shift = grid).
- "Definition" buttons on a block: *Use library version* / *Save to library* appear only when the project's copy differs from the library (e.g. you fixed a port name while drawing and want that fix for future projects); *Add to library* appears for blocks that aren't in your library (e.g. a project from someone else).
- Copy/paste of blocks creates new devices (Phase 2 will add "place another instance of this device").
- Quick insert: the Insert… button (round 5: no shortcut), Enter drops the block at the cursor.
- Shortcuts: V/T/R tools, Ctrl+Z/Y, Ctrl+C/X/V/D/A, Delete, Ctrl+S / Ctrl+Shift+S / Ctrl+O, Ctrl+0 fit, Ctrl+± zoom, Space/middle-drag pan, Ctrl+wheel zoom.

### Phase 2 (decisions made while building)
- **Display list** gained `group` items (an affine matrix + child items) for rotation and imported SVG art, and even-odd fills. SVG backend: `<g transform="matrix(…)">`; PDF backend: the same matrix conjugated by the y-flip and applied with `cm`.
- **Rotation** (`rot`, degrees clockwise about the box centre) on text boxes, rectangles, ellipses, containers, callouts and images; blocks and tags never rotate. Round handle above the selection (Shift = 15° steps, gentle snap to 0/90/180/270), number field + ⟲/⟳ in Properties. Resizing a rotated shape works in its own frame and keeps the opposite side fixed; grid snap only applies when upright. Routing obstacles, marquee, align/distribute use the rotated bounding box. Lines to a rotated shape attach to its rotated side centres and leave along the nearest axis.
- **Label at both ends** (round 2, per line, off by default): the label is drawn near each end (just past the stub) instead of once along the line. Round 3: each end label can be dragged (`labelEndsT`, snaps to other labels; "Auto label positions" resets). Align (round 6): Properties for several lines offer Left / Centre / Right (Top / Middle / Bottom for labels on vertical runs); the label of the first line selected is the reference and stays put, the others take its left edge, centre or right edge (the toolbar align buttons do the same with only lines selected). Which label of a two-label line moves: lines with one label use it; a two-label line uses the label nearest the single labels; if every selected line has two, start labels align with start labels and end labels with end labels.
- **Tools are one-shot** (round 3 made them sticky; reverted in round 4 at the designer's request): after drawing one object it's back to Select. Esc with a tool active leaves the tool; otherwise it clears the selection.
- **Drag out to size** (round 4): rectangles, ellipses, containers, callouts, thought bubbles and text boxes can be dragged out to size from any corner (grid snap; Shift = equal sides → circle / square); a plain click still gives the default size. A dragged-out text box wraps. "Make a circle / Make a square" in Properties equalises an existing one (keeps the centre).
- **Next line** (round 4): with one line selected, Shift+↓ / Shift+↑ selects the next / previous line (other lines leaving the same object top to bottom first, then all lines on the page) — then just type its label. In the label editor, Shift+↓ / Shift+↑ saves and moves on.
- **Several lines selected** (round 4): Properties show Routing (right-angle / curved / mixed), "Label at both ends" (tri-state) and Bundle — also when blocks or shapes are selected along with them.
- **Multi-port drag** (round 3, Q-SYS style): with several ports selected on one block (click, Shift-click for a run, Ctrl-click to add), dragging one of them to a port on another block connects them all — in row order, onto consecutive rows of the target column, lined up so the dragged port lands where you drop. Ports that run past the end of the column are skipped (warning). One history step. Range connect (Shift+C) still exists.
- **Drawn lines / arrows** (round 5: one Line tool — arrowheads are set in its properties with four buttons — / → ← ↔; typing a length or angle lets go of glued ends; originally round 2: Line, Arrow, ↔ tools; drag to draw, click = 1-inch, Shift = 15° steps; round 3/4: ends snap to corners / side centres / outline of shapes, containers, blocks and images, to the ends or any point of other drawn lines, and to connectors, within 8 px — green ring shows it; Alt = no snap. A snapped end stays **glued** (`LineObj.ends`): after every change (`syncGlue`, run inside `updateProject`) glued lines are re-solved from their targets, two passes so lines glued to glued lines settle — they follow moves, resizes, rotation and rerouting. Moving the line itself lets go of targets that don't move with it — but dragging a single line snaps its nearest end onto a shape / line within 8 px and glues it there (and the other end too if it lands on something; round 6); copies keep glue only to copied targets): `LineObj` is a box object whose line runs along the middle of its box, length = w, direction = rotation — so colour, width, dash and rotation work like other shapes. Selected: round handles at both ends move that end. Arrowheads: none / end / start / both, filled triangles sized from the line width. They're annotations: not routing obstacles and lines can't connect to them.
- **Thought bubble** (round 2, Thought tool): a callout with `shape: 'cloud'` — scalloped outline around an ellipse, three shrinking bubbles trailing to the tip; same pointer/glue behaviour; Callout properties switch between box and cloud.
- **Ellipse** (`E`): text is laid out in the inscribed rectangle. **Container** (`F`): labelled frame (label band along the top, optional band fill, dashed by default); created behind everything; only its frame/label band is clickable, so clicks and drag-selection inside reach its contents; moving it (drag or arrow keys) moves everything fully inside it, nested containers included. **Callout** (`L`): text box with a wedge to a tip, dragged by the yellow diamond. The tip is stored page-oriented, so rotating or resizing the callout leaves it where it is; dropping the diamond on an object (shape, block, image…) glues it there (`tailTo`, as fractions of the object's box), so it follows that object when it moves or rotates; dropped on a line (round 2) it glues to that fraction of the line's length and follows the line's route. Properties shows "Detach". Copying keeps the glue if the target is copied too, otherwise the tip stays at the same spot.
- Moving several objects now also moves manual line routes (and snake trunks) whose ends all move together, instead of stretching them.
- **Curved lines** (revised in feedback round 1): per-line Routing = Right-angle / Curved (Properties, or buttons for several lines / a snake). A curve is the line's right-angle route (automatic — so it goes around blocks and shapes — or manually adjusted) smoothed: straight out of each end to the middle of the first/last segment, and at every corner a curve from one segment's middle to the next. The square handles of a selected curve sit on it (segment middles); dragging them moves those segments, reshaping the curve. No hops on curves; the label stays horizontal in a gap cut out of the curve (exact sub-curves in the export). Auto label position: the middle of the route's longest horizontal run (it lies on the curve). Label alignment and label-drag snapping work on curves wherever the curve crosses the target x/y.
- **Snakes**: `B` / Bundle with ≥4 lines selected — same signal type (case-insensitive) on the port ends, same two objects, ports in one column on each block, not already bundled; otherwise a toast says why. An end may be a shape (e.g. owner-furnished equipment drawn as a rectangle, round 1): there the trunk goes straight to where the first line attached, with no legs (labels show on the block end). Trunks can be curved. Selecting the trunk and typing (or Enter/F2, double-click) edits the snake label. Model: `page.bundles[]` = member line ids + trunk label/style/bends. Each member keeps a leg out of its port long enough for its full label (shown on both legs); legs join a vertical bar; bars join one trunk (default 3× the line width, auto-routed around objects, segments draggable like a line). Clicking a leg selects that line (its whole run is highlighted); clicking the trunk selects the snake (label, style, Reset route, Select lines, Unbundle `Ctrl+Shift+B` — not a plain letter, because typing on a selected snake labels it). Delete on a selected snake deletes its lines; deleting lines shrinks the snake and dissolves it below 2 lines. Copy/paste and duplicate page keep snakes.
- **Imports** (toolbar Image…, drop files on the page, or paste an image): PNG/JPG embedded as-is (placed at 96 dpi). PDF: the original file is stored; the export embeds the chosen page as vector (pdf-lib `embedPage`); the screen shows a pdf.js raster preview made at import (`pdfjs-dist`, loaded on demand). Multi-page PDFs ask which page. Files pdf-lib can't embed (e.g. encrypted) are refused at import. SVG: converted at import into plain vector paths (computed styles and transforms read through the browser, arcs/quads → cubics) and drawn identically on screen and in the PDF; text, `<use>`, embedded images, clips/masks are skipped (with a warning — convert text to outlines); gradients use their first stop colour; partial transparency is ignored. Images keep their proportions on corner handles (Shift stretches); "Original proportions" button. Unused imported assets are dropped from the project. Known limit: a PDF page with a `/Rotate` entry may export unrotated.
- `.schema` zips store PDF previews as `assets/<id>.preview`; SVG vector data sits in `project.json`.
- **Devices, names and instances** (reworked in feedback round 1): the library holds templates; a *device* is one real piece of equipment with one friendly name; a *block* is where a device is drawn. Placing from the library makes a new device (unique name, e.g. VR-2). **Paste onto a page where the device isn't yet = the same device** (also Duplicate page); paste on the same page, or `Ctrl+Shift+V`, = a new device of the same model. Renaming a device to the name of another device of the same model (not on the same page) asks whether they're the same device and merges them (lines kept by port id, else port name; others removed and listed in History). "Make separate device…" (block properties, when the device is on several pages) splits one block off under a new name.
- **Per-block rows / ports**: "Rows shown on this block" hides rows on one block only (checkbox list, per-signal-type buttons when there are several signal types, or "Hide these rows" for selected port rows); a row with a line on that page can't be hidden. "Edit ports — this block only…" gives the block its own port list (`BlockObj.defId`, copied from the device's with the same port ids, so lines and cross-page markers keep working); "Use shared ports" goes back. "Edit ports — every <model>…" is the old project-wide definition edit (blocks with their own port list are not affected). The library is never changed by either.
- **Device instances**: Devices tab in the left panel lists project devices with the pages they're on (click a page number to go there); drag or double-click places another instance of the same device on the current page (not twice on one page). Block properties show "Same device on page …". Ports connected on another page get a small blue dot just outside the port (tooltip lists the pages) — **screen only**, not printed (tags are the printed cross-reference). Connections also drawn on this page (same device ports at both ends, e.g. a copied jumper) don't count. **Clicking the dot** (round 2) adds an off-page reference tag. Tags created at a port (blue dot, paired partner, line dragged from a port into empty space) are as tall as the block's row and use its port font size (`TagObj.height`), so tags on neighbouring rows stack edge to edge (round 3); "Match row height" in tag properties does the same for existing tags. The dot adds an off-page reference tag at that port for each such connection, pointing at what the line goes to there (a device port, or where a tag at that end points), stacked if several; ones already tagged there are skipped.
- **Tags go with their block** (round 4): deleting objects also deletes reference tags whose lines only went to those objects; tags anywhere pointing at a device that no longer exists in the project are removed too (listed in History).
- **Reference tags** (`G`, or drag a line from a port and let go on empty space): a picker asks for the device (and optional port); Cancel removes the new tag again. Text = `TO|FROM (page) NAME [PORT] [extra text]`; TO/FROM is automatic from the attached line (tag at the line's end = TO) or forced; the page is where the device (preferably the linked port's connection) is, preferring a page other than the tag's own. Size is automatic; when a line is attached to the tag's right side the right edge stays put as the text changes. **Paired tags** (round 1): when a tag on a line from a port points to a specific port of a device drawn on another page, a matching tag is added at that port there, on a line of its own, pointing back (`TO (2) VR-2 SDI IN 4` ↔ `FROM (1) VR-1 SDI OUT 1`); an existing tag already there is linked instead. Re-pointing a tag replaces its automatic partner; deleting a tag deletes its automatic partner; it's all one undo step. **Double-click** a tag (or "Go to page N") to jump to the device — a single click selects/moves it like any object (deviation from "clicking it jumps").
- **Equipment list** (toolbar Equipment): CSV with Manufacturer, Model, Friendly name, Page(s), sorted; UTF-8 with BOM so Excel reads it.
- History: specific labels (e.g. "Edit text") are no longer overwritten by the generic "Change object".
- Fill colours (shapes, container label band, tags) use a swatch that always shows the colour; its palette has "No fill" and a custom colour.
- Keyboard shortcuts (after the round-5 trim): Ctrl+S / Ctrl+Shift+S / Ctrl+O, Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z), Ctrl+H history, Ctrl+C / X / V / D / A, Ctrl+Shift+V paste as new devices, Delete, arrows nudge (Shift = grid), Esc, tools V T R E F L H, type / Enter to label a selected line or snake, Shift+↑/↓ next line, Ctrl+0 fit, Ctrl+± zoom, Ctrl+wheel, Space/right/middle-drag pan, Ctrl+Enter finishes text.
- Stacking: objects stack in creation order (the right-click menu changes it — Phase 3; containers and racks start at the back); lines are always drawn above all objects so connections are never hidden.

### Phase 3 (decisions made while building)
- **Properties panel** (designer request): settings are grouped in titled boxes — **Text** (content, colour, size, bold, wrap, alignment), **Border**, **Fill**, **Position & size**, plus Pointer for callouts and Line style for lines. One colour control everywhere (`ui/controls.tsx` `ColorSwatch`): a swatch that opens a small palette of print-friendly colours (black, three greys, white, brown, red, orange, yellow, green, blue, purple — no pale tints) and "Custom". The first entry is **Default (black)** for text and borders, **No fill** for fills, **No border** where a border is optional (text boxes, images — replaces the old Add/No border buttons). Number fields everywhere apply on Enter / leaving / spinner.
- **Right-click menu** (designer request): stacking order (Bring to front / forward, Send backward / to back) moved out of the toolbar into a context menu on the canvas, with Cut / Copy / Paste / Duplicate / Delete. Right-click without moving opens it (selecting what's under the pointer first if it isn't selected); right-drag still pans.
- **Rack elevations** (`model/rack.ts`, `render/rackDraw.ts`, `state/rackActions.ts`, `ui/RackProps.tsx`), modelled on the designer's rack sheet (racks.png, round 1 of Phase 3):
  - `BlockDef.rack = { ru, width: 'full' | 'half' | 'third', depth (in) }` — edited in the block editor (library / every-model) or from a rack unit's properties (changes the project's copy of the model; "Save to library" when it differs). Library CSV/XLSX gained `Rack Units, Rack Width, Depth (in)` columns. A model with no size is placed as 1U full width (toast says so).
  - `RackObj` (page object, not rotatable): RU count, title (name + tag shown in quotes, e.g. *Backstage 40U Rack* / *“AV1”*), look (grey **cabinet** or black **frame / wall rack**), casters, RU numbers (1 at the bottom, on the left rail), optional grey **blank panels** in empty spaces, optional **side view** (drawn on the left: rear rail left, front rail right, each unit a box of its depth from the front rail; unknown depth = dashed at 12″) with rail depth, and a scale in points per inch (default 8 pt/in = 100%; corner handles scale the whole rack). Placed with the **Rack** tool (12U by default; size in properties). Racks are created at the back, like containers.
  - `RackUnitObj`: a device (same project device as its schematic blocks — renaming either renames both; Devices tab / equipment list show both) mounted at bottom RU `u` and `slot` (for half / third width) in `rackId`. Its x/y follow the rack (`syncRacks` runs after every change, next to `syncGlue`). Units are always drawn and hit on top of their rack. Face: white panel (colour selectable) with rack ears and screws on full-width units, manufacturer / model / friendly name centred and shrunk to fit; text colour selectable.
  - Mounting: drop a library block on a rack = new device mounted; drop a device from the Devices tab = that device mounted (once per page). Dragging a unit lifts it out of its rack; on release over a rack it snaps to the nearest free space (6 sub-columns per RU so half and third widths share spaces), otherwise it stays free-standing on the page; if there's no room it goes back. Bottom RU / left-right can also be typed in properties. The rack's properties list its contents top to bottom (click to select) and warn about overlaps after a size change. Deleting / copying a rack takes its units along.
- **Cable list** (`model/cableList.ts`, toolbar **Cables**): one row per cable — Label, Signal, From, From port, From connector, To, To port, To connector, Page(s). A line ending at a reference tag counts as going to the tag's device/port, so a cable drawn across two pages (paired tags) and lines repeated on several pages are listed once. Sorted by label (numeric aware), then source.
- **Signal colours** (project setting, `Project.signalStyles` + `signalColors`): Page properties → Signal colours → Edit colours… (dialog lists the preference signal types plus any used in the project; "Suggest colours" fills print-friendly defaults; optional dash per type). A line that is still black is drawn in its signal type's colour (output port's signal first); a line given its own colour keeps it ("Use signal colour" resets it). Snake trunks follow their lines' signal.
- **Auto-numbered labels** (`Project.autoLabel` = prefix, next number, digits): Page properties → Line labels. When on, every new line gets the next label (`C-001`, …; paired off-page lines share it). "Number these lines" (several lines selected) numbers unlabelled lines top to bottom (Shift-click renumbers labelled ones too).
- **Custom fonts** (`Project.fonts`, Page properties → Fonts): upload a TTF/OTF (plus optional bold) to replace the narrow font (blocks, labels, tags, shapes, rack faces) and/or the title font (title block, rack titles). Stored as project assets, measured with fontkit like the built-in fonts (layout caches are cleared when fonts change), registered as their own CSS families on screen, and embedded whole in PDFs. "Use built-in" goes back.
- Dev hook `window.__schema` also exposes `cableListCsv` and `rackActions` for smoke tests.

## 11. Feedback log

**Phase 3 — kickoff** (all addressed): grouped Text / Border / Fill properties, the fill colour swatch reused for text and borders with a few print colours (default black) · z-order buttons moved to a right-click menu · rack elevations from the reference sheet (front + optional side view) · plus the planned Phase 3 items (cable list, signal colours, auto-numbering, font upload).

**Phase 2 — round 6** (all addressed; last round of Phase 2): line up labels left / centre / right (top / middle / bottom on vertical runs), all relative to the first selected line's label · clearer selection (halo + outline set outside the object, corner markers when several are selected) · dragging an existing line near a shape / line glues its end there.

**Phase 2 — round 5** (all addressed): Line up labels (centre) now lines up with the label of the first line selected, which stays put (was the midpoint of all of them) · one Line tool, arrowheads in properties · number fields apply on Enter / leaving the field / spinner, not per keystroke; typed angle/length unglue a line · shortcuts trimmed: no G (tag), Q / Ctrl+K (insert), F2, Shift+C, S, B, Ctrl+Shift+B; Tag and Range connect toolbar buttons removed (Range connect stays in the selected-ports properties, for non-consecutive destinations).

**Phase 2 — round 4** (all addressed): Shift+↑/↓ to the next line for labelling · routing / label-at-both-ends for several selected lines at once · drag shapes out to size · tags deleted with their block · drawn line ends stay glued to shapes, lines and connectors · sticky tools reverted · circle: Shift while dragging, or "Make a circle" · keyboard shortcut list sent for review (to trim later).

**Phase 2 — round 3** (all addressed): end labels of two-label lines movable + alignable · Q-SYS-style multi-port drag · drawing tools stay selected · line/arrow ends snap to shapes · port tags as tall as the row (no overlap).

**Phase 2 — round 2** (all addressed): straighten bump = blocks at different scales → Straighten matches scales, scale snapping, "Reset to 100%" · label at both ends option · nested jumper lanes (no jumper flat on the block) · callout pointer glues to lines · drawn lines, arrows, double arrows · thought bubble · clicking a blue dot adds the off-page tag · bulk routing = Range connect (answered) · custom font upload: deferred to Phase 3 polish (see reply).

**Phase 2 — round 1** (all addressed): curves route around objects and have reshaping handles · curved labels line up · snakes to shapes (OFE) · type to label a snake · curved snakes · callout pointer glues to an object and ignores the callout's rotation · fill colour swatch with "No fill" · same device = same friendly name across pages (paste to another page, merge on rename, make separate) · per-block hidden rows / own ports, clearer "Edit ports" wording · paired reference tags at the far port · blue "used elsewhere" dot explained (only for the same device on another page) · fonts: question open (see reply).

**Round 5** (all addressed): shrunk text stays centred in its box · click anywhere inside a rectangle / text box to select it · Phase 3: rack elevations added to the plan.

**Round 4** (all addressed): floating divider under the designer section · Title block window vs. app-only Prefs · text shrinks only on physical overlap with the box edge.

**Round 3** (all addressed): change History with details (e.g. which connections a block update removed) · text shrinks with its box · connection dots on rectangles/text boxes · drag-select works the same in every direction (Alt = touch) · pan by right-drag / Hand tool / grey area · title block rebuilt from the reference sheet, with a shared free area copied from page 1.

**Round 2** (all addressed): rectangles/text boxes (and future shapes) are routing obstacles · easy alignment so lines stay straight (port snap while dragging, auto-straighten on connect, Straighten command).

**Round 1** (all addressed): no IN/OUT dropdown (column = direction) · centre divider + split header per reference block · export only highlighted library blocks · text inside rectangles · same-device jumpers · lines snap to the centre of a text box/rectangle side · click a line and type to label · line labels up with each other · drag-select (marquee rectangle was invisible — fixed; plus crossing selection) · auto lines avoid blocks · "push to library" reworked into context-dependent buttons · Prefs designer info now updates the open project (superseded in round 4 by the Title block window).

## 12. Working process

- Code + this spec live in the GitHub repo. Each new conversation starts from the repo; refer to "the spec" rather than re-describing features.
- One conversation per phase or major feature. Feedback sent in batches (one list per test round, screenshots for visual issues).
