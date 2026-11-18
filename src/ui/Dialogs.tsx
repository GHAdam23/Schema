import { useEffect, useState } from 'react';
import { getState, nextLabel, redo, setState, toast, undo, updateProject, useStore } from '../state/store';
import { savePrefs, type Prefs } from '../state/prefs';
import { fileToImageAsset, pickFile, download } from '../io/files';
import { newId } from '../model/ids';
import { exportPdfCmd, listBackups, restoreBackup, downloadBackup, type BackupRecord } from '../state/fileOps';
import { DEFAULT_SIGNAL_TYPES, PAGE_SIZES } from '../model/defaults';
import type { PageSizeId, TagObj } from '../model/types';
import { setTagTarget } from '../state/actions';
import { devicePages } from '../model/tags';

const close = () => setState({ modal: null });

function Modal({ title, children, buttons, wide, onClose = close }: { title: string; children: React.ReactNode; buttons: React.ReactNode; wide?: boolean; onClose?: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? '' : ' small')}>
        <div className="modal-title">{title}</div>
        {children}
        <div className="modal-buttons">{buttons}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function PrefsDialog() {
  const [p, setP] = useState<Prefs>(getState().prefs);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP({ ...p, [k]: v });
  const save = () => {
    savePrefs(p);
    setState({ prefs: p });
    close();
  };
  return (
    <Modal
      title="Preferences"
      buttons={
        <>
          <button
            onClick={() => download(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), 'schema-preferences.json')}
          >
            Export…
          </button>
          <button
            onClick={async () => {
              const f = await pickFile('.json');
              if (!f) return;
              try {
                setP({ ...p, ...JSON.parse(await f.text()) });
                toast('Preferences loaded — click Save to apply.');
              } catch {
                toast('Not a valid preferences file.', 'error');
              }
            }}
          >
            Import…
          </button>
          <div className="spacer" />
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form">
        <div className="muted small">
          App settings for this browser. Everything printed in the title block (project, designer, logo) is in <b>Title block</b>, where you can also
          save your designer details as the default for new projects.
        </div>
        <div className="sub">New projects</div>
        <label>
          Page size{' '}
          <select value={p.defaultPageSize} onChange={(e) => set('defaultPageSize', e.target.value as PageSizeId)}>
            {Object.entries(PAGE_SIZES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Grid size (pt){' '}
          <input type="number" min={1} max={72} value={p.gridSize} onChange={(e) => set('gridSize', Math.max(1, Number(e.target.value) || 9))} />
        </label>
        <div className="sub">Saving</div>
        <label>
          <input type="checkbox" checked={p.autosaveToFile} onChange={(e) => set('autosaveToFile', e.target.checked)} /> Also autosave into the open
          .schema file
        </label>
        <label>
          Backups to keep <input type="number" min={1} max={200} value={p.backupsToKeep} onChange={(e) => set('backupsToKeep', Math.max(1, Number(e.target.value) || 20))} />
        </label>
        <div className="sub">Signal types</div>
        <button onClick={() => setState({ modal: { kind: 'signalTypes' } })}>Edit signal types…</button>
      </div>
    </Modal>
  );
}

export function SignalTypesDialog() {
  const prefs = useStore((s) => s.prefs);
  const [text, setText] = useState(prefs.signalTypes.join('\n'));
  return (
    <Modal
      title="Signal types"
      buttons={
        <>
          <button onClick={() => setText(DEFAULT_SIGNAL_TYPES.join('\n'))}>Reset to defaults</button>
          <div className="spacer" />
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              const list = [...new Set(text.split(/\r?\n/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
              const p = { ...prefs, signalTypes: list };
              savePrefs(p);
              setState({ prefs: p, modal: null });
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="muted small">One per line. Used for suggestions in the block editor and for mismatch warnings.</div>
      <textarea className="textedit" rows={16} value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------

export function TitleBlockDialog() {
  const project = useStore((s) => s.project);
  const prefs = useStore((s) => s.prefs);
  const [info, setInfo] = useState(project.info);
  const [logo, setLogo] = useState(info.logoAssetId ? project.assets[info.logoAssetId] ?? null : null);
  const set = <K extends keyof typeof info>(k: K, v: (typeof info)[K]) => setInfo({ ...info, [k]: v });
  const save = () => {
    nextLabel('Edit title block');
    updateProject((d) => {
      const oldLogo = d.info.logoAssetId;
      const cur = oldLogo ? d.assets[oldLogo] : null;
      let logoId = oldLogo;
      if (logo !== cur) {
        if (oldLogo) delete d.assets[oldLogo];
        logoId = null;
        if (logo) {
          logoId = newId('as');
          d.assets[logoId] = logo;
        }
      }
      d.info = { ...info, logoAssetId: logoId };
    });
    close();
  };
  const saveDefaults = () => {
    const p = { ...prefs, designerName: info.designerName, copyright: info.copyright, phone: info.phone, email: info.email, logo };
    savePrefs(p);
    setState({ prefs: p });
    toast('Designer details and logo saved as the default for new projects.');
  };
  const useDefaults = () => {
    setInfo({ ...info, designerName: prefs.designerName, copyright: prefs.copyright, phone: prefs.phone, email: prefs.email });
    setLogo(prefs.logo);
  };
  const field = (k: 'name' | 'address' | 'designerName' | 'copyright' | 'phone' | 'email' | 'revision', label: string, multiline = false, placeholder = '') => (
    <label>
      {label}
      {multiline ? (
        <textarea rows={2} value={info[k]} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} />
      ) : (
        <input value={info[k]} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} />
      )}
    </label>
  );
  return (
    <Modal
      title="Title block"
      buttons={
        <>
          <div className="spacer" />
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form">
        <div className="muted small">Everything printed in the title block of this project. Saved with the project file.</div>
        <div className="sub">Logo</div>
        <label>
          Logo{' '}
          <span>
            {logo ? <img className="logo-thumb" src={`data:${logo.mime};base64,${logo.data}`} /> : <span className="muted">none</span>}{' '}
            <button
              onClick={async () => {
                const f = await pickFile('image/png,image/jpeg');
                if (!f) return;
                try {
                  setLogo(await fileToImageAsset(f));
                } catch (e) {
                  toast((e as Error).message, 'error');
                }
              }}
            >
              Choose…
            </button>{' '}
            {logo && <button onClick={() => setLogo(null)}>Remove</button>}
          </span>
        </label>
        <div className="sub">Project</div>
        {field('address', 'Project address', true)}
        {field('name', 'Project name', true, 'e.g. Sojourn Campus Church Technology Systems')}
        {field('revision', 'Revision', false, 'e.g. 5.1')}
        <label>
          Created <input type="date" value={info.created.slice(0, 10)} onChange={(e) => set('created', new Date(e.target.value + 'T12:00:00').toISOString())} />
        </label>
        <label>
          Modified <span className="muted">{new Date(info.modified).toLocaleString()} (updates when you save)</span>
        </label>
        <div className="sub">Designer</div>
        {field('designerName', 'Designed by')}
        {field('copyright', 'Copyright', false, 'e.g. Adam Rollin 2025 (printed as "Copyright © …")')}
        {field('phone', 'Phone')}
        {field('email', 'Email')}
        <div className="btnrow">
          <button onClick={saveDefaults} title="New projects will start with these designer details and logo">
            Save designer &amp; logo as my default
          </button>
          <button onClick={useDefaults} title="Fill in the designer details and logo from your saved default">
            Use my default
          </button>
        </div>
        <div className="muted small">Page names and numbers come from the page tabs. Anything you place in the title block on page 1 repeats on every page.</div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------

export function ExportPdfDialog() {
  const pages = useStore((s) => s.project.pages);
  const pageId = useStore((s) => s.pageId);
  const cur = pages.findIndex((p) => p.id === pageId) + 1;
  const [mode, setMode] = useState<'all' | 'current' | 'range'>('all');
  const [range, setRange] = useState(`1-${pages.length}`);
  const [busy, setBusy] = useState(false);
  const parseRange = (): number[] => {
    const out = new Set<number>();
    for (const part of range.split(',')) {
      const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) continue;
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= pages.length) out.add(i - 1);
    }
    return [...out].sort((a, b) => a - b);
  };
  const indices = mode === 'all' ? pages.map((_, i) => i) : mode === 'current' ? [cur - 1] : parseRange();
  return (
    <Modal
      title="Export PDF"
      buttons={
        <>
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            disabled={!indices.length || busy}
            onClick={async () => {
              setBusy(true);
              await exportPdfCmd(indices);
              setBusy(false);
              close();
            }}
          >
            {busy ? 'Exporting…' : `Export ${indices.length} page${indices.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} /> All pages ({pages.length})
        </label>
        <label>
          <input type="radio" checked={mode === 'current'} onChange={() => setMode('current')} /> Current page ({cur})
        </label>
        <label>
          <input type="radio" checked={mode === 'range'} onChange={() => setMode('range')} /> Pages{' '}
          <input value={range} onChange={(e) => setRange(e.target.value)} onFocus={() => setMode('range')} placeholder="e.g. 1-3, 5" />
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------

export function BackupsDialog() {
  const [list, setList] = useState<BackupRecord[] | null>(null);
  useEffect(() => {
    void listBackups().then(setList);
  }, []);
  return (
    <Modal title="Backups" wide buttons={<button onClick={close}>Close</button>}>
      <div className="muted small">
        The open project is autosaved in this browser continuously. A backup snapshot is kept every 5 minutes while editing and on every save
        (the most recent {getState().prefs.backupsToKeep} are kept).
      </div>
      <table className="backups">
        <thead>
          <tr>
            <th>When</th>
            <th>Project</th>
            <th>File</th>
            <th>Kind</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list?.map((b, i) => (
            <tr key={i}>
              <td>{new Date(b.at).toLocaleString()}</td>
              <td>{b.name}</td>
              <td>{b.fileName}</td>
              <td>{b.reason}</td>
              <td>
                <button
                  onClick={() => {
                    close();
                    restoreBackup(b);
                  }}
                >
                  Restore
                </button>{' '}
                <button onClick={() => downloadBackup(b)}>Download</button>
              </td>
            </tr>
          ))}
          {list && !list.length && (
            <tr>
              <td colSpan={5} className="muted">
                No backups yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------

export function HistoryDialog() {
  const pastLog = useStore((s) => s.pastLog);
  const futureLog = useStore((s) => s.futureLog);
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  // Newest first: undone steps (greyed, can be redone) above the current state, then applied steps.
  const undone = futureLog.map((e, i) => ({ e, i })).reverse();
  const done = pastLog.map((e, i) => ({ e, i })).reverse();
  const undoTo = (i: number) => {
    // Undo step i and everything after it.
    for (let n = pastLog.length - i; n > 0; n--) undo();
  };
  const redoTo = (i: number) => {
    for (let n = i + 1; n > 0; n--) redo();
  };
  return (
    <Modal title="History" wide buttons={<button onClick={close}>Close</button>}>
      <div className="muted small">
        Every change in this session, newest first. “Undo to here” undoes that step and everything after it; undone steps can be redone until you
        make a new change. ({pastLog.length} step{pastLog.length === 1 ? '' : 's'} can be undone.)
      </div>
      <div className="history">
        {undone.map(({ e, i }) => (
          <div key={'f' + i} className="hist undone">
            <span className="time">{time(e.at)}</span>
            <span className="label">{e.label}</span>
            <button onClick={() => redoTo(i)}>Redo to here</button>
            {e.details && <Details details={e.details} />}
          </div>
        ))}
        <div className="hist now">— current state —</div>
        {done.map(({ e, i }) => (
          <div key={'p' + i} className="hist">
            <span className="time">{time(e.at)}</span>
            <span className="label">{e.label}</span>
            <button onClick={() => undoTo(i)}>Undo to here</button>
            {e.details && <Details details={e.details} />}
          </div>
        ))}
        {!done.length && !undone.length && <div className="muted">No changes yet.</div>}
      </div>
    </Modal>
  );
}

function Details({ details }: { details: string[] }) {
  return (
    <ul className="details">
      {details.slice(0, 40).map((d, k) => (
        <li key={k}>{d}</li>
      ))}
      {details.length > 40 && <li>…and {details.length - 40} more</li>}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------

/** Pick the device (and optionally the port) a reference tag points to. */
export function TagTargetDialog({ objId, isNew }: { objId: string; isNew: boolean }) {
  const project = useStore((s) => s.project);
  const tag = project.pages.flatMap((p) => p.objects).find((o) => o.id === objId) as TagObj | undefined;
  const [q, setQ] = useState('');
  const [devId, setDevId] = useState(tag?.target?.deviceId ?? '');
  const [portId, setPortId] = useState(tag?.target?.portId ?? '');
  const cancel = () => {
    close();
    if (isNew) undo(); // removes the new tag (and its line) again
  };
  const ok = (dev = devId, port = portId) => {
    close();
    if (dev) setTagTarget(objId, { deviceId: dev, portId: port || undefined });
  };
  if (!tag) return null;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const devices = Object.values(project.devices)
    .map((d) => ({ d, def: project.blockDefs[d.defId], pages: devicePages(project, d.id) }))
    .filter(({ d, def }) => terms.every((t) => `${d.name} ${def?.manufacturer} ${def?.model}`.toLowerCase().includes(t)))
    .sort((a, b) => a.d.name.localeCompare(b.d.name, undefined, { numeric: true }));
  const sel = devId ? project.devices[devId] : undefined;
  const def = sel && project.blockDefs[sel.defId];
  return (
    <Modal
      title="Reference tag — where does this line go?"
      onClose={cancel}
      buttons={
        <>
          <div className="spacer" />
          <button onClick={cancel}>{isNew ? 'Cancel (remove tag)' : 'Cancel'}</button>
          <button className="primary" disabled={!devId} onClick={() => ok()}>
            OK
          </button>
        </>
      }
    >
      <div className="form">
        <input
          autoFocus
          className="search"
          placeholder="Search devices…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && devices.length) ok(devices[0].d.id, '');
          }}
        />
        <div className="quicklist devpick">
          {devices.map(({ d, def: df, pages }) => (
            <div key={d.id} className={'quickitem' + (d.id === devId ? ' sel' : '')} onClick={() => (setDevId(d.id), setPortId(''))} onDoubleClick={() => ok(d.id, '')}>
              <b>{d.name}</b> <span className="muted">{df ? `${df.manufacturer} ${df.model}` : ''} · page {pages.map((i) => i + 1).join(', ')}</span>
            </div>
          ))}
          {!devices.length && <div className="empty">No devices{q ? ' match' : ' in this project yet'}.</div>}
        </div>
        {def && (
          <label>
            Port (optional){' '}
            <select value={portId} onChange={(e) => setPortId(e.target.value)}>
              <option value="">(whole device)</option>
              {[...def.left, ...def.right].map((p) => (
                <option key={p.id} value={p.id}>
                  {p.dir} · {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="muted small">The tag reads TO/FROM (page) NAME and keeps itself up to date when pages move or devices are renamed.</div>
      </div>
    </Modal>
  );
}
