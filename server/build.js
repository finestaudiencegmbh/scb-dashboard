import { computeQuality } from './scoring.js';
import { loadCampaignConfig } from './campaigns.js';

const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Welcher UTM-Parameter trägt welche Dimension? Hängt am URL-Schema des
 * Werbekontos und steht daher in project.config.json (sheet.utmRoles).
 * Default = bisheriges Schema (source = Anzeigengruppe, medium = Creative).
 * null bedeutet: diese Dimension wird nicht getrackt.
 */
export const DEFAULT_UTM_ROLES = { campaign: 'campaign', adset: 'source', creative: 'medium', placement: 'term' };

/** Wert einer Dimension aus der UTM-Kombination (gemäß Rollen-Mapping). */
const roleOf = (utm, roles, role) => {
  const param = roles[role];
  return param ? collapse(utm[param]) : '';
};

/** Rein numerischer Wert (z. B. Meta-IDs wie 52540202640549) -> nicht zuordenbar. */
const isNumericId = (s) => /^\d{6,}$/.test(collapse(s));

const titleCase = (s) => collapse(s).replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Aussagekräftiges Label für eine ORGANISCHE Quelle:
 * - ManyChat (steht im utm_medium) -> "ManyChat · <Kampagnenname>"
 * - Bio (utm_source enthält "bio")  -> "<Plattform> Bio"  (fb-bio -> Facebook Bio)
 * - sonst -> die Quelle selbst (Title Case)
 * Liefert { campaign, adset } für die zweistufige Gruppierung.
 */
function organicLabels(utm) {
  const src = collapse(utm.source).toLowerCase();
  const med = collapse(utm.medium).toLowerCase();
  const camp = collapse(utm.campaign);

  if (/manychat/.test(med) || /manychat/.test(src) || /manychat/.test(camp.toLowerCase())) {
    const flow = camp || titleCase(collapse(utm.medium).replace(/manychat/i, '').replace(/[-_|]/g, ' ').trim()) || '(ohne Flow)';
    return { campaign: 'ManyChat', adset: flow };
  }
  if (/bio/.test(src)) {
    const platMap = { fb: 'Facebook', facebook: 'Facebook', ig: 'Instagram', insta: 'Instagram', instagram: 'Instagram', yt: 'YouTube', youtube: 'YouTube', tiktok: 'TikTok', tt: 'TikTok' };
    const token = src.replace(/[-_\s]*bio.*/, '').replace(/[-_\s]+/g, '');
    const plat = platMap[token] || titleCase(token) || 'Bio';
    return { campaign: 'Bio', adset: `${plat} Bio` };
  }
  const label = titleCase(src) || '(direkt)';
  return { campaign: label, adset: label };
}

/** Lesbares Label für ein Placement (utm_term). */
function placementLabel(term) {
  const t = collapse(term);
  if (!t) return '(kein Placement)';
  if (/^\d{6,}$/.test(t)) return `Placement-ID ${t}`;
  return t.replace(/_/g, ' ');
}

/** Quellen, die immer als organisch gelten – unabhängig vom UTM-Schema. */
function isOrganicSource(utm, patterns) {
  const hay = [utm.source, utm.medium, utm.campaign, utm.term]
    .map((v) => collapse(v).toLowerCase())
    .join(' | ');
  return patterns.some((p) => hay.includes(String(p).toLowerCase()));
}

/**
 * Entscheidet, ob ein Datensatz aus bezahlter Werbung stammt.
 * Reihenfolge: organische Muster > utm_medium (paid/cpc/…) > Adspend-Übersicht
 * > Namensschema "X | Y | Z | …". Alles andere gilt als organisch.
 */
