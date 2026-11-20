import { useId, useState } from 'react';
import { quickAdd } from '../actions';
import { useDB } from '../store';
import { todayISO } from '../util';
import { Modal } from './ui';

export function QuickAdd({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const db = useDB();
  const tagList = useId();
  const placeList = useId();
  const [f, setF] = useState({ firstName: '', lastName: '', placeMet: '', date: todayISO(), tagName: '', placeName: '', note: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const save = (open: boolean) => {
    if (!f.firstName.trim()) return;
    const p = quickAdd(f);
    if (open) onCreated(p.id);
    else setF({ ...f, firstName: '', lastName: '', note: '' });
    if (open) onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save(!(e.shiftKey));
  };

  return (
    <Modal
      title="Quick add person"
      onClose={onClose}
      footer={
        <>
          <span className="muted small">Enter: save & open · Shift+Enter: save & add another</span>
          <span className="spacer" />
          <button disabled={!f.firstName.trim()} onClick={() => save(false)}>Save & add another</button>
          <button className="primary" disabled={!f.firstName.trim()} onClick={() => save(true)}>Save</button>
        </>
      }
    >
      <div className="form-grid" onKeyDown={onKey}>
        <label className="field"><span>First name *</span><input autoFocus value={f.firstName} onChange={set('firstName')} /></label>
        <label className="field"><span>Last name</span><input value={f.lastName} onChange={set('lastName')} /></label>
        <label className="field"><span>Where you met</span><input value={f.placeMet} onChange={set('placeMet')} placeholder="e.g. Sarah’s wedding" /></label>
        <label className="field"><span>Date met</span><input type="date" value={f.date} onChange={set('date')} /></label>
        <label className="field"><span>Tag</span>
          <input value={f.tagName} list={tagList} onChange={set('tagName')} placeholder="e.g. Pickleball Team" />
          <datalist id={tagList}>{db.tags.map((t) => <option key={t.id} value={t.name} />)}</datalist>
        </label>
        <label className="field"><span>Location</span>
          <input value={f.placeName} list={placeList} onChange={set('placeName')} placeholder="e.g. Duluth, MN" />
          <datalist id={placeList}>{db.places.map((t) => <option key={t.id} value={t.name} />)}</datalist>
        </label>
        <label className="field full"><span>Note</span><input value={f.note} onChange={set('note')} placeholder="Anything to jog your memory" /></label>
      </div>
      <p className="muted small">Adds a “First met” life event on the date above, plus the tag and location (through present) if given.</p>
    </Modal>
  );
}
