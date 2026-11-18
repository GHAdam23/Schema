import type { Asset, PageSizeId } from '../model/types';
import { DEFAULT_SIGNAL_TYPES, OLD_DEFAULT_SIGNAL_TYPES } from '../model/defaults';

export interface Prefs {
  designerName: string;
  copyright: string;
  phone: string;
  email: string;
  logo: Asset | null;
  defaultPageSize: PageSizeId;
  gridSize: number;
  snap: boolean;
  showGrid: boolean;
  smartGuides: boolean;
  signalTypes: string[];
  /** Also write autosaves to the open .schema file (when it was opened/saved via the file picker). */
  autosaveToFile: boolean;
  backupsToKeep: number;
}

const KEY = 'schema.prefs.v1';

export const DEFAULT_PREFS: Prefs = {
  designerName: '',
  copyright: '',
  phone: '',
  email: '',
  logo: null,
  defaultPageSize: 'tabloid',
  gridSize: 9,
  snap: true,
  showGrid: true,
  smartGuides: true,
  signalTypes: DEFAULT_SIGNAL_TYPES,
  autosaveToFile: false,
  backupsToKeep: 20,
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p: Prefs = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
      // Untouched old default list → the new defaults.
      if (p.signalTypes.join('|') === OLD_DEFAULT_SIGNAL_TYPES.join('|')) p.signalTypes = DEFAULT_SIGNAL_TYPES;
      return p;
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PREFS };
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch (e) {
    console.warn('Could not save preferences', e);
  }
}