function isPaid(utm, paidAdsets, patterns, roles, paidMediums = []) {
  // Harte Regel: was in config/campaigns.json unter organicPatterns steht
  // (z. B. ManyChat, Bio, der Kampagnen-Slug), gilt immer als organisch.
  if (isOrganicSource(utm, patterns)) return false;
  // utm_medium=paid / cpc / paid_social … – das eindeutigste Signal, sofern das
  // URL-Schema des Werbekontos es setzt (config/campaigns.json: paidMediums).
  const med = collapse(utm.medium).toLowerCase();
  if (med && paidMediums.some((m) => med === String(m).toLowerCase())) return true;
  const src = roleOf(utm, roles, 'adset') || collapse(utm.source);
  if (!src) return false;
  if (paidAdsets.has(src.toLowerCase())) return true;
  // Bezahlte Anzeigen folgen dem Schema "X | Y | Z | ..." – das kann in der
  // Anzeigengruppe (utm_source), der Kampagne (utm_campaign) ODER dem Creative
  // (utm_medium) stehen. Manche Konten nutzen Pipes nur im Kampagnennamen.
  if (`${src} ${roleOf(utm, roles, 'campaign')} ${collapse(utm.medium)}`.includes('|')) return true;
  // Rein numerische Source = Meta-ID -> bezahlt (aber nicht eindeutig zuordenbar).
  if (isNumericId(src)) return true;
  return false;
}

/**
 * Webinar-Spalte -> kurzes Label und Datum: "Webinar 01.11.2026 um 11 Uhr"
 * -> { label: "Webinar 01.11.26", date: "2026-11-01" }. Ohne erkennbares
 * Datum bleibt der Text, wie er ist.
 */
export function webinarOf(raw) {
  const v = collapse(raw);
  if (!v) return { label: '', date: '' };
  const m = v.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return { label: v, date: '' };
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return { label: `Webinar ${dd}.${mm}.${yyyy.slice(2)}`, date: `${yyyy}-${mm}-${dd}` };
}

/** Telefonnummer -> Vergleichsschlüssel (letzte 9 Ziffern, Vorwahl-Schreibweise egal). */
const phoneKey = (s) => {
  const d = String(s ?? '').replace(/\D/g, '');
  return d.length >= 7 ? d.slice(-9) : '';
};

const hasUtm = (utm) => Boolean(utm && (utm.source || utm.medium || utm.campaign || utm.content));

/**
 * Quelle eines Termins für den Quellen-Tab: Gruppe (Meta Ads, E-Mail,
 * Affiliate, …) und Unterquelle (Kampagne, Mail, Kanal).
 */
function appointmentSource(a) {
  if (a.sourceType === 'paid') return { group: 'Meta Ads', detail: a.campaign };
  const u = a.utm;
  if (!hasUtm(u)) return { group: 'Ohne UTM', detail: 'keine Zuordnung' };
  const src = collapse(u.source).toLowerCase();
  const med = collapse(u.medium).toLowerCase();
  const detail = collapse(u.content) || collapse(u.medium) || collapse(u.campaign) || '(ohne Angabe)';
  if (med === 'affiliate' || src === 'affiliate') return { group: 'Affiliate', detail };
  if (/mail/.test(src) || /mail/.test(med)) return { group: 'E-Mail', detail };
  if (/manychat/.test(`${src} ${med}`)) return { group: 'ManyChat', detail };
  return { group: titleCase(collapse(u.source) || collapse(u.medium)), detail };
}

/**
 * Termine aus dem Termin-Tab: eigene Datensätze, die KEINE Lead-, Ticket- oder
 * Spend-Zahl verändern. Je Person zählt EIN Termin (Umbuchungen und doppelte
 * Buchungen werden über E-Mail ODER Telefonnummer zusammengefasst), `bookings`
 * hält die Anzahl der Buchungen.
 *
 * Fehlen die UTMs (andere E-Mail bei der Buchung als beim Opt-in), wird die
 * Person über die E-Mail im Lead-Tab oder die Telefonnummer im Fragebogen
 * gesucht und deren Attribution übernommen (matchedBy). Sonst: "Ohne UTM".
 */
