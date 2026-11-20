# People — Specification

Personal app for keeping track of people you've met. It is built around a timeline and tags, so it can show how a relationship and a person's life change over time ("I met this person here but forgot their name", "it was their anniversary when we talked").

Owner: Adam Rollin. Target: Chrome / Edge on desktop (full feature set); works on phones and tablets in any modern browser (sync by export/import there).

This app lives in `people-app/` and is separate from the Schema app in the repo root.

---

## 1. Platform & architecture

- Vite + TypeScript + React, no backend. It is an installable PWA that works offline (`public/sw.js`, `manifest.webmanifest`).
- One in-memory `Database` (see `src/types.ts`) with immutable updates (`src/store.ts`), undo/redo (Ctrl+Z / Ctrl+Shift+Z, 100 steps; typing in one field is grouped into one step).
- Dates are stored as `YYYY-MM-DD` strings (day resolution). A birthday with an unknown year is stored as `--MM-DD`. A timeline item's `end` is `''` (single day), `'present'` or a date.

## 2. Data ownership, storage & sync — decision

The developer must never see or host the data. Chosen approach (**local-first + your own cloud drive**):

1. **Always:** saved automatically to this browser's IndexedDB (and `navigator.storage.persist()` is requested).
2. **Optional linked data file** (`*.people.json`, File System Access API, Chrome/Edge desktop). Every change is written to it about a second later. If the file sits in a OneDrive / Dropbox / iCloud Drive / Google Drive / Syncthing folder, each computer that opens the same file stays in sync. Before each write and whenever the app regains focus, the file is read and **merged**:
   - people merge per record by `updatedAt` (newest wins);
   - other records merge by id, and the copy saved most recently wins;
   - deletions are kept as tombstones (`deleted` map), so a deleted record never comes back.
3. **Export / import** a full JSON backup (merge or replace), plus a CSV of people. This is the path for phones, where browsers can't keep a linked file.

Why not a hosted cloud database? It would put the data on a server the developer runs, which goes against the brief. A personal cloud-drive file covers backup and multiple devices with zero infrastructure. Possible later step: wrap the same app with Capacitor/Tauri for native phone and desktop file access.

## 3. Person entry

Can be saved with only a first name. Fields:
- First / middle / last name, nickname, maiden / former name
- Photo (downscaled to a 480 px JPEG)
- Phones, emails, addresses (labelled, many of each; tel:/mailto: links)
- Birthday (with a "year unknown" option) → age, plus a "birthday in N days" badge
- Place met
- Favorites (label + value: food, color …)
- Custom fields (label + value)
- File attachments (stored inline as data URLs; warning above 15 MB)
- Notes
- Lists membership (flag)
- `createdAt` and `updatedAt` are tracked automatically and shown at the bottom. `updatedAt` also changes when the person's timeline or links change.
- Quick actions: Flag, "Contacted today" (moves or creates the *Last contacted* event), Family view, Delete (with confirmation).

## 4. Relationships

- Link to any other entry (or create a new one by typing a name), then choose a relationship: "Jane is John's **Daughter**". The reverse ("John is Jane's **Parent**") is filled in from the relationship type and can be edited or left blank for a one-way link. Both directions share a `pairId` and are deleted together.
- Relationship types can be edited in Settings: name, what the other side is called, whether it's a family link, and the generation offset (−2…+2) used to lay out families.

## 5. Tags, locations, life events, lists, lanes

- A user-managed list of **tags** (with colours), **locations** and **life event types**. You can create them in Settings, or on the fly by typing a new name in the timeline editor or Quick add.
- Defaults: event types *First met, Last contacted, Engagement, Wedding, Child's birth, Adoption, Graduation, Divorce, Moved, New job, Retirement, Passed away*.
- **Lists**: named lists for flagging people to refine later. "Flagged" is the built-in quick-flag list. Search results can be added to a list in bulk.
- **Lanes**: defaults are *Life events*, *Tags* and *Location*. You can add custom lanes; they appear on every person's timeline. Lanes can be renamed and reordered, and custom lanes deleted.

## 6. Timeline (per person)

- Multi-lane, horizontal, day resolution. Each entry has a start date, then either a single day, "through present", or an end date. Each entry also has a tag, location, event type or free text, depending on its lane, plus a note.
- Zoom: Decades / Years / Months / Weeks / Days presets, +/−, **Fit** (the default when a person opens), and Ctrl + scroll around the cursor. The axis adapts (years → months → days). Only visible ticks are rendered.
- Overlapping entries in a lane stack into extra rows. A long bar keeps its label in view while scrolling. Ongoing bars have a dashed end. Markers show the birthday (★) and today (red line).
- Click an empty spot in a lane to add an entry on that date; click an entry to edit or delete it. A **List** toggle shows the same entries chronologically.

## 7. Search & totals

- Free text (all name parts, place met, notes, contact info, favorites, custom fields, attachment names, timeline text).
- Filters: tags, locations, life events, relationship types, lists, birthday month, photo yes/no.
- Date range applied to **timeline entries overlapping the range** (e.g. Tag = Neighbor, From 2007, To 2007 → "who did I tag as a neighbor in 2007?"), or to date added, date last edited, or date of birth. Accepts `2007`, `2007-06` or `2007-06-15`.
- Shows a **total count**, "count by" tag / location / list / last name, the timeline entries that made each person match, export of the results as CSV, and adding all results to a list.
- A quick filter is also built into the people sidebar (by name, recently added, recently edited; filter by list).

## 8. Families

- Built by walking family-type relationships from a person, with generations assigned from each type's offset.
- The tree shows generation rows. Partners sit side by side with a dashed line, and children hang from the middle of their parents' line. Other family links (siblings, cousins) are listed underneath.
- An index lists every family group (the most common last names, and the number of people). Click a card to centre on that person; double-click to open their page.

## 9. Home & shortcuts

- Home: upcoming birthdays (21 days), flagged people, recently edited.
- Upcoming wedding/engagement anniversaries (30 days) are shown as a badge on the person's page.
- Shortcuts: **N** quick add, **/** search, Ctrl+Z / Ctrl+Shift+Z undo / redo.
- Quick add: first name (required), last name, where met, date met, tag, location, note. It creates a *First met* event, plus the tag and location as "through present" entries. Shift+Enter saves and starts another.

---

## Phase status

### Phase 1 — done (Nov 2026)
- [x] Data model, IndexedDB autosave, undo/redo
- [x] Person page with every field in §3, photo, attachments
- [x] Relationships with automatic reverse links
- [x] Multi-lane timeline with zoom, add/edit/delete, list view
- [x] Tags, locations, event types, lists, custom lanes (Settings)
- [x] Quick add, sidebar filter and sort
- [x] Search with date ranges, totals, count-by, CSV export, bulk add to list
- [x] Families index and tree
- [x] Linked sync file with merge, JSON backup import/export, CSV export
- [x] PWA (installable, offline), responsive phone layout, dark mode
- [x] Sample data loader

### Ideas for next phases
- [ ] Import from phone contacts (vCard `.vcf`) and export vCard
- [ ] Reminders / notifications for birthdays and anniversaries
- [ ] Global timeline: "everyone tagged X over time" across people
- [ ] Optional end-to-end-encrypted sync file (password)
- [ ] Native wrappers (Capacitor for iOS/Android, Tauri for desktop) for file sync on phones
- [ ] Attachments stored as separate files next to the data file (keeps the JSON small)
