import React, { useEffect, useRef, useState } from 'react';
import { fmtEur, fmtInt, fmtPct, fmtQuality, entityKey, minuteSeriesFromEvents } from '../lib.js';
import { useProject } from '../project.jsx';
import GraphPanel from './GraphPanel.jsx';

/** Kleiner "Grafik"-Button (öffnet die Zeitreihen-Ansicht). */
function GraphBtn({ onClick, compact }) {
  return (
    <button className={`graph-btn ${compact ? 'compact' : ''}`} onClick={(e) => { e.stopPropagation(); onClick(); }} title="Grafik anzeigen">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 3 3 5-6" />
      </svg>
      {!compact && <span>Grafik</span>}
    </button>
  );
}

const fmtEur2 = (n) => (n == null ? '–' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n));
const fmtScore = (n) => (n == null ? '–' : String(Math.round(n)));

/** Kennzahlen in bis zu drei Sektionen – ohne horizontales Scrollen, alles
 * umbruchfähig. Ticket-/Qualitäts-Kacheln nur, wenn das Projekt sie hat. */
function Metrics({ n, leadHidden }) {
  const { features, labels } = useProject();
  const { hasTickets, hasQuality } = features;
  const T = labels.ticket;
  const lead = (v) => (leadHidden ? '–' : v);
  const groups = [
    {
      title: 'Ergebnis', cls: 'g-result',
      items: [
        ['Adspend', fmtEur(n.spend)],
        ['Leads', lead(fmtInt(n.leads))],
        ...(hasTickets ? [[T.many, lead(fmtInt(n.tickets))]] : []),
        ['€/Lead', lead(fmtEur(n.cpl))],
        ...(hasTickets ? [[`€/${T.one}`, lead(fmtEur(n.cpt))]] : []),
      ],
    },
    {
      title: hasQuality ? 'Qualität & Funnel' : 'Funnel', cls: 'g-quality',
      items: [
        ...(hasQuality ? [['Lead-Qualität', lead(fmtQuality(n.avgQuality))]] : []),
        ['CVR Start', lead(fmtPct(n.cvrStart))],
        ...(hasTickets ? [[`CVR ${T.one}`, lead(fmtPct(n.cvrTicket))]] : []),
      ],
    },
    {
      title: 'Facebook', cls: 'g-fb',
      items: [
        ['CPM', fmtEur2(n.cpm)],
        ['CTR ausg.', fmtPct(n.outboundCtr)],
        ['CPC ausg.', fmtEur2(n.cpoc)],
        ['Ausg. Klicks', fmtInt(n.outboundClicks)],
      ],
    },
  ].filter((g) => g.items.length > 0);
  return (
    <div className="cc-metrics" style={{ '--cc-metric-cols': groups.length }}>
      {groups.map((g) => (
        <div key={g.title} className={`cc-group ${g.cls}`}>
          <div className="cc-group-title">{g.title}</div>
          <div className="cc-tiles">
            {g.items.map(([label, val]) => (
              <div key={label} className="cc-tile">
                <span className="cc-tile-val">{val}</span>
                <span className="cc-tile-label">{label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusDot({ active }) {
  if (active == null) return null;
  return <span className={`status-dot ${active ? 'on' : 'off'}`} title={active ? 'Aktiv' : 'Pausiert'} />;
}

const LEVEL_LABEL = { campaign: 'Kampagne', adset: 'Anzeigengruppe', creative: 'Creative' };

// Anzeigen, die in Meta eingeschaltet sind, aber nicht ausliefern: bleiben auch
// bei "Nur aktive" sichtbar (hier muss man handeln) und bekommen einen Hinweis.
const AD_ISSUES = { DISAPPROVED: 'Abgelehnt', WITH_ISSUES: 'Problem', PENDING_REVIEW: 'In Prüfung', IN_PROCESS: 'In Bearbeitung' };

const campKey = (c) => `${c.account || ''}|${c.id ?? c.name}`;

/** Griff zum Verschieben (sechs Punkte). */
function DragHandle({ onPointerDown }) {
  return (
    <span className="cc-drag" onPointerDown={onPointerDown} onClick={(e) => e.stopPropagation()} title="Ziehen, um die Reihenfolge zu ändern" aria-label="Kampagne verschieben" role="button">
      <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
        {[3, 8, 13].map((y) => [3, 9].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}
      </svg>
    </span>
  );
}

/**
 * Eigene Reihenfolge der Kampagnen, im Browser gespeichert (je Projekt).
 * Kampagnen ohne gespeicherten Platz (neu hinzugekommen) folgen darunter in
 * der Standard-Sortierung nach Spend.
 */
function useCampaignOrder(slug) {
  const storageKey = `campaignOrder:${slug || 'dashboard'}`;
  const [order, setOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || []; } catch { return []; }
  });
  useEffect(() => {
    try {
      if (order.length) localStorage.setItem(storageKey, JSON.stringify(order));
      else localStorage.removeItem(storageKey);
    } catch { /* privater Modus o. ä.: Reihenfolge gilt dann nur bis zum Neuladen */ }
  }, [order, storageKey]);
  const sort = (list) => {
    const rank = new Map(order.map((k, i) => [k, i]));
    return [...list].sort((a, b) => {
      const ra = rank.get(campKey(a)), rb = rank.get(campKey(b));
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return 0; // Array.sort ist stabil -> Spend-Reihenfolge bleibt
    });
  };
  return { order, setOrder, sort };
}

export default function CampaignCards({ hierarchy, dailyByEntity, intradayByEntity, intradayDay, accounts }) {
  const { features, labels, slug } = useProject();
  const { hasTickets, hasQuality } = features;
  const T = labels.ticket;
  // Spalten der Anzeigen-Tabelle: Name + je nach Feature 5–7 Kennzahlen
  const adCols = [
    { label: 'Adspend', value: (ad) => fmtEur(ad.spend), always: true },
    { label: 'Leads', value: (ad, hidden) => (hidden ? '–' : fmtInt(ad.leads)) },
    { label: 'CPL', value: (ad, hidden) => (hidden ? '–' : fmtEur(ad.cpl)) },
    ...(hasTickets ? [{ label: T.many, value: (ad, hidden) => (hidden ? '–' : fmtInt(ad.tickets)) }] : []),
    ...(hasQuality ? [{ label: 'Qualität', value: (ad, hidden) => (hidden ? '–' : fmtQuality(ad.avgQuality)) }] : []),
    { label: 'CVR Start', value: (ad, hidden) => (hidden ? '–' : fmtPct(ad.cvrStart)) },
    { label: 'CTR ausg.', value: (ad) => fmtPct(ad.outboundCtr), always: true },
  ];
  const [open, setOpen] = useState(() => new Set());
  const [onlyActive, setOnlyActive] = useState(true);
  const [graph, setGraph] = useState(null);
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Bei 1-Tages-Zeitraum liefert der Server minutengenaue Events je Entität.
  const intraday = Boolean(intradayByEntity && intradayDay);
  // Liefert die fertige Punktreihe (Tagesreihe oder minutengenaue Ausschlag-Linie)
  const seriesFor = (dim, parts) => {
    const key = entityKey(dim, parts);
    if (intraday) {
      const ev = intradayByEntity?.[dim]?.[key];
      return ev ? minuteSeriesFromEvents(ev, intradayDay) : null;
    }
    return dailyByEntity?.[dim]?.[key];
  };
  const hasData = (dim, parts) => {
    const key = entityKey(dim, parts);
    return intraday ? Boolean(intradayByEntity?.[dim]?.[key]?.length) : Boolean(dailyByEntity?.[dim]?.[key]?.length);
  };
  const openGraph = (dim, parts, title) => {
    setGraph({ title, levelLabel: LEVEL_LABEL[dim], series: seriesFor(dim, parts) || [] });
  };
  const hasGraph = (dim, parts) => hasData(dim, parts);

  const { order, setOrder, sort } = useCampaignOrder(slug);
  const allSorted = sort(hierarchy || []);
  const campaigns = allSorted.filter((c) => !onlyActive || c.active !== false);

  // Verschieben per Ziehen am Griff (Pointer-Events: Maus und Touch). Während
  // des Ziehens wird die Reihenfolge live umgestellt; ausgeblendete Kampagnen
  // ("Nur aktive") behalten ihren Platz in der gespeicherten Liste.
  const [dragId, setDragId] = useState(null);
  const allKeysRef = useRef([]);
  allKeysRef.current = allSorted.map(campKey);
  const onDragStart = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragId(key);
  };
  const onDragMove = (e) => {
    if (!dragId) return;
    const edge = 70;
    if (e.clientY < edge) window.scrollBy(0, -14);
    else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-cid]');
    const overKey = target?.getAttribute('data-cid');
    if (!overKey || overKey === dragId) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const keys = allKeysRef.current.filter((k) => k !== dragId);
    const at = keys.indexOf(overKey);
    if (at < 0) return;
    keys.splice(before ? at : at + 1, 0, dragId);
    if (keys.join('\n') !== allKeysRef.current.join('\n')) setOrder(keys);
  };
  const onDragEnd = () => setDragId(null);

  // Eine einzelne Kampagnen-Karte rendern (für flache Liste ODER Account-Gruppen)
  const renderCampaign = (c) => {
          const cOpen = open.has(c.id);
          const leadHidden = c.leadCampaign === false;
          const adsets = c.adsets.filter((a) => !onlyActive || a.active !== false);
          return (
            <div key={c.id} data-cid={campKey(c)} className={`cc-card ${leadHidden ? 'is-traffic' : ''} ${dragId === campKey(c) ? 'is-dragging' : ''}`}>
              <div className="cc-head" onClick={() => toggle(c.id)} role="button">
                <DragHandle onPointerDown={(e) => onDragStart(e, campKey(c))} />
                <span className={`caret ${cOpen ? 'open' : ''}`}>▶</span>
                <StatusDot active={c.active} />
                <span className="cc-name" title={c.name}>{c.name}</span>
                {leadHidden && <span className="traffic-tag">Traffic</span>}
                <span className="cc-head-spend">{fmtEur(c.spend)}</span>
                {hasGraph('campaign', { campaign: c.name, account: c.account }) && <GraphBtn onClick={() => openGraph('campaign', { campaign: c.name, account: c.account }, c.name)} />}
              </div>
              <Metrics n={c} leadHidden={leadHidden} />

              {cOpen && (
                <div className="cc-children">
                  {adsets.map((a) => {
                    const aId = `${c.id}/${a.id}`;
                    const aOpen = open.has(aId);
                    const ads = (a.ads || []).filter((ad) => !onlyActive || ad.active !== false || AD_ISSUES[ad.status]);
                    return (
                      <div key={aId} className="cc-sub">
                        <div className="cc-subhead" onClick={() => toggle(aId)} role="button">
                          <span className={`caret ${aOpen ? 'open' : ''}`}>▶</span>
                          <StatusDot active={a.active} />
                          <span className="cc-subname" title={a.name}>{a.name}</span>
                          <span className="cc-sub-meta">
                            <span className="cc-sm-item"><b>{fmtEur(a.spend)}</b> Adspend</span>
                            <span className="cc-sm-item"><b>{leadHidden ? '–' : fmtInt(a.leads)}</b> Leads</span>
                            <span className="cc-sm-item"><b>{leadHidden ? '–' : fmtEur(a.cpl)}</b> CPL</span>
                            {hasQuality && <span className="cc-sm-item"><b>{leadHidden ? '–' : fmtQuality(a.avgQuality)}</b> Quali</span>}
                          </span>
                          {hasGraph('adset', { campaign: c.name, adset: a.name, account: c.account }) && <GraphBtn onClick={() => openGraph('adset', { campaign: c.name, adset: a.name, account: c.account }, a.name)} />}
                        </div>
                        {aOpen && (
                          <div className="cc-sub-body">
                            <Metrics n={a} leadHidden={leadHidden} />
                            {ads.length > 0 && (
                              <div className="cc-ads" style={{ '--cc-ad-cols': adCols.length }}>
                                <div className="cc-ad cc-ad-headrow" style={{ '--cc-ad-cols': adCols.length }}>
                                  <span className="cc-ad-name">Werbeanzeige</span>
                                  {adCols.map((c) => <span key={c.label}>{c.label}</span>)}
                                </div>
                                {ads.map((ad) => (
                                  <div key={ad.id} className={`cc-ad ${ad.active === false ? 'is-paused' : ''}`} style={{ '--cc-ad-cols': adCols.length }}>
                                    <span className="cc-ad-name" title={ad.name}>
                                      {ad.active != null && <span className={`status-dot ${ad.active ? 'on' : 'off'}`} />}
                                      <span className="cc-ad-label">{ad.name}</span>
                                      {AD_ISSUES[ad.status]
                                        ? <span className="issue-tag" title={`Meta-Status: ${ad.status}`}>{AD_ISSUES[ad.status]}</span>
                                        : ad.active === false && <span className="paused-tag">aus</span>}
                                      {hasGraph('creative', { campaign: c.name, adset: a.name, creative: ad.name, account: c.account }) && <GraphBtn compact onClick={() => openGraph('creative', { campaign: c.name, adset: a.name, creative: ad.name, account: c.account }, ad.name)} />}
                                    </span>
                                    {adCols.map((c) => <span key={c.label}>{c.value(ad, leadHidden)}</span>)}
                                  </div>
                                ))}
                              </div>
                            )}
                            {ads.length === 0 && <div className="muted" style={{ padding: '8px 2px' }}>keine Werbeanzeigen</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
  };

  // Mehrere Werbekonten -> je Konto eine eigene Gruppe mit eigenen KPIs. Der
  // Server rechnet jedes Konto getrennt (server/accounts.js); gleichnamige
  // Kampagnen erscheinen deshalb in jedem Konto mit ihren eigenen Zahlen.
  const accountList = accounts && accounts.length > 1 ? accounts : null;
  let body;
  if (accountList) {
    const known = new Set(accountList.map((a) => a.id));
    const groups = accountList
      .map((acc) => ({ acc, items: campaigns.filter((c) => c.account === acc.id) }))
      .filter((g) => g.items.length > 0);
    const rest = campaigns.filter((c) => !known.has(c.account));
    if (rest.length) groups.push({ acc: { id: '_rest', name: 'Weitere Konten' }, items: rest });
    body = groups.map((g) => (
      <div key={g.acc.id} className="cc-account-group">
        <div className="cc-account-head">
          <span className="cc-account-name">{g.acc.name}</span>
          <span className="cc-account-count">{g.items.length} Kampagnen</span>
        </div>
        <div className="cc-list">{g.items.map(renderCampaign)}</div>
      </div>
    ));
  } else {
    body = <div className="cc-list">{campaigns.map(renderCampaign)}</div>;
  }

  return (
    <div className={dragId ? 'cc-sorting' : ''} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
      <div className="table-toolbar">
        <label className="switch">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          <span className="switch-track"><span className="switch-thumb" /></span>
          <span className="switch-label">Nur aktive anzeigen</span>
        </label>
        <span className="cc-toolbar-right">
          {order.length > 0 && <button className="ghost-btn cc-order-reset" onClick={() => setOrder([])}>Reihenfolge zurücksetzen</button>}
          <span className="muted">{campaigns.length} Kampagnen{accountList ? ` · ${accountList.length} Konten` : ''}</span>
        </span>
      </div>

      {body}
      {campaigns.length === 0 && <div className="empty">Keine {onlyActive ? 'aktiven ' : ''}Kampagnen gefunden.</div>}

      {graph && (
        <GraphPanel title={graph.title} levelLabel={graph.levelLabel} series={graph.series} hourly={intraday} onClose={() => setGraph(null)} />
      )}
    </div>
  );
}
