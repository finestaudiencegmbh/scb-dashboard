/**
 * Synthetische Demo-Daten – KEINE echten Personendaten.
 * Dienen nur dazu, das Dashboard ohne Google-Anbindung sofort ansehbar zu
 * machen. Struktur identisch zu den geparsten Sheet-Daten, fließt also durch
 * dieselbe buildDataset-Pipeline.
 *
 * Die UTM-Werte werden nach dem Rollen-Mapping des Projekts erzeugt
 * (sheet.utmRoles), damit der Demo-Modus genauso aussieht wie später die
 * echten Daten. Die Fragebogen-Antworten werden für die Schlüssel erzeugt,
 * die das Projekt kennt – unbekannte bleiben leer.
 */

import { DEFAULT_UTM_ROLES } from './build.js';

const campaigns = [
  'Workshop | Kaltakquise | CBO | 101026',
  'Workshop | Retargeting | ABO | 101026',
];
const adsets = [
  'Broad | DACH | 30+',
  'Broad | CH | 30+',
  'Interessen | Persönlichkeitsentwicklung | DACH',
  'LaL 1% Käufer | DACH',
  'Retargeting | Websitebesucher 180 Tage',
];
const creatives = ['Video Hook A', 'Video Hook B', 'Static 2', 'Static 7', 'Reel 3'];
const placements = ['Instagram_Feed', 'Facebook_Mobile_Feed', 'Instagram_Reels', 'Instagram_Stories'];

/** Antwort-Pools je bekanntem Fragebogen-Schlüssel (nur für die Demo). */
const ANSWER_POOLS = {
  income: ['Unter 1.999 €', '2.000 - 2.999 €', '3.000 - 3.999 €', '4.000 - 4.999 €', 'Über 5.000 €'],
  urgency: ['Sofort', 'In den nächsten Wochen', 'In den nächsten Monaten', 'Innerhalb eines Jahres', 'Irgendwann'],
  employment: ['Angestellt', 'Selbstständig / Unternehmer', 'Rentner', 'Schüler/Student', 'Arbeitssuchend'],
  age: ['18-29 Jahre', '30-39 Jahre', '40-49 Jahre', '50-59 Jahre', 'Über 60 Jahre'],
  challenge: ['Zu wenig Zeit', 'Allem gerecht werden', 'Fehlende Struktur', 'Unklare Ziele'],
  expectation: ['Klarer Plan', 'Ich möchte weiterkommen', 'Konkrete Werkzeuge'],
  realEstate: ['Nein', 'Ja, eine', 'Ja, mehrere', 'Noch nicht'],
  invested: ['Nein', '4000', '10000', 'Ja, monatlich 300-400 €', '25000'],
  relationship: ['Ledig', 'In einer Beziehung', 'Verheiratet'],
};

function rand(arr, i) {
  return arr[i % arr.length];
}

/** Baut den UTM-Block so, wie ihn das Rollen-Mapping des Projekts erwartet. */
function utmFor(roles, { campaign, adset, creative, placement }) {
  const utm = { source: 'meta', medium: 'paid', campaign: '', term: '', content: '' };
  const values = { campaign, adset, creative, placement };
  for (const [role, param] of Object.entries(roles)) {
    if (param && values[role] != null) utm[param] = values[role];
  }
  return utm;
}

export function getSampleParsed(project = {}) {
  const roles = { ...DEFAULT_UTM_ROLES, ...(project?.sheet?.utmRoles || {}) };
  const answerKeys = Object.keys(project?.sheet?.answers || {});
  const leads = [];
  const tickets = [];
  let seed = 7;
  const next = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

  const answersFor = (i) => {
    const out = {};
    for (const key of answerKeys) {
      const pool = ANSWER_POOLS[key];
      out[key] = pool ? rand(pool, Math.floor(next() * pool.length)) : '';
    }
    return out;
  };

  for (let i = 0; i < 48; i++) {
    const campaign = i % 5 < 3 ? campaigns[0] : campaigns[1];
    const adset = i % 5 < 3 ? rand(adsets.slice(0, 3), i) : rand(adsets.slice(3), i);
    const creative = rand(creatives, i + (i % 3));
    const placement = rand(placements, i * 2 + 1);
    const email = `demo.lead${i}@example.com`;
    const day = 24 + (i % 4);
    const wonAt = new Date(Date.UTC(2026, 4, day, 10 + (i % 12), (i * 7) % 60, 0)).toISOString();
    const gotTicket = next() < 0.45;
    const utm = utmFor(roles, { campaign, adset, creative, placement });
    leads.push({
      wonAt,
      firstName: `Demo${i}`,
      lastName: 'Person',
      email,
      utm,
      ticketAt: gotTicket ? wonAt : null,
    });
    if (gotTicket) {
      tickets.push({
        at: wonAt,
        firstName: `Demo${i}`,
        lastName: 'Person',
        email,
        emailTypeform: email,
        phone: `+49150${String(1000000 + i)}`,
        answers: answersFor(i),
        utm: { ...utm },
      });
    }
  }

  // ein paar organische Leads
  for (let i = 0; i < 6; i++) {
    leads.push({
      wonAt: new Date(`2026-05-2${5 + (i % 3)}T12:00:00Z`).toISOString(),
      firstName: `Organic${i}`,
      lastName: 'Person',
      email: `demo.organic${i}@example.com`,
      utm: { source: rand(['instagram', 'facebook', 'youtube'], i), medium: 'manychat', campaign: 'workshop-anmeldung', term: '', content: '' },
      ticketAt: null,
    });
  }

  // Adspend-Übersicht je Anzeigengruppe. Im echten Betrieb kommen die
  // Ad-Kosten aus der Meta-API; in der Demo simuliert das hier die Zahlen,
  // damit CPL & Co. nicht leer bleiben.
  const overview = adsets.map((adset, i) => ({
    status: i % 3 === 0 ? 'AUS' : 'AN',
    adset,
    adspend: 800 + i * 350,
    clicks: 90 + i * 20,
    cpc: 6 + i,
    cvrOptin: 9 + i,
    cvrTicket: 20 + i,
    cpl: 50 + i * 8,
    leads: 12 + i,
    tickets: 3 + (i % 4),
    ticketsQualified: i % 3,
    ticketsUnqualified: 2,
  }));

  return { leads, tickets, overview };
}
