/**
 * Zuordnung über die Meta-Ad-ID ({{ad.id}} als URL-Parameter, Spalte ad_id).
 *
 * Die UTM-Namen sind fehleranfällig: Anzeigen werden umbenannt, kopiert
 * ("… – Kopie") oder das URL-Schema ändert sich mitten in der Kampagne. Die
 * Ad-ID dagegen ist eindeutig. Steht sie in einer Sheet-Zeile und kennt Meta
 * die Anzeige, übernimmt der Datensatz Kampagne, Anzeigengruppe und Creative
 * 1:1 aus Meta. Damit passt die Zeile exakt auf die Hierarchie in combine.js.
 *
 * Zeilen ohne ID oder mit einer ID, die Meta (noch) nicht liefert, behalten
 * ihre UTM-Zuordnung. Die Funktion ändert die Datensätze in place.
 */

/** Ad-ID -> { campaign, adset, creative } aus Metas Ad-Liste und den Insights. */
export function adIndexFromMeta(meta) {
  const index = new Map();
  for (const ad of meta?.adList || []) {
    if (ad.id && ad.campaign && ad.adset && ad.name) {
      index.set(String(ad.id), { campaign: ad.campaign, adset: ad.adset, creative: ad.name, account: ad.account || null });
    }
  }
  // Insights zuletzt: das sind die Namen, unter denen combine.js den Spend führt.
  for (const e of meta?.entities || []) {
    if (e.adId && e.campaign && e.adset && e.creative) {
      index.set(String(e.adId), { campaign: e.campaign, adset: e.adset, creative: e.creative, account: e.account || null });
    }
  }
  return index;
}

/**
 * @param {array}  records  Datensätze aus buildDataset (mit adId/ticketAdId)
 * @param {object} meta     Ergebnis aus fetchMetaAll()
 * @returns {{ resolved: number, unknown: number }}
 */
export function resolveAdIds(records, meta) {
  const index = adIndexFromMeta(meta);
  let resolved = 0;
  let unknown = 0;
  if (!index.size) return { resolved, unknown };

  for (const r of records || []) {
    if (r.adId) {
      const hit = index.get(String(r.adId));
      if (hit) {
        r.campaign = hit.campaign;
        r.adset = hit.adset;
        r.creative = hit.creative;
        r.adAccount = hit.account; // Werbekonto, aus dem die Anzeige stammt
        r.sourceType = 'paid';
        delete r.organicCampaign;
        delete r.organicAdset;
        resolved += 1;
      } else {
        unknown += 1;
      }
    }
    if (r.hasTicket) {
      const hit = index.get(String(r.ticketAdId || r.adId || ''));
      if (hit) {
        r.ticketCampaign = hit.campaign;
        r.ticketAdset = hit.adset;
        r.ticketCreative = hit.creative;
        r.ticketAdAccount = hit.account;
      }
    }
  }
  return { resolved, unknown };
}
