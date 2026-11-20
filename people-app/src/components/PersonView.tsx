import { useRef, useState } from 'react';
import { deletePerson, saveTimelineItem, toggleList, updatePerson } from '../actions';
import { FLAGGED_LIST_ID } from '../defaults';
import { useDB } from '../store';
import type { Attachment, Person } from '../types';
import {
  ageOn, daysUntilAnniversary, fileToDataUrl, fmtBytes, fmtDate, fmtStamp, fullName, imageToThumb, nowStamp, todayISO, uid,
} from '../util';
import { Relationships } from './Relationships';
import { Timeline } from './Timeline';
import { Avatar, LabeledList, Section, TextField } from './ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function BirthdayField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const noYear = value.startsWith('--');
  const [m, d] = noYear ? value.slice(2).split('-').map(Number) : [0, 0];
  return (
    <div className="field">
      <span>Birthday</span>
      {noYear ? (
        <div className="row">
          <select value={m || ''} onChange={(e) => onChange(`--${e.target.value.padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`)}>
            <option value="">Month</option>
            {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
          <input type="number" min={1} max={31} value={d || ''} placeholder="Day" style={{ width: 70 }}
            onChange={(e) => onChange(`--${String(m || 1).padStart(2, '0')}-${e.target.value.padStart(2, '0')}`)} />
        </div>
      ) : (
        <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      <label className="check small">
        <input type="checkbox" checked={noYear} onChange={(e) => {
          if (e.target.checked) onChange(value ? `--${value.slice(5)}` : '--01-01');
          else onChange('');
        }} /> Year unknown
      </label>
    </div>
  );
}

export function PersonView({ person, onOpen, onClosed }: { person: Person; onOpen: (id: string) => void; onClosed: () => void }) {
  const db = useDB();
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<Person>, key = Object.keys(patch).join(',')) => updatePerson(person.id, patch, key);

  const flagged = person.listIds.includes(FLAGGED_LIST_ID);
  const age = ageOn(person.birthday);
  const bdayIn = daysUntilAnniversary(person.birthday);

  const lastContacted = db.timeline
    .filter((t) => t.personId === person.id && t.eventType === 'Last contacted')
    .sort((a, b) => b.start.localeCompare(a.start))[0];

  const markContacted = () => {
    saveTimelineItem(
      lastContacted
        ? { ...lastContacted, start: todayISO() }
        : { id: uid(), personId: person.id, laneId: 'lane-events', start: todayISO(), end: '', eventType: 'Last contacted', note: '' },
    );
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: Attachment[] = [];
    for (const f of Array.from(files)) {
      if (f.size > 15 * 1024 * 1024 && !confirm(`${f.name} is ${fmtBytes(f.size)}. Large files make the data file slow to sync. Attach anyway?`)) continue;
      added.push({ id: uid(), name: f.name, type: f.type, size: f.size, dataUrl: await fileToDataUrl(f), addedAt: nowStamp() });
    }
    set({ attachments: [...person.attachments, ...added] }, '');
  };

  // Upcoming anniversaries from life events (weddings etc.)
  const anniversaries = db.timeline
    .filter((t) => t.personId === person.id && t.laneId === 'lane-events' && ['Wedding', 'Engagement'].includes(t.eventType || ''))
    .map((t) => ({ t, days: daysUntilAnniversary(t.start)!, years: Number(todayISO().slice(0, 4)) - Number(t.start.slice(0, 4)) }))
    .filter((a) => a.days <= 30);

  return (
    <div className="person-view">
      <header className="person-header">
        <button className="photo-btn" onClick={() => photoInput.current?.click()} title="Change photo">
          <Avatar person={person} size={96} />
          <span className="photo-hint">{person.photo ? 'Change' : 'Add photo'}</span>
        </button>
        <input ref={photoInput} type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) set({ photo: await imageToThumb(f) }, '');
          e.target.value = '';
        }} />
        <div className="person-title">
          <h1>{fullName(person)}</h1>
          <div className="muted">
            {[person.nickname && `“${person.nickname}”`, person.formerName && `formerly ${person.formerName}`, age !== null && `${age} years old`]
              .filter(Boolean).join(' · ')}{' '}
            {bdayIn !== null && bdayIn <= 30 && <span className="badge">🎂 {bdayIn === 0 ? 'Birthday today!' : `Birthday in ${bdayIn} day${bdayIn === 1 ? '' : 's'}`}</span>}
            {anniversaries.map((a) => (
              <span key={a.t.id} className="badge">💍 {a.t.eventType} anniversary ({a.years}) {a.days === 0 ? 'today' : `in ${a.days} days`}</span>
            ))}
          </div>
          <div className="muted small">
            {lastContacted ? `Last contacted ${fmtDate(lastContacted.start)}` : 'No contact logged'}
          </div>
          <div className="row wrap">
            <button className={flagged ? 'flag on' : 'flag'} onClick={() => toggleList(person.id)}>
              {flagged ? '⚑ Flagged' : '⚐ Flag'}
            </button>
            <button onClick={markContacted}>✓ Contacted today</button>
            <a className="button" href={`#/families/${person.id}`}>Family view</a>
            {person.photo && <button onClick={() => set({ photo: '' }, '')}>Remove photo</button>}
            <span className="spacer" />
            {confirmDelete ? (
              <>
                <span className="small">Delete {person.firstName || 'this person'} and their timeline?</span>
                <button className="danger" onClick={() => { deletePerson(person.id); onClosed(); }}>Delete</button>
                <button onClick={() => setConfirmDelete(false)}>Keep</button>
              </>
            ) : (
              <button className="ghost" onClick={() => setConfirmDelete(true)}>Delete…</button>
            )}
          </div>
        </div>
      </header>

      <Section title="Timeline" id="timeline">
        <Timeline person={person} />
      </Section>

      <div className="person-grid">
        <Section title="Name">
          <div className="form-grid">
            <TextField label="First" value={person.firstName} onChange={(v) => set({ firstName: v })} />
            <TextField label="Middle" value={person.middleName} onChange={(v) => set({ middleName: v })} />
            <TextField label="Last" value={person.lastName} onChange={(v) => set({ lastName: v })} />
            <TextField label="Nickname" value={person.nickname} onChange={(v) => set({ nickname: v })} />
            <TextField label="Maiden / former name" value={person.formerName} onChange={(v) => set({ formerName: v })} className="full" />
          </div>
        </Section>

        <Section title="About">
          <div className="form-grid">
            <BirthdayField value={person.birthday} onChange={(v) => set({ birthday: v })} />
            <TextField label="Place met" value={person.placeMet} onChange={(v) => set({ placeMet: v })} placeholder="e.g. Hermantown pickleball courts" />
          </div>
        </Section>

        <Section title="Contact">
          <h4>Phone</h4>
          <LabeledList items={person.phones} onChange={(phones) => set({ phones }, 'phones')} valueType="tel"
            labelSuggestions={['Mobile', 'Home', 'Work', 'Other']} valuePlaceholder="Phone number" addText="Add phone" linkPrefix="tel:" />
          <h4>Email</h4>
          <LabeledList items={person.emails} onChange={(emails) => set({ emails }, 'emails')} valueType="email"
            labelSuggestions={['Personal', 'Work', 'Other']} valuePlaceholder="name@example.com" addText="Add email" linkPrefix="mailto:" />
          <h4>Address</h4>
          <LabeledList items={person.addresses} onChange={(addresses) => set({ addresses }, 'addresses')} multiline
            labelSuggestions={['Home', 'Work', 'Cabin', 'Other']} valuePlaceholder="Street, city, state" addText="Add address" />
        </Section>

        <Section title="Favorites">
          <LabeledList items={person.favorites} onChange={(favorites) => set({ favorites }, 'favorites')}
            labelSuggestions={['Food', 'Color', 'Drink', 'Restaurant', 'Music', 'Movie', 'Book', 'Sports team', 'Hobby', 'Flower', 'Candy']}
            valuePlaceholder="e.g. Walleye" addText="Add favorite" />
        </Section>

        <Section title="Custom fields">
          <LabeledList items={person.customFields} onChange={(customFields) => set({ customFields }, 'customFields')}
            labelSuggestions={['Employer', 'Job title', 'Kids’ names', 'Pets', 'Allergies', 'Church', 'Website', 'Instagram']}
            valuePlaceholder="Value" addText="Add field" />
        </Section>

        <Section title="Linked people" actions={<a className="small" href={`#/families/${person.id}`}>Family view →</a>}>
          <Relationships person={person} onOpen={onOpen} />
        </Section>

        <Section title="Files" actions={<button className="link" onClick={() => fileInput.current?.click()}>+ Attach</button>}>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          {person.attachments.length === 0 && <p className="muted">No files attached.</p>}
          <ul className="files">
            {person.attachments.map((a) => (
              <li key={a.id}>
                {a.type.startsWith('image/') ? <img src={a.dataUrl} alt="" /> : <span className="file-icon">📄</span>}
                <a href={a.dataUrl} download={a.name}>{a.name}</a>
                <span className="muted small">{fmtBytes(a.size)}</span>
                <button className="icon" title="Remove" onClick={() => set({ attachments: person.attachments.filter((x) => x.id !== a.id) }, '')}>×</button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Lists">
          <div className="row wrap">
            {db.lists.map((l) => (
              <label key={l.id} className="check">
                <input type="checkbox" checked={person.listIds.includes(l.id)} onChange={() => toggleList(person.id, l.id)} /> {l.name}
              </label>
            ))}
          </div>
          <p className="muted small">Manage lists in Settings.</p>
        </Section>

        <Section title="Notes">
          <TextField multiline value={person.notes} onChange={(v) => set({ notes: v })} placeholder="Anything else worth remembering…" />
        </Section>
      </div>

      <p className="meta muted small">
        Added {fmtStamp(person.createdAt)} · Last edited {fmtStamp(person.updatedAt)}
      </p>
    </div>
  );
}
