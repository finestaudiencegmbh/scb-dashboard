/**
 * Prüft die AKTUELLE Projekt-Konfiguration (config/project.config.json) gegen
 * den echten Aufbau des Tracking-Sheets: Tabellen-Erkennung, Spalten-Mapping,
 * UTM-Rollen, Ad-ID und das Scoring-Modell. Schlägt fehl, sobald Config und
 * Sheet auseinanderlaufen. Ausführen: node server/project.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { resolveAdIds } from './adid.js';
import { loadScoringConfig, computeQuality, qualifiedTiersOf } from './scoring.js';
import { loadProjectConfig } from './project.js';

const PROJECT = loadProjectConfig();
const scoring = loadScoringConfig();

// Kopfzeilen 1:1 aus dem Sheet "JP | SCB - Live-Webinare". Die Zeilen sind
// erfunden und folgen dem Hyros-Schema der Meta-Anzeigen:
//   utm_source={{adset.name}} utm_medium={{ad.name}} utm_campaign={{campaign.name}}
//   utm_term={{placement}} ad_id={{ad.id}}
const CAMPAIGN = 'AP | 01.11. | SCC Webinar | ABO';
const ADSET = '15.10. | broad';
const leadsSheet = {
  title: 'Live-Webinar 01.11.26 OptIns',
  values: [
    ['Eingetragen am', 'Vorname', 'E-Mail', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ad_id', 'LP'],
    ['265', '', '', '', '', '', '', '', '', ''], // Zählzeile (=COUNTA) – muss ignoriert werden
    ['2026-10-20 11:55:07', 'Lara', 'lara@example.com', ADSET, 'Frau Müller', CAMPAIGN, '', 'Instagram_Reels', '120200000000000001', 'v2'],
    ['2026-10-20 14:05:31 +0000', 'Svenja', 'svenja@example.com', ADSET, 'Speed Dating', CAMPAIGN, '', 'Facebook_Mobile_Feed', '120200000000000002', 'v2'],
    // Ohne Ad-ID: Zuordnung allein über die UTM-Namen
    ['2026-10-20 15:10:07', 'Naomi', 'naomi@example.com', ADSET, 'Frau Müller', CAMPAIGN, '', 'Instagram_Stories', '', 'v3'],
    // Organisch: Newsletter und Affiliate
    ['2026-10-20 15:28:52', 'Kim', 'kim@example.com', 'email', 'email', 'webinar-2026-11-01', 'mail', '', '', 'v2'],
    ['2026-10-20 16:38:47', 'Claudia', 'claudia@example.com', 'recnIq3WsvUB2Nw1L', 'affiliate', 'webinar-2026-11-01', 'link', 'organic', '', 'v2'],
  ],
};

const umfrageSheet = {
  title: 'Live-Webinar 01.11.26 Umfrage',
  values: [
    ['Eingetragen am', 'Vorname', 'Nachname', 'E-Mail', 'Telefonnummer', 'Berufsbezeichnung', 'Wieso würdest du gern online Geld verdienen?', 'Was sind deine größten Ziele?', 'Monatliches Einkommen', 'Wie würde sich dein Leben verändern, wenn du ortsunabhängig und online Geld verdienst?', 'Was erhoffst du dir vom Live-Webinar?', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ad_id'],
    ['2', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['2026-10-20 12:01:00', 'Lara', 'Sommer', 'lara@example.com', '+4917300000', 'Selbstständig/Unternehmer', 'Freiheit', 'Eigenes Business', 'Über 5.000 €', 'Mehr Zeit', 'Klarheit', ADSET, 'Frau Müller', CAMPAIGN, '', 'Instagram_Reels', '120200000000000001'],
    ['2026-10-20 15:30:00', 'Kim', 'Berg', 'kim@example.com', '+4917300001', 'Angestellt', 'Nebeneinkommen', 'Schulden weg', '1.500-2.499 €', 'Weniger Druck', 'Ideen', 'email', 'email', 'webinar-2026-11-01', 'mail', '', ''],
  ],
};

// Der Funnel-Tab darf von KEINER Regel erkannt werden
const funnelSheet = {
  title: 'Funnel',
  values: [
    ['Seite', 'URL', 'Tracking'],
    ['Startseite V4', 'https://secretbusiness.live/v4', 'Pageview'],
    ['Dankesseite 1', 'https://secretbusiness.live/workshop-free-ticket-erfolgreich', 'Lead'],
    ['Umfrage', 'https://secretbusiness.live/vip-ticket', 'Pageview'],
  ],
};

const parsed = parseSheets([leadsSheet, umfrageSheet, funnelSheet], PROJECT.sheet, PROJECT.features);

assert.equal(parsed.leads.length, 5, 'fünf Leads erkannt (Zählzeile ignoriert)');
assert.equal(parsed.tickets.length, 2, 'zwei Umfrage-Zeilen erkannt');
assert.equal(parsed.overview.length, 0, 'Funnel-Tab wird nicht als Übersicht missdeutet');
assert.equal(parsed.leads[0].wonAt, '2026-10-20T11:55:07.000Z', 'Zeitstempel ohne Zonenangabe als UTC gelesen');
assert.equal(parsed.leads[1].wonAt, '2026-10-20T14:05:31.000Z', 'Zeitstempel mit +0000 gelesen');
assert.equal(parsed.leads[0].adId, '120200000000000001', 'Ad-ID aus dem Lead-Tab');
assert.equal(parsed.leads[2].adId, '', 'leere Ad-ID bleibt leer');
assert.equal(parsed.tickets[0].adId, '120200000000000001', 'Ad-ID aus dem Umfrage-Tab');
assert.equal(parsed.tickets[0].phone, '+4917300000', 'Telefonnummer gemappt');
assert.equal(parsed.tickets[0].answers.employment, 'Selbstständig/Unternehmer', 'Berufsbezeichnung gemappt');
assert.equal(parsed.tickets[0].answers.income, 'Über 5.000 €', 'Einkommen gemappt');
assert.equal(parsed.tickets[0].answers.motivation, 'Freiheit', 'Wieso online Geld verdienen gemappt');
assert.equal(parsed.tickets[0].answers.goals, 'Eigenes Business', 'Ziele gemappt');
assert.equal(parsed.tickets[0].answers.lifeChange, 'Mehr Zeit', 'Lebensveränderung gemappt (Komma in der Überschrift)');
assert.equal(parsed.tickets[0].answers.expectation, 'Klarheit', 'Erwartung an das Webinar gemappt');

const ds = buildDataset(parsed, scoring, PROJECT.features, PROJECT.sheet.utmRoles);
const leadRows = ds.leads.filter((l) => l.isLead);
const ticketRows = ds.leads.filter((l) => l.hasTicket);
const byMail = (rows, mail) => rows.find((l) => l.email === mail);

// --- UTM-Rollen (Hyros-Schema) ---------------------------------------------
const naomi = byMail(leadRows, 'naomi@example.com');
assert.equal(naomi.sourceType, 'paid', 'Pipe-Namensschema -> bezahlt');
assert.equal(naomi.campaign, CAMPAIGN, 'Kampagne aus utm_campaign');
assert.equal(naomi.adset, ADSET, 'Anzeigengruppe aus utm_source');
assert.equal(naomi.creative, 'Frau Müller', 'Creative aus utm_medium');
assert.equal(naomi.placement, 'Instagram Stories', 'Placement aus utm_term');

// --- Organisch ---------------------------------------------------------------
assert.equal(byMail(leadRows, 'kim@example.com').sourceType, 'organic', 'Newsletter -> organisch');
assert.equal(byMail(leadRows, 'claudia@example.com').sourceType, 'organic', 'Affiliate (utm_term=organic) -> organisch');

// --- Zählung: Lead-Tab und Umfrage-Tab getrennt ------------------------------
assert.equal(ds.counts.leads, 5, 'so viele Leads wie Zeilen im Lead-Tab');
assert.equal(ds.counts.tickets, 2, 'so viele VIP-Tickets wie Zeilen im Umfrage-Tab');
assert.equal(byMail(leadRows, 'lara@example.com').linkedTicket, true, 'Umfrage über die E-Mail zur Anzeige verknüpft');

// --- Ad-ID gewinnt gegen die UTM-Namen ---------------------------------------
// Meta kennt die Anzeige unter leicht anderem Namen (z. B. nach Umbenennung).
const meta = {
  adList: [
    { id: '120200000000000001', name: 'Frau Müller | v2', adset: '15.10. | broad |', campaign: CAMPAIGN },
    { id: '120200000000000002', name: 'Speed Dating | v1', adset: '15.10. | broad |', campaign: CAMPAIGN },
  ],
  entities: [],
};
const stats = resolveAdIds(ds.leads, meta);
assert.equal(stats.resolved, 3, 'zwei Leads und ein VIP-Ticket über die Ad-ID aufgelöst');
const lara = byMail(leadRows, 'lara@example.com');
assert.equal(lara.adset, '15.10. | broad |', 'Anzeigengruppe aus Meta statt aus utm_source');
assert.equal(lara.creative, 'Frau Müller | v2', 'Creative aus Meta statt aus utm_medium');
const laraTicket = byMail(ticketRows, 'lara@example.com');
assert.equal(laraTicket.ticketCreative, 'Frau Müller | v2', 'VIP-Ticket zählt bei derselben Meta-Anzeige');
assert.equal(byMail(leadRows, 'naomi@example.com').creative, 'Frau Müller', 'ohne Ad-ID bleibt die UTM-Zuordnung');

// --- Einstufung (echte Antwortoptionen der Umfrage) --------------------------
//   ab 2.500 €                     -> A
//   1.500 - 2.499 €                -> B
//   unter 1.500 €                  -> C
//   Rentner oder Arbeitssuchend    -> D (schlägt jedes Einkommen)
const tierOf = (answers) => computeQuality(answers, scoring)?.tier ?? null;
const scoreOf = (answers) => computeQuality(answers, scoring)?.score ?? null;
assert.equal(laraTicket.quality.tier, 'A', 'Über 5.000 € -> A');
assert.equal(byMail(ticketRows, 'kim@example.com').quality.tier, 'B', '1.500–2.499 € -> B');

const EXPECTED = {
  'Unter 1.499 €': 'C',
  '1.500-2.499 €': 'B',
  '2.500-3.499 €': 'A',
  '3.500-4.999 €': 'A',
  'Über 5.000 €': 'A',
};
for (const [income, want] of Object.entries(EXPECTED)) {
  for (const employment of ['Angestellt', 'Selbstständig/Unternehmer', 'Elternzeit']) {
    assert.equal(tierOf({ income, employment }), want, `${income} / ${employment} -> ${want}`);
  }
  for (const employment of ['Rentner', 'Arbeitssuchend']) {
    assert.equal(tierOf({ income, employment }), 'D', `${income} / ${employment} -> immer D`);
    assert.equal(scoreOf({ income, employment }), 0, `${employment} = 0 %`);
  }
}
assert.equal(tierOf({ employment: 'Rentner' }), 'D', 'Rentner auch ohne Einkommens-Angabe -> D');
assert.equal(scoreOf({ income: 'Über 5.000 €', employment: 'Angestellt' }), 100, 'A = 100 %');
assert.equal(scoreOf({ income: '1.500-2.499 €', employment: 'Angestellt' }), 70, 'B = 70 %');
assert.equal(scoreOf({ income: 'Unter 1.499 €', employment: 'Angestellt' }), 40, 'C = 40 %');
assert.deepEqual(qualifiedTiersOf(scoring), ['A'], 'nur A gilt als qualifiziert');
assert.equal(computeQuality({ goals: 'Eigenes Business' }, scoring), null, 'ohne Einkommen keine Note');

console.log('✓ Projekt-Konfiguration passt zum Sheet');
console.log(`  ${PROJECT.name} | Ticket-Begriff: ${PROJECT.labels.ticket.many} | Leads: ${ds.counts.leads}, Tickets: ${ds.counts.tickets}`);
console.log('  UTM-Schema: source = Anzeigengruppe · medium = Creative · campaign = Kampagne · term = Placement · ad_id gewinnt');
console.log('  Einstufung: ab 2.500 € -> A · 1.500–2.499 € -> B · unter 1.500 € -> C · Rentner/Arbeitssuchend -> D');
