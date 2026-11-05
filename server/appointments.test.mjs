/**
 * Termin-Tab: eigener Strang neben Leads und Tickets. Prüft Erkennung,
 * Personen-Zählung (Umbuchungen), Zuordnung ohne UTM, Quellen und die
 * Termine je Kampagne – und vor allem, dass KEINE Lead-, Ticket- oder
 * Spend-Zahl sich durch den Tab ändert.
 * Ausführen: node server/appointments.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset, labelAppointmentSources, webinarOf } from './build.js';
import { loadProjectConfig } from './project.js';
import { loadScoringConfig } from './scoring.js';
import { resolveAdIds } from './adid.js';
import { combineByAccount, attachAppointments } from './accounts.js';

const P = loadProjectConfig();
const cfg = loadScoringConfig();
const CAMP = 'JP | Live-Workshop 01.11. | ABO | TEST | 211026';
const AS = 'JP | LP V4 | Broad | DACH | Video Stack #1';
const AD = 'Ad #6- Du darfst Job mögen V4';

const leadTab = [
  ['Eingetragen am', 'Vorname', 'Nachname', 'E-Mail', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ad_id'],
  ['2026-10-30 10:00:00 +0000', 'Lea', 'Lead', 'lea@example.com', AS, AD, CAMP, 'an', '120257413220010715', '120257413220010715'],
  ['2026-10-30 11:00:00 +0000', 'Otto', 'Organisch', 'otto@example.com', 'email', 'invite', 'workshop', '', 'invite1', ''],
];
const surveyTab = [
  ['Eingetragen am', 'Vorname', 'Nachname', 'E-Mail', 'Telefonnummer', 'Monatliches Einkommen', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ad_id'],
  ['2026-10-30 12:00:00 +0000', 'Sina', 'Survey', 'sina@example.com', '+49 170 1234567', '2.500 €', AS, AD, CAMP, 'an', '120257413220010715', '120257413220010715'],
];
const T = (date, name, email, phone, utm = ['', '', '', '', '', '']) => [date, name, email, phone, '2026-11-02 10:00:00 +0000', 'Closer A', ...utm];
const paidUtm = [AS, AD, CAMP, '120257413220010715', 'an', '120257413220010715'];
const termTab = [
  ['Datum', 'Name', 'E-Mail', 'Telefonnummer', 'Datum Call', 'Datum Closer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ad_id'],
  T('2026-11-01 12:30:00 +0000', 'Paula Paid', 'paula@example.com', '+49 160 1111111', paidUtm),
  // Umbuchung: gleiche E-Mail -> eine Person, zwei Buchungen
  T('2026-11-01 12:40:00 +0000', 'Paula', 'paula@example.com', '+49 160 1111111', paidUtm),
  // andere E-Mail, gleiche Telefonnummer wie Paula, ohne UTM -> dieselbe Person
  T('2026-11-01 12:45:00 +0000', 'Paula P.', 'paula.privat@example.com', '0160 1111111'),
  T('2026-11-01 12:50:00 +0000', 'Erik', 'erik@example.com', '+49 151 2222222', ['email', 'invite', 'workshop_0111', 'invite2_bali', '', '']),
  T('2026-11-01 12:51:00 +0000', 'Anna', 'anna@example.com', '+43 660 3333333', ['recABC', 'affiliate', 'webinar-2026-11-01', 'instagram-dm', 'organic', '']),
  // ohne UTM, aber E-Mail aus dem Lead-Tab -> Attribution des Leads
  T('2026-11-01 12:52:00 +0000', 'Lea', 'lea@example.com', '+49 171 4444444'),
  // ohne UTM, andere E-Mail, Telefon aus dem Fragebogen -> Attribution der Umfrage
  T('2026-11-01 12:53:00 +0000', 'Sina', 'sina.anders@example.com', '0170 1234567'),
  // ohne UTM und ohne Treffer
  T('2026-11-01 12:54:00 +0000', 'Nora', 'nora@example.com', '+49 152 5555555'),
  // Summenzeile ohne Datum wird ignoriert
  ['', '', '', '', '', '', '', '', '', '', '', ''],
];

const sheets = [{ title: 'Leads', values: leadTab }, { title: 'Umfrage', values: surveyTab }, { title: 'Termine', values: termTab }];
const on = { ...P.features, hasAppointments: true };
const off = { ...P.features, hasAppointments: false };

// --- Nichts an Leads/Tickets ändert sich ------------------------------------
const withTab = buildDataset(parseSheets(sheets, P.sheet, on), cfg, on, P.sheet.utmRoles);
const without = buildDataset(parseSheets(sheets.slice(0, 2), P.sheet, on), cfg, on, P.sheet.utmRoles);
const flagOff = buildDataset(parseSheets(sheets, P.sheet, off), cfg, off, P.sheet.utmRoles);
for (const k of ['leads', 'paidLeads', 'tickets', 'scored']) {
  assert.equal(withTab.counts[k], without.counts[k], `${k} unverändert durch den Termin-Tab`);
}
assert.equal(withTab.leads.length, without.leads.length, 'keine Termin-Zeile landet bei den Leads');
assert.equal(flagOff.appointments.length, 0, 'ohne Flag wird der Tab nicht gelesen');
assert.equal(flagOff.counts.leads, withTab.counts.leads);

// --- Personen statt Buchungen ------------------------------------------------
const A = withTab.appointments;
assert.equal(withTab.counts.appointmentBookings, 8, 'acht Buchungen (Summenzeile ignoriert)');
assert.equal(A.length, 6, 'Paula (3 Buchungen über E-Mail und Telefon) zählt einmal');
const paula = A.find((a) => a.email === 'paula@example.com');
assert.equal(paula.bookings, 3);
assert.equal(paula.at, '2026-11-01T12:30:00.000Z', 'Zeitpunkt = erste Buchung');
assert.equal(paula.sourceType, 'paid');
assert.equal(paula.campaign, CAMP);

// --- Ohne UTM: Zuordnung über Lead-E-Mail bzw. Umfrage-Telefon ---------------
const lea = A.find((a) => a.email === 'lea@example.com');
assert.equal(lea.matchedBy, 'lead-email');
assert.equal(lea.sourceType, 'paid');
const sina = A.find((a) => a.email === 'sina.anders@example.com');
assert.equal(sina.matchedBy, 'survey-phone');
assert.equal(sina.creative, AD);
const nora = A.find((a) => a.email === 'nora@example.com');
assert.equal(nora.matchedBy, null);

// --- Quellen ------------------------------------------------------------------
const group = (email) => A.find((a) => a.email === email);
assert.equal(group('paula@example.com').sourceGroup, 'Meta Ads');
assert.equal(group('erik@example.com').sourceGroup, 'E-Mail');
assert.equal(group('erik@example.com').sourceDetail, 'invite2_bali');
assert.equal(group('anna@example.com').sourceGroup, 'Affiliate');
assert.equal(group('anna@example.com').sourceDetail, 'instagram-dm');
assert.equal(group('nora@example.com').sourceGroup, 'Ohne UTM');

// --- Termine je Kampagne, getrennt je Werbekonto ------------------------------
const ent = (account, adId, spend) => ({ account, campaignId: `c-${account}`, campaign: CAMP, adsetId: `as-${account}`, adset: AS, adId, creative: AD, spend, impressions: 1000, clicks: 10, uniqueOutboundClicks: 5 });
const acc = (account, entities) => ({
  account, name: account, daily: [], dailyEntities: [], entities,
  adList: entities.map((e) => ({ id: e.adId, name: e.creative, adset: e.adset, campaign: e.campaign, active: true, account })),
  campaignStatus: { [CAMP]: { status: 'ACTIVE', active: true, objective: 'OUTCOME_LEADS' } }, adsetStatus: {}, adStatus: {},
});
const KA = acc('act_A', [ent('act_A', '120257413220010715', 300)]);
const KB = acc('act_B', [ent('act_B', '120257999999990715', 100)]);
const meta = { byAccount: [KA, KB], entities: [...KA.entities, ...KB.entities], adList: [...KA.adList, ...KB.adList], daily: [] };
resolveAdIds(A, meta);
labelAppointmentSources(A);
const fb = combineByAccount(meta, withTab.leads, { features: on });
const before = JSON.stringify(fb.hierarchy.map((c) => [c.spend, c.leads, c.tickets, c.cpl]));
const { unassigned } = attachAppointments(fb.hierarchy, meta.byAccount, A);
const camp = (account) => fb.hierarchy.find((c) => c.account === account);
// Die Anzeige mit dieser Ad-ID liegt in Konto A: Paula, Lea (über Lead) und Sina (über Umfrage)
assert.equal(camp('act_A').appointments, 3, 'Termine mit Ad-ID im richtigen Konto');
assert.equal(camp('act_A').adsets[0].ads[0].appointments, 3, 'bis auf die Anzeige');
assert.equal(camp('act_B').appointments, 0, 'nichts in Konto B');
assert.equal(unassigned, 0);
assert.equal(JSON.stringify(fb.hierarchy.map((c) => [c.spend, c.leads, c.tickets, c.cpl])), before, 'Spend/Leads/Tickets/CPL unverändert');

// Gleicher Name in beiden Konten, keine Ad-ID -> nicht zuordenbar statt geraten
const ambiguous = [{ sourceType: 'paid', campaign: CAMP, adset: AS, creative: AD, adId: '' }];
assert.equal(attachAppointments(fb.hierarchy, meta.byAccount, ambiguous).unassigned, 1);

// --- Webinar-Spalte -------------------------------------------------------------
assert.deepEqual(webinarOf('Webinar 01.11.2026 um 11 Uhr'), { label: 'Webinar 01.11.26', date: '2026-11-01' });
assert.deepEqual(webinarOf('Webinar 1.12.26'), { label: 'Webinar 01.12.26', date: '2026-12-01' });
assert.deepEqual(webinarOf(''), { label: '', date: '' });
const W1 = 'Webinar 01.11.2026 um 11 Uhr';
const W2 = 'Webinar 21.11.2026 um 11 Uhr';
const wLeads = [
  ['Eingetragen am', 'Vorname', 'E-Mail', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ad_id', 'LP', 'Webinar'],
  ['2026-10-25 10:00:00 +0000', 'Alt', 'alt@example.com', 'email', 'invite', 'w', '', '', '', '', W1],
  ['2026-11-03 10:00:00 +0000', 'Neu', 'neu@example.com', 'email', 'invite', 'w', '', '', '', '', W2],
];
const wTerm = [
  termTab[0],
  T('2026-11-01 13:00:00 +0000', 'Alt', 'alt@example.com', '+49 1'),          // über E-Mail -> W1
  T('2026-11-22 09:00:00 +0000', 'Fremd', 'fremd@example.com', '+49 160 9999999'), // kein Treffer -> letztes Webinar davor (W2)
  T('2026-11-02 09:00:00 +0000', 'Frueh', 'frueh@example.com', '+49 160 8888888'), // zwischen W1 und W2 -> W1
];
const wds = buildDataset(parseSheets([{ title: 'L', values: wLeads }, { title: 'T', values: wTerm }], P.sheet, on), cfg, on, P.sheet.utmRoles);
assert.deepEqual(wds.leads.map((l) => l.webinar), ['Webinar 01.11.26', 'Webinar 21.11.26'], 'Leads tragen das Webinar-Label');
const wOf = (email) => wds.appointments.find((a) => a.email === email).webinar;
assert.equal(wOf('alt@example.com'), 'Webinar 01.11.26', 'Termin erbt das Webinar der Person');
assert.equal(wOf('fremd@example.com'), 'Webinar 21.11.26', 'ohne Treffer: letztes Webinar am oder vor dem Buchungstag');
assert.equal(wOf('frueh@example.com'), 'Webinar 01.11.26');

console.log('✓ Alle Termin-Tests bestanden');
console.log('  Termin-Tab ändert keine Lead-/Ticket-/Spend-Zahl; je Person gezählt; ohne UTM über Lead-E-Mail/Umfrage-Telefon; je Konto getrennt');
