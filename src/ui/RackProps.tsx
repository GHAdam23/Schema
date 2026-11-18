// Properties for racks and the units mounted in them.
import type { RackLabelSide, RackObj, RackSpec, RackUnitObj } from '../model/types';
import { pickFile } from '../io/files';
import { importMediaFile, MEDIA_ACCEPT } from '../io/importMedia';
import { newId } from '../model/ids';
import { currentPage, nextLabel, setState, toast, updateProject, type AppState } from '../state/store';
import { patchObjects, projectDefToLibrary, renameDevice, setPage } from '../state/actions';
import { rackProblems, setRackSpec, setUnitPosition, setUnitSize } from '../state/rackActions';
import { ACCESSORY_NAMES, labelSideOf, isCustom, rackSpecOf, slotsOf, unitDef, unitName, unitSpec, unitsIn } from '../model/rack';
import { devicePages } from '../model/tags';
import { ColorSwatch, Field, Group, NumberField } from './controls';

function patchRack(id: string, fn: (r: RackObj) => void, label: string) {
  nextLabel(label);
  patchObjects([id], (t) => void (t.kind === 'rack' && fn(t as RackObj)));
}

/** The model after the name, unless the name already is the model (unnamed device). */
function modelHint(x: { name: string; def?: { model: string } }) {
  return x.def && x.name !== x.def.model ? <span className="muted">{x.def.model}</span> : <i className="muted">(no name)</i>;
}

const enter = (e: React.KeyboardEvent) => e.key === 'Enter' && (e.target as HTMLInputElement).blur();

