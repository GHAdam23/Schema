// Small shared property controls: colour swatch, stroke editor, number field, labelled groups.
import { useEffect, useRef, useState } from 'react';
import type { StrokeStyle } from '../model/types';

/**
 * Print-friendly palette: black and greys, white, then strong primaries (no pale tints — they wash
 * out on paper). Anything else via "Custom".
 */
export const SWATCHES = [
  '#000000', '#404040', '#7f7f7f', '#bfbfbf', '#ffffff', '#8b4513',
  '#d00000', '#f07800', '#e6b800', '#00963c', '#0060c0', '#7030a0',
];

/**
 * Colour swatch that is always visible; click for the palette. The first entry is the "none" choice
 * (fill: no fill, border: no border) or, with `defaultColor`, the default colour (black).
 */
export function ColorSwatch({
  value,
  onChange,
  noneLabel = 'No fill',
  defaultColor,
  title,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  noneLabel?: string;
  /** Instead of a "none" entry: a "Default" entry with this colour. */
  defaultColor?: string;
  title?: string;
}) {
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const pick = (v: string | null) => {
    onChange(v);
    setOpen(null);
  };
  const cur = value?.toLowerCase() ?? null;
  return (
    <span className="swatchwrap" ref={ref}>
      <button
        className={'swatch' + (value ? '' : ' none')}
        style={value ? { background: value } : undefined}
        title={title ?? (value ?? noneLabel)}
        onClick={(e) => {
          // Fixed position so the palette isn't clipped by the scrolling panel.
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { left: Math.max(4, Math.min(r.left, window.innerWidth - 190)), top: Math.min(r.bottom + 4, window.innerHeight - 150) });
        }}
      />
      {open && (
        <div className="swatchpop">
          {defaultColor ? (
            <button className="swatchnone" onClick={() => pick(defaultColor)}>
              <span className="swatch" style={{ background: defaultColor }} /> Default (black)
            </button>
          ) : (
            <button className="swatchnone" onClick={() => pick(null)}>
              <span className="swatch none" /> {noneLabel}
            </button>
          )}
          <div className="swatchgrid">
            {SWATCHES.map((c) => (
              <button key={c} className={'swatch' + (c === cur ? ' cur' : '')} style={{ background: c }} title={c} onClick={() => pick(c)} />
            ))}
          </div>
          <label className="swatchcustom">
            Custom <input type="color" value={value ?? defaultColor ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} />
          </label>
        </div>
      )}
    </span>
  );
}

/**
 * Number input that applies on Enter, when you leave it, or with the spinner / arrow keys — not
 * on every keystroke (typing "0" over "25" would otherwise apply "2" first).
 */
export function NumberField({ value, onCommit, min, max, step, placeholder, width }: { value: number | ''; onCommit: (v: number) => void; min?: number; max?: number; step?: number; placeholder?: string; width?: number }) {
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    setText(null);
    const v = Number(raw);
    if (raw.trim() === '' || !isFinite(v)) return;
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    if (c !== value) onCommit(c);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      style={width ? { width } : undefined}
      value={text ?? value}
      onChange={(e) => {
        // Spinner clicks / arrow keys have no inputType: apply right away. Typing waits.
        if (!(e.nativeEvent as InputEvent).inputType) commit(e.target.value);
        else setText(e.target.value);
      }}
      onBlur={(e) => text !== null && commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        if (e.key === 'Escape') setText(null);
      }}
    />
  );
}

/** A titled box in the properties panel (Text / Border / Fill / Position & size …). */
export function Group({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="pgroup">
      <div className="pgroup-title">
        <span>{title}</span>
        {extra}
      </div>
      {children}
    </div>
  );
}

const NEW_BORDER: StrokeStyle = { color: '#000000', width: 0.75, dash: 'solid' };

/**
 * Colour / width / style of a border or line. With `allowNone`, the colour palette's first entry is
 * "No border" (value null) and picking a colour adds one again.
 */
export function StrokeEditor({ value, onChange, allowNone, colorLabel = 'Colour' }: { value: StrokeStyle | null; onChange: (s: Partial<StrokeStyle> | null) => void; allowNone?: boolean; colorLabel?: string }) {
  const v = value ?? NEW_BORDER;
  return (
    <div className="fieldgroup">
      <label>
        {colorLabel}{' '}
        <ColorSwatch
          value={value ? value.color : null}
          noneLabel="No border"
          defaultColor={allowNone ? undefined : '#000000'}
          onChange={(c) => (c === null ? onChange(null) : onChange(value ? { color: c } : { ...NEW_BORDER, color: c }))}
        />
      </label>
      {value && (
        <>
          <label>
            Width <NumberField min={0} max={10} step={0.25} value={v.width} width={52} onCommit={(w) => onChange({ width: Math.max(0, w) })} />
          </label>
          <label>
            Style{' '}
            <select value={v.dash} onChange={(e) => onChange({ dash: e.target.value as StrokeStyle['dash'] })}>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </label>
        </>
      )}
    </div>
  );
}

export function FillEditor({ value, onChange, label = 'Colour' }: { value: string | null; onChange: (v: string | null) => void; label?: string }) {
  return (
    <div className="fieldgroup">
      <label>
        {label} <ColorSwatch value={value} onChange={onChange} />
      </label>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
