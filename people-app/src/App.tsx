import { useEffect, useState } from 'react';
import { FamilyView } from './components/FamilyView';
import { PeopleList } from './components/PeopleList';
import { PersonView } from './components/PersonView';
import { QuickAdd } from './components/QuickAdd';
import { SearchView } from './components/SearchView';
import { SettingsView } from './components/SettingsView';
import { sampleDatabase } from './sample';
import { canRedo, canUndo, reconnectFile, redo, replaceAll, undo, useDB, useSync } from './store';
import { daysUntilAnniversary, displayName } from './util';
import { Avatar } from './components/ui';

type Route =
  | { view: 'people'; id?: string }
  | { view: 'search'; listId?: string }
  | { view: 'families'; id?: string }
  | { view: 'settings' };

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const [a, b] = path.split('/');
  if (a === 'person') return { view: 'people', id: b };
  if (a === 'search') return { view: 'search', listId: new URLSearchParams(query).get('list') || undefined };
  if (a === 'families') return { view: 'families', id: b };
  if (a === 'settings') return { view: 'settings' };
  return { view: 'people' };
}

const go = (hash: string) => { location.hash = hash; };

function SyncBadge() {
  const s = useSync();
  if (s.fileStatus === 'linked') return <a className="sync ok" href="#/settings" title={`Saving to ${s.fileName}`}>● Synced to file</a>;
  if (s.fileStatus === 'needs-permission')
    return <button className="sync warn" onClick={() => reconnectFile()} title={`Click to let the app keep writing ${s.fileName}`}>● Reconnect file</button>;
  if (s.fileStatus === 'error') return <a className="sync err" href="#/settings" title={s.error}>● Sync problem</a>;
  return <a className="sync" href="#/settings" title="Saved in this browser only. Link a file in Settings to back up and sync.">● This device only</a>;
}

function Welcome({ onQuickAdd }: { onQuickAdd: () => void }) {
  return (
    <div className="welcome card">
      <h1>Remember everyone you meet.</h1>
      <p>Add a person with as little as a first name, then build up their timeline — where you met, tags like “Pickleball Team”, where they lived, and life events like weddings and births.</p>
      <div className="row wrap">
        <button className="primary" onClick={onQuickAdd}>+ Add your first person</button>
        <button onClick={() => replaceAll(sampleDatabase())}>Load sample people</button>
        <a className="button" href="#/settings">Set up a sync file</a>
      </div>
      <p className="muted small">Your data stays on your devices. No account, no server.</p>
    </div>
  );
}

function Upcoming() {
  const db = useDB();
  const soon = db.people
    .map((p) => ({ p, days: daysUntilAnniversary(p.birthday) }))
    .filter((x): x is { p: (typeof db.people)[number]; days: number } => x.days !== null && x.days <= 21)
    .sort((a, b) => a.days - b.days);
  const flagged = db.people.filter((p) => p.listIds.includes('list-flagged'));
  const recent = [...db.people].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  return (
    <div className="home">
      <section className="card">
        <h3>Upcoming birthdays</h3>
        {soon.length === 0 ? <p className="muted">None in the next three weeks.</p> : (
          <ul className="mini-list">
            {soon.map(({ p, days }) => (
              <li key={p.id}><a href={`#/person/${p.id}`}><Avatar person={p} size={24} /> {displayName(p)}</a>
                <span className="muted small">{days === 0 ? 'today 🎂' : `in ${days} day${days === 1 ? '' : 's'}`}</span></li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h3>Flagged ({flagged.length})</h3>
        {flagged.length === 0 ? <p className="muted">Flag people you want to come back to.</p> : (
          <ul className="mini-list">
            {flagged.slice(0, 8).map((p) => (
              <li key={p.id}><a href={`#/person/${p.id}`}><Avatar person={p} size={24} /> {displayName(p)}</a></li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h3>Recently edited</h3>
        <ul className="mini-list">
          {recent.map((p) => (
            <li key={p.id}><a href={`#/person/${p.id}`}><Avatar person={p} size={24} /> {displayName(p)}</a></li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function App() {
  const db = useDB();
  const [route, setRoute] = useState<Route>(parseHash);
  const [quickAdd, setQuickAdd] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.matches('input, textarea, select, [contenteditable]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        force((n) => n + 1);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        redo();
      } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'n') { e.preventDefault(); setQuickAdd(true); }
        if (e.key === '/') { e.preventDefault(); go('#/search'); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const person = route.view === 'people' && route.id ? db.people.find((p) => p.id === route.id) : undefined;

  return (
    <div className={`app view-${route.view} ${person ? 'has-person' : ''}`}>
      <header className="topbar">
        <a className="brand" href="#/"><img src="./icon.svg" alt="" /> People</a>
        <nav>
          <a className={route.view === 'people' ? 'on' : ''} href={person ? `#/person/${person.id}` : '#/'}>People</a>
          <a className={route.view === 'search' ? 'on' : ''} href="#/search">Search</a>
          <a className={route.view === 'families' ? 'on' : ''} href="#/families">Families</a>
          <a className={route.view === 'settings' ? 'on' : ''} href="#/settings">Settings</a>
        </nav>
        <span className="spacer" />
        <SyncBadge />
        <button className="icon hide-narrow" onClick={undo} disabled={!canUndo()} title="Undo (Ctrl+Z)">↶</button>
        <button className="icon hide-narrow" onClick={redo} disabled={!canRedo()} title="Redo (Ctrl+Shift+Z)">↷</button>
        <button className="primary" onClick={() => setQuickAdd(true)} title="Quick add (N)">+ Quick add</button>
      </header>

      <main>
        {route.view === 'people' && (
          db.people.length === 0 ? <Welcome onQuickAdd={() => setQuickAdd(true)} /> : (
            <div className="people-layout">
              <PeopleList selectedId={person?.id} onSelect={(id) => go(`#/person/${id}`)} />
              <div className="people-main">
                {person ? (
                  <>
                    <a className="back-link" href="#/">← All people</a>
                    <PersonView key={person.id} person={person} onOpen={(id) => go(`#/person/${id}`)} onClosed={() => go('#/')} />
                  </>
                ) : route.id ? (
                  <p className="muted">That person no longer exists.</p>
                ) : (
                  <Upcoming />
                )}
              </div>
            </div>
          )
        )}
        {route.view === 'search' && <SearchView key={route.listId || ''} initialListId={route.listId} onOpen={(id) => go(`#/person/${id}`)} />}
        {route.view === 'families' && <FamilyView focusId={route.id} />}
        {route.view === 'settings' && <SettingsView />}
      </main>

      {quickAdd && <QuickAdd onClose={() => setQuickAdd(false)} onCreated={(id) => go(`#/person/${id}`)} />}
    </div>
  );
}
