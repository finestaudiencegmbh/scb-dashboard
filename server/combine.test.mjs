/**
 * Test für combineMetaWithLeads: Hierarchie-Aufbau, Lead-Attribution je Ebene,
 * abgeleitete Kennzahlen (CPM, individuell ausgehende CTR, LP-Conversion),
 * Status-Übernahme und Tagesreihen. Ausführen: node server/combine.test.mjs
 */
import assert from 'node:assert/strict';
import { combineMetaWithLeads } from './combine.js';

const meta = {
  entities: [
    { campaignId: 'c1', campaign: 'Kampagne A', adsetId: 'a1', adset: 'AG 1', adId: 'ad1', creative: 'Static 19', spend: 100, impressions: 10000, clicks: 200, cpm: 10, uniqueOutboundClicks: 150, uniqueOutboundClicksCtr: 0, costPerUniqueOutboundClick: 0 },
    { campaignId: 'c1', campaign: 'Kampagne A', adsetId: 'a1', adset: 'AG 1', adId: 'ad2', creative: 'Reel 3', spend: 50, impressions: 4000, clicks: 60, cpm: 12.5, uniqueOutboundClicks: 50, uniqueOutboundClicksCtr: 0, costPerUniqueOutboundClick: 0 },
  ],
  daily: [
    { date: '2026-05-27', spend: 80, impressions: 8000, clicks: 120 },
    { date: '2026-05-28', spend: 70, impressions: 6000, clicks: 140 },
  ],
  campaignStatus: { 'Kampagne A': { status: 'ACTIVE', active: true, objective: 'OUTCOME_LEADS' } },
  adsetStatus: { 'AG 1': { status: 'PAUSED', active: false } },
};

// Zweite Kampagne: Traffic-Ziel -> darf NICHT in CPL einfließen
meta.entities.push({ campaignId: 'c2', campaign: 'Traffic B', adsetId: 'a2', adset: 'AG T', adId: 'adt', creative: 'Banner', spend: 500, impressions: 100000, clicks: 3000, cpm: 5, uniqueOutboundClicks: 2000, uniqueOutboundClicksCtr: 0, costPerUniqueOutboundClick: 0 });
meta.campaignStatus['Traffic B'] = { status: 'ACTIVE', active: true, objective: 'OUTCOME_TRAFFIC' };
meta.adsetStatus['AG T'] = { status: 'ACTIVE', active: true };

// Leads aus dem Sheet (paid), attribuiert über die Namen
const leads = [
  { sourceType: 'paid', campaign: 'Kampagne A', adset: 'AG 1', creative: 'Static 19', wonAt: '2026-05-27T10:00:00Z', hasTicket: true },
  { sourceType: 'paid', campaign: 'Kampagne A', adset: 'AG 1', creative: 'Static 19', wonAt: '2026-05-27T12:00:00Z', hasTicket: false },
  { sourceType: 'paid', campaign: 'Kampagne A', adset: 'AG 1', creative: 'Reel 3', wonAt: '2026-05-28T09:00:00Z', hasTicket: false },
  { sourceType: 'organic', campaign: '(organisch)', adset: 'x', creative: 'y', wonAt: '2026-05-28T09:00:00Z', hasTicket: false },
];

const { hierarchy, daily, totals } = combineMetaWithLeads(meta, leads);

assert.equal(hierarchy.length, 2, 'zwei Kampagnen');
const c = hierarchy.find((x) => x.name === 'Kampagne A');
const t = hierarchy.find((x) => x.name === 'Traffic B');
assert.equal(c.leadCampaign, true, 'Lead-Kampagne erkannt');
assert.equal(t.leadCampaign, false, 'Traffic-Kampagne erkannt (objective OUTCOME_TRAFFIC)');

// Totals: Gesamt-Spend enthält Traffic, leadSpend nicht
assert.equal(totals.spend, 650, 'Gesamt-Spend 150 + 500');
assert.equal(totals.leadSpend, 150, 'Lead-Spend nur Kampagne A');
assert.equal(totals.nonLeadSpend, 500, 'Traffic-Spend separat');
assert.equal(c.name, 'Kampagne A');
assert.equal(c.active, true, 'Kampagnen-Status aktiv');
assert.equal(c.spend, 150, 'Kampagnen-Spend = Summe der Ads');
assert.equal(c.impressions, 14000);
assert.equal(c.outboundClicks, 200, 'individuell ausgehende Klicks summiert');
assert.equal(c.leads, 3, 'paid-Leads der Kampagne (organisch nicht gezählt)');
assert.equal(c.tickets, 1);

// abgeleitete Kennzahlen
assert.equal(c.cpm, round2(150 / (14000 / 1000)), 'CPM korrekt');
assert.equal(c.cpl, round2(150 / 3), 'CPL korrekt');
assert.equal(c.lpConversion, 3 / 200, 'LP-Conversion = Leads / individuell ausgehende Klicks');

// Anzeigengruppen-Ebene
assert.equal(c.adsets.length, 1);
const a = c.adsets[0];
assert.equal(a.active, false, 'Anzeigengruppe pausiert');
assert.equal(a.ads.length, 2, 'zwei Ads');
const adStatic = a.ads.find((x) => x.name === 'Static 19');
assert.equal(adStatic.leads, 2, 'Ad Static 19 hat 2 Leads');
assert.equal(adStatic.tickets, 1);
assert.equal(adStatic.lpConversion, 2 / 150, 'Ad LP-Conversion');

// Tagesreihen
assert.equal(daily.spend.length, 2, 'zwei Spend-Tage');
assert.equal(daily.spend[0].date, '2026-05-27');
const d27 = daily.leads.find((d) => d.date === '2026-05-27');
assert.equal(d27.leads, 2, 'zwei Leads am 27.');
assert.equal(d27.tickets, 1);

function round2(n) { return Math.round(n * 100) / 100; }

console.log('✓ Alle Combine-Tests bestanden');
console.log(`  Kampagne: ${c.name} | Spend ${c.spend}€ | Leads ${c.leads} | LP-Conv ${(c.lpConversion * 100).toFixed(1)}%`);
