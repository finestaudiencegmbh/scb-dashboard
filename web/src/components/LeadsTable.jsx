import React, { useState, useMemo } from 'react';
import { fmtDate } from '../lib.js';
import { useProject } from '../project.jsx';
import QualityBadge from './QualityBadge.jsx';

/** Spalten der Leadliste – Ticket-/Qualitäts-Spalten nur mit aktivem Feature. */
function buildCols({ hasTickets, hasQuality, ticketLabel }) {
  const cols = [
    { key: 'name', label: 'Name', sort: (l) => l.name },
    { key: 'wonAt', label: 'Lead am', sort: (l) => l.wonAt || '' },
    { key: 'sourceType', label: 'Quelle', sort: (l) => l.sourceType },
    { key: 'campaign', label: 'Kampagne', sort: (l) => l.campaign },
    { key: 'adset', label: 'Anzeigengruppe', sort: (l) => l.adset },
    { key: 'creative', label: 'Creative', sort: (l) => l.creative },
    { key: 'placement', label: 'Placement', sort: (l) => l.placement },
  ];
  if (hasTickets) cols.push({ key: 'ticket', label: ticketLabel, sort: (l) => (l.linkedTicket ? 1 : 0) });
  if (hasQuality) cols.push({ key: 'quality', label: 'Qualität', sort: (l) => l.quality?.score ?? -1 });
  return cols;
}

function exportCsv(leads, { slug, features, answers, ticketLabel }) {
  const { hasTickets, hasQuality } = features;
  const answerKeys = hasQuality ? Object.keys(answers) : [];
  const head = [
    'Name', 'E-Mail', 'Telefon', 'Lead am',
    ...(hasTickets ? [`${ticketLabel} am`] : []),
    'Quelle', 'Kampagne', 'Anzeigengruppe', 'Creative', 'Placement',
    ...(hasQuality ? ['Quality-Score', 'Tier'] : []),
    ...answerKeys.map((k) => answers[k].label),
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = leads.map((l) =>
    [
      l.name, l.email, l.phone, l.wonAt,
      ...(hasTickets ? [l.ticketAt] : []),
      l.sourceType, l.campaign, l.adset, l.creative, l.placement,
      ...(hasQuality ? [l.quality?.score ?? '', l.quality?.tier ?? ''] : []),
      ...answerKeys.map((k) => l.answers?.[k] ?? ''),
    ].map(esc).join(';')
  );
  const csv = [head.map(esc).join(';'), ...lines].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function LeadsTable({ leads: allRows, tiers }) {
  // Die Leadliste zeigt die Zeilen aus dem Lead-Tab. Fragebogen-Zeilen sind
  // eigene Datensätze (Gold-Tickets) und würden die Liste sonst verdoppeln.
  const leads = useMemo(() => allRows.filter((l) => l.isLead !== false), [allRows]);
  const project = useProject();
  const { features, labels, answers, slug } = project;
  const { hasTickets, hasQuality } = features;
  const T = labels.ticket;
  const [sort, setSort] = useState({ col: 'wonAt', dir: 'desc' });
  const [open, setOpen] = useState(null);

  const COLS = useMemo(
    () => buildCols({ hasTickets, hasQuality, ticketLabel: T.short }),
    [hasTickets, hasQuality, T.short]
  );
  const answerKeys = useMemo(() => (hasQuality ? Object.keys(answers) : []), [hasQuality, answers]);

  const sorted = useMemo(() => {
    const def = COLS.find((c) => c.key === sort.col) || COLS[1];
    const arr = [...leads].sort((a, b) => {
      const av = def.sort(a);
      const bv = def.sort(b);
      const cmp = typeof av === 'string' ? av.localeCompare(bv, 'de') : av - bv;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [leads, sort, COLS]);

  const onSort = (col) => setSort((s) => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }));

  return (
    <div>
      <div className="table-toolbar">
        <span>{leads.length} Leads</span>
        <button className="ghost-btn" onClick={() => exportCsv(sorted, { slug, features, answers, ticketLabel: T.one })}>
          <svg className="btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="M7 10l5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
          CSV exportieren
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table leads">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={sort.col === c.key ? 'sorted' : ''} onClick={() => onSort(c.key)}>
                  {c.label}{sort.col === c.key && <span className="sort-arrow">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((l, i) => {
              const isOpen = open === l.email + i;
              const hasDetails = hasQuality && Boolean(l.answers);
              return (
              <React.Fragment key={l.email + i}>
                <tr className={`clickable ${isOpen ? 'expanded' : ''}`} onClick={() => setOpen(isOpen ? null : l.email + i)}>
                  <td className="left lead-main" data-label="Lead">
                    <div className="lead-name">{l.name}</div>
                    <div className="lead-email">{l.email}</div>
                  </td>
                  <td className="nowrap sec" data-label="Lead am">{fmtDate(l.wonAt)}</td>
                  <td data-label="Quelle"><span className={`pill ${l.sourceType}`}>{l.sourceType === 'paid' ? 'Ads' : 'Organisch'}</span></td>
                  <td className="trunc sec" data-label="Kampagne" title={l.campaign}>{l.campaign}</td>
                  <td className="trunc sec" data-label="Anzeigengruppe" title={l.adset}>{l.adset}</td>
                  <td className="trunc sec" data-label="Creative" title={l.creative}>{l.creative}</td>
                  <td className="trunc sec" data-label="Placement" title={l.placement}>{l.placement}</td>
                  {hasTickets && (
                    <td className="sec" data-label={T.short}>{l.linkedTicket ? <span className="pill vip">{T.short}</span> : <span className="muted">–</span>}</td>
                  )}
                  {hasQuality && (
                    <td data-label="Qualität"><QualityBadge quality={l.quality} tiers={tiers} /></td>
                  )}
                </tr>
                {isOpen && hasDetails && (
                  <tr className="detail-row">
                    <td colSpan={COLS.length}>
                      <div className="answers">
                        {answerKeys.map((k) => (
                          <Answer key={k} label={answers[k].label} value={l.answers[k]} wide={answers[k].wide} />
                        ))}
                        <Answer label="Telefon" value={l.phone} />
                        {l.quality && (
                          <div className="answer wide">
                            <div className="answer-label">Quality-Breakdown</div>
                            <div className="breakdown">
                              {Object.entries(l.quality.breakdown).map(([k, v]) => (
                                <span key={k} className="bd-item">{answers[k]?.label || k}: <strong>{v ?? '–'}</strong></span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
              );
            })}
            {sorted.length === 0 && <tr><td colSpan={COLS.length} className="empty">Keine Leads für die aktuelle Auswahl.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Answer({ label, value, wide }) {
  return (
    <div className={`answer ${wide ? 'wide' : ''}`}>
      <div className="answer-label">{label}</div>
      <div className="answer-value">{value || <span className="muted">–</span>}</div>
    </div>
  );
}
