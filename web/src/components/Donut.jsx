import React from 'react';
import { useProject } from '../project.jsx';

/**
 * Donut-Diagramm (SVG, ohne Library) mit Center-Label und Legende.
 * data: [{ key, count }]. Farben werden aus einer Palette zugewiesen; der erste
 * Platz gehört der Projekt-Akzentfarbe, damit das Diagramm zum Branding passt.
 */
const PALETTE = ['#5ec8d8', '#a78bfa', '#6fcf97', '#f0883e', '#ec4899', '#60a5fa', '#94a3b8'];

export default function Donut({ data, centerLabel = 'GESAMT', size = 220, thickness = 30 }) {
  const { branding } = useProject();
  const palette = [branding.accent, ...PALETTE];
  const total = data.reduce((s, d) => s + d.count, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const segments = data.map((d, i) => {
    const frac = total ? d.count / total : 0;
    const len = frac * circ;
    const seg = { color: palette[i % palette.length], dasharray: `${len} ${circ - len}`, dashoffset: -offset, ...d, frac };
    offset += len;
    return seg;
  });

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut-svg">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={thickness} />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={s.dasharray}
            strokeDashoffset={s.dashoffset}
            transform={`rotate(-90 ${cx} ${cy})`}
          >
            <title>{`${s.key}: ${s.count} (${(s.frac * 100).toFixed(1)} %)`}</title>
          </circle>
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" className="donut-total">{total.toLocaleString('de-DE')}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="donut-label">{centerLabel}</text>
      </svg>
      <div className="donut-legend">
        {segments.map((s, i) => (
          <div key={i} className="donut-leg-row">
            <span className="legend-dot" style={{ background: s.color }} />
            <span className="donut-leg-name" title={s.key}>{s.key}</span>
            <span className="donut-leg-val">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