export function RackSection({ s, o }: { s: AppState; o: RackObj }) {
  const page = currentPage(s);
  const units = unitsIn(page, o.id)
    .map((u) => ({ u, sp: unitSpec(s.project, u), def: unitDef(s.project, u), name: unitName(s.project, u) }))
    .sort((a, b) => (isCustom(a.sp) ? 1 : 0) - (isCustom(b.sp) ? 1 : 0) || b.u.u + b.sp.ru - (a.u.u + a.sp.ru) || a.u.slot - b.u.slot);
  const used = new Set<number>();
  for (const x of units) if (!isCustom(x.sp)) for (let i = x.u.u; i < x.u.u + x.sp.ru; i++) used.add(i);
  const problems = rackProblems(s.project, page, o);
  const noDepth = units.filter((x) => !x.sp.depth && !x.u.accessory).length;
  // Paper scale: 72 points per inch on paper.
  const ratio = Math.round((72 / o.scale) * 100) / 100;
  return (
    <div className="section">
      <div className="section-title">Rack</div>
      <Group title="Title">
        <Field label="Name">
          <input key={o.id + 'n' + o.name} defaultValue={o.name} placeholder="e.g. Backstage 40U Rack" onBlur={(e) => e.target.value !== o.name && patchRack(o.id, (r) => (r.name = e.target.value), 'Rename rack')} onKeyDown={enter} />
        </Field>
        <Field label="Tag (shown in quotes)">
          <input key={o.id + 't' + o.tag} defaultValue={o.tag} placeholder="e.g. AV1" onBlur={(e) => e.target.value !== o.tag && patchRack(o.id, (r) => (r.tag = e.target.value), 'Rack tag')} onKeyDown={enter} />
        </Field>
      </Group>
      <Group title="Rack">
        <div className="fieldgroup">
          <label>
            Size <NumberField min={1} max={60} step={1} width={52} value={o.ru} onCommit={(v) => patchRack(o.id, (r) => (r.ru = Math.round(v)), `Rack size ${Math.round(v)}U`)} /> U
          </label>
          <label>
            Look{' '}
            <select value={o.frame} onChange={(e) => patchRack(o.id, (r) => (r.frame = e.target.value as RackObj['frame']), 'Rack look')}>
              <option value="cabinet">Cabinet (grey)</option>
              <option value="frame">Frame / wall rack (black)</option>
            </select>
          </label>
        </div>
        <div className="fieldgroup">
          <label>
            <input type="checkbox" checked={o.numbers} onChange={(e) => patchRack(o.id, (r) => (r.numbers = e.target.checked), 'Rack numbers')} /> RU numbers
          </label>
          <label>
            <input type="checkbox" checked={!!o.casters} onChange={(e) => patchRack(o.id, (r) => (r.casters = e.target.checked || undefined), 'Rack casters')} /> Casters
          </label>
        </div>
        <div className="fieldgroup">
          <span title="Where the equipment's manufacturer, model and name are written (each unit can override it)">Equipment labels</span>
          <span className="seg">
            {(
              [
                ['face', 'On face'],
                ['left', 'Left'],
                ['right', 'Right'],
              ] as const
            ).map(([v, l]) => (
              <button key={v} className={(o.labels ?? 'face') === v ? 'active' : ''} onClick={() => patchRack(o.id, (r) => (r.labels = v === 'face' ? undefined : v), 'Rack label position')}>
                {l}
              </button>
            ))}
          </span>
        </div>
        <div className="fieldgroup">
          <label title="Drawing scale on paper: 1 : 9 means 9 inches of rack per inch of paper. Or drag a corner handle.">
            Scale 1 : <NumberField min={2} max={36} step={1} width={56} value={ratio} onCommit={(v) => patchRack(o.id, (r) => (r.scale = 72 / v), `Rack scale 1:${v}`)} />
          </label>
        </div>
        <div className="muted small">
          Drawn to scale: each space is 19″ × 1.75″ ({((19 * o.scale) / 72).toFixed(2)}″ × {((1.75 * o.scale) / 72).toFixed(2)}″ on paper); this rack is {((o.ru * 1.75 * o.scale) / 72).toFixed(1)}″ tall
          on paper.
        </div>
      </Group>
      <Group title="Side view">
        <label className="check">
          <input type="checkbox" checked={!!o.side} onChange={(e) => patchRack(o.id, (r) => (r.side = e.target.checked || undefined), e.target.checked ? 'Show rack side view' : 'Hide rack side view')} /> Show side view (equipment depth)
        </label>
        {o.side && (
          <div className="fieldgroup">
            <label title="Front rail to rear rail">
              Rack depth <NumberField min={4} max={60} step={1} width={52} value={o.depth} onCommit={(v) => patchRack(o.id, (r) => (r.depth = v), 'Rack depth')} /> in
            </label>
          </div>
        )}
        {o.side && noDepth > 0 && <div className="muted small">{noDepth} unit{noDepth > 1 ? 's have' : ' has'} no depth set — drawn dashed at 12″.</div>}
        {o.side && <div className="muted small">Gear deeper than the rack is drawn sticking out past the rear rail.</div>}
      </Group>
      <Group title={`Contents (${used.size} of ${o.ru} U used)`}>
        {units.length === 0 && <div className="muted small">Drag blocks from the library, devices from the Devices tab, rack parts or front-panel images onto a rack space.</div>}
        <ul className="racklist">
          {units.map((x) => (
            <li key={x.u.id}>
              <button className="linkish" onClick={() => setState({ selection: [x.u.id], selectedPorts: [] })} title={x.def ? `${x.def.manufacturer} ${x.def.model}` : x.name}>
                <span className="ru">{isCustom(x.sp) ? 'shelf' : x.sp.ru > 1 ? `${x.u.u}–${x.u.u + x.sp.ru - 1}` : x.u.u}</span> {x.name} {x.def && modelHint(x)}
              </button>
            </li>
          ))}
        </ul>
        {problems.map((p) => (
          <div key={p} className="warnbox">
            {p}
          </div>
        ))}
      </Group>
    </div>
  );
}

