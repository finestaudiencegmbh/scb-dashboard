/**
 * Zuordnung über die Meta-Ad-ID: Ein Lead mit ad_id landet bei genau der
 * Anzeige, die Meta unter dieser ID führt – auch wenn die UTM-Namen falsch,
 * veraltet oder leer sind. Ohne ID bleibt die Namens-Zuordnung.
 * Ausführen: node server/adid.test.mjs
 */
import assert from 'node:assert/strict';
import { resolveAdIds, adIndexFromMeta } from './adid.js';
import { combineMetaWithLeads } from './combine.js';

const ad = (campaign, adset, creative, adId, spend) => ({
  campaignId: 'c1', campaign, adsetId: `as-${adset}`, adset, adId, creative,
  spend, impressions: 10000, clicks: 100, uniqueOutboundClicks: 50,
});

// Zwei gleichnamige Creatives in zwei Anzeigengruppen – über Namen nur mit
// korrekter utm_source trennbar, über die ID immer.
const meta = {
  entities: [
    ad('Kampagne X', 'AG A', 'Reel 1', '1201', 200),
    ad('Kampagne X', 'AG B', 'Reel 1', '1202', 100),
  ],
  adList: [
    { id: '1201', name: 'Reel 1', adset: 'AG A', campaign: 'Kampagne X', active: true },
    { id: '1202', name: 'Reel 1', adset: 'AG B', campaign: 'Kampagne X', active: true },
    // Anzeige ohne Auslieferung im Zeitraum: nur in der Ad-Liste
    { id: '1203', name: 'Static 3', adset: 'AG B', campaign: 'Kampagne X', active: false },
  ],
  daily: [],
  campaignStatus: { 'Kampagne X': { status: 'ACTIVE', active: true, objective: 'OUTCOME_LEADS' } },
  adsetStatus: { 'AG A': { status: 'ACTIVE', active: true }, 'AG B': { status: 'ACTIVE', active: true } },
};

assert.equal(adIndexFromMeta(meta).size, 3, 'Index aus Ad-Liste und Insights');
assert.equal(adIndexFromMeta({}).size, 0, 'ohne Meta-Daten leerer Index');

const rec = (over) => ({
  isLead: true, hasTicket: false, sourceType: 'paid', campaign: 'Kampagne X', adset: 'fb', creative: 'paid_social',
  wonAt: '2026-10-20T10:00:00Z', adId: '', ticketAdId: '', ...over,
});
const leads = [
  // Falsche UTMs (adset = "fb"), aber korrekte Ad-ID -> AG B
  rec({ adId: '1202' }),
  rec({ adId: '1202' }),
  // Als organisch eingestuft, ID beweist Paid -> AG A
  rec({ adId: '1201', sourceType: 'organic', campaign: '(organisch)', adset: '(organisch)', organicCampaign: 'Email', organicAdset: 'Email' }),
  // ID, die Meta nicht kennt -> bleibt bei den UTM-Namen
  rec({ adId: '999999999' }),
  // Ohne ID, korrekte UTM-Namen -> AG A über den Namen
  rec({ adset: 'AG A', creative: 'Reel 1' }),
  // VIP-Ticket aus dem Umfrage-Tab mit eigener ID -> zählt bei Static 3
  rec({ isLead: false, hasTicket: true, adId: '1203', ticketAdId: '1203', ticketCampaign: 'Kampagne X', ticketAdset: 'fb', ticketCreative: 'x' }),
];

const stats = resolveAdIds(leads, meta);
assert.deepEqual(stats, { resolved: 4, unknown: 1 }, 'vier Zeilen aufgelöst, eine unbekannte ID');
assert.equal(leads[0].adset, 'AG B', 'Anzeigengruppe aus Meta');
assert.equal(leads[0].creative, 'Reel 1', 'Creative aus Meta');
assert.equal(leads[2].sourceType, 'paid', 'Ad-ID macht den Lead zu Paid');
assert.equal(leads[2].organicCampaign, undefined, 'Organisch-Gruppierung entfernt');
assert.equal(leads[3].adset, 'fb', 'unbekannte ID: UTM-Zuordnung bleibt');
assert.equal(leads[5].ticketAdset, 'AG B', 'Ticket-Dimensionen über die Ticket-ID');
assert.equal(leads[5].ticketCreative, 'Static 3');

const fb = combineMetaWithLeads(meta, leads);
const camp = fb.hierarchy[0];
const agA = camp.adsets.find((a) => a.name === 'AG A');
const agB = camp.adsets.find((a) => a.name === 'AG B');
assert.equal(agA.leads, 2, 'AG A: ein Lead per ID, einer per Name');
assert.equal(agB.leads, 2, 'AG B: zwei Leads per ID trotz falscher UTMs');
assert.equal(agB.tickets, 1, 'AG B: VIP-Ticket per ID');
assert.equal(agB.ads.find((x) => x.name === 'Static 3').tickets, 1, 'Ticket bei der Anzeige ohne Auslieferung');
assert.equal(agB.ads.find((x) => x.name === 'Reel 1').cpl, 50, '100 € / 2 Leads');

// Ohne Meta-Daten passiert nichts
const untouched = [rec({ adId: '1202' })];
assert.deepEqual(resolveAdIds(untouched, null), { resolved: 0, unknown: 0 });
assert.equal(untouched[0].adset, 'fb');

console.log('✓ Alle Ad-ID-Tests bestanden');
