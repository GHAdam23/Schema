import { memo } from 'react';
import type { Asset } from '../model/types';
import { FONT_CSS } from '../text/fonts';
import { pathToSvg, type DLItem, type DLStroke } from './displayList';

function strokeProps(s: DLStroke | null) {
  if (!s) return { stroke: 'none' };
  return {
    stroke: s.color,
    strokeWidth: s.width,
    strokeDasharray: s.dash.length ? s.dash.join(' ') : undefined,
    strokeLinecap: 'butt' as const,
    strokeLinejoin: 'miter' as const,
  };
}

export const SvgItems = memo(function SvgItems({ items, assets }: { items: DLItem[]; assets: Record<string, Asset> }) {
  return (
    <>
      {items.map((it, i) => {
        switch (it.t) {
          case 'rect':
            return <rect key={i} x={it.x} y={it.y} width={it.w} height={it.h} fill={it.fill ?? 'none'} {...strokeProps(it.stroke)} />;
          case 'path':
            return <path key={i} d={pathToSvg(it.d)} fill={it.fill ?? 'none'} {...strokeProps(it.stroke)} />;
          case 'text': {
            const f = FONT_CSS[it.font];
            return (
              <text
                key={i}
                x={it.x}
                y={it.y}
                fontFamily={f.family}
                fontWeight={f.weight}
                fontSize={it.size}
                fill={it.color}
                transform={it.rot ? `rotate(${it.rot} ${it.x} ${it.y})` : undefined}
                style={{ fontKerning: 'none', fontVariantLigatures: 'none', whiteSpace: 'pre' }}
              >
                {it.text}
              </text>
            );
          }
          case 'image': {
            const a = assets[it.assetId];
            if (!a) return null;
            return <image key={i} x={it.x} y={it.y} width={it.w} height={it.h} href={`data:${a.mime};base64,${a.data}`} preserveAspectRatio="none" />;
          }
        }
      })}
    </>
  );
});