const WIDTHS: [NonNullable<RackSpec['width']>, string, string][] = [
  ['full', 'Full', 'Full 19″ width'],
  ['half', '½', 'Half width (two side by side)'],
  ['third', '⅓', 'Third width (three side by side)'],
  ['custom', 'Shelf', 'Not rack-mount: sits on a shelf, drawn at its real width × height'],
];

function PositionGroup({ s, o }: { s: AppState; o: RackUnitObj }) {
  const page = currentPage(s);
  const sp = unitSpec(s.project, o);
  const slots = slotsOf(sp.width);
  const rack = o.rackId ? page.objects.find((x): x is RackObj => x.id === o.rackId && x.kind === 'rack') : undefined;
  return (
    <Group title="Position">
      {rack && isCustom(sp) ? (
        <div className="muted small">On a shelf in rack {rack.tag || rack.name}. Drag it to move it; it sits on the shelf it's dropped on.</div>
      ) : rack ? (
        <>
          <div className="fieldgroup">
            <label title="Lowest rack unit it occupies (1 = bottom)">
              Bottom RU <NumberField min={1} max={rack.ru} step={1} width={52} value={o.u} onCommit={(v) => setUnitPosition(o.id, Math.round(v), o.slot)} />
            </label>
            {slots > 1 && (
              <span className="seg">
                {Array.from({ length: slots }, (_, i) => (
                  <button key={i} className={o.slot === i ? 'active' : ''} onClick={() => setUnitPosition(o.id, o.u, i)}>
                    {slots === 2 ? (i ? 'Right' : 'Left') : ['Left', 'Middle', 'Right'][i]}
                  </button>
                ))}
              </span>
            )}
          </div>
          <div className="muted small">In rack {rack.tag || rack.name}. Drag it to another empty space, or off the rack to take it out.</div>
        </>
      ) : (
        <div className="muted small">Not in a rack — drag it onto an empty rack space.</div>
      )}
    </Group>
  );
}

/** Blank / brush / vent panels, shelves and front-panel images: their own size and label. */
function PartSection({ s, o }: { s: AppState; o: RackUnitObj }) {
  const sz = o.size ?? { ru: 1 };
  const patch = (fn: (u: RackUnitObj) => void, label: string) => {
    nextLabel(label);
    patchObjects([o.id], (t) => void (t.kind === 'rackunit' && fn(t as RackUnitObj)));
  };
  const sp = unitSpec(s.project, o);
  return (
    <div className="section">
      <div className="section-title">{o.accessory ? ACCESSORY_NAMES[o.accessory] : 'Front-panel image'}</div>
      <Group title="Size">
        <div className="fieldgroup">
          <label>
            Height <NumberField min={1} max={20} step={1} width={48} value={sz.ru} onCommit={(v) => setUnitSize(o.id, { ru: Math.round(v) })} /> U
          </label>
          <label>
            Depth <NumberField min={0} max={48} step={0.25} width={56} value={sp.depth || ''} placeholder="?" onCommit={(v) => setUnitSize(o.id, { depth: v })} /> in
          </label>
        </div>
        {o.accessory !== 'shelf' && (
          <div className="fieldgroup">
            <span>Width</span>
            <span className="seg">
              {WIDTHS.slice(0, 3).map(([w, l, t]) => (
                <button key={w} className={(sz.width ?? 'full') === w ? 'active' : ''} title={t} onClick={() => setUnitSize(o.id, { width: w as 'full' })}>
                  {l}
                </button>
              ))}
            </span>
          </div>
        )}
        {o.assetId && <div className="muted small">The picture is stretched to fill the space.</div>}
      </Group>
      {o.accessory !== 'shelf' && (
        <Group title={o.assetId ? 'Name' : 'Label'}>
          <input
            key={o.id + (o.label ?? '')}
            defaultValue={o.label ?? ''}
            placeholder={o.assetId ? 'e.g. AJA HELO (shown in the side view)' : 'e.g. BLANK PANEL (optional)'}
            onBlur={(e) => e.target.value !== (o.label ?? '') && patch((u) => (u.label = e.target.value || undefined), 'Rack part label')}
            onKeyDown={enter}
          />
          {o.accessory && (
            <div className="fieldgroup">
              <label>
                Panel <ColorSwatch value={o.fill ?? '#595959'} defaultColor="#595959" defaultLabel="Default (dark grey)" onChange={(c) => patch((u) => (u.fill = c && c !== '#595959' ? c : null), 'Panel colour')} />
              </label>
              <label>
                Text <ColorSwatch value={o.color === '#000000' ? '#ffffff' : o.color} defaultColor="#ffffff" defaultLabel="Default (white)" onChange={(c) => patch((u) => (u.color = c && c !== '#ffffff' ? c : '#000000'), 'Panel text colour')} />
              </label>
            </div>
          )}
        </Group>
      )}
      <PositionGroup s={s} o={o} />
      {o.assetId && <LabelGroup s={s} o={o} />}
    </div>
  );
}