function buildAppointments(rows, { leads, tickets, dimsFor }) {
  if (!rows?.length) return [];
  // Personen bündeln (Union-Find über E-Mail und Telefon)
  const parent = rows.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstBy = new Map();
  rows.forEach((r, i) => {
    for (const k of [r.email && `e:${r.email}`, phoneKey(r.phone) && `p:${phoneKey(r.phone)}`]) {
      if (!k) continue;
      if (firstBy.has(k)) parent[find(i)] = find(firstBy.get(k));
      else firstBy.set(k, i);
    }
  });
  const groups = new Map();
  rows.forEach((r, i) => {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  });

  const leadByEmail = new Map();
  for (const l of leads || []) if (l.email && !leadByEmail.has(l.email)) leadByEmail.set(l.email, l);
  const ticketByPhone = new Map();
  for (const t of tickets || []) {
    const k = phoneKey(t.phone);
    if (k && !ticketByPhone.has(k)) ticketByPhone.set(k, t);
  }

  // Webinar je Person (E-Mail/Telefon) und alle bekannten Webinare nach Datum
  const webinarByEmail = new Map();
  const webinarByPhone = new Map();
  const known = new Map();
  for (const p of [...(leads || []), ...(tickets || [])]) {
    const w = webinarOf(p.webinar);
    if (!w.label) continue;
    if (p.email && !webinarByEmail.has(p.email)) webinarByEmail.set(p.email, w);
    const pk = phoneKey(p.phone);
    if (pk && !webinarByPhone.has(pk)) webinarByPhone.set(pk, w);
    known.set(w.label, w);
  }
  const webinarDates = [...known.values()].filter((w) => w.date).sort((x, y) => (x.date < y.date ? -1 : 1));

  const out = [];
  for (const list of groups.values()) {
    list.sort((x, y) => (x.at < y.at ? -1 : 1));
    // Attribution aus der ersten Buchung MIT UTM/Ad-ID, Zeitpunkt = erste Buchung
    const rep = list.find((r) => r.adId || hasUtm(r.utm)) || list[0];
    let utm = rep.utm;
    let adId = rep.adId;
    let matchedBy = null;
    if (!adId && !hasUtm(utm)) {
      for (const r of list) {
        const l = r.email && leadByEmail.get(r.email);
        if (l && (l.adId || hasUtm(l.utm))) { utm = l.utm; adId = l.adId; matchedBy = 'lead-email'; break; }
        const t = phoneKey(r.phone) && ticketByPhone.get(phoneKey(r.phone));
        if (t && (t.adId || hasUtm(t.utm))) { utm = t.utm; adId = t.adId; matchedBy = 'survey-phone'; break; }
      }
    }
    const d = dimsFor(utm, adId);
    // Webinar: eigene Spalte, sonst das der Person aus Lead-/Fragebogen-Tab,
    // sonst das letzte Webinar am oder vor dem Buchungstag
    let webinar = webinarOf(list.find((r) => r.webinar)?.webinar);
    if (!webinar.label) {
      for (const r of list) {
        const w = (r.email && webinarByEmail.get(r.email)) || (phoneKey(r.phone) && webinarByPhone.get(phoneKey(r.phone)));
        if (w) { webinar = w; break; }
      }
    }
    if (!webinar.label) {
      const day = String(list[0].at || '').slice(0, 10);
      webinar = webinarDates.filter((w) => w.date && w.date <= day).pop() || { label: '', date: '' };
    }
    const a = {
      at: list[0].at,
      callAt: rep.callAt || null,
      name: rep.name || '(ohne Name)',
      email: rep.email,
      bookings: list.length,
      sourceType: d.paid ? 'paid' : 'organic',
      campaign: d.campaign,
      adset: d.adset,
      creative: d.creative,
      adId: adId || '',
      utm: { ...utm },
      matchedBy,
      webinar: webinar.label,
    };
    out.push(a);
  }
  return out.sort((x, y) => (x.at < y.at ? -1 : 1));
}

/** Quelle (Gruppe/Unterquelle) setzen – nach resolveAdIds erneut aufrufen. */
export function labelAppointmentSources(appointments) {
  for (const a of appointments || []) {
    const s = appointmentSource(a);
    a.sourceGroup = s.group;
    a.sourceDetail = s.detail;
  }
  return appointments;
}

/**
 * Führt Leads, VIP-Tickets und Adspend-Übersicht zu einem einheitlichen
 * Datensatz zusammen. Join über die E-Mail-Adresse.
 */
