import type { BlockDef, Direction, PortDef } from './types';
import { newId } from './ids';

function ports(dir: Direction, rows: [string, string, string][]): PortDef[] {
  return rows.map(([name, signal, connector]) => ({ id: newId('pt'), name, signal, connector, dir }));
}

function seq(prefix: string, n: number, signal: string, connector: string): [string, string, string][] {
  return Array.from({ length: n }, (_, i) => [`${prefix} ${i + 1}`, signal, connector]);
}

/** A few generic starter blocks so a fresh install isn't empty. */
export function sampleLibrary(): BlockDef[] {
  return [
    {
      id: newId('bd'),
      manufacturer: 'Generic',
      model: 'SDI Router 8x8',
            rack: { ru: 1, depth: 10 },
      left: ports('IN', seq('SDI IN', 8, 'SDI', 'BNC')),
      right: ports('OUT', seq('SDI OUT', 8, 'SDI', 'BNC')),
    },
    {
      id: newId('bd'),
      manufacturer: 'Generic',
      model: 'PTZ Camera',
      left: [...ports('IN', [['PWR', 'POWER', 'IEC']]), ...ports('IN', [['LAN', 'DATA', 'RJ45']])],
      right: ports('OUT', [
        ['SDI OUT', 'SDI', 'BNC'],
        ['HDMI OUT', 'HDMI', 'HDMI'],
      ]),
    },
    {
      id: newId('bd'),
      manufacturer: 'Generic',
      model: 'Network Switch 8-Port',
      rack: { ru: 1, width: 'half', depth: 8 },
      left: ports('IN', seq('PORT', 4, 'DATA', 'RJ45')),
      right: ports('OUT', seq('PORT', 4, 'DATA', 'RJ45').map(([n, s, c], i) => [n.replace(/\d+$/, String(i + 5)), s, c] as [string, string, string])),
    },
    {
      id: newId('bd'),
      manufacturer: 'Generic',
      model: 'Display 65"',
      left: ports('IN', [
        ['HDMI 1', 'HDMI', 'HDMI'],
        ['HDMI 2', 'HDMI', 'HDMI'],
        ['RS232', 'RS232', 'DB9'],
        ['PWR', 'POWER', 'IEC'],
      ]),
      right: [],
    },
  ];
}
