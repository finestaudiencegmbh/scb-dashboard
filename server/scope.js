/**
 * Projekt-Bereich: Welche Meta-Kampagnen gehören zu DIESEM Dashboard?
 *
 * In den Werbekonten laufen auch Kampagnen anderer Funnels (z. B. VSL), deren
 * Leads nie im Sheet landen. Würde ihr Spend mitzählen, wären Adspend, CPL
 * und Kosten/Ticket zu hoch. Deshalb zählt nur, was im Bereich liegt:
 *
 *   scope.landingPages: Teilstrings der Ziel-URL (z. B. "secretbusiness.live").
 *                       Eine Kampagne gehört dazu, wenn mindestens eine ihrer
 *                       Anzeigen auf eine passende Landingpage verlinkt.
 *   scope.campaignNames: optional, Teilstrings des Kampagnennamens als
 *                       zusätzliche Regel (z. B. für Lead-Formulare ohne LP).
 *
 * Ohne Regeln (beide leer) gilt alles als im Bereich. Konnte Meta die
 * Landingpages eines Kontos nicht liefern, wird in DIESEM Konto nichts
 * ausgefiltert (lieber zu viel als still verschwundener Spend) – das meldet
 * meta.js als accountWarnings.
 */

const lower = (s) => String(s ?? '').toLowerCase();
const campKey = (account, campaign) => `${account}::${lower(campaign).trim()}`;

export function scopeActive(scope) {
  return Boolean((scope?.landingPages || []).length || (scope?.campaignNames || []).length);
}

/** Kampagnen je Konto einstufen: { key -> { inScope, reason, urls } } */
function classify(byAccount, scope) {
  const lps = (scope.landingPages || []).map(lower).filter(Boolean);
  const names = (scope.campaignNames || []).map(lower).filter(Boolean);
  const result = new Map();
  for (const a of byAccount) {
    const urlsByCampaign = new Map();
    for (const e of a.entities || []) {
      const k = campKey(a.account, e.campaign);
      if (!urlsByCampaign.has(k)) urlsByCampaign.set(k, { campaign: e.campaign, urls: new Set() });
      for (const u of (a.adUrls || {})[String(e.adId)] || []) urlsByCampaign.get(k).urls.add(u);
    }
    for (const [k, { campaign, urls }] of urlsByCampaign) {
      const list = [...urls];
      let inScope = false;
      let reason = '';
      if (names.some((n) => lower(campaign).includes(n))) {
        inScope = true; reason = 'Kampagnenname';
      } else if (lps.length && list.some((u) => lps.some((lp) => lower(u).includes(lp)))) {
        inScope = true; reason = 'Landingpage';
      } else if (a.adUrls == null) {
        // Landingpages für dieses Konto unbekannt -> nicht ausfiltern
        inScope = true; reason = 'Landingpages nicht lesbar – ungefiltert';
      } else {
        reason = list.length ? 'andere Landingpage' : 'keine Landingpage erkennbar';
      }
      result.set(k, { account: a.account, campaign, inScope, reason, urls: list });
    }
  }
  return result;
}

/** Tagesspend je Datum aus den Tagesdaten je Anzeige (nur Kampagnen im Bereich). */
function dailyFrom(dailyEntities) {
  const m = new Map();
  for (const r of dailyEntities || []) {
    if (!r.date) continue;
    const e = m.get(r.date) || { date: r.date, spend: 0, impressions: 0, clicks: 0 };
    e.spend += r.spend || 0;
    e.impressions += r.impressions || 0;
    e.clicks += r.clicks || 0;
    m.set(r.date, e);
  }
  return [...m.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
}

/**
 * @param {object} all    Ergebnis aus fetchMetaAll()
 * @param {object} scope  project.config.json -> scope
 * @returns {{ meta, excluded, active }} meta = gefilterte Kopie, excluded = Kampagnen außerhalb
 */
export function applyScope(all, scope) {
  if (!all || !scopeActive(scope)) return { meta: all, excluded: [], active: false };
  const cls = classify(all.byAccount || [], scope);
  const keep = (account, campaign) => {
    const c = cls.get(campKey(account, campaign));
    return c ? c.inScope : true; // unbekannt (z. B. nur in der Ad-Liste) -> nicht wegfiltern
  };

  const byAccount = (all.byAccount || []).map((a) => {
    const entities = (a.entities || []).filter((e) => keep(a.account, e.campaign));
    const dailyEntities = (a.dailyEntities || []).filter((e) => keep(a.account, e.campaign));
    // Konto-Tagesspend enthält ALLE Kampagnen -> aus den Tagesdaten je Anzeige neu bilden.
    // Fehlen diese (Abruf gescheitert), bleibt der ungefilterte Wert (Warnung kommt aus meta.js).
    const daily = a.dailyEntities?.length ? dailyFrom(dailyEntities) : a.daily;
    return {
      ...a,
      entities,
      dailyEntities,
      daily,
      adList: (a.adList || []).filter((x) => keep(a.account, x.campaign)),
      records: (a.records || []).filter((r) => keep(a.account, r.campaign)),
    };
  });

  const dailyMap = new Map();
  for (const a of byAccount) {
    for (const d of a.daily || []) {
      const e = dailyMap.get(d.date) || { date: d.date, spend: 0, impressions: 0, clicks: 0 };
      e.spend += d.spend || 0;
      e.impressions += d.impressions || 0;
      e.clicks += d.clicks || 0;
      dailyMap.set(d.date, e);
    }
  }

  const meta = {
    ...all,
    byAccount,
    records: byAccount.flatMap((a) => a.records),
    entities: byAccount.flatMap((a) => a.entities),
    dailyEntities: byAccount.flatMap((a) => a.dailyEntities),
    adList: byAccount.flatMap((a) => a.adList),
    daily: [...dailyMap.values()].sort((x, y) => (x.date < y.date ? -1 : 1)),
  };

  // Ausgeschlossene Kampagnen mit Spend – bleiben sichtbar, zählen aber nicht
  const spendOf = new Map();
  for (const a of all.byAccount || []) {
    for (const e of a.entities || []) {
      const k = campKey(a.account, e.campaign);
      spendOf.set(k, (spendOf.get(k) || 0) + (e.spend || 0));
    }
  }
  const excluded = [...cls.entries()]
    .filter(([, c]) => !c.inScope)
    .map(([k, c]) => ({ account: c.account, campaign: c.campaign, reason: c.reason, urls: c.urls.slice(0, 3), spend: Math.round((spendOf.get(k) || 0) * 100) / 100 }))
    .sort((x, y) => y.spend - x.spend);

  return { meta, excluded, active: true };
}
