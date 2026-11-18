// Project settings (saved in the project, same for every page): signal types, signal colours, fonts.
import { nextLabel, setState, updateProject, useStore } from '../state/store';
import { Group } from './controls';
import { FontSettings } from './FontSettings';

/** Project-wide settings: signal types, signal colours, fonts. */
export function ProjectSettingsBody() {
  const s = useStore((st) => st);
  const nStyles = Object.keys(s.project.signalStyles ?? {}).length;
  return (
    <>
      <Group title="Signal types">
        <div className="muted small">
          {(s.project.signalTypes ?? s.prefs.signalTypes).join(', ')}
        </div>
        <button onClick={() => setState({ modal: { kind: 'signalTypes', scope: 'project' } })}>Edit this project's signal types…</button>
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

