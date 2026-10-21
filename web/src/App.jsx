import React, { useEffect, useMemo, useState } from 'react';
import { fetchData } from './api.js';
import { applyFilters, aggregate, computeKpis, tierDistribution, leadsByDay, leadsByTime, cplByDay, qualityByDay, qualifiedTiersOf, fmtDate } from './lib.js';
import Kpis from './components/Kpis.jsx';
import Filters from './components/Filters.jsx';
import BreakdownTable from './components/BreakdownTable.jsx';
import LeadsTable from './components/LeadsTable.jsx';
import TimeChart from './components/TimeChart.jsx';
import IntradayChart from './components/IntradayChart.jsx';
import CampaignCards from './components/CampaignCards.jsx';
import DateRangePicker from './components/DateRangePicker.jsx';
import SourcesView from './components/SourcesView.jsx';
import ChatBot from './components/ChatBot.jsx';
import LeadHeatmap from './components/LeadHeatmap.jsx';
import DataSources from './components/DataSources.jsx';
import { useProject } from './project.jsx';
import { fmtEur, fmtInt } from './lib.js';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
  { key: 'campaigns', label: 'Kampagnen', icon: 'M3 3v18h18M7 15l4-4 3 3 5-6' },
  { key: 'leads', label: 'Leadliste', icon: 'M3 5h18M3 12h18M3 19h18' },
  { key: 'sources', label: 'Quellen', icon: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 0v10l7 3' },
];

const EMPTY_FILTERS = {
  search: '', sourceType: 'all', campaign: '', adset: '', creative: '', placement: '',
  // answers = { <fragebogenSchlüssel>: <wert> }, aus der Projekt-Konfiguration
  answers: {}, from: '', to: '', onlyTickets: false, tiers: [],
};

