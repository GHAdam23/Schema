import { useId, useState } from 'react';
import { addPlace, addTag, deleteTimelineItem, saveTimelineItem, setEventTypes } from '../actions';
import { getDB, useDB } from '../store';
import type { TimelineItem } from '../types';
import { todayISO, uid } from '../util';
import { Modal } from './ui';

export function TimelineItemEditor({ item, onClose }: { item: TimelineItem; onClose: () => void }) {
  const db = useDB();
  const listId = useId();
  const [laneId, setLaneId] = useState(item.laneId);
  const lane = db.lanes.find((l) => l.id === laneId) || db.lanes[0];
  const initialName =
    (item.tagId && db.tags.find((t) => t.id === item.tagId)?.name) ||
    (item.placeId && db.places.find((p) => p.id === item.placeId)?.name) ||
    item.eventType ||
    '';
  const [name, setName] = useState(initialName);
  const [text, setText] = useState(item.text || '');
  const [start, setStart] = useState(item.start || todayISO());
  const [endMode, setEndMode] = useState<'single' | 'present' | 'date'>(
    !item.end ? 'single' : item.end === 'present' ? 'present' : 'date',
  );
  const [end, setEnd] = useState(item.end && item.end !== 'present' ? item.end : '');
  const [note, setNote] = useState(item.note);
  const [error, setError] = useState('');

  const suggestions =
    lane.kind === 'tags' ? db.tags.map((t) => t.name)
    : lane.kind === 'locations' ? db.places.map((p) => p.name)
    : lane.kind === 'events' ? db.eventTypes
    : [];

  const nameLabel = lane.kind === 'tags' ? 'Tag' : lane.kind === 'locations' ? 'Location' : lane.kind === 'events' ? 'Event' : '';

  const save = () => {
    if (!start) return setError('A start date is required.');
    if (endMode === 'date' && (!end || end < start)) return setError('The end date must be on or after the start date.');
    const n = name.trim();
    if (lane.kind !== 'custom' && !n) return setError(`Choose or type a ${nameLabel.toLowerCase()}.`);
    if (lane.kind === 'custom' && !text.trim()) return setError('Type what happened.');

    const out: TimelineItem = {
      id: item.id || uid(),
      personId: item.personId,
      laneId: lane.id,
      start,
      end: endMode === 'single' ? '' : endMode === 'present' ? 'present' : end,
      note: note.trim(),
      text: text.trim() || undefined,
    };
    const current = getDB();
    if (lane.kind === 'tags') {
      out.tagId = (current.tags.find((t) => t.name.toLowerCase() === n.toLowerCase()) || addTag(n)).id;
    } else if (lane.kind === 'locations') {
      out.placeId = (current.places.find((p) => p.name.toLowerCase() === n.toLowerCase()) || addPlace(n)).id;
    } else if (lane.kind === 'events') {
      const existing = current.eventTypes.find((t) => t.toLowerCase() === n.toLowerCase());
      if (!existing) setEventTypes([...current.eventTypes, n]);
      out.eventType = existing || n;
    }
    saveTimelineItem(out);
    onClose();
  };

  return (
    <Modal
      title={item.id ? 'Edit timeline entry' : 'Add to timeline'}
      onClose={onClose}
      footer={
        <>
          {item.id && (
            <button className="danger" onClick={() => { deleteTimelineItem(item.id); onClose(); }}>Delete</button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>Save</button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>Lane</span>
          <select value={laneId} onChange={(e) => { setLaneId(e.target.value); setName(''); }}>
            {db.lanes.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        {lane.kind !== 'custom' && (
          <label className="field">
            <span>{nameLabel}</span>
            <input autoFocus value={name} list={listId} placeholder={`Pick or type a new ${nameLabel.toLowerCase()}`}
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
            <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
        )}
        <label className="field">
          <span>{lane.kind === 'custom' ? 'What' : 'Detail (optional)'}</span>
          <input value={text} autoFocus={lane.kind === 'custom'} onChange={(e) => setText(e.target.value)}
            placeholder={lane.kind === 'events' ? 'e.g. “at the lake cabin”' : ''} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </label>
        <label className="field">
          <span>{endMode === 'single' ? 'Date' : 'Start date'}</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <fieldset className="field">
          <span>Ends</span>
          <div className="radio-row">
            <label><input type="radio" checked={endMode === 'single'} onChange={() => setEndMode('single')} /> Single day</label>
            <label><input type="radio" checked={endMode === 'present'} onChange={() => setEndMode('present')} /> Through present</label>
            <label><input type="radio" checked={endMode === 'date'} onChange={() => setEndMode('date')} /> On a date</label>
          </div>
          {endMode === 'date' && <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />}
        </fieldset>
        <label className="field full">
          <span>Note</span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
