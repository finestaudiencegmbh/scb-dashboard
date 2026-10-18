import React, { useMemo } from 'react';
import { leadsByWeekdayHour, fmtInt } from '../lib.js';

const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const DAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Heatmap "Leadaktivitäten": Wochentag x Stunde. Die Intensität kommt
 * aus der Akzentfarbe (--accent-rgb), starke Zellen leuchten – funktioniert
 * damit in jedem Branding. Reagiert auf die aktiven Filter.
 */
export default function LeadHeatmap({ leads }) {
  const { grid, max, total, peak } = useMemo(() => {
    const grid = leadsByWeekdayHour(leads);
    let max = 0, total = 0, peak = null;
    grid.forEach((row, d) => row.forEach((v, h) => {
      total += v;
      if (v > max) { max = v; peak = { d, h, v }; }
    }));
    return { grid, max, total, peak };
  }, [leads]);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Leadaktivitäten</h2>
          <span className="panel-sub">Eintragungen nach Wochentag und Uhrzeit (deutsche Zeit)</span>
        </div>
        {peak && (
          <span className="heat-peak">
            Stärkstes Fenster: <strong>{DAYS_LONG[peak.d]}, {peak.h}–{peak.h + 1} Uhr</strong> · {fmtInt(peak.v)} Leads
          </span>
        )}
      </div>
      {total === 0 ? (
        <div className="chart-empty">Keine Leads für die aktuelle Auswahl.</div>
      ) : (
        <div className="heat-scroll">
          <div className="heat-grid" role="table" aria-label="Leads nach Wochentag und Stunde">
            <span />
            {HOURS.map((h) => (
              <span key={h} className="heat-hour">{h % 3 === 0 ? h : ''}</span>
            ))}
            {grid.map((row, d) => (
              <React.Fragment key={d}>
                <span className="heat-day">{DAYS[d]}</span>
                {row.map((v, h) => {
                  const r = max ? v / max : 0;
                  // Wurzel-Kurve: auch einzelne Leads sind sichtbar, die Spitze bleibt klar
                  const alpha = v ? 0.14 + 0.78 * Math.sqrt(r) : 0.035;
                  const hot = r >= 0.6;
                  return (
                    <span
                      key={h}
                      className={`heat-cell${hot ? ' hot' : ''}`}
                      style={{ background: `rgba(var(--accent-rgb), ${alpha.toFixed(3)})`, '--heat': (0.25 + 0.6 * r).toFixed(2) }}
                      title={`${DAYS_LONG[d]}, ${h}–${h + 1} Uhr: ${fmtInt(v)} ${v === 1 ? 'Lead' : 'Leads'}`}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <div className="heat-legend">
            <span>wenig</span>
            {[0.1, 0.3, 0.55, 0.8, 1].map((r) => (
              <span key={r} className="heat-cell legend" style={{ background: `rgba(var(--accent-rgb), ${(0.14 + 0.78 * Math.sqrt(r)).toFixed(3)})` }} />
            ))}
            <span>viel</span>
          </div>
        </div>
      )}
    </section>
  );
}