export function RackUnitSection({ s, o }: { s: AppState; o: RackUnitObj }) {
  if (o.accessory || !o.deviceId) return <PartSection s={s} o={o} />;
  const dev = s.project.devices[o.deviceId];
  const def = unitDef(s.project, o);
  if (!dev || !def) return <div className="section">Missing device.</div>;
  const sp = rackSpecOf(def);
  const here = s.project.pages.findIndex((p) => p.id === s.pageId);
  const pages = devicePages(s.project, dev.id).filter((i) => i !== here);
  const usage = Object.values(s.project.devices).filter((d) => d.defId === def.id).length;
  const patch = (fn: (u: RackUnitObj) => void, label: string) => {
    nextLabel(label);
    patchObjects([o.id], (t) => void (t.kind === 'rackunit' && fn(t as RackUnitObj)));
  };
  const lib = s.library.find((l) => l.id === def.libraryId);
  const libSp = lib ? rackSpecOf(lib) : null;
  const key = (x: typeof sp) => JSON.stringify([x.set, x.ru, x.width, x.depth, x.width === 'custom' ? [x.w, x.h] : 0]);
  const differs = !!lib && key(libSp!) !== key(sp);
  return (
    <div className="section">
      <div className="section-title">Rack unit</div>
      <Field label="Friendly name">
        <input key={dev.id + dev.name} defaultValue={dev.name} placeholder="add friendly name" onBlur={(e) => e.target.value.trim() !== dev.name && renameDevice(dev.id, e.target.value.trim())} onKeyDown={enter} />
      </Field>
      <div className="muted">
        {def.manufacturer} | {def.model}
      </div>
      {pages.length > 0 && (
        <div className="btnrow small">
          <span className="muted">Same device on page</span>
          {pages.map((i) => (
            <button key={i} title={s.project.pages[i].name} onClick={() => setPage(s.project.pages[i].id)}>
              {i + 1}
            </button>
          ))}
        </div>
      )}
      <Group title={`Size — every ${def.model || 'unit of this model'}${usage > 1 ? ` (${usage})` : ''}`}>
        <div className="fieldgroup">
          <span>Width</span>
          <span className="seg">
            {WIDTHS.map(([w, l, t]) => (
              <button key={w} className={sp.width === w ? 'active' : ''} title={t} onClick={() => setRackSpec(def.id, { width: w })}>
                {l}
              </button>
            ))}
          </span>
        </div>
        <div className="fieldgroup">
          {sp.width === 'custom' ? (
            <>
              <label>
                W <NumberField min={0.5} max={19} step={0.25} width={52} value={sp.w} onCommit={(v) => setRackSpec(def.id, { w: v })} /> in
              </label>
              <label>
                H <NumberField min={0.25} max={40} step={0.25} width={52} value={sp.h} onCommit={(v) => setRackSpec(def.id, { h: v })} /> in
              </label>
            </>
          ) : (
            <label>
              Height <NumberField min={1} max={20} step={1} width={48} value={sp.ru} onCommit={(v) => setRackSpec(def.id, { ru: Math.round(v) })} /> U
            </label>
          )}
          <label>
            Depth <NumberField min={0} max={60} step={0.25} width={56} placeholder="?" value={sp.depth || ''} onCommit={(v) => setRackSpec(def.id, { depth: v || undefined })} /> in
          </label>
        </div>
        {!sp.set && <div className="warntext small">No size set for this model yet (drawn as 1U, full width).</div>}
        {!lib && <div className="muted small">Not in your library.</div>}
        {differs && (
          <div className="btnrow small">
            <span className="warntext">Differs from your library.</span>
            <button onClick={() => projectDefToLibrary(def.id)} title="Save this model (size and ports) into your library for future projects">
              Save to library
            </button>
          </div>
        )}
      </Group>
      <PositionGroup s={s} o={o} />
      <LabelGroup s={s} o={o} />
      <Group title="Face">
        <div className="btnrow small">
          <button title="Show a picture of the front panel (PNG, JPG, PDF or SVG, cropped to the panel) instead of the drawn face" onClick={() => void pickFacePicture(o.id)}>
            {o.assetId ? 'Replace picture…' : 'Use a picture…'}
          </button>
          {o.assetId && (
            <button onClick={() => patch((u) => delete u.assetId, 'Remove face picture')}>Drawn face</button>
          )}
        </div>
        <div className="fieldgroup">
          <label>
            Panel <ColorSwatch value={o.fill ?? '#ffffff'} defaultColor="#ffffff" defaultLabel="Default (white)" onChange={(c) => patch((u) => (u.fill = c && c !== '#ffffff' ? c : null), 'Unit face colour')} />
          </label>
          <label>
            Text <ColorSwatch value={o.color} defaultColor="#000000" onChange={(c) => patch((u) => (u.color = c ?? '#000000'), 'Unit text colour')} />
          </label>
        </div>
      </Group>
    </div>
  );
}

