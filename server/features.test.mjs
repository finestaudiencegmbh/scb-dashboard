/**
 * Tests für die Feature-Flags (hasTickets / hasQuality). Prüft, dass die
 * Ticket- und Qualitäts-Logik sauber verschwindet – und dass Leads, Spend und
 * CPL davon unberührt bleiben. Ausführen: node server/features.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { combineMetaWithLeads } from './combine.js';
import { loadScoringConfig } from './scoring.js';

const leadsSheet = {
  title: 'Leads',
  values: [
    ['Gewonnen am', 'Vorname', 'Nachname', 'E-Mail', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'VIP-Ticket geholt am'],
    ['2026-05-26 20:42:50 +0000', 'Rebecca', 'Schießl', 'rebecca@example.com', 'J&P | LP 1 | Broad | DACH', 'LP 1 - Static 16', 'J&P | MMV | 260526', 'Facebook_Mobile_Feed', '2026-05-26 20:47:35 +0000'],
    ['2026-05-27 09:00:00 +0000', 'Lisa', 'Ohne', 'lisa@example.com', 'J&P | LP 1 | Broad | DACH', 'LP 1 - Static 16', 'J&P | MMV | 260526', 'Instagram_Feed', ''],
  ],
};

const ticketsSheet = {
  title: 'VIP Ticket',
  values: [
    ['Teilgenommen am', 'Vorname', 'Nachname', 'E-Mail (Funnelcockpit)', 'E-Mail (Typeform)', 'Handynummer', 'Angestellt, Selbstständig oder Unternehmer?', 'Monatliches Einkommen', 'Immobilien im Besitz?', 'Geld investiert in den Vermögensaufbau? Wenn ja, wie viel?', 'Beziehungsstand?', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term'],
    ['2026-05-26 20:47:35 +0000', 'Rebecca', 'Schießl', 'rebecca@example.com', 'rebecca@example.com', '+49178', 'Angestellt', '3.500-5.000 im Monat', 'Ja, mehrere', '10000', 'Ledig', 'J&P | LP 1 | Broad | DACH', 'LP 1 - Static 16', 'J&P | MMV | 260526', 'Facebook_Mobile_Feed'],
  ],
};

const cfg = loadScoringConfig();
const sheets = [leadsSheet, ticketsSheet];

// --- 1) Volles Programm: Tickets + Qualität -------------------------------
const full = buildDataset(parseSheets(sheets), cfg, { hasTickets: true, hasQuality: true });
assert.equal(full.counts.leads, 2, 'zwei Leads');
assert.equal(full.counts.tickets, 1, 'ein Ticket');
assert.equal(full.counts.scored, 1, 'ein bewerteter Lead');
const rebeccaFull = full.leads.find((l) => l.email === 'rebecca@example.com');
assert.ok(rebeccaFull.quality && rebeccaFull.quality.score > 0, 'Qualität berechnet');
assert.ok(rebeccaFull.answers, 'Antworten vorhanden');

// --- 2) Ohne Fragebogen: Tickets bleiben, Qualität verschwindet -----------
const noQuality = buildDataset(
  parseSheets(sheets, undefined, { hasTickets: true }),
  cfg,
  { hasTickets: true, hasQuality: false }
);
assert.equal(noQuality.counts.leads, 2, 'Lead-Anzahl unverändert');
assert.equal(noQuality.counts.tickets, 1, 'Ticket bleibt erhalten');
assert.equal(noQuality.counts.scored, 0, 'nichts mehr bewertet');
for (const l of noQuality.leads) {
  assert.equal(l.quality, null, 'kein Quality-Objekt');
  assert.equal(l.answers, null, 'keine Fragebogen-Antworten');
}

// --- 3) Ohne Tickets: nur noch Leads --------------------------------------
const leadsOnlyFeatures = { hasTickets: false, hasQuality: false };
const parsedNoTickets = parseSheets(sheets, undefined, leadsOnlyFeatures);
assert.equal(parsedNoTickets.tickets.length, 0, 'Ticket-Tab wird nicht geparst');
assert.equal(parsedNoTickets.leads.length, 2, 'Leads unverändert geparst');

const leadsOnly = buildDataset(parsedNoTickets, cfg, leadsOnlyFeatures);
assert.equal(leadsOnly.counts.leads, 2, 'Lead-Anzahl unverändert');
assert.equal(leadsOnly.counts.tickets, 0, 'keine Tickets mehr');
assert.equal(leadsOnly.counts.scored, 0, 'nichts bewertet');
for (const l of leadsOnly.leads) {
  assert.equal(l.hasTicket, false, 'kein Ticket-Flag – auch nicht über die Lead-Spalte');
  assert.equal(l.ticketAt, null);
  assert.equal(l.quality, null);
}

// --- 4) combineMetaWithLeads: Kennzahlen null statt 0 ---------------------
const meta = {
  entities: [
    { campaignId: 'c1', campaign: 'Kampagne A', adsetId: 'a1', adset: 'AG 1', adId: 'ad1', creative: 'Static 19', spend: 100, impressions: 10000, clicks: 200, uniqueOutboundClicks: 150 },
  ],
  daily: [{ date: '2026-05-27', spend: 100, impressions: 10000, clicks: 200 }],
  campaignStatus: { 'Kampagne A': { status: 'ACTIVE', active: true, objective: 'OUTCOME_LEADS' } },
  adsetStatus: { 'AG 1': { status: 'ACTIVE', active: true } },
};
const metaLeads = [
  { sourceType: 'paid', campaign: 'Kampagne A', adset: 'AG 1', creative: 'Static 19', wonAt: '2026-05-27T10:00:00Z', hasTicket: true, quality: { score: 80, tier: 'A' } },
  { sourceType: 'paid', campaign: 'Kampagne A', adset: 'AG 1', creative: 'Static 19', wonAt: '2026-05-27T12:00:00Z', hasTicket: false },
];

const off = combineMetaWithLeads(meta, metaLeads, { features: leadsOnlyFeatures });
const cOff = off.hierarchy[0];
assert.equal(cOff.leads, 2, 'Leads weiterhin attribuiert');
assert.equal(cOff.spend, 100, 'Spend unverändert');
assert.equal(cOff.cpl, 50, 'CPL unverändert');
assert.equal(cOff.tickets, null, 'Tickets ausgeblendet');
assert.equal(cOff.cpt, null, '€/Ticket ausgeblendet');
assert.equal(cOff.cvrTicket, null, 'CVR Ticket ausgeblendet');
assert.equal(cOff.avgQuality, null, 'Ø Qualität ausgeblendet');
assert.equal(cOff.qualifiedRate, null, 'Quali-Rate ausgeblendet');
assert.equal(off.totals.tickets, null, 'Ticket-Summe ausgeblendet');
assert.equal(off.totals.spend, 100, 'Spend-Summe unverändert');
assert.equal(off.daily.leads[0].tickets, 0, 'Tagesreihe ohne Tickets');

// Gegenprobe: mit Flags an bleibt alles wie gehabt (Default = an)
const on = combineMetaWithLeads(meta, metaLeads);
assert.equal(on.hierarchy[0].tickets, 1);
assert.equal(on.hierarchy[0].cpt, 100);
assert.equal(on.hierarchy[0].qualifiedRate, 1);

console.log('✓ Alle Feature-Flag-Tests bestanden');
console.log('  Voll:', full.counts, '| nur Leads:', leadsOnly.counts);
