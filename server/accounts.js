/**
 * Konto-saubere Auswertung bei mehreren Werbekonten: Jedes Konto wird mit
 * SEINEN Meta-Daten und SEINEN Leads getrennt durch combineMetaWithLeads
 * gerechnet. Nichts wird zwischen Konten vermischt – auch dann nicht, wenn
 * Kampagnen, Anzeigengruppen und Anzeigen in beiden Konten gleich heißen.
 *
 * Zuordnung eines Leads/Tickets zu einem Konto, in dieser Reihenfolge:
 *   1. Meta-Ad-ID (adAccount aus adid.js) – immer eindeutig
 *   2. Name: Anzeige, sonst Anzeigengruppe, sonst Kampagne existiert in genau
 *      EINEM Konto
 *   3. Name existiert in mehreren Konten -> NICHT zugeordnet. Diese Zeilen
 *      fehlen bewusst in den Konto-KPIs und werden als `unassigned` gemeldet.
 *
 * Schlüssel der Tagesreihen (dailyByEntity, intradayByEntity, dimMeta,
 * uocByDim) tragen das Konto als Präfix: "act_123::<Pfad>".
 */
import { combineMetaWithLeads, _keys } from './combine.js';

const { normKey, pathKey } = _keys;
const LEVELS = ['creative', 'adset', 'campaign'];
const AMBIGUOUS = Symbol('ambiguous');
export const ACCOUNT_SEP = '::';

/** Pfad -> Set(Konten) je Ebene, aus Insights und Ad-Liste aller Konten. */
function pathIndex(byAccount) {
  const idx = { creative: new Map(), adset: new Map(), campaign: new Map() };
  const add = (lvl, parts, account) => {
    const leaf = lvl === 'campaign' ? parts.campaign : lvl === 'adset' ? parts.adset : parts.creative;
    if (!normKey(leaf)) return;
    const k = pathKey(lvl, parts);
    if (!idx[lvl].has(k)) idx[lvl].set(k, new Set());
    idx[lvl].get(k).add(account);
  };
  for (const a of byAccount) {
    for (const e of a.entities || []) {
      for (const lvl of LEVELS) add(lvl, e, a.account);
    }
    for (const ad of a.adList || []) {
      const parts = { campaign: ad.campaign, adset: ad.adset, creative: ad.name };
      for (const lvl of LEVELS) add(lvl, parts, a.account);
    }
  }
  return idx;
}

/** Konto eines Datensatzes: Konto-ID, AMBIGUOUS oder null (in keinem Konto bekannt). */
function accountOf(r, idx) {
  const ticketRow = r.hasTicket && r.isLead === false;
  const dims = ticketRow
    ? { campaign: r.ticketCampaign ?? r.campaign, adset: r.ticketAdset ?? r.adset, creative: r.ticketCreative ?? r.creative }
    : r;
  const viaId = ticketRow ? (r.ticketAdAccount || r.adAccount) : r.adAccount;
  if (viaId) return viaId;
  for (const lvl of LEVELS) {
    const set = idx[lvl].get(pathKey(lvl, dims));
    if (set) return set.size === 1 ? [...set][0] : AMBIGUOUS;
  }
  return null;
}

const prefixKeys = (byDim, account) => {
  const out = {};
  for (const [dim, map] of Object.entries(byDim || {})) {
    out[dim] = {};
    for (const [k, v] of Object.entries(map || {})) out[dim][`${account}${ACCOUNT_SEP}${k}`] = v;
  }
  return out;
};
const mergeByDim = (target, source) => {
  for (const [dim, map] of Object.entries(source || {})) Object.assign((target[dim] ||= {}), map);
  return target;
};

/**
 * @param {object} meta   Ergebnis aus fetchMetaAll() (mit byAccount)
 * @param {array}  leads  Datensätze (nach resolveAdIds)
 * @param {object} opts   wie combineMetaWithLeads
 */
export function combineByAccount(meta, leads, opts = {}) {
  const byAccount = meta?.byAccount || [];
  if (byAccount.length === 0) return { ...combineMetaWithLeads(meta, leads, opts), unassigned: null };

  const idx = pathIndex(byAccount);
  const buckets = new Map(byAccount.map((a) => [a.account, []]));
  const unassignedRows = [];
  for (const r of leads || []) {
    const acc = accountOf(r, idx);
    if (acc === AMBIGUOUS) unassignedRows.push(r);
    else if (acc && buckets.has(acc)) buckets.get(acc).push(r);
    // null: Name in keinem Konto bekannt (organisch, fremde Kampagne) –
    // taucht in der Meta-Hierarchie ohnehin nicht auf.
  }

  const { hasTickets = true } = opts.features || {};
  const totals = { spend: 0, leadSpend: 0, nonLeadSpend: 0, impressions: 0, outboundClicks: 0, leads: 0, tickets: hasTickets ? 0 : null };
  const out = { hierarchy: [], nonLeadCampaigns: [], uocByDim: {}, dimMeta: {}, dailyByEntity: {}, intradayByEntity: opts.hourlyDay ? {} : null };

  for (const a of byAccount) {
    const part = combineMetaWithLeads(
      {
        entities: a.entities, dailyEntities: a.dailyEntities, daily: a.daily, adList: a.adList,
        campaignStatus: a.campaignStatus, adsetStatus: a.adsetStatus, adStatus: a.adStatus,
      },
      buckets.get(a.account),
      opts
    );
    out.hierarchy.push(...part.hierarchy.map((c) => ({ ...c, account: a.account })));
    out.nonLeadCampaigns.push(...part.nonLeadCampaigns.map((c) => ({ ...c, account: a.account })));
    for (const k of Object.keys(totals)) {
      if (totals[k] != null) totals[k] += part.totals[k] || 0;
    }
    mergeByDim(out.uocByDim, prefixKeys(part.uocByDim, a.account));
    mergeByDim(out.dimMeta, prefixKeys(part.dimMeta, a.account));
    mergeByDim(out.dailyByEntity, prefixKeys(part.dailyByEntity, a.account));
    if (out.intradayByEntity) mergeByDim(out.intradayByEntity, prefixKeys(part.intradayByEntity, a.account));
  }
  out.hierarchy.sort((x, y) => y.spend - x.spend);
  for (const k of ['spend', 'leadSpend', 'nonLeadSpend']) totals[k] = Math.round(totals[k] * 100) / 100;

  // Konto-übergreifende Tagesreihen (Spend aller Konten, Leads aller Zeilen)
  const overall = combineMetaWithLeads({ daily: meta.daily }, leads, opts);

  // Nicht eindeutig zuordenbar: je Kampagnenname zählen
  const perCampaign = new Map();
  for (const r of unassignedRows) {
    const ticketRow = r.hasTicket && r.isLead === false;
    const name = ticketRow ? (r.ticketCampaign ?? r.campaign) : r.campaign;
    if (!perCampaign.has(name)) perCampaign.set(name, { campaign: name, leads: 0, tickets: 0 });
    const e = perCampaign.get(name);
    if (r.isLead !== false && r.sourceType === 'paid') e.leads += 1;
    if (hasTickets && r.hasTicket) e.tickets += 1;
  }
  const campaigns = [...perCampaign.values()].filter((c) => c.leads || c.tickets);
  const unassigned = campaigns.length
    ? { leads: campaigns.reduce((s, c) => s + c.leads, 0), tickets: hasTickets ? campaigns.reduce((s, c) => s + c.tickets, 0) : null, campaigns }
    : null;

  return { ...out, totals, daily: overall.daily, intradayDay: opts.hourlyDay || null, unassigned };
}
