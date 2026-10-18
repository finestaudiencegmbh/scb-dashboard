/**
 * Leichtgewichtiger Test ohne Framework: prüft Parser + Dataset-Aufbau gegen
 * Zeilen, die exakt der echten Sheet-Struktur entsprechen (UTM-Werte mit
 * eingebetteten "|", zwei gestapelte Übersichts-Tabellen, doppelter Ticket-Tab).
 * Ausführen:  node server/parser.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig } from './scoring.js';

const overviewSheet = {
  title: 'Anzeigengruppen',
  values: [
    ['Status', 'Anzeigengruppe', 'Adspend', 'Ausg. Klicks', 'CPC', 'CVR Optin', 'CVR Ticket', 'CPL', 'Pro Ticket', 'Quali Rate Ticket', 'Leads', 'VIP Ticket', 'Ticket Nicht Qualifiziert', 'Ticket Qualifiziert'],
    ['AUS', 'J&P | LP 1 | Broad | DACH | W | 30-55', '1.030,66 €', '134', '7,69 €', '9,70%', '46,15%', '79,28 €', '171,78 €', '0,00%', '13', '6', '6', '0'],
    [],
    ['Status', 'Anzeigengruppe', 'Adspend', 'Ausg. Klicks', 'CPC', 'CVR Optin', 'CVR Ticket', 'CPL', 'Pro Ticket', 'Quali Rate Ticket', 'Leads', 'VIP Ticket', 'Ticket Nicht Qualifiziert', 'Ticket Qualifiziert'],
    ['AN', 'AG1: J&P | LP 3 | Broad | DACH | W | 30-55', '1.194,23 €', '120', '9,95 €', '15,00%', '38,89%', '66,35 €', '170,60 €', '42,86%', '18', '7', '4', '3'],
  ],
};

const leadsSheet = {
  title: 'Leads',
  values: [
    ['Gewonnen am', 'Vorname', 'Nachname', 'E-Mail', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'VIP-Ticket geholt am', 'Leads aus Ads', 'Leads Newsletter', 'Leads Insta'],
    ['161', '', '', '', '', '', '', '', '47', '', '', ''], // Zähl-/Summenzeile -> muss ignoriert werden
    ['2026-05-26 20:42:50 +0000', 'Rebecca', 'Schießl', 'schiessl.rebecca@gmail.com', 'J&P | LP 1 | Broad | DACH | W | 30-55', 'LP 1 - Static 16', 'J&P | MMV 15.06.-18.06. | ABO | 260526', 'Facebook_Mobile_Feed', '2026-05-26 20:47:35 +0000', '', '', ''],
    ['2026-05-26 21:00:00 +0000', 'Max', 'Organik', 'max@example.com', 'instagram', 'bio', 'moneymaker-workshop-2026', 'workshop-anmeldung', '', '', '', ''],
    // Lead mit VIP-Ticket, aber OHNE passende Antworten-Zeile:
    // Ticket muss trotzdem dem Creative zugeordnet werden, Qualität bleibt offen.
    ['2026-05-27 09:00:00 +0000', 'Lisa', 'Nolead', 'lisa@example.com', 'J&P | LP 2 | Broad | DACH | W | 30-55', 'LP 2 - Static 19', 'J&P | MMV 15.06.-18.06. | ABO | 260526', 'Instagram_Feed', '2026-05-27 09:05:00 +0000', '', '', ''],
  ],
};

const ticketsSheet = {
  title: 'VIP Ticket',
  values: [
    ['Teilgenommen am', 'Vorname', 'Nachname', 'E-Mail (Funnelcockpit)', 'E-Mail (Typeform)', 'Handynummer', 'Angestellt, Selbstständig oder Unternehmer?', 'Größte Herausforderung im Vermögensaufbau?', 'Monatliches Einkommen', 'Immobilien im Besitz?', 'Geld investiert in den Vermögensaufbau? Wenn ja, wie viel?', 'Beziehungsstand?', 'Was erhoffst du dir von den 4 Abenden?', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term'],
    ['2026-05-26 20:47:35 +0000', 'Rebecca', 'Schießl', 'schiessl.rebecca@gmail.con', 'schiessl.rebecca@gmail.com', '+491783420945', 'Angestellt', 'Strategie finden', '3.500-5.000 im Monat', 'Ja, mehrere', '10000', 'Ledig', 'Klarer Plan', 'J&P | LP 1 | Broad | DACH | W | 30-55', 'LP 1 - Static 16', 'J&P | MMV 15.06.-18.06. | ABO | 260526', 'Facebook_Mobile_Feed'],
  ],
};

// zweiter Ticket-Tab mit derselben Person (muss dedupliziert werden)
const ticketsSheet2 = { title: 'VIP Ticket (raw)', values: ticketsSheet.values.map((r) => [...r]) };

const cfg = loadScoringConfig();
const parsed = parseSheets([overviewSheet, leadsSheet, ticketsSheet, ticketsSheet2]);

assert.equal(parsed.overview.length, 2, 'beide Übersichts-Tabellen erkannt');
assert.equal(parsed.overview[0].adset, 'J&P | LP 1 | Broad | DACH | W | 30-55', 'Pipe-Wert intakt');
assert.equal(parsed.overview[0].adspend, 1030.66, 'deutsches Zahlenformat geparst');
assert.equal(parsed.leads.length, 3, 'Summenzeile ignoriert, 3 echte Leads');
assert.equal(parsed.tickets.length, 1, 'Ticket-Duplikat entfernt');

const ds = buildDataset(parsed, cfg);

// Die beiden Tabs zählen getrennt: Leads = Zeilen im Lead-Tab,
// Tickets = Zeilen im Ticket-/Fragebogen-Tab.
assert.equal(ds.counts.leads, 3, 'so viele Leads wie Zeilen im Lead-Tab');
assert.equal(ds.counts.tickets, 1, 'so viele Tickets wie Zeilen im Ticket-Tab');

const leadRows = ds.leads.filter((l) => l.isLead);
const ticketRows = ds.leads.filter((l) => l.hasTicket);
assert.equal(leadRows.length, 3);
assert.equal(ticketRows.length, 1);
assert.equal(ticketRows[0].isLead, false, 'eine Ticket-Zeile ist kein Lead');

const rebecca = leadRows.find((l) => l.email === 'schiessl.rebecca@gmail.com');
assert.ok(rebecca, 'Lead-Zeile vorhanden');
assert.equal(rebecca.hasTicket, false, 'eine Lead-Zeile zählt nie als Ticket');
assert.equal(rebecca.linkedTicket, true, 'Fragebogen über die E-Mail nur zur Anzeige verknüpft');
assert.equal(rebecca.sourceType, 'paid');
assert.equal(rebecca.campaign, 'J&P | MMV 15.06.-18.06. | ABO | 260526');
assert.equal(rebecca.placement, 'Facebook Mobile Feed');
assert.ok(rebecca.answers, 'Antworten zur Anzeige übernommen');

const max = leadRows.find((l) => l.email === 'max@example.com');
assert.equal(max.sourceType, 'organic', 'einzelnes Token = organisch');
assert.equal(max.linkedTicket, false);

// Lead mit Datum in der Ticket-Spalte, aber OHNE Zeile im Ticket-Tab:
// zählt nicht als Ticket – gezählt wird ausschließlich der Ticket-Tab.
const lisa = leadRows.find((l) => l.email === 'lisa@example.com');
assert.equal(lisa.hasTicket, false, 'kein Ticket ohne Zeile im Ticket-Tab');
assert.equal(lisa.linkedTicket, false);
assert.equal(lisa.creative, 'LP 2 - Static 19', 'Creative aus der Lead-Zeile');

// Das Ticket wird über seine EIGENEN UTM-Werte attribuiert
assert.equal(ticketRows[0].creative, 'LP 1 - Static 16', 'Creative aus der Ticket-Zeile');
assert.ok(ticketRows[0].quality && ticketRows[0].quality.score > 0, 'Qualität am Ticket berechnet');

// Spend-Zuordnung über Anzeigengruppe
const spendKey = 'j&p | lp 1 | broad | dach | w | 30-55';
assert.equal(ds.overviewByAdset[spendKey].adspend, 1030.66);

console.log('✓ Alle Parser-/Dataset-Tests bestanden');
console.log('  Leads:', ds.counts, '| Quality Rebecca:', rebecca.quality.score, rebecca.quality.tier);
