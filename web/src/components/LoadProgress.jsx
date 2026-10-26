import React, { useEffect, useRef, useState } from 'react';

/**
 * Ladebalken nach ECHTEM Fortschritt: fragt /api/progress ab, solange geladen
 * wird. Der Server zählt jeden abgeschlossenen Abruf (Sheet, je Werbekonto
 * Kennzahlen/Placements/Tagesdaten/Status/Landingpages, Berechnung).
 *   variant="screen": großer Ladescreen beim ersten Laden
 *   variant="bar":    dünne Leiste oben beim "Aktualisieren"
 */
export default function LoadProgress({ range, variant = 'screen' }) {
  const [p, setP] = useState(null);
  const [secs, setSecs] = useState(0);
  const t0 = useRef(Date.now());
  const busy = useRef(false);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams();
    if (range?.from) qs.set('from', range.from);
    if (range?.to) qs.set('to', range.to);
    const tick = async () => {
      setSecs(Math.floor((Date.now() - t0.current) / 1000));
      if (busy.current) return; // Server antwortet noch (z. B. Kaltstart)
      busy.current = true;
      try {
        const res = await fetch(`/api/progress?${qs}`, { cache: 'no-store' });
        const j = await res.json();
        if (alive) setP(j);
      } catch {
        /* Server noch nicht erreichbar – Anzeige bleibt auf "startet" */
      } finally {
        busy.current = false;
      }
    };
    tick();
    const id = setInterval(tick, 400);
    return () => { alive = false; clearInterval(id); };
  }, [range?.from, range?.to]);

  const known = p && p.total > 0 && (p.active || p.done > 0);
  const pct = known ? Math.round((p.done / p.total) * 100) : 0;
  const label = known ? p.label : secs > 4 ? 'Server startet (nach längerer Pause bis zu ~50 Sek.)…' : 'Verbinde…';

  if (variant === 'bar') {
    return (
      <div className="lp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} title={label}>
        <div className={`lp-bar-fill ${known ? '' : 'indeterminate'}`} style={known ? { width: `${pct}%` } : undefined} />
      </div>
    );
  }

  return (
    <div className="loader lp-screen">
      <div className="lp-box">
        <div className="lp-head">
          <span>Lade Daten</span>
          <span className="lp-pct">{known ? `${pct} %` : ''}</span>
        </div>
        <div className="lp-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`lp-fill ${known ? '' : 'indeterminate'}`} style={known ? { width: `${pct}%` } : undefined} />
        </div>
        <div className="lp-meta">
          <span className="lp-label">{label}</span>
          <span>{known ? `${p.done}/${p.total} Schritte · ` : ''}{secs} s</span>
        </div>
      </div>
    </div>
  );
}
