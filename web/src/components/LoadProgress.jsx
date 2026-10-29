import React, { useEffect, useRef, useState } from 'react';
import { useProject } from '../project.jsx';

/**
 * Ladebalken nach ECHTEM Fortschritt: fragt /api/progress ab, solange geladen
 * wird. Der Server zählt jeden abgeschlossenen Abruf (Sheet, je Werbekonto
 * Kennzahlen/Placements/Tagesdaten/Status/Landingpages, Berechnung).
 *   variant="screen": HUD-Ladescreen beim ersten Laden (Ringe, Signet, Log)
 *   variant="bar":    dünne Leiste oben beim "Aktualisieren"
 *   closing:          Daten sind da -> HUD fährt auseinander, Dashboard öffnet sich
 */

const TICKS = Array.from({ length: 72 }, (_, i) => i);
const R_PROGRESS = 146;
const CIRC = 2 * Math.PI * R_PROGRESS;

/** Kreisbogen von a0 bis a1 (Grad, 0 = oben, im Uhrzeigersinn). */
function arc(r, a0, a1) {
  const p = (a) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return `${(200 + r * Math.cos(rad)).toFixed(2)} ${(200 + r * Math.sin(rad)).toFixed(2)}`;
  };
  return `M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`;
}

const clock = () => new Date().toLocaleTimeString('de-DE', { hour12: false });

export default function LoadProgress({ range, variant = 'screen', closing = false }) {
  const project = useProject();
  const [p, setP] = useState(null);
  const [secs, setSecs] = useState(0);
  const [now, setNow] = useState(clock);
  const [log, setLog] = useState([]);
  const t0 = useRef(Date.now());
  const busy = useRef(false);

  useEffect(() => {
    if (closing) return undefined;
    let alive = true;
    const qs = new URLSearchParams();
    if (range?.from) qs.set('from', range.from);
    if (range?.to) qs.set('to', range.to);
    const tick = async () => {
      setSecs(Math.floor((Date.now() - t0.current) / 1000));
      setNow(clock());
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
  }, [range?.from, range?.to, closing]);

  const known = p && p.total > 0 && (p.active || p.done > 0);
  const pct = closing ? 100 : known ? Math.round((p.done / p.total) * 100) : 0;
  const label = closing
    ? 'Dashboard bereit'
    : known ? p.label : secs > 4 ? 'Server startet (nach längerer Pause bis zu ~50 Sek.)…' : 'Verbinde…';

  // Protokoll: jeder neue Schritt wird eine Zeile, die vorherigen gelten als erledigt
  useEffect(() => {
    if (!label) return;
    setLog((l) => (l[l.length - 1] === label ? l : [...l, label].slice(-5)));
  }, [label]);

  if (variant === 'bar') {
    return (
      <div className="lp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} title={label}>
        <div className={`lp-bar-fill ${known ? '' : 'indeterminate'}`} style={known ? { width: `${pct}%` } : undefined} />
      </div>
    );
  }

  const mark = project.branding?.loaderMark || '/fa-mark.png';

  return (
    <div className={`hud ${closing ? 'hud--closing' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="hud-grid" aria-hidden="true" />
      <div className="hud-scanline" aria-hidden="true" />

      <span className="hud-corner tl" aria-hidden="true" />
      <span className="hud-corner tr" aria-hidden="true" />
      <span className="hud-corner bl" aria-hidden="true" />
      <span className="hud-corner br" aria-hidden="true" />
      <div className="hud-tele tl">FINEST AUDIENCE <b>//</b> SYSTEM BOOT</div>
      <div className="hud-tele tr">{now}</div>
      <div className="hud-tele bl">{known || closing ? `SCHRITT ${closing ? p?.total ?? '' : p.done}/${p?.total ?? ''}` : 'VERBINDUNG'}</div>
      <div className="hud-tele br">T+{String(secs).padStart(2, '0')} S</div>

      <div className="hud-center">
        <div className="hud-reactor">
          <div className="hud-sweep" aria-hidden="true" />
          <div className="hud-core" aria-hidden="true" />
          <svg className="hud-rings" viewBox="0 0 400 400" aria-hidden="true">
            <defs>
              <linearGradient id="hudGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" className="hud-stop-a" />
                <stop offset="55%" className="hud-stop-b" />
                <stop offset="100%" className="hud-stop-c" />
              </linearGradient>
            </defs>
            <g className="hud-ring r1">
              {TICKS.map((i) => (
                <line key={i} x1="200" y1={i % 6 === 0 ? 4 : 9} x2="200" y2="16" transform={`rotate(${i * 5} 200 200)`} className={i % 6 === 0 ? 'tick major' : 'tick'} />
              ))}
            </g>
            <circle className="hud-ring r2" cx="200" cy="200" r="174" />
            <g className="hud-ring r3">
              <path d={arc(160, 10, 80)} />
              <path d={arc(160, 190, 260)} />
            </g>
            <g className="hud-ring r4">
              <path d={arc(160, 120, 140)} />
              <path d={arc(160, 300, 320)} />
            </g>
            <circle className="hud-track" cx="200" cy="200" r={R_PROGRESS} />
            <circle
              className="hud-progress"
              cx="200" cy="200" r={R_PROGRESS}
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - pct / 100)}
              transform="rotate(-90 200 200)"
            />
            <g className="hud-ring r5">
              <circle cx="200" cy="200" r="128" />
              <path d="M200 66 l-6 -10 h12 z" />
              <path d="M200 334 l-6 10 h12 z" />
            </g>
          </svg>
          <div className="hud-mark" style={{ WebkitMaskImage: `url(${mark})`, maskImage: `url(${mark})` }} aria-hidden="true" />
        </div>

        <div className="hud-title">
          <span className="hud-kicker">{project.shortName || project.name}</span>
          <span className="hud-pct">{pct}<small>%</small></span>
        </div>

        <ul className="hud-log" aria-live="polite">
          {log.map((l, i) => {
            const current = i === log.length - 1 && !closing;
            return (
              <li key={`${i}-${l}`} className={current ? 'now' : 'done'}>
                <span className="hud-log-tag">{current ? '>>' : 'OK'}</span>
                <span className="hud-log-text">{l}</span>
                {current && <span className="hud-cursor" />}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