export function buildDataset({ leads, tickets, overview, appointments: appointmentRows = [] }, cfg, features = {}, utmRoles = DEFAULT_UTM_ROLES) {
  const { hasTickets = true, hasQuality = true, hasAppointments = false } = features;
  const roles = { ...DEFAULT_UTM_ROLES, ...(utmRoles || {}) };
  const warnings = [];
  const paidAdsets = new Set(overview.map((o) => o.adset.toLowerCase()));
  const campCfg = loadCampaignConfig();
  const organicPatterns = campCfg.organicPatterns || ['manychat', 'bio'];
  const paidMediums = campCfg.paidMediums || [];
  const organicLabel = campCfg.organicLabel || '(organisch)';
  const unattribLabel = campCfg.unattributablePaidLabel || '(Paid · nicht zuordenbar)';

  // Leitet die Dimensions-Labels (Kampagne/Anzeigengruppe/Creative) aus einer
  // UTM-Kombination ab – einheitlich für Lead-UTM UND Ticket-UTM verwendbar.
  // Eine Meta-Ad-ID gibt es nur bei bezahltem Traffic -> eindeutig Paid. Die
  // Namen dazu löst resolveAdIds() (adid.js) später gegen Meta auf.
  const dimsFor = (utm, adId = '') => {
    const paid = Boolean(adId) || isPaid(utm, paidAdsets, organicPatterns, roles, paidMediums);
    const rawCampaign = roleOf(utm, roles, 'campaign');
    const rawAdset = roleOf(utm, roles, 'adset');
    const rawCreative = roleOf(utm, roles, 'creative');
    if (!paid) return { paid: false, campaign: organicLabel, adset: organicLabel, creative: rawCreative || organicLabel };
    if (isNumericId(rawCampaign) || isNumericId(rawAdset) || !rawCampaign || !rawAdset) {
      return { paid: true, campaign: unattribLabel, adset: unattribLabel, creative: rawCreative || unattribLabel };
    }
    return { paid: true, campaign: rawCampaign, adset: rawAdset, creative: rawCreative || unattribLabel };
  };

  // Die beiden Tabs sind EIGENSTÄNDIG:
  //   Lead-Tab      -> ein Datensatz je Zeile, zählt als Lead
  //   Fragebogen-Tab -> ein Datensatz je Zeile, zählt als Ticket
  // Es wird NICHT zusammengeführt und nichts dedupliziert: Die Lead-Anzahl
  // entspricht exakt den Zeilen im Lead-Tab, die Ticket-Anzahl exakt den Zeilen
  // im Fragebogen-Tab. Beide werden über ihre EIGENEN UTM-Spalten attribuiert.
  //
  // Die E-Mail wird nur für die ANZEIGE genutzt: passt sie, erscheinen die
  // Fragebogen-Antworten beim Lead in der Leadliste. Das ändert keine Zahl.
  const ticketByEmail = new Map();
  for (const t of (hasTickets ? tickets : [])) {
    for (const e of [t.email, t.emailTypeform]) {
      if (e && !ticketByEmail.has(e)) ticketByEmail.set(e, t);
    }
  }

  const recs = [];

  // 1) Lead-Zeilen
  for (const l of leads) {
    const email = l.email || '';
    const t = email ? ticketByEmail.get(email) : null; // nur zur Anreicherung
    recs.push({
      isLead: true,
      hasTicket: false,
      // Nur fürs Auge: markiert in der Leadliste, wer den Fragebogen ausgefüllt
      // hat. Gezählt werden die Tickets aus dem Fragebogen-Tab (siehe unten).
      linkedTicket: Boolean(t),
      email,
      firstName: l.firstName || '',
      lastName: l.lastName || '',
      phone: t?.phone || '',
      wonAt: l.wonAt,
      ticketAt: null,
      utm: { ...l.utm },
      adId: l.adId || '',
      ticketUtm: null,
      ticketAdId: '',
      answers: hasQuality ? (t?.answers || null) : null,
      webinar: webinarOf(l.webinar).label,
    });
  }

  // 2) Fragebogen-Zeilen – eigene Datensätze, zählen NICHT als Leads
  for (const t of (hasTickets ? tickets : [])) {
    recs.push({
      isLead: false,
      hasTicket: true,
      linkedTicket: true,
      email: t.email || t.emailTypeform || '',
      firstName: t.firstName || '',
      lastName: t.lastName || '',
      phone: t.phone || '',
      wonAt: t.at || null,
      ticketAt: t.at || null,
      utm: { ...t.utm },
      adId: t.adId || '',
      ticketUtm: { ...t.utm },
      ticketAdId: t.adId || '',
      answers: hasQuality ? (t.answers || null) : null,
      webinar: webinarOf(t.webinar).label,
    });
  }

  // 3) Finalisieren: Dimensionen, Quelle, Qualität
  const records = [];
  for (const r of recs) {
    // Lead-Dimensionen aus der Lead-UTM
    const ld = dimsFor(r.utm, r.adId);
    const paid = ld.paid;
    const { campaign, adset, creative } = ld;
    // Qualität hängt an den Fragebogen-Antworten. Auf einer Lead-Zeile ist sie
    // reine Anzeige (die Kennzahlen rechnen ausschließlich mit den Tickets).
    const quality = hasQuality ? computeQuality(r.answers, cfg) : null;

    // Ticket-Dimensionen aus der TICKET-EIGENEN UTM (damit ein Ticket dort zählt,
    // wo es wirklich entstand – nicht in jeder Kampagne, in der die Person Lead war)
    let ticketCampaign = null, ticketAdset = null, ticketCreative = null;
    if (r.hasTicket) {
      const td = dimsFor(r.ticketUtm || r.utm, r.ticketAdId || r.adId);
      ticketCampaign = td.campaign; ticketAdset = td.adset; ticketCreative = td.creative;
    }

    records.push({
      ticketCampaign,
      ticketAdset,
      ticketCreative,
      email: r.email,
      name: collapse(`${r.firstName} ${r.lastName}`) || '(ohne Name)',
      firstName: r.firstName,
      lastName: r.lastName,
      phone: r.phone,
      wonAt: r.wonAt,
      ticketAt: r.ticketAt,
      isLead: r.isLead,
      hasTicket: r.hasTicket,
      linkedTicket: r.linkedTicket,
      sourceType: paid ? 'paid' : 'organic',
      campaign,
      adset,
      creative,
      adId: r.adId,
      ticketAdId: r.ticketAdId,
      placement: placementLabel(roleOf(r.utm, roles, 'placement')),
      placementRaw: roleOf(r.utm, roles, 'placement'),
      // Rohe UTM-Werte für den Quellen-Tab (Donut/Top-Listen)
      sourceRaw: collapse(r.utm.source),
      campaignRaw: collapse(r.utm.campaign),
      mediumRaw: collapse(r.utm.medium),
      // Aussagekräftige Gruppierung für den Organisch-Container
      ...(paid ? {} : (() => { const o = organicLabels(r.utm); return { organicCampaign: o.campaign, organicAdset: o.adset }; })()),
      quality,
      answers: r.answers,
      webinar: r.webinar || '',
    });
  }

  // Spend-Übersicht: nach Anzeigengruppe verdichten (mehrere Kampagnen-Tabs)
  const overviewByAdset = new Map();
  for (const o of overview) {
    const k = o.adset.toLowerCase();
    if (!overviewByAdset.has(k)) overviewByAdset.set(k, o);
  }

  const matchedAdsets = new Set(records.filter((r) => r.isLead && r.sourceType === 'paid').map((r) => r.adset.toLowerCase()));
  for (const o of overview) {
    if (!matchedAdsets.has(o.adset.toLowerCase())) {
      // Übersicht kennt eine Anzeigengruppe, zu der (noch) keine Leads mit
      // exakt gleichem utm_source gefunden wurden – nur ein Hinweis.
    }
  }

  // Termine: eigener Strang, unabhängig von Leads/Tickets (siehe buildAppointments)
  const appointments = hasAppointments
    ? labelAppointmentSources(buildAppointments(appointmentRows, { leads, tickets, dimsFor }))
    : [];

  return {
    leads: records,
    appointments,
    overview,
    overviewByAdset: Object.fromEntries(overviewByAdset),
    warnings,
    counts: {
      leads: records.filter((r) => r.isLead).length,
      paidLeads: records.filter((r) => r.isLead && r.sourceType === 'paid').length,
      tickets: records.filter((r) => r.hasTicket).length,
      scored: records.filter((r) => r.hasTicket && r.quality).length,
      appointments: appointments.length,
      appointmentBookings: appointments.reduce((n, a) => n + a.bookings, 0),
    },
  };
}
