/**
 * Wandelt die Roh-Zellen aus dem Google Sheet in strukturierte Datensätze um.
 *
 * Das Sheet besteht aus mehreren Tabs/Tabellen. Statt fixe Tab-Namen
 * vorauszusetzen, erkennt der Parser jede Tabelle an ihrer Kopfzeile.
 * Dadurch bleibt er stabil, auch wenn Tabs umbenannt oder verschoben werden.
 *
 * Welche Kopfzeilen/Spalten gemeint sind, steht NICHT im Code, sondern in
 * config/project.config.json ("sheet"). DEFAULT_SHEET_CONFIG unten ist der
 * Fallback und dient zugleich als Beispiel-Mapping.
 */

const norm = (s) =>
  String(s ?? '')
    .replace(/ /g, ' ')
    .trim();

const key = (s) =>
  norm(s)
    .toLowerCase()
    .replace(/[?:.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Standard-Mapping (entspricht dem ursprünglichen Sheet-Aufbau). */
export const DEFAULT_SHEET_CONFIG = {
  detect: {
    overview: [{ all: ['anzeigengruppe', 'adspend'] }],
    tickets: [
      { some: ['monatliches einkommen', 'immobilien im besitz'] },
      { all: ['teilgenommen am', 'vorname'] },
    ],
    leads: [{ all: ['gewonnen am'], some: ['utm_source', 'e-mail'] }],
  },
  columns: {
    leads: {
      date: ['gewonnen am'],
      firstName: ['vorname'],
      lastName: ['nachname'],
      email: ['e-mail'],
      ticketDate: ['vip-ticket geholt am'],
      utmSource: ['utm_source'],
      utmMedium: ['utm_medium'],
      utmCampaign: ['utm_campaign'],
      utmTerm: ['utm_term'],
      utmContent: ['utm_content'],
    },
    tickets: {
      date: ['teilgenommen am'],
      firstName: ['vorname'],
      lastName: ['nachname'],
      email: ['e-mail (funnelcockpit)', 'e-mail (typeform)', 'e-mail'],
      emailAlt: ['e-mail (typeform)'],
      phone: ['handynummer'],
      utmSource: ['utm_source'],
      utmMedium: ['utm_medium'],
      utmCampaign: ['utm_campaign'],
      utmTerm: ['utm_term'],
      utmContent: ['utm_content'],
    },
    overview: {
      status: ['status'],
      adset: ['anzeigengruppe'],
      adspend: ['adspend'],
      clicks: ['ausg klicks', 'klicks'],
      cpc: ['cpc'],
      cvrOptin: ['cvr optin'],
      cvrTicket: ['cvr ticket'],
      cpl: ['cpl'],
      leads: ['leads'],
      tickets: ['vip ticket'],
      ticketsQualified: ['ticket qualifiziert'],
      ticketsUnqualified: ['ticket nicht qualifiziert'],
    },
  },
  answers: {
    employment: { label: 'Beschäftigung', columns: ['angestellt selbstständig oder unternehmer'], filter: true },
    income: { label: 'Monatliches Einkommen', columns: ['monatliches einkommen'], filter: true },
    realEstate: { label: 'Immobilien im Besitz', columns: ['immobilien im besitz'], filter: true },
    invested: { label: 'Investiertes Kapital', columns: ['geld investiert in den vermögensaufbau wenn ja wie viel'] },
    relationship: { label: 'Beziehungsstand', columns: ['beziehungsstand'] },
    challenge: { label: 'Größte Herausforderung', columns: ['größte herausforderung im vermögensaufbau'], wide: true },
    expectation: { label: 'Erwartung an den Workshop', columns: ['was erhoffst du dir von den 4 abenden'], wide: true },
  },
};

/** Erster nicht-leerer Wert aus einer Liste möglicher Spaltennamen. */
function pick(obj, names) {
  for (const n of names || []) {
    const v = obj[key(n)];
    if (norm(v) !== '') return v;
  }
  return '';
}

/** Erkennt anhand einer Kopfzeile, um welchen Tabellentyp es sich handelt. */
function classifyHeader(cells, detect) {
  const set = new Set(cells.map(key));
  const matches = (rule) => {
    const all = rule.all || [];
    const some = rule.some || [];
    if (!all.every((k) => set.has(key(k)))) return false;
    if (some.length && !some.some((k) => set.has(key(k)))) return false;
    return all.length > 0 || some.length > 0;
  };
  // Reihenfolge wie in der Config (overview vor tickets vor leads).
  for (const [type, rules] of Object.entries(detect)) {
    if ((rules || []).some(matches)) return type;
  }
  return null;
}

function rowToObj(headerCells, row) {
  const obj = {};
  headerCells.forEach((h, i) => {
    const k = key(h);
    if (!k) return;
    obj[k] = norm(row[i]);
  });
  return obj;
}

function isEmptyRow(row) {
  return !row || row.every((c) => norm(c) === '');
}

function parseDate(s) {
  const v = norm(s);
  if (!v) return null;
  // Nur echte Datumsangaben akzeptieren (Format im Sheet:
  // "2026-05-26 18:46:08 +0000"). Verhindert, dass Zähl-/Summenzeilen
  // wie "161" fälschlich als Datum (Jahr 161) interpretiert werden.
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  let iso = v.replace(' +0000', 'Z').replace(' ', 'T');
  // Ohne Zonenangabe ("2026-09-11T22:40:45") würde Node die SERVER-Zeitzone
  // annehmen – je nach Host verschiebt sich dann der Tag. Die Sheet-Zeit ist
  // bereits die gewünschte Ortszeit, also 1:1 als UTC lesen (das Frontend
  // formatiert ebenfalls mit timeZone UTC).
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) iso += 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const normEmail = (s) => norm(s).toLowerCase();

/**
 * Zerlegt ein Tab (2D-Array) in einzelne Tabellen. Ein Tab kann mehrere
 * untereinander gestapelte Tabellen enthalten (z. B. die Anzeigengruppen-
 * Übersicht mit mehreren Kampagnen).
 */
function* iterateTables(rows, detect) {
  let header = null;
  let type = null;
  let body = [];
  const flush = () => {
    if (header && body.length) return { header, type, body };
    return null;
  };
  for (const row of rows) {
    const t = classifyHeader(row.map(norm).filter(Boolean).length >= 2 ? row : [], detect);
    if (t) {
      const prev = flush();
      if (prev) yield prev;
      header = row;
      type = t;
      body = [];
      continue;
    }
    if (header) {
      if (isEmptyRow(row)) {
        const prev = flush();
        if (prev) yield prev;
        header = null;
        type = null;
        body = [];
      } else {
        body.push(row);
      }
    }
  }
  const last = flush();
  if (last) yield last;
}

const num = (s) => {
  const v = norm(s).replace(/[^\d,.-]/g, '');
  if (!v) return null;
  // deutsches Format: 1.030,11 -> 1030.11
  const n = parseFloat(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function parseOverviewRow(o, cols) {
  const adset = norm(pick(o, cols.adset));
  if (!adset) return null;
  return {
    status: norm(pick(o, cols.status)),
    adset,
    adspend: num(pick(o, cols.adspend)),
    clicks: num(pick(o, cols.clicks)),
    cpc: num(pick(o, cols.cpc)),
    cvrOptin: num(pick(o, cols.cvrOptin)),
    cvrTicket: num(pick(o, cols.cvrTicket)),
    cpl: num(pick(o, cols.cpl)),
    leads: num(pick(o, cols.leads)),
    tickets: num(pick(o, cols.tickets)),
    ticketsQualified: num(pick(o, cols.ticketsQualified)),
    ticketsUnqualified: num(pick(o, cols.ticketsUnqualified)),
  };
}

/**
 * UTM-Block aus einer Zeile lesen (Spaltennamen aus der Config). Die Zuordnung
 * "welcher UTM-Parameter ist Kampagne/Anzeigengruppe/Creative/Placement"
 * passiert NICHT hier, sondern in build.js (sheet.utmRoles) – je nach
 * URL-Schema des Werbekontos.
 */
function utmOf(o, cols) {
  return {
    source: norm(pick(o, cols.utmSource)),
    medium: norm(pick(o, cols.utmMedium)),
    campaign: norm(pick(o, cols.utmCampaign)),
    term: norm(pick(o, cols.utmTerm)),
    content: norm(pick(o, cols.utmContent)),
  };
}

function parseLeadRow(o, cols) {
  const wonAt = parseDate(pick(o, cols.date));
  if (!wonAt) return null; // Zähl-/Summenzeilen ohne gültiges Datum überspringen
  return {
    wonAt,
    firstName: norm(pick(o, cols.firstName)),
    lastName: norm(pick(o, cols.lastName)),
    email: normEmail(pick(o, cols.email)),
    utm: utmOf(o, cols),
    ticketAt: parseDate(pick(o, cols.ticketDate)),
  };
}

function parseTicketRow(o, cols, answerCfg) {
  const at = parseDate(pick(o, cols.date));
  const email = normEmail(pick(o, cols.email));
  if (!at && !email) return null;
  const answers = {};
  for (const [name, a] of Object.entries(answerCfg || {})) {
    answers[name] = norm(pick(o, a.columns));
  }
  return {
    at,
    firstName: norm(pick(o, cols.firstName)),
    lastName: norm(pick(o, cols.lastName)),
    email,
    emailTypeform: normEmail(pick(o, cols.emailAlt)),
    phone: norm(pick(o, cols.phone)),
    answers,
    utm: utmOf(o, cols),
  };
}

/**
 * Hauptfunktion: bekommt die Tabs als [{title, values}] und liefert
 * { leads, tickets, overview, warnings }.
 *
 * @param {array}  sheets    Tabs aus dem Google Sheet
 * @param {object} sheetCfg  Spalten-Mapping (Default: DEFAULT_SHEET_CONFIG)
 * @param {object} features  { hasTickets } – ohne Tickets wird der Ticket-Tab
 *                           gar nicht erst gelesen.
 */
export function parseSheets(sheets, sheetCfg = DEFAULT_SHEET_CONFIG, features = {}) {
  const { hasTickets = true } = features;
  const cols = sheetCfg.columns || DEFAULT_SHEET_CONFIG.columns;
  const answerCfg = sheetCfg.answers || {};
  const detect = { ...(sheetCfg.detect || DEFAULT_SHEET_CONFIG.detect) };
  if (!hasTickets) delete detect.tickets;

  const leads = [];
  const tickets = [];
  const overview = [];
  const warnings = [];
  const seenTickets = new Set();

  for (const sheet of sheets) {
    const rows = sheet.values || [];
    for (const table of iterateTables(rows, detect)) {
      for (const row of table.body) {
        const o = rowToObj(table.header, row);
        if (table.type === 'overview') {
          const r = parseOverviewRow(o, cols.overview);
          if (r) overview.push(r);
        } else if (table.type === 'leads') {
          const r = parseLeadRow(o, cols.leads);
          if (r) leads.push(r);
        } else if (table.type === 'tickets') {
          const r = parseTicketRow(o, cols.tickets, answerCfg);
          if (!r) continue;
          // Dedupe (das Sheet enthält teils zwei Ticket-Tabs)
          const dk = `${r.email}|${r.at || ''}`;
          if (seenTickets.has(dk)) continue;
          seenTickets.add(dk);
          tickets.push(r);
        }
      }
    }
  }

  return { leads, tickets, overview, warnings };
}

export const _internal = { classifyHeader, key, num, parseDate, iterateTables, pick };
