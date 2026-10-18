import React from 'react';
import Donut from './Donut.jsx';
import { groupCount } from '../lib.js';

/** Horizontale Balken-Liste (Top-N) wie im Referenz-Screenshot. */
function RankList({ title, subtitle, items, color = '#a78bfa' }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <span className="panel-sub">{subtitle}</span>}
        </div>
      </div>
      <div className="rank-list">
        {items.map((it) => (
          <div key={it.key} className="rank-row">
            <div className="rank-top">
              <span className="rank-name" title={it.key}>{it.key}</span>
              <span className="rank-count">{it.count}</span>
            </div>
            <div className="rank-track">
              <div className="rank-fill" style={{ width: `${(it.count / max) * 100}%`, background: color }} />
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="empty">Keine Daten.</div>}
      </div>
    </div>
  );
}

export default function SourcesView({ leads: allRows }) {
  // Quellen-Auswertung über die Lead-Zeilen (nicht über die Fragebogen-Zeilen)
  const leads = allRows.filter((l) => l.isLead !== false);
  const bySource = groupCount(leads, (l) => l.sourceRaw, { emptyLabel: '(direkt)' });
  const byCampaign = groupCount(leads, (l) => l.campaignRaw, { limit: 8, emptyLabel: '(direkt)' });
  const byContent = groupCount(leads, (l) => l.mediumRaw, { limit: 8, emptyLabel: '(direkt)' });

  return (
    <div className="sources-grid">
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Quellen · utm_source</h2>
            <span className="panel-sub">Woher die Leads kommen</span>
          </div>
        </div>
        <Donut data={bySource.slice(0, 8)} centerLabel="LEADS GESAMT" />
      </div>
      <RankList title="Top Kampagnen · utm_campaign" subtitle="Leads je Kampagne" items={byCampaign} color="#5ec8d8" />
      <RankList title="Ad-Varianten · utm_medium" subtitle="Leads je Creative/Variante" items={byContent} color="#a78bfa" />
    </div>
  );
}
