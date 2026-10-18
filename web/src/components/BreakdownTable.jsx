import React, { useState, useMemo } from 'react';
import { fmtEur, fmtInt, fmtPct, fmtQuality } from '../lib.js';
import { useProject } from '../project.jsx';

export default function BreakdownTable({ rows, dimLabel, onSelect, tiers, showActiveToggle = true }) {
  const { features, labels } = useProject();
  const { hasTickets, hasQuality } = features;
  const T = labels.ticket;
  const [sort, setSort] = useState({ col: 'leads', dir: 'desc' });
  const [onlyActive, setOnlyActive] = useState(false);

  const hasPaused = rows.some((r) => r.active === false);
  const visibleRows = onlyActive ? rows.filter((r) => r.active !== false) : rows;

  // Elternpfad nur zeigen, wenn er etwas unterscheidet: gleicher Name mehrfach.
  const showParent = useMemo(() => {
    const seen = new Set();
    return rows.some((r) => {
      const k = String(r.key).toLowerCase();
      if (seen.has(k)) return true;
      seen.add(k);
      return false;
    });
  }, [rows]);

  const hasSpend = rows.some((r) => r.spend != null);
  const hasImpressions = rows.some((r) => r.impressions != null);
  const hasOutbound = rows.some((r) => r.outboundClicks != null);

  const cols = useMemo(() => {
    // Reihenfolge wie gewünscht (links -> rechts)
    const base = [{ key: 'key', label: dimLabel, align: 'left', fmt: (v) => v }];
    if (hasSpend) base.push({ key: 'spend', label: 'Adspend', fmt: fmtEur });   // 1
    base.push({ key: 'leads', label: 'Leads', fmt: fmtInt });                   // 2
    if (hasTickets) base.push({ key: 'tickets', label: T.many, fmt: fmtInt });  // 3
    if (hasSpend) {
      base.push({ key: 'cpl', label: '€/Lead', fmt: fmtEur });                 // 4
      if (hasTickets) base.push({ key: 'cpt', label: `€/${T.one}`, fmt: fmtEur }); // 5
    }
    if (hasQuality) base.push({ key: 'avgQuality', label: 'Lead-Qualität', fmt: fmtQuality }); // 6
    if (hasOutbound) base.push({ key: 'cvrStart', label: 'CVR Start', fmt: fmtPct }); // 8
    if (hasTickets) base.push({ key: 'ticketRate', label: `CVR ${T.one}`, fmt: fmtPct }); // 9
    if (hasImpressions) base.push({ key: 'cpm', label: 'CPM', fmt: fmtEur });   // 10
    if (hasOutbound) {
      base.push({ key: 'outboundCtr', label: 'CTR (ausg.)', fmt: fmtPct });    // 11
      base.push({ key: 'cpoc', label: 'CPC (ausg.)', fmt: fmtEur });           // 12
      base.push({ key: 'outboundClicks', label: 'Ausg. Klicks', fmt: fmtInt }); // 13
    }
    return base;
  }, [dimLabel, hasSpend, hasImpressions, hasOutbound, hasTickets, hasQuality, T.one, T.many]);

  const sorted = useMemo(() => {
    const arr = [...visibleRows];
    const { col, dir } = sort;
    arr.sort((a, b) => {
      // Aktive immer vor pausierten (active === false ans Ende)
      const ap = a.active === false ? 1 : 0;
      const bp = b.active === false ? 1 : 0;
      if (ap !== bp) return ap - bp;
      const av = a[col];
      const bv = b[col];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv, 'de') : av - bv;
      return dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [visibleRows, sort]);


  const onSort = (col) => setSort((s) => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }));

  return (
    <div>
      <div className="bt-toolbar">
        {showActiveToggle ? (
          <label className="switch">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
            <span className="switch-track"><span className="switch-thumb" /></span>
            <span className="switch-label">Nur aktive anzeigen</span>
          </label>
        ) : <span />}
        <span className="muted">{visibleRows.length} {onlyActive ? 'aktive' : 'Einträge'}</span>
      </div>
      <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={`${c.align === 'left' ? 'left' : 'num'} ${sort.col === c.key ? 'sorted' : ''}`} onClick={() => onSort(c.key)}>
                {c.label}
                {sort.col === c.key && <span className="sort-arrow">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id || r.key} className={`clickable ${r.active === false ? 'is-paused' : ''}`} onClick={() => onSelect?.(r.key)} title={r.active === false ? 'Pausiert' : 'Klicken, um danach zu filtern'}>
              {cols.map((c) => (
                <td key={c.key} className={c.align === 'left' ? 'left' : 'num'} data-label={c.key === 'key' ? '' : c.label}>
                  {c.key === 'key' ? (
                    <div className="cell-name">
                      {r.active != null && <span className={`status-dot ${r.active ? 'on' : 'off'}`} />}
                      <span className="cell-name-main">
                        <span className="cell-name-text" title={r.key}>{r.key}</span>
                        {/* Elternpfad: unterscheidet gleichnamige Anzeigengruppen/Creatives */}
                        {r.parent && showParent && <span className="cell-parent" title={r.parent}>{r.parent}</span>}
                      </span>
                      {r.active === false && <span className="paused-tag">pausiert</span>}
                    </div>
                  ) : (
                    c.fmt(r[c.key])
                  )}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={cols.length} className="empty">Keine Daten für die aktuelle Auswahl.</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