export default function App() {
  const project = useProject();
  const { features, labels, branding } = project;
  const { hasTickets, hasQuality } = features;
  const T = labels.ticket;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [range, setRange] = useState({ from: '', to: '' });
  const [view, setView] = useState('dashboard');

  const load = async (refresh = false, r = range) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchData({ refresh, from: r.from, to: r.to }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(false); }, []);

  const applyRange = (r) => {
    setRange(r);
    // Zeitraum steuert Server (FB) UND die clientseitige Lead-Filterung
    setFilters((f) => ({ ...f, from: r.from, to: r.to }));
    load(false, r);
  };

  const tiers = data?.scoring?.tiers || [];
  // Welche Stufen als "qualifiziert" zählen, entscheidet config/scoring.json
  const qualifiedTiers = useMemo(() => qualifiedTiersOf(tiers), [tiers]);
  const fb = data?.fb || null;
  const hasFb = Boolean(fb?.byDim);
  const filtered = useMemo(() => (data ? applyFilters(data.leads, filters) : []), [data, filters]);
  const kpis = useMemo(() => (data ? computeKpis(filtered, data.overviewByAdset, fb, features, qualifiedTiers) : null), [data, filtered, fb, features, qualifiedTiers]);
  const dist = useMemo(() => (data ? tierDistribution(filtered, tiers) : {}), [data, filtered, tiers]);
  // Stunden-Raster, wenn der gewählte Zeitraum genau EIN Tag ist (0–24 Uhr).
  const hourlyDay = (range.from && range.to && range.from === range.to) ? range.from : null;
  const leadDaily = useMemo(() => (data ? leadsByTime(filtered, hourlyDay) : []), [data, filtered, hourlyDay]);
  const cplDaily = useMemo(() => ((hasFb && fb.daily) ? cplByDay(fb.daily.spend, filtered) : []), [hasFb, fb, filtered]);
  const qualityDaily = useMemo(() => (data ? qualityByDay(filtered) : []), [data, filtered]);

  const [orgDrill, setOrgDrill] = useState(''); // organische Kampagne, in die reingezoomt wurde

  const organicRows = useMemo(() => {
    if (!data) return [];
    // Organisch zweistufig: organicCampaign (ManyChat, Bio, …) -> organicAdset
    // (Live Automation, Facebook Bio, …). Keine Meta-Daten (addFbRows:false).
    const base = filtered.filter((l) => l.sourceType !== 'paid');
    const leads = orgDrill
      ? base.filter((l) => (l.organicCampaign || '(direkt)') === orgDrill)
      : base;
    const dim = orgDrill ? 'organicAdset' : 'organicCampaign';
    const rows = aggregate(
      leads.map((l) => ({ ...l, organicCampaign: l.organicCampaign || '(direkt)', organicAdset: l.organicAdset || '(direkt)' })),
      dim, data.overviewByAdset, fb, {}, { addFbRows: false, features, qualifiedTiers }
    );
    return rows;
  }, [data, filtered, fb, orgDrill, features, qualifiedTiers]);

  if (loading && !data) return <div className="loader">Lade Daten…</div>;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src={branding.logo} alt={project.name} width="40" height="40" />
          <div className="brand-text">
            <div className="brand-title">{project.shortName || project.name}</div>
            <div className="brand-sub">{project.subtitle}</div>
            {project.event && <div className="brand-event">{project.event}</div>}
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.key} className={`nav-item ${view === n.key ? 'active' : ''}`} onClick={() => setView(n.key)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={n.icon} /></svg>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <DataSources data={data} />
          {data && <span className="updated">Stand: {fmtDate(data.fetchedAt)}</span>}
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div className="topbar-title">
            <img className="topbar-logo" src={branding.logo} alt="" width="34" height="34" />
            <div>
              <h1>{NAV.find((n) => n.key === view)?.label}</h1>
              <p className="subtitle">{project.name}</p>
            </div>
            <div className="topbar-badges">
              {data?.source === 'demo' && <span className="demo-badge" title="Es werden synthetische Beispieldaten angezeigt.">DEMO</span>}
              {hasFb && <span className="fb-badge" title={`Facebook-Daten via ${fb.provider === 'meta' ? 'Meta' : 'Supermetrics'} · ${fb.rows} Zeilen`}>FB live</span>}
            </div>
          </div>
          <div className="topbar-right">
            <DateRangePicker from={range.from} to={range.to} onApply={applyRange} />
            <button className="refresh-btn" onClick={() => load(true)} disabled={loading}>
              <svg className={`btn-icon ${loading ? 'spin' : ''}`} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
              </svg>
              {loading ? 'Lädt…' : 'Aktualisieren'}
            </button>
          </div>
        </header>

        {error && (
          <div className="error-banner">
            <strong>Fehler:</strong> {error}
            <div className="hint">Prüfe Service-Account, SPREADSHEET_ID und Sheet-Freigabe (siehe README).</div>
          </div>
        )}
        {fb?.configured && fb?.error && (
          <div className="error-banner warn">
            <strong>Facebook{fb.provider === 'meta' ? ' (Meta API)' : ' (Supermetrics)'}:</strong> {fb.error}
            <div className="hint">{fb.provider === 'meta'
              ? 'Das Dashboard funktioniert weiter. Prüfe META_ACCESS_TOKEN (ads_read, nicht abgelaufen) und META_AD_ACCOUNT_ID.'
              : 'Das Dashboard funktioniert weiter. Prüfe SUPERMETRICS_API_KEY und die Query.'}</div>
          </div>
        )}
        {fb?.configured && !fb?.error && fb?.accountErrors?.length > 0 && (
          <div className="error-banner warn">
            <strong>Facebook (Meta API):</strong> Nur {fb.accounts?.length ?? 0} von {fb.accountsRequested ?? '?'} Werbekonten geladen – die Zahlen sind unvollständig.
            <div className="hint">Nicht geladen: {fb.accountErrors.join(' · ')}. Meist transient (Rate-Limit/Netzwerk nach Meta-Störung) – in 1–2 Min nochmal „Aktualisieren".</div>
          </div>
        )}

        {data && (
          <>
            <Filters leads={data.leads} filters={filters} setFilters={setFilters} tiers={tiers} onReset={() => setFilters({ ...EMPTY_FILTERS, from: range.from, to: range.to })} />

            {view === 'dashboard' && (
              <>
                {/* Graphen oben: Leads & Tickets breit, darunter Spend + CPL nebeneinander */}
                <section className="panel">
                  <div className="panel-head"><div><h2>Verlauf</h2><span className="panel-sub">{hourlyDay
                      ? `Leads${hasTickets ? `/${T.many}` : ''} im Tagesverlauf (0–24 Uhr, minutengenau) · Maus zum Anzeigen`
                      : `Leads${hasTickets ? `/${T.many}` : ''} (Sheet) & Ad-Spend/CPL (Facebook) pro Tag · Maus zum Anzeigen`}</span></div></div>
                  <div className="charts-stack">
                    {hourlyDay ? (
                      <>
                        <IntradayChart title={`Leads${hasTickets ? ` & ${T.many}` : ''} im Tagesverlauf`} formatY={(v) => fmtInt(Math.round(v))}
                          series={[
                            { key: 'leads', label: 'Leads', color: '#5ec8d8', data: leadDaily.map((d) => ({ date: d.date, value: d.leads })) },
                            ...(hasTickets ? [{ key: 'tickets', label: T.many, color: '#6fcf97', data: leadDaily.map((d) => ({ date: d.date, value: d.tickets })) }] : []),
                          ]} />
                        <div className="info-note">Ad-Spend &amp; CPL sind aktuell nur pro Tag verfügbar – die Stundenwerte dafür folgen. Die Sheet-Kennzahlen siehst du oben minutengenau.</div>
                      </>
                    ) : (
                      <>
                        <TimeChart title={`Leads${hasTickets ? ` & ${T.many}` : ''} pro Tag`} formatY={(v) => fmtInt(Math.round(v))}
                          series={[
                            { key: 'leads', label: 'Leads', color: '#5ec8d8', data: leadDaily.map((d) => ({ date: d.date, value: d.leads })) },
                            ...(hasTickets ? [{ key: 'tickets', label: T.many, color: '#6fcf97', data: leadDaily.map((d) => ({ date: d.date, value: d.tickets })) }] : []),
                          ]} />
                        <div className="charts-grid">
                          <TimeChart title="Ad-Spend pro Tag" formatY={(v) => fmtEur(Math.round(v))}
                            series={[{ key: 'spend', label: 'Ad-Spend', color: branding.accent, data: (hasFb && fb.daily ? fb.daily.spend : []).map((d) => ({ date: d.date, value: d.spend })) }]} />
                          <TimeChart title="CPL pro Tag" formatY={(v) => fmtEur(Math.round(v))}
                            series={[{ key: 'cpl', label: 'CPL (Ads)', color: '#a78bfa', data: cplDaily.map((d) => ({ date: d.date, value: d.value })) }]} />
                        </div>
                      </>
                    )}
                  </div>
                </section>

                {/* KPI-Boxen darunter */}
                <Kpis kpis={kpis} dist={dist} tiers={tiers} qualifiedTiers={qualifiedTiers} qualityDaily={qualityDaily} />

                <LeadHeatmap leads={filtered} />

                {organicRows.length > 0 && (
                  <section className="panel">
                    <div className="panel-head"><div><h2>Organisch</h2><span className="panel-sub">Leads ohne Ad-Kosten · ManyChat-Flows, Bios, Direkt …</span></div></div>
                    {orgDrill && (
                      <div className="drill-crumbs">
                        <span className="crumb-label">Aufgeschlüsselt nach:</span>
                        <span className="crumb"><span className="crumb-dim">Quelle:</span> {orgDrill}
                          <button className="crumb-x" title="zurück" onClick={() => setOrgDrill('')}>×</button>
                        </span>
                      </div>
                    )}
                    <BreakdownTable rows={organicRows} dimLabel={orgDrill ? 'Unterquelle' : 'Quelle'} onSelect={orgDrill ? undefined : (k) => setOrgDrill(k)} tiers={tiers} showActiveToggle={false} />
                  </section>
                )}
              </>
            )}

            {view === 'campaigns' && (
              hasFb && fb.hierarchy ? (
                <section className="panel">
                  <div className="panel-head"><div><h2>Kampagnen-Aufschlüsselung</h2><span className="panel-sub">Kampagne → Anzeigengruppe → Creative · Facebook-Kennzahlen + Lead-Attribution</span></div></div>
                  <CampaignCards hierarchy={fb.hierarchy} dailyByEntity={fb.dailyByEntity} intradayByEntity={fb.intradayByEntity} intradayDay={fb.intradayDay} accounts={fb.accounts} />
                </section>
              ) : (
                <section className="panel">
                  <div className="panel-head"><div><h2>Kampagnen-Aufschlüsselung</h2></div></div>
                  <div className="info-note">Keine Facebook-Daten verfügbar. Prüfe die Meta-Anbindung (META_ACCESS_TOKEN, META_AD_ACCOUNT_ID).</div>
                </section>
              )
            )}

            {view === 'leads' && (
              <section className="panel">
                <div className="panel-head"><div><h2>Alle Leads</h2><span className="panel-sub">{hasQuality ? 'Zeile anklicken für Details & Fragebogen-Antworten' : 'Alle Leads im gewählten Zeitraum'}</span></div></div>
                <LeadsTable leads={filtered} tiers={tiers} />
              </section>
            )}

            {view === 'sources' && <SourcesView leads={filtered} />}

            {/* Mobil ist die Sidebar-Fußzeile ausgeblendet -> Status hier unten */}
            <div className="ds-mobile"><DataSources data={data} /></div>

            <footer className="footer">
              {data.counts.leads} Leads · {data.counts.paidLeads} bezahlt
              {hasTickets && ` · ${data.counts.tickets} ${T.many}`}
              {hasQuality && ` · ${data.counts.scored} bewertet`}
              {' · '}Quelle: {data.source === 'google' ? 'Google Sheet (live)' : 'Demo'}
            </footer>
          </>
        )}
      </main>
      <ChatBot range={range} />
    </div>
  );
}
