// Properties for racks and the units mounted in them.
import type { RackObj, RackSpec, RackUnitObj } from '../model/types';
import { currentPage, nextLabel, setState, type AppState } from '../state/store';
import { patchObjects, projectDefToLibrary, renameDevice, setPage } from '../state/actions';
import { rackProblems, setRackSpec, setUnitPosition } from '../state/rackActions';
import { DEFAULT_RACK_SCALE, rackSpecOf, slotsOf, unitDef, unitSpec, unitsIn } from '../model/rack';
import { devicePages } from '../model/tags';
import { ColorSwatch, Field, Group, NumberField } from './controls';

function patchRack(id: string, fn: (r: RackObj) => void, label: string) {
  nextLabel(label);
  patchObjects([id], (t) => void (t.kind === 'rack' && fn(t as RackObj)));
}

export function RackSection({ s, o }: { s: AppState; o: RackObj }) {
  const page = currentPage(s);
  const units = unitsIn(page, o.id)
    .map((u) => ({ u, sp: unitSpec(s.project, u), def: unitDef(s.project, u), name: s.project.devices[u.deviceId]?.name ?? '?' }))
    .sort((a, b) => b.u.u + b.sp.ru - (a.u.u + a.sp.ru) || a.u.slot - b.u.slot);
  const used = new Set<number>();
  for (const x of units) for (let i = x.u.u; i < x.u.u + x.sp.ru; i++) used.add(i);
  const problems = rackProblems(s.project, page, o);
  const noDepth = units.filter((x) => !x.sp.depth).length;
  return (
    <div className="section">
      <div className="section-title">Rack</div>
      <Group title="Title">
        <Field label="Name">
          <input key={o.id + 'n' + o.name} defaultValue={o.name} placeholder="e.g. Backstage 40U Rack" onBlur={(e) => e.target.value !== o.name && patchRack(o.id, (r) => (r.name = e.target.value), 'Rename rack')} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </Field>
        <Field label="Tag (shown in quotes)">
          <input key={o.id + 't' + o.tag} defaultValue={o.tag} placeholder="e.g. AV1" onBlur={(e) => e.target.value !== o.tag && patchRack(o.id, (r) => (r.tag = e.target.value), 'Rack tag')} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
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
          <label title="Empty spaces drawn as grey blank panels">
            <input type="checkbox" checked={!!o.blanks} onChange={(e) => patchRack(o.id, (r) => (r.blanks = e.target.checked || undefined), 'Rack blank panels')} /> Blank panels in empty spaces
          </label>
        </div>
        <div className="fieldgroup">
          <label title="Drawing scale. 100% = 8 points per inch (a 42U rack is about 8.5 inches tall on paper). Or drag a corner handle.">
            Scale <NumberField min={25} max={375} step={5} width={60} value={Math.round((o.scale / DEFAULT_RACK_SCALE) * 100)} onCommit={(v) => patchRack(o.id, (r) => (r.scale = (DEFAULT_RACK_SCALE * v) / 100), 'Rack scale')} /> %
          </label>
        </div>
      </Group>
      <Group title="Side view">
        <label className="check">
          <input type="checkbox" checked={!!o.side} onChange={(e) => patchRack(o.id, (r) => (r.side = e.target.checked || undefined), e.target.checked ? 'Show rack side view' : 'Hide rack side view')} /> Show side view (equipment depth)
        </label>
        {o.side && (
          <div className="fieldgroup">
            <label>
              Rail depth <NumberField min={4} max={48} step={1} width={52} value={o.depth} onCommit={(v) => patchRack(o.id, (r) => (r.depth = v), 'Rack depth')} /> in
            </label>
          </div>
        )}
        {o.side && noDepth > 0 && <div className="muted small">{noDepth} unit{noDepth > 1 ? 's have' : ' has'} no depth set — drawn dashed at 12″.</div>}
      </Group>
      <Group title={`Contents (${used.size} of ${o.ru} U used)`}>
        {units.length === 0 && <div className="muted small">Drag blocks from the library, or devices from the Devices tab, onto the rack. They snap to the nearest free space.</div>}
        <ul className="racklist">
          {units.map((x) => (
            <li key={x.u.id}>
              <button className="linkish" onClick={() => setState({ selection: [x.u.id], selectedPorts: [] })} title={`${x.def?.manufacturer ?? ''} ${x.def?.model ?? ''}`}>
                <span className="ru">{x.sp.ru > 1 ? `${x.u.u}–${x.u.u + x.sp.ru - 1}` : x.u.u}</span> {x.name} <span className="muted">{x.def?.model}</span>
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

const WIDTHS: [NonNullable<RackSpec['width']>, string][] = [
  ['full', 'Full'],
  ['half', '½'],
  ['third', '⅓'],
];

export function RackUnitSection({ s, o }: { s: AppState; o: RackUnitObj }) {
  const page = currentPage(s);
  const dev = s.project.devices[o.deviceId];
  const def = unitDef(s.project, o);
  if (!dev || !def) return <div className="section">Missing device.</div>;
  const sp = rackSpecOf(def);
  const slots = slotsOf(sp.width);
  const rack = o.rackId ? page.objects.find((x): x is RackObj => x.id === o.rackId && x.kind === 'rack') : undefined;
  const here = s.project.pages.findIndex((p) => p.id === s.pageId);
  const pages = devicePages(s.project, dev.id).filter((i) => i !== here);
  const usage = Object.values(s.project.devices).filter((d) => d.defId === def.id).length;
  const patch = (fn: (u: RackUnitObj) => void, label: string) => {
    nextLabel(label);
    patchObjects([o.id], (t) => void (t.kind === 'rackunit' && fn(t as RackUnitObj)));
  };
  return (
    <div className="section">
      <div className="section-title">Rack unit</div>
      <Field label="Friendly name">
        <input key={dev.id + dev.name} defaultValue={dev.name} onBlur={(e) => e.target.value.trim() && e.target.value !== dev.name && renameDevice(dev.id, e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
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
          <label>
            Height <NumberField min={1} max={20} step={1} width={48} value={sp.ru} onCommit={(v) => setRackSpec(def.id, { ru: Math.round(v) })} /> U
          </label>
          <label>
            Depth <NumberField min={0} max={48} step={0.25} width={56} placeholder="?" value={sp.depth || ''} onCommit={(v) => setRackSpec(def.id, { depth: v || undefined })} /> in
          </label>
        </div>
        <div className="fieldgroup">
          <span>Width</span>
          <span className="seg">
            {WIDTHS.map(([w, l]) => (
              <button key={w} className={sp.width === w ? 'active' : ''} title={w === 'full' ? 'Full 19″ width' : w === 'half' ? 'Half width (two side by side)' : 'Third width (three side by side)'} onClick={() => setRackSpec(def.id, { width: w })}>
                {l}
              </button>
            ))}
          </span>
        </div>
        {!sp.set && <div className="muted small">No size set for this model yet (drawn as 1U, full width).</div>}
        {(() => {
          const lib = s.library.find((l) => l.id === def.libraryId);
          const libSp = lib ? rackSpecOf(lib) : null;
          const differs = !!lib && JSON.stringify([libSp!.set, libSp!.ru, libSp!.width, libSp!.depth]) !== JSON.stringify([sp.set, sp.ru, sp.width, sp.depth]);
          if (!lib) return <div className="muted small">Not in your library.</div>;
          if (!differs) return null;
          return (
            <div className="btnrow small">
              <span className="muted">Differs from your library.</span>
              <button onClick={() => projectDefToLibrary(def.id)} title="Save this model (size and ports) into your library for future projects">
                Save to library
              </button>
            </div>
          );
        })()}
      </Group>
      <Group title="Position">
        {rack ? (
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
            <div className="muted small">
              In rack {rack.tag || rack.name}. Drag it to another space, or off the rack to take it out.
            </div>
          </>
        ) : (
          <div className="muted small">Not in a rack — drag it onto one.</div>
        )}
      </Group>
      <Group title="Face">
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
