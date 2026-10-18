/**
 * Lädt die zentrale Projekt-Konfiguration (config/project.config.json) und
 * füllt fehlende Werte mit Defaults auf. Alles, was sich von Workshop zu
 * Workshop unterscheidet – Name, Branding, Feature-Flags, Sheet-Spalten –
 * kommt von hier. Siehe TEMPLATE.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SHEET_CONFIG } from './parser.js';
import { DEFAULT_UTM_ROLES } from './build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'project.config.json');

export const DEFAULT_PROJECT = {
  name: 'Lead-Dashboard',
  shortName: 'Dashboard',
  subtitle: 'Lead-Dashboard',
  slug: 'dashboard',
  branding: { accent: '#d0bb5a', logo: '/logo.svg' },
  features: { hasTickets: true, hasQuality: true },
  labels: { ticket: { one: 'Ticket', many: 'Tickets', short: 'Ticket' } },
  sheet: { ...DEFAULT_SHEET_CONFIG, utmRoles: DEFAULT_UTM_ROLES },
};

let cached = null;

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return normalize(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`project.config.json konnte nicht gelesen werden (${err.message}) – Defaults werden verwendet.`);
    }
    return normalize({});
  }
}

/** Merged die Datei über die Defaults und räumt Rundungsfehler in den Flags auf. */
function normalize(raw) {
  const sheet = raw.sheet || {};
  const cfg = {
    ...DEFAULT_PROJECT,
    ...raw,
    branding: { ...DEFAULT_PROJECT.branding, ...(raw.branding || {}) },
    features: { ...DEFAULT_PROJECT.features, ...(raw.features || {}) },
    labels: {
      ticket: { ...DEFAULT_PROJECT.labels.ticket, ...((raw.labels || {}).ticket || {}) },
    },
    sheet: {
      utmRoles: { ...DEFAULT_UTM_ROLES, ...(sheet.utmRoles || {}) },
      detect: sheet.detect || DEFAULT_SHEET_CONFIG.detect,
      columns: {
        leads: { ...DEFAULT_SHEET_CONFIG.columns.leads, ...((sheet.columns || {}).leads || {}) },
        tickets: { ...DEFAULT_SHEET_CONFIG.columns.tickets, ...((sheet.columns || {}).tickets || {}) },
        overview: { ...DEFAULT_SHEET_CONFIG.columns.overview, ...((sheet.columns || {}).overview || {}) },
      },
      answers: sheet.answers || DEFAULT_SHEET_CONFIG.answers,
    },
  };
  cfg.features.hasTickets = Boolean(cfg.features.hasTickets);
  cfg.features.hasQuality = Boolean(cfg.features.hasQuality);
  // Der Fragebogen hängt am Ticket-/Antworten-Tab des Sheets. Ohne Tickets gibt
  // es keine Antwortzeilen – also auch kein Scoring.
  if (!cfg.features.hasTickets && cfg.features.hasQuality) {
    console.warn('project.config.json: hasQuality ohne hasTickets ist nicht möglich (die Fragebogen-Antworten stecken im Ticket-Tab) – Lead-Qualität wird deaktiviert.');
    cfg.features.hasQuality = false;
  }
  // Ohne Fragebogen gibt es auch nichts anzuzeigen/zu filtern.
  if (!cfg.features.hasQuality) cfg.sheet.answers = {};
  return cfg;
}

/** Projekt-Konfiguration (gecacht; in der Entwicklung via reload() neu laden). */
export function loadProjectConfig() {
  if (!cached) cached = readConfig();
  return cached;
}

export function reloadProjectConfig() {
  cached = null;
  return loadProjectConfig();
}

/**
 * Der Teil der Konfiguration, den das Frontend braucht. Bewusst ohne die
 * Sheet-Spalten (interne Details, im Browser nutzlos) – aber MIT den
 * Antwort-Labels, weil die Lead-Detailansicht sie anzeigt.
 */
export function publicProjectConfig(cfg = loadProjectConfig()) {
  const answers = {};
  for (const [key, a] of Object.entries(cfg.sheet.answers || {})) {
    answers[key] = { label: a.label || key, filter: Boolean(a.filter), wide: Boolean(a.wide) };
  }
  return {
    name: cfg.name,
    shortName: cfg.shortName,
    subtitle: cfg.subtitle,
    slug: cfg.slug,
    branding: cfg.branding,
    features: cfg.features,
    labels: cfg.labels,
    answers,
  };
}
