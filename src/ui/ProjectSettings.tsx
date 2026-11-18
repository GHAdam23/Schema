// Project settings (saved in the project, same for every page): line label numbering, signal colours, fonts.
import { nextLabel, setState, updateProject, useStore } from '../state/store';
import { DEFAULT_AUTO_LABEL, formatLabel } from '../model/signals';
import { Group, NumberField } from './controls';
import { FontSettings } from './FontSettings';

/** Project-wide settings: auto-numbered line labels, signal colours, fonts. */
export function ProjectSettingsBody() {
  const s = useStore((st) => st);
  const auto = s.project.autoLabel ?? DEFAULT_AUTO_LABEL;
  const setAuto = (patch: Partial<typeof auto>, label: string) => {
    nextLabel(label);
    updateProject((d) => void (d.autoLabel = { ...auto, ...patch }));
  };
  const nStyles = Object.keys(s.project.signalStyles ?? {}).length;
  return (
    <>
      <Group title="Line labels">
        <label className="check" title="Every new line gets the next number as its label">
          <input type="checkbox" checked={auto.on} onChange={(e) => setAuto({ on: e.target.checked }, e.target.checked ? 'Auto-number line labels' : 'Stop auto-numbering line labels')} /> Number new lines automatically
        </label>
        <div className="fieldgroup">
          <label>
            Prefix <input style={{ width: 60 }} key={auto.prefix} defaultValue={auto.prefix} onBlur={(e) => e.target.value !== auto.prefix && setAuto({ prefix: e.target.value }, 'Label prefix')} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </label>
          <label>
            Next <NumberField min={0} step={1} width={60} value={auto.next} onCommit={(v) => setAuto({ next: Math.round(v) }, 'Next label number')} />
          </label>
          <label title="Pad with zeros to this many digits">
            Digits <NumberField min={0} max={6} step={1} width={44} value={auto.digits} onCommit={(v) => setAuto({ digits: Math.round(v) }, 'Label digits')} />
          </label>
        </div>
        <div className="muted small">
          Next label: <b>{formatLabel(auto, auto.next)}</b>. To number existing lines, select them and use “Number these lines”.
        </div>
      </Group>
      <Group title="Signal colours">
        <label className="check">
          <input
            type="checkbox"
            checked={!!s.project.signalColors}
            onChange={(e) => {
              if (e.target.checked && !nStyles) {
                setState({ modal: { kind: 'signalColors' } });
                return;
              }
              nextLabel(e.target.checked ? 'Colour lines by signal type' : 'Black lines');
              updateProject((d) => void (d.signalColors = e.target.checked));
            }}
          />{' '}
          Colour lines by signal type
        </label>
        <button onClick={() => setState({ modal: { kind: 'signalColors' } })}>Edit colours…{nStyles ? ` (${nStyles} set)` : ''}</button>
      </Group>
      <FontSettings />
    </>
  );
}

