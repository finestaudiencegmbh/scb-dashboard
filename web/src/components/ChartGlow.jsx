import React, { useId } from 'react';

/**
 * Glow-Effekt für die SVG-Charts. Der Filter zeichnet die Linie weichgezeichnet
 * unter sich selbst – der Schein hat damit immer die Farbe der jeweiligen
 * Linie, unabhängig von Akzent- oder Serienfarbe.
 *
 * Wichtig: filterUnits="userSpaceOnUse". Mit der Standard-Bounding-Box hätte
 * eine flache Linie (alle Werte gleich) die Höhe 0, und der Browser würde sie
 * samt Filter gar nicht zeichnen.
 */
export function useChartIds() {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return {
    glow: `glow-${base}`,
    area: (i) => `area-${base}-${i}`,
  };
}

export function GlowDefs({ ids, w, h, colors = [] }) {
  return (
    <defs>
      <filter id={ids.glow} filterUnits="userSpaceOnUse" x={-20} y={-20} width={w + 40} height={h + 40}>
        <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="wide" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="tight" />
        <feMerge>
          <feMergeNode in="wide" />
          <feMergeNode in="tight" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      {colors.map((c, i) => (
        <linearGradient key={i} id={ids.area(i)} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.32" />
          <stop offset="70%" stopColor={c} stopOpacity="0.06" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      ))}
    </defs>
  );
}
