import React from 'react';

/**
 * Status der Datenquellen: Google Sheet und jedes Meta-Werbekonto mit Punkt.
 *   grün  = liefert Daten
 *   gelb  = verbunden, aber im gewählten Zeitraum keine Kampagnen
 *   rot   = nicht geladen (Grund im Tooltip, direkt von Meta)
 *   grau  = nicht eingerichtet / Demo
 */
export default function DataSources({ data }) {
  if (!data) return null;
  const fb = data.fb || {};
  const rows = [];

  rows.push(data.source === 'google'
    ? { key: 'sheet', state: 'ok', label: 'Google Sheet', hint: `${data.counts?.leads ?? 0} Leads geladen` }
    : { key: 'sheet', state: 'off', label: 'Google Sheet', hint: 'Demo-Daten – kein Service-Account hinterlegt' });

  if (!fb.configured) {
    rows.push({ key: 'meta', state: 'off', label: 'Meta', hint: 'Nicht verbunden (META_ACCESS_TOKEN / META_AD_ACCOUNT_ID fehlen)' });
  } else if (fb.error) {
    rows.push({ key: 'meta', state: 'err', label: 'Meta', hint: fb.error });
  } else {
    const campaignsByAccount = new Map();
    for (const c of fb.hierarchy || []) {
      const ids = c.accounts?.length ? c.accounts.map((x) => x.id) : [c.account];
      for (const id of ids) campaignsByAccount.set(id, (campaignsByAccount.get(id) || 0) + 1);
    }
    const warnOf = (id) => (fb.accountWarnings || []).filter((w) => w.startsWith(`${id}:`)).map((w) => w.slice(id.length + 1).trim());
    for (const acc of fb.accounts || []) {
      const n = campaignsByAccount.get(acc.id) || 0;
      const warns = warnOf(acc.id);
      rows.push({
        key: acc.id,
        // gelb auch dann, wenn das Konto lädt, aber ein Teil der Daten fehlt
        state: n && !warns.length ? 'ok' : 'idle',
        label: acc.name && acc.name !== acc.id ? acc.name : acc.id,
        hint: [n ? `${acc.id} · ${n} Kampagnen im Zeitraum` : `${acc.id} · verbunden, im Zeitraum keine Kampagnen`, ...warns].join(' · '),
      });
    }
    // accountErrors: "act_123: Grund"
    for (const e of fb.accountErrors || []) {
      const i = e.indexOf(':');
      const id = i > 0 ? e.slice(0, i).trim() : e;
      rows.push({ key: `err-${id}`, state: 'err', label: id, hint: i > 0 ? e.slice(i + 1).trim() : 'nicht geladen' });
    }
  }

  return (
    <div className="ds">
      <div className="ds-title">Datenquellen</div>
      <ul className="ds-list">
        {rows.map((r) => (
          <li key={r.key} className="ds-row" title={r.hint}>
            <span className={`ds-dot ${r.state}`} />
            <span className="ds-label">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
