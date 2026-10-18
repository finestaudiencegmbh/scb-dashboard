import React, { useState } from 'react';
import { uniqueValues, answerValues } from '../lib.js';
import { useProject } from '../project.jsx';

function Select({ label, value, onChange, options, allLabel = 'Alle' }) {
  return (
    <label className="filter">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o.length > 60 ? o.slice(0, 57) + '…' : o}</option>
        ))}
      </select>
    </label>
  );
}

export default function Filters({ leads, filters, setFilters, tiers, onReset }) {
  const { features, answers } = useProject();
  const { hasQuality } = features;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  // Fragebogen-Filter: welche Antworten filterbar sind, steht in der Config.
  const answerFilters = hasQuality ? Object.entries(answers).filter(([, a]) => a.filter) : [];
  const setAnswer = (key, value) => setFilters((f) => ({ ...f, answers: { ...(f.answers || {}), [key]: value } }));
  const toggleTier = (key) => {
    set({
      tiers: filters.tiers.includes(key)
        ? filters.tiers.filter((t) => t !== key)
        : [...filters.tiers, key],
    });
  };

  return (
    <div className="filters">
      <div className="filters-primary">
        <label className="filter grow">
          <span>Suche (Name, E-Mail, Creative)</span>
          <input type="search" value={filters.search} placeholder="Leads durchsuchen…" onChange={(e) => set({ search: e.target.value })} />
        </label>
        <label className="filter">
          <span>Quelle</span>
          <select value={filters.sourceType} onChange={(e) => set({ sourceType: e.target.value })}>
            <option value="all">Alle</option>
            <option value="paid">Bezahlt (Ads)</option>
            <option value="organic">Organisch</option>
          </select>
        </label>
        <button className={`more-btn ${showAdvanced ? 'open' : ''}`} onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? 'Weniger Filter' : 'Mehr Filter'}
          <svg className="chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button className="reset-btn" onClick={onReset}>Filter zurücksetzen</button>
      </div>

      {showAdvanced && (
        <div className="filters-advanced">
          <div className="filters-row">
            <Select label="Kampagne" value={filters.campaign} onChange={(v) => set({ campaign: v })} options={uniqueValues(leads, 'campaign')} />
            <Select label="Anzeigengruppe" value={filters.adset} onChange={(v) => set({ adset: v })} options={uniqueValues(leads, 'adset')} />
            <Select label="Creative" value={filters.creative} onChange={(v) => set({ creative: v })} options={uniqueValues(leads, 'creative')} />
            <Select label="Placement" value={filters.placement} onChange={(v) => set({ placement: v })} options={uniqueValues(leads, 'placement')} />
          </div>

          {answerFilters.length > 0 && (
            <div className="filters-row">
              {answerFilters.map(([key, a]) => (
                <Select key={key} label={a.label} value={(filters.answers || {})[key] || ''} onChange={(v) => setAnswer(key, v)} options={answerValues(leads, key)} />
              ))}
            </div>
          )}

          {hasQuality && tiers.length > 0 && (
            <div className="filters-row tier-row">
              <span className="tier-label">Qualität:</span>
              {tiers.map((t) => (
                <button key={t.key} className={`tier-chip ${filters.tiers.includes(t.key) ? 'active' : ''}`} style={filters.tiers.includes(t.key) ? { background: t.color, borderColor: t.color } : { borderColor: t.color, color: t.color }} onClick={() => toggleTier(t.key)}>
                  {t.label}
                </button>
              ))}
              <button className={`tier-chip ${filters.tiers.includes('none') ? 'active' : ''}`} onClick={() => toggleTier('none')}>ohne Score</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
