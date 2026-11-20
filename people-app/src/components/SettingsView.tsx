import { useRef, useState } from 'react';
import {
  addLane, addList, addPlace, addTag, deleteLane, deleteList, deletePlace, deleteTag, moveLane, renameLane,
  renameList, setEventTypes, setRelationshipTypes, updatePlace, updateTag,
} from '../actions';
import { normalize } from '../defaults';
import { mergeDatabases } from '../merge';
import { sampleDatabase } from '../sample';
import {
  getDB, linkExistingFile, linkNewFile, reconnectFile, replaceAll, unlinkFile, update, useDB, useSync,
} from '../store';
import { download, fmtBytes, fmtStamp, todayISO } from '../util';
import { peopleToCsv } from './SearchView';
import { Section } from './ui';

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState('');
  const go = () => { if (v.trim()) { onAdd(v.trim()); setV(''); } };
  return (
    <div className="row">
      <input value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      <button onClick={go} disabled={!v.trim()}>Add</button>
    </div>
  );
}

function DataSection() {
  const db = useDB();
  const sync = useSync();
  const importInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [msg, setMsg] = useState('');
  const size = new Blob([JSON.stringify(db)]).size;

  const run = async (fn: () => Promise<void>) => {
    try { setMsg(''); await fn(); } catch (e) {
      if ((e as Error).name !== 'AbortError') setMsg((e as Error).message);
    }
  };

  return (
    <Section title="Your data" id="data">
      <p>
        Everything is stored <strong>on this device</strong> (in this browser’s private storage). Nothing is sent to any server —
        there is no account and the developer never sees your data.
      </p>
      <p className="muted small">
        {db.people.length} people · {db.timeline.length} timeline entries · {fmtBytes(size)}
        {sync.lastLocalSave && ` · saved ${fmtStamp(sync.lastLocalSave)}`}
        {sync.persisted ? ' · storage is marked persistent' : ' · the browser may clear storage if the disk gets full — link a file or export backups'}
      </p>

      <h4>Sync &amp; backup file</h4>
      {sync.fileStatus === 'unsupported' ? (
        <p className="muted">This browser can’t keep a linked file (use Chrome or Edge on a computer). Use Export / Import below instead.</p>
      ) : (
        <>
          <p className="muted small">
            Link a data file and every change is written to it automatically. Put the file in a folder that your own cloud drive
            syncs (OneDrive, Dropbox, iCloud Drive, Google Drive for desktop, Syncthing) and open the same file on your other
            computers — edits from each device are merged.
          </p>
          {sync.fileStatus === 'none' && (
            <div className="row wrap">
              <button className="primary" onClick={() => run(linkNewFile)}>Create data file…</button>
              <button onClick={() => run(linkExistingFile)}>Open existing data file…</button>
            </div>
          )}
          {sync.fileStatus === 'linked' && (
            <div className="row wrap">
              <span>✓ Linked to <strong>{sync.fileName}</strong>{sync.lastFileWrite && ` · written ${fmtStamp(sync.lastFileWrite)}`}</span>
              <button onClick={() => run(unlinkFile)}>Unlink</button>
            </div>
          )}
          {sync.fileStatus === 'needs-permission' && (
            <div className="row wrap">
              <span>Linked to <strong>{sync.fileName}</strong>, but the browser needs your OK again.</span>
              <button className="primary" onClick={() => run(reconnectFile)}>Reconnect</button>
              <button onClick={() => run(unlinkFile)}>Unlink</button>
            </div>
          )}
          {sync.fileStatus === 'error' && (
            <div className="row wrap">
              <span className="error">{sync.error}</span>
              <button onClick={() => run(reconnectFile)}>Retry</button>
              <button onClick={() => run(unlinkFile)}>Unlink</button>
            </div>
          )}
        </>
      )}

      <h4>Export &amp; import</h4>
      <div className="row wrap">
        <button onClick={() => download(`people-backup-${todayISO()}.people.json`, JSON.stringify(getDB(), null, 1))}>Export full backup (.json)</button>
        <button onClick={() => download(`people-${todayISO()}.csv`, peopleToCsv(db, db.people), 'text/csv')}>Export people (.csv)</button>
      </div>
      <div className="row wrap">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}>
          <option value="merge">Merge with what’s here</option>
          <option value="replace">Replace everything</option>
        </select>
        <button onClick={() => importInput.current?.click()}>Import backup…</button>
        <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const incoming = normalize(JSON.parse(await f.text()));
            if (mode === 'replace' && !confirm(`Replace all ${db.people.length} people with ${incoming.people.length} from ${f.name}? (You can undo.)`)) return;
            replaceAll(mode === 'merge' ? mergeDatabases(getDB(), incoming) : incoming);
            setMsg(`Imported ${incoming.people.length} people from ${f.name}.`);
          } catch (err) {
            setMsg(`Could not read ${f.name}: ${(err as Error).message}`);
          }
        }} />
      </div>
      {db.people.length === 0 && (
        <div className="row wrap">
          <button onClick={() => replaceAll(sampleDatabase())}>Load sample people to try things out</button>
        </div>
      )}
      {msg && <p className="small">{msg}</p>}
    </Section>
  );
}

