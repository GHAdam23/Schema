import { useEffect, useState } from 'react';
import { getState, nextLabel, redo, setState, toast, undo, updateProject, useStore } from '../state/store';
import { savePrefs, type Prefs } from '../state/prefs';
import { fileToImageAsset, pickFile, download } from '../io/files';
import { newId } from '../model/ids';
import { exportPdfCmd, listBackups, restoreBackup, downloadBackup, type BackupRecord } from '../state/fileOps';
import { DEFAULT_SIGNAL_TYPES, PAGE_SIZES } from '../model/defaults';
import type { PageSizeId } from '../model/types';

const close = () => setState({ modal: null });

function Modal({ title, children, buttons, wide }: { title: string; children: React.ReactNode; buttons: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
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
  const [applyToProject, setApplyToProject] = useState(true);
  const save = () => {
    savePrefs(p);
    setState({ prefs: p });
    if (applyToProject) {
      // Designer info lives in each project (so files keep it); copy it into the open one too.
      nextLabel('Designer info from Preferences');
      updateProject((d) => {
        d.info.designerName = p.designerName;
        d.info.copyright = p.copyright;
        d.info.phone = p.phone;
        d.info.email = p.email;
        if (d.info.logoAssetId) delete d.assets[d.info.logoAssetId];
        d.info.logoAssetId = null;
        if (p.logo) {
          const id = newId('as');
          d.assets[id] = p.logo;
          d.info.logoAssetId = id;
        }
      });
    }
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
        <div className="sub">Designer (pre-filled into new projects)</div>
        <label>
          <input type="checkbox" checked={applyToProject} onChange={(e) => setApplyToProject(e.target.checked)} /> Also update the open project's title
          block
        </label>
        <label>
          Name <input value={p.designerName} onChange={(e) => set('designerName', e.target.value)} />
        </label>
        <label>
          Copyright / company <input value={p.copyright} onChange={(e) => set('copyright', e.target.value)} />
        </label>
        <label>
          Phone <input value={p.phone} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label>
          Email <input value={p.email} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label>
          Logo{' '}
          <span>
            {p.logo ? <img className="logo-thumb" src={`data:${p.logo.mime};base64,${p.logo.data}`} /> : <span className="muted">none</span>}{' '}
            <button
              onClick={async () => {
                const f = await pickFile('image/png,image/jpeg');
                if (!f) return;
                try {
                  set('logo', await fileToImageAsset(f));
                } catch (e) {
                  toast((e as Error).message, 'error');
                }
              }}
            >
              Choose…
            </button>{' '}
            {p.logo && <button onClick={() => set('logo', null)}>Remove</button>}
          </span>
        </label>
        <div className="sub">Defaults</div>
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

export function ProjectInfoDialog() {
  const project = useStore((s) => s.project);
  const [info, setInfo] = useState(project.info);
  const [logo, setLogo] = useState(info.logoAssetId ? project.assets[info.logoAssetId] ?? null : null);
  const set = <K extends keyof typeof info>(k: K, v: (typeof info)[K]) => setInfo({ ...info, [k]: v });
  const save = () => {
    nextLabel('Edit project / title block info');
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
  const field = (k: 'name' | 'address' | 'designerName' | 'copyright' | 'phone' | 'email' | 'revision', label: string, multiline = false) => (
    <label>
      {label}
      {multiline ? <textarea rows={2} value={info[k]} onChange={(e) => set(k, e.target.value)} /> : <input value={info[k]} onChange={(e) => set(k, e.target.value)} />}
    </label>
  );
  return (
    <Modal
      title="Project / title block"
      buttons={
        <>
          <button
            onClick={() => {
              const p = getState().prefs;
              setInfo({ ...info, designerName: p.designerName, copyright: p.copyright, phone: p.phone, email: p.email });
              setLogo(p.logo);
            }}
          >
            Reset designer from preferences
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
        {field('name', 'Project name')}
        {field('address', 'Project address', true)}
        {field('revision', 'Revision')}
        <label>
          Created <input type="date" value={info.created.slice(0, 10)} onChange={(e) => set('created', new Date(e.target.value + 'T12:00:00').toISOString())} />
        </label>
        <label>
          Modified <span className="muted">{new Date(info.modified).toLocaleString()} (updates on save)</span>
        </label>
        <div className="sub">Designer</div>
        {field('designerName', 'Name')}
        {field('copyright', 'Copyright / company')}
        {field('phone', 'Phone')}
        {field('email', 'Email')}
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