/** Pick a front-panel picture for a device unit. */
async function pickFacePicture(id: string) {
  const f = await pickFile(MEDIA_ACCEPT);
  if (!f) return;
  try {
    const r = await importMediaFile(f);
    const assetId = newId('as');
    nextLabel('Face picture');
    updateProject((d) => {
      d.assets[assetId] = r.asset;
      for (const pg of d.pages) for (const o of pg.objects) if (o.id === id && o.kind === 'rackunit') o.assetId = assetId;
    });
  } catch (e) {
    toast(`Could not import ${f.name}: ${(e as Error).message}`, 'error', 7000);
  }
}

/** Where a unit's label goes: on its face, beside the rack, or nowhere. */
function LabelGroup({ s, o }: { s: AppState; o: RackUnitObj }) {
  const rack = o.rackId ? currentPage(s).objects.find((x): x is RackObj => x.id === o.rackId && x.kind === 'rack') : undefined;
  const cur = labelSideOf(rack, o);
  const set = (v: RackLabelSide | undefined) => {
    nextLabel('Unit label position');
    patchObjects([o.id], (t) => {
      if (t.kind !== 'rackunit') return;
      if (v) t.labelSide = v;
      else delete t.labelSide;
    });
  };
  return (
    <Group title="Label">
      <div className="fieldgroup">
        <span className="seg">
          {(
            [
              ['face', 'On face'],
              ['left', 'Left'],
              ['right', 'Right'],
              ['none', 'None'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} className={cur === v ? 'active' : ''} title={v === 'left' || v === 'right' ? `Beside the rack on the ${v}, with a leader line` : undefined} onClick={() => set(v)}>
              {l}
            </button>
          ))}
        </span>
        {o.labelSide && (
          <button className="small" title="Use the rack's setting" onClick={() => set(undefined)}>
            Rack default
          </button>
        )}
      </div>
      {!rack && cur !== 'face' && <div className="muted small">Side labels show once the unit is in a rack.</div>}
    </Group>
  );
}
