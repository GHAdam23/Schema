import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { LabeledValue, Person } from '../types';
import { initials, uid } from '../util';

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [props.onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.wide ? 'wide' : ''}`} role="dialog" aria-label={props.title}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="icon" onClick={props.onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

export function Avatar({ person, size = 40 }: { person: Person; size?: number }) {
  return person.photo ? (
    <img className="avatar" src={person.photo} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="avatar placeholder" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials(person)}
    </span>
  );
}

/** Text input that commits on every keystroke but keeps the cursor stable. */
export function TextField(props: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
  list?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const id = useId();
  const input = props.multiline ? (
    <textarea id={id} value={props.value} placeholder={props.placeholder} rows={4}
      onChange={(e) => props.onChange(e.target.value)} />
  ) : (
    <input id={id} type={props.type || 'text'} value={props.value} placeholder={props.placeholder}
      list={props.list} autoFocus={props.autoFocus} onChange={(e) => props.onChange(e.target.value)} />
  );
  if (!props.label) return input;
  return (
    <label className={`field ${props.className || ''}`} htmlFor={id}>
      <span>{props.label}</span>
      {input}
    </label>
  );
}

/** Editable list of label + value rows (phones, emails, favorites, custom fields…). */
export function LabeledList(props: {
  items: LabeledValue[];
  onChange: (items: LabeledValue[]) => void;
  labelSuggestions: string[];
  valuePlaceholder: string;
  addText: string;
  valueType?: string;
  multiline?: boolean;
  linkPrefix?: string;
}) {
  const listId = useId();
  const set = (id: string, patch: Partial<LabeledValue>) =>
    props.onChange(props.items.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <div className="labeled-list">
      <datalist id={listId}>
        {props.labelSuggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
      {props.items.map((x) => (
        <div className="lv-row" key={x.id}>
          <input className="lv-label" value={x.label} list={listId} placeholder="Label"
            onChange={(e) => set(x.id, { label: e.target.value })} />
          {props.multiline ? (
            <textarea className="lv-value" rows={2} value={x.value} placeholder={props.valuePlaceholder}
              onChange={(e) => set(x.id, { value: e.target.value })} />
          ) : (
            <input className="lv-value" type={props.valueType || 'text'} value={x.value}
              placeholder={props.valuePlaceholder} onChange={(e) => set(x.id, { value: e.target.value })} />
          )}
          {props.linkPrefix && x.value && (
            <a className="icon" href={props.linkPrefix + x.value} title="Open" target="_blank" rel="noreferrer">↗</a>
          )}
          <button className="icon" title="Remove" onClick={() => props.onChange(props.items.filter((y) => y.id !== x.id))}>×</button>
        </div>
      ))}
      <button className="link" onClick={() => props.onChange([...props.items, { id: uid(), label: props.labelSuggestions[0] || '', value: '' }])}>
        + {props.addText}
      </button>
    </div>
  );
}

/** Small multi-select of chips with a typeahead. */
export function ChipPicker<T extends { id: string; name: string; color?: string }>(props: {
  options: T[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const matches = props.options.filter(
    (o) => !props.selected.includes(o.id) && o.name.toLowerCase().includes(text.toLowerCase()),
  );
  return (
    <div className="chip-picker" ref={ref}>
      {props.selected.map((id) => {
        const o = props.options.find((x) => x.id === id);
        if (!o) return null;
        return (
          <span className="chip" key={id} style={o.color ? { background: o.color } : undefined}>
            {o.name}
            <button onClick={() => props.onChange(props.selected.filter((x) => x !== id))} aria-label={`Remove ${o.name}`}>×</button>
          </span>
        );
      })}
      <input value={text} placeholder={props.selected.length ? '' : props.placeholder}
        onFocus={() => setOpen(true)} onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && matches[0]) { props.onChange([...props.selected, matches[0].id]); setText(''); }
          if (e.key === 'Backspace' && !text && props.selected.length) props.onChange(props.selected.slice(0, -1));
        }} />
      {open && matches.length > 0 && (
        <div className="chip-menu">
          {matches.slice(0, 50).map((o) => (
            <button key={o.id} onMouseDown={(e) => { e.preventDefault(); props.onChange([...props.selected, o.id]); setText(''); }}>
              {o.color && <span className="dot" style={{ background: o.color }} />}
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Section(props: { title: string; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className="card" id={props.id}>
      <div className="card-head">
        <h3>{props.title}</h3>
        {props.actions && <div className="card-actions">{props.actions}</div>}
      </div>
      {props.children}
    </section>
  );
}
