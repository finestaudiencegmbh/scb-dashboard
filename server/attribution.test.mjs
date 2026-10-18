/**
 * Tests gegen doppelte Namen in Meta: dieselbe Anzeigengruppe oder dasselbe
 * Creative kommt mehrfach vor (duplizierte Anzeigengruppe, Creative-Name nicht
 * geändert). Zugeordnet werden muss immer über den VOLLEN PFAD
 * Kampagne ▸ Anzeigengruppe ▸ Creative – sonst verschmelzen gleichnamige
 * Einträge zu einer Zeile und mischen gute mit schlechter Leistung.
 * Ausführen: node server/attribution.test.mjs
 */
import assert from 'node:assert/strict';
import { combineMetaWithLeads } from './combine.js';
import { aggregate } from '../web/src/lib.js';

const ad = (campaign, adset, creative, ids, spend, uoc) => ({
  campaignId: ids[0], campaign, adsetId: ids[1], adset, adId: ids[2], creative,
  spend, impressions: 10000, clicks: 100, uniqueOutboundClicks: uoc,
});

// "Video Ad #1" läuft in zwei Anzeigengruppen derselben Kampagne.
// AG A: 300 € auf 1 Lead (schlecht) · AG B: 100 € auf 3 Leads (gut)
const meta = {
  entities: [
    ad('Kampagne X', 'AG A', 'Video Ad #1', ['c1', 'a1', 'ad1'], 300, 100),
    ad('Kampagne X', 'AG B', 'Video Ad #1', ['c1', 'a2', 'ad2'], 100, 50),
  ],
  daily: [],
  campaignStatus: { 'Kampagne X': { status: 'ACTIVE', active: true, objective: 'OUTCOME_LEADS' } },
  adsetStatus: { 'AG A': { status: 'ACTIVE', active: true }, 'AG B': { status: 'ACTIVE', active: true } },
};

const lead = (adset, hasTicket = false) => ({
  isLead: true, sourceType: 'paid', campaign: 'Kampagne X', adset, creative: 'Video Ad #1',
  wonAt: '2026-10-01T10:00:00Z', hasTicket,
});
const leads = [lead('AG A'), lead('AG B'), lead('AG B'), lead('AG B')];

const fb = combineMetaWithLeads(meta, leads);

// --- 1) Kampagnen-Aufschlüsselung: zwei getrennte Anzeigen-Zeilen ----------
const camp = fb.hierarchy[0];
assert.equal(camp.adsets.length, 2, 'zwei Anzeigengruppen');
const adsetA = camp.adsets.find((a) => a.name === 'AG A');
const adsetB = camp.adsets.find((a) => a.name === 'AG B');
assert.equal(adsetA.ads.length, 1);
assert.equal(adsetB.ads.length, 1);
assert.equal(adsetA.ads[0].spend, 300, 'Spend bleibt bei AG A');
assert.equal(adsetA.ads[0].leads, 1, 'Leads bleiben bei AG A');
assert.equal(adsetB.ads[0].spend, 100, 'Spend bleibt bei AG B');
assert.equal(adsetB.ads[0].leads, 3, 'Leads bleiben bei AG B');

// --- 2) Daten für die Tabelle: hierarchisch geschlüsselt -------------------
const creativeKeys = Object.keys(fb.dimMeta.creative);
assert.equal(creativeKeys.length, 2, 'zwei Schlüssel, nicht einer – Name allein reicht nicht');
const spends = creativeKeys.map((k) => fb.dimMeta.creative[k].spend).sort((a, b) => a - b);
assert.deepEqual(spends, [100, 300], 'Spend NICHT zu 400 € verschmolzen');
const uocs = Object.values(fb.uocByDim.creative).sort((a, b) => a - b);
assert.deepEqual(uocs, [50, 100], 'ausgehende Klicks NICHT zu 150 verschmolzen');
// Jeder Eintrag kennt seinen Elternpfad
for (const k of creativeKeys) {
  const m = fb.dimMeta.creative[k];
  assert.ok(m.parents?.campaign && m.parents?.adset, 'Elternpfad hinterlegt');
}

// --- 3) Tabelle "Performance nach Ebene": zwei Zeilen mit eigenen Zahlen ---
const rows = aggregate(leads, 'creative', {}, fb);
assert.equal(rows.length, 2, 'zwei Zeilen statt einer verschmolzenen');
const rowA = rows.find((r) => r.parent.includes('AG A'));
const rowB = rows.find((r) => r.parent.includes('AG B'));
assert.ok(rowA && rowB, 'Zeilen sind über den Elternpfad unterscheidbar');
assert.equal(rowA.key, 'Video Ad #1');
assert.equal(rowB.key, 'Video Ad #1');
assert.notEqual(rowA.id, rowB.id, 'eigene Schlüssel je Pfad');
assert.equal(rowA.leads, 1);
assert.equal(Math.round(rowA.cpl), 300, 'schlechtes Creative bleibt sichtbar schlecht');
assert.equal(rowB.leads, 3);
assert.equal(Math.round(rowB.cpl), 33, 'gutes Creative bleibt sichtbar gut');

// --- 4) Gegenprobe: gleiche Anzeigengruppe in ZWEI Kampagnen --------------
const meta2 = {
  entities: [
    ad('Kampagne 1', 'Broad | CH', 'Ad X', ['c1', 'a1', 'ad1'], 200, 80),
    ad('Kampagne 2', 'Broad | CH', 'Ad X', ['c2', 'a2', 'ad2'], 50, 20),
  ],
  daily: [],
  campaignStatus: {
    'Kampagne 1': { status: 'ACTIVE', active: true, objective: 'OUTCOME_LEADS' },
    'Kampagne 2': { status: 'ACTIVE', active: true, objective: 'OUTCOME_LEADS' },
  },
  adsetStatus: { 'Broad | CH': { status: 'ACTIVE', active: true } },
};
const leads2 = [
  { isLead: true, sourceType: 'paid', campaign: 'Kampagne 1', adset: 'Broad | CH', creative: 'Ad X', wonAt: '2026-10-01T10:00:00Z' },
  { isLead: true, sourceType: 'paid', campaign: 'Kampagne 2', adset: 'Broad | CH', creative: 'Ad X', wonAt: '2026-10-01T11:00:00Z' },
];
const fb2 = combineMetaWithLeads(meta2, leads2);
assert.equal(Object.keys(fb2.dimMeta.adset).length, 2, 'gleichnamige Anzeigengruppe in zwei Kampagnen bleibt getrennt');
const adsetRows = aggregate(leads2, 'adset', {}, fb2);
assert.equal(adsetRows.length, 2, 'zwei Zeilen');
assert.deepEqual(adsetRows.map((r) => r.leads).sort(), [1, 1], 'je ein Lead pro Kampagne');
assert.deepEqual(adsetRows.map((r) => r.spend).sort((a, b) => a - b), [50, 200], 'Spend getrennt');

console.log('✓ Alle Attributions-Tests bestanden');
console.log('  Gleicher Creative-Name in zwei Anzeigengruppen: 300 € / 1 Lead und 100 € / 3 Leads bleiben getrennt');
console.log('  Gleiche Anzeigengruppe in zwei Kampagnen: bleibt getrennt');