function RelationshipTypesSection() {
  const db = useDB();
  const types = db.relationshipTypes;
  const set = (i: number, patch: Partial<(typeof types)[number]>) =>
    setRelationshipTypes(types.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <Section title="Relationship types">
      <p className="muted small">“Generation” places the other person in the family view: −1 = one generation older (Parent), +1 = younger (Child).</p>
      <div className="table-wrap">
        <table className="edit-table">
          <thead><tr><th>Name</th><th>Other side is called</th><th>Family</th><th>Generation</th><th /></tr></thead>
          <tbody>
            {types.map((t, i) => (
              <tr key={i}>
                <td><input value={t.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
                <td><input value={t.inverse} onChange={(e) => set(i, { inverse: e.target.value })} /></td>
                <td><input type="checkbox" checked={t.family} onChange={(e) => set(i, { family: e.target.checked })} /></td>
                <td>
                  <select value={t.generation} onChange={(e) => set(i, { generation: Number(e.target.value) })}>
                    {[-2, -1, 0, 1, 2].map((g) => <option key={g} value={g}>{g > 0 ? `+${g}` : g}</option>)}
                  </select>
                </td>
                <td><button className="icon" onClick={() => setRelationshipTypes(types.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddRow placeholder="New relationship type" onAdd={(name) => setRelationshipTypes([...types, { name, inverse: '', family: false, generation: 0 }])} />
    </Section>
  );
}

export function SettingsView() {
  const db = useDB();
  const usage = (pred: (t: (typeof db.timeline)[number]) => boolean) =>
    new Set(db.timeline.filter(pred).map((t) => t.personId)).size;

  return (
    <div className="settings">
      <DataSection />

      <div className="settings-grid">
        <Section title="Tags">
          <ul className="edit-list">
            {db.tags.map((t) => (
              <li key={t.id}>
                <input type="color" value={t.color} onChange={(e) => updateTag(t.id, { color: e.target.value })} />
                <input value={t.name} onChange={(e) => updateTag(t.id, { name: e.target.value })} />
                <span className="muted small">{usage((x) => x.tagId === t.id)}</span>
                <button className="icon" title="Delete tag" onClick={() => confirm(`Delete “${t.name}” and remove it from every timeline?`) && deleteTag(t.id)}>×</button>
              </li>
            ))}
          </ul>
          <AddRow placeholder="e.g. Pickleball Team" onAdd={addTag} />
        </Section>

        <Section title="Locations">
          <ul className="edit-list">
            {db.places.map((p) => (
              <li key={p.id}>
                <input value={p.name} onChange={(e) => updatePlace(p.id, e.target.value)} />
                <span className="muted small">{usage((x) => x.placeId === p.id)}</span>
                <button className="icon" title="Delete location" onClick={() => confirm(`Delete “${p.name}” and remove it from every timeline?`) && deletePlace(p.id)}>×</button>
              </li>
            ))}
          </ul>
          <AddRow placeholder="e.g. Duluth, MN" onAdd={addPlace} />
        </Section>

        <Section title="Timeline lanes">
          <p className="muted small">Lanes appear on every person’s timeline.</p>
          <ul className="edit-list">
            {db.lanes.map((l, i) => (
              <li key={l.id}>
                <input value={l.name} onChange={(e) => renameLane(l.id, e.target.value)} />
                <span className="muted small">{l.builtIn ? l.kind : 'custom'}</span>
                <button className="icon" disabled={i === 0} onClick={() => moveLane(l.id, -1)} title="Move up">↑</button>
                <button className="icon" disabled={i === db.lanes.length - 1} onClick={() => moveLane(l.id, 1)} title="Move down">↓</button>
                {!l.builtIn && <button className="icon" title="Delete lane" onClick={() => confirm(`Delete lane “${l.name}” and everything on it?`) && deleteLane(l.id)}>×</button>}
              </li>
            ))}
          </ul>
          <AddRow placeholder="e.g. Job, School, Church" onAdd={addLane} />
        </Section>

        <Section title="Life event types">
          <ul className="edit-list">
            {db.eventTypes.map((e, i) => (
              <li key={i}>
                <input value={e} onChange={(ev) => {
                  const old = e;
                  const name = ev.target.value;
                  setEventTypes(db.eventTypes.map((x, j) => (j === i ? name : x)));
                  // keep existing timeline entries pointing at the renamed type
                  update((d) => ({ ...d, timeline: d.timeline.map((t) => (t.eventType === old ? { ...t, eventType: name } : t)) }), 'eventTypes');
                }} />
                <span className="muted small">{usage((x) => x.eventType === e)}</span>
                <button className="icon" onClick={() => setEventTypes(db.eventTypes.filter((_, j) => j !== i))} title="Remove from suggestions">×</button>
              </li>
            ))}
          </ul>
          <AddRow placeholder="e.g. Baptism" onAdd={(v) => setEventTypes([...db.eventTypes, v])} />
        </Section>

        <Section title="Lists">
          <p className="muted small">Flag people into lists to refine later (“Flagged” is the quick-flag list).</p>
          <ul className="edit-list">
            {db.lists.map((l) => (
              <li key={l.id}>
                <input value={l.name} onChange={(e) => renameList(l.id, e.target.value)} />
                <span className="muted small">{db.people.filter((p) => p.listIds.includes(l.id)).length}</span>
                <a className="small" href={`#/search?list=${l.id}`}>view</a>
                {l.id !== 'list-flagged' && <button className="icon" onClick={() => confirm(`Delete list “${l.name}”? People stay.`) && deleteList(l.id)}>×</button>}
              </li>
            ))}
          </ul>
          <AddRow placeholder="e.g. Christmas cards" onAdd={addList} />
        </Section>
      </div>

      <RelationshipTypesSection />

      <Section title="Keyboard shortcuts">
        <ul className="shortcuts small">
          <li><kbd>N</kbd> Quick add a person</li>
          <li><kbd>/</kbd> Search</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> Undo · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> Redo</li>
          <li><kbd>Ctrl</kbd> + scroll on a timeline to zoom</li>
        </ul>
      </Section>
    </div>
  );
}
