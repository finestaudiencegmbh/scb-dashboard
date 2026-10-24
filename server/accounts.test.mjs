/**
 * Konto-Trennung bei mehreren Werbekonten mit IDENTISCHEN Namen: Spend,
 * Leads, Tickets und Qualität bleiben je Konto getrennt, nichts wird
 * vermischt. Ausführen: node server/accounts.test.mjs
 */
import assert from 'node:assert/strict';
import { combineByAccount } from './accounts.js';
import { resolveAdIds } from './adid.js';

const CAMP = 'JP | Live-Workshop 01.11. | ABO';
const ent = (account, adId, adset, creative, spend) => ({
  account, campaignId: `c-${account}`, campaign: CAMP, adsetId: `as-${account}-${adset}`, adset, adId, creative,
  spend, impressions: 10000, clicks: 100, uniqueOutboundClicks: 50,
});
const acc = (account, entities) => ({
  account, name: account, daily: [], dailyEntities: [], entities,
  adList: entities.map((e) => ({ id: e.adId, name: e.creative, adset: e.adset, campaign: e.campaign, active: true, account })),
  campaignStatus: { [CAMP]: { status: 'ACTIVE', active: true, objective: 'OUTCOME_LEADS' } },
  adsetStatus: {}, adStatus: {},
});

// Beide Konten: gleiche Kampagne, gleiche Anzeigengruppe "Broad", gleiche Anzeige "Reel 1".
// Konto B hat zusätzlich eine Anzeige "Nur in B".
const A = acc('act_A', [ent('act_A', '1201', 'Broad', 'Reel 1', 300)]);
const B = acc('act_B', [ent('act_B', '5257', 'Broad', 'Reel 1', 100), ent('act_B', '5258', 'Broad', 'Nur in B', 50)]);
const meta = {
  byAccount: [A, B],
  entities: [...A.entities, ...B.entities],
  adList: [...A.adList, ...B.adList],
  daily: [{ date: '2026-10-22', spend: 450, impressions: 30000, clicks: 300 }],
};

const rec = (over) => ({
  isLead: true, hasTicket: false, sourceType: 'paid', campaign: CAMP, adset: 'Broad', creative: 'Reel 1',
  wonAt: '2026-10-22T10:00:00Z', adId: '', ticketAdId: '', ...over,
});
const leads = [
  rec({ adId: '1201' }), rec({ adId: '1201' }), rec({ adId: '1201' }), // 3 Leads Konto A per Ad-ID
  rec({ adId: '5257' }),                                                // 1 Lead Konto B per Ad-ID
  rec({ creative: 'Nur in B' }),                                        // Konto B per eindeutigem Namen
  rec({}), rec({}),                                                     // gleiche Namen, keine Ad-ID -> nicht zuordenbar
  // VIP-Ticket aus der Umfrage mit Ad-ID aus Konto B, Qualität A
  rec({ isLead: false, hasTicket: true, adId: '5257', ticketAdId: '5257', ticketCampaign: CAMP, ticketAdset: 'Broad', ticketCreative: 'Reel 1', quality: { score: 100, tier: 'A' } }),
];

resolveAdIds(leads, meta);
assert.equal(leads[0].adAccount, 'act_A', 'Ad-ID verrät das Konto');
assert.equal(leads[3].adAccount, 'act_B');

const fb = combineByAccount(meta, leads, { qualifiedTiers: ['A'] });
const camp = (account) => fb.hierarchy.find((c) => c.account === account);

// --- Zwei getrennte Kampagnen-Karten, je Konto eigene Zahlen ---------------
assert.equal(fb.hierarchy.length, 2, 'gleichnamige Kampagne erscheint einmal je Konto');
assert.equal(camp('act_A').spend, 300, 'Spend Konto A');
assert.equal(camp('act_B').spend, 150, 'Spend Konto B');
assert.equal(camp('act_A').leads, 3, 'Leads Konto A nur per Ad-ID aus A');
assert.equal(camp('act_B').leads, 2, 'Leads Konto B: Ad-ID + eindeutiger Name');
assert.equal(camp('act_A').cpl, 100, 'CPL A = 300 € / 3');
assert.equal(camp('act_B').cpl, 75, 'CPL B = 150 € / 2');
assert.equal(camp('act_A').tickets, 0, 'Ticket aus B landet nicht in A');
assert.equal(camp('act_B').tickets, 1, 'Ticket Konto B');
assert.equal(camp('act_B').qualifiedRate, 1, 'Qualität nur im Konto des Tickets');

const adsB = camp('act_B').adsets[0].ads;
assert.equal(adsB.find((x) => x.name === 'Reel 1').leads, 1, 'Anzeige Reel 1 in B: nur ihr Lead');
assert.equal(adsB.find((x) => x.name === 'Nur in B').leads, 1);
assert.equal(camp('act_A').adsets[0].ads[0].leads, 3, 'Anzeige Reel 1 in A: nur ihre Leads');

// --- Nicht zuordenbar statt geraten -----------------------------------------
assert.deepEqual(fb.unassigned, { leads: 2, tickets: 0, campaigns: [{ campaign: CAMP, leads: 2, tickets: 0 }] }, 'zwei Leads ohne Ad-ID mit Doppel-Namen');
assert.equal(fb.totals.leads, 5, 'Konto-Summen ohne die nicht zuordenbaren');
assert.equal(fb.totals.spend, 450);

// --- Tagesreihen je Konto getrennt geschlüsselt ------------------------------
assert.ok(Object.keys(fb.dimMeta.campaign).every((k) => k.startsWith('act_A::') || k.startsWith('act_B::')), 'Schlüssel mit Konto-Präfix');
assert.equal(Object.keys(fb.dimMeta.campaign).length, 2, 'zwei getrennte Kampagnen-Einträge');
assert.equal(fb.daily.spend[0].spend, 450, 'Gesamt-Tagesspend über beide Konten');

// --- Ein einzelnes Konto: alles eindeutig, nichts unzugeordnet --------------
const single = combineByAccount({ byAccount: [A], daily: [] }, [rec({}), rec({})], {});
assert.equal(single.hierarchy[0].leads, 2, 'ein Konto: Name genügt');
assert.equal(single.unassigned, null);

console.log('✓ Alle Konto-Trennungs-Tests bestanden');
console.log('  Gleiche Namen in zwei Konten: Spend, Leads, Tickets, Qualität je Konto getrennt; ohne Ad-ID -> nicht zuordenbar');
