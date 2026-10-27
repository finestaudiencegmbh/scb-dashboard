import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { fetchAllSheets, isConfigured } from './sheets.js';
import { parseSheets } from './parser.js';
import { buildDataset } from './build.js';
import { loadScoringConfig, qualifiedTiersOf } from './scoring.js';
import { getSampleParsed } from './sample-data.js';
import { isSupermetricsConfigured, fetchFbInsights, aggregateFb } from './supermetrics.js';
import { isMetaConfigured, fetchMetaAll, diagnoseMeta, findInMeta, accountTargets, META_STEPS_PER_ACCOUNT } from './meta.js';
import { resolveAdIds } from './adid.js';
import { combineByAccount } from './accounts.js';
import { applyScope } from './scope.js';
import { isChatConfigured, buildContext, chat } from './chat.js';
import { loadProjectConfig, publicProjectConfig } from './project.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PROJECT = loadProjectConfig();
const PORT = process.env.PORT || 3000;
// Standard 15 Min: Ansehen/Tab-Wechsel/erneutes Öffnen kommt aus dem Cache und
// kostet keine Meta-Calls (schont das API-Rate-Limit). Der „Aktualisieren"-
// Button (refresh=1) umgeht den Cache und holt immer frische Daten.
const CACHE_TTL = (Number(process.env.CACHE_TTL_SECONDS) || 900) * 1000;

const app = express();
app.use(express.json());

// --- Optionaler Basic-Auth-Schutz -------------------------------------------
const AUTH_USER = process.env.DASHBOARD_USER;
const AUTH_PASS = process.env.DASHBOARD_PASSWORD;
if (AUTH_USER && AUTH_PASS) {
  app.use((req, res, next) => {
    // Health-Check muss ohne Login erreichbar sein (Render/Hoster prüfen ihn
    // ohne Zugangsdaten – sonst schlägt das Deployment fehl).
    if (req.path === '/api/health') return next();
    const hdr = req.headers.authorization || '';
    const [scheme, encoded] = hdr.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [u, p] = Buffer.from(encoded, 'base64').toString().split(':');
      if (u === AUTH_USER && p === AUTH_PASS) return next();
    }
    res.set('WWW-Authenticate', `Basic realm="${PROJECT.name}"`);
    return res.status(401).send('Authentifizierung erforderlich.');
  });
}

// --- Daten-Cache (je Zeitraum) ---------------------------------------------
const cache = new Map(); // key -> { at, payload }

// --- Fortschritt laufender Ladevorgänge (für den Ladebalken im Frontend) ---
// Je Zeitraum: { done, total, label, startedAt }. Der Balken bildet echte,
// abgeschlossene Abrufe ab – keine geschätzte Zeit.
const progress = new Map();
const inflight = new Map(); // gleicher Zeitraum parallel angefragt -> ein Ladevorgang

function startProgress(key, total) {
  const p = { done: 0, total, label: 'Starte…', startedAt: Date.now(), finished: false };
  progress.set(key, p);
  return {
    step: (label) => { p.done = Math.min(p.total - 1, p.done + 1); if (label) p.label = label; },
    finish: () => { p.done = p.total; p.label = 'Fertig'; p.finished = true; setTimeout(() => { if (progress.get(key) === p) progress.delete(key); }, 30000); },
  };
}

function loadDataset(opts = {}) {
  const key = `${opts.from || ''}|${opts.to || ''}`;
  const hit = cache.get(key);
  if (!opts.refresh && hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.payload);
  if (inflight.has(key)) return inflight.get(key);
  const run = buildPayload(opts).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

async function buildPayload({ from = '', to = '', refresh = false } = {}) {
  const key = `${from}|${to}`;
  const metaSteps = isMetaConfigured() ? accountTargets().length * META_STEPS_PER_ACCOUNT : 0;
  // Sheet + Meta-Abrufe + Berechnen
  const prog = startProgress(key, 1 + metaSteps + 1);
  try {
    return await buildPayloadInner({ from, to, key, prog, refresh });
  } finally {
    prog.finish();
  }
}

async function buildPayloadInner({ from, to, key, prog, refresh }) {
  const cfg = loadScoringConfig();
  const features = PROJECT.features;
  const qualifiedTiers = qualifiedTiersOf(cfg);
  let parsed;
  let source;
  if (isConfigured()) {
    const sheets = await fetchAllSheets();
    prog.step('Google Sheet geladen');
    parsed = parseSheets(sheets, PROJECT.sheet, features);
    source = 'google';
  } else {
    parsed = getSampleParsed(PROJECT);
    source = 'demo';
    prog.step('Demo-Daten geladen');
  }
  const dataset = buildDataset(parsed, cfg, features, PROJECT.sheet.utmRoles);

  // Facebook-Ads-Daten: bevorzugt direkt über die Meta Marketing API,
  // alternativ über Supermetrics. Fehler hier dürfen das Sheet-Dashboard
  // nicht blockieren. Der Zeitraum (from/to) wird an Meta durchgereicht.
  const range = from && to ? { since: from, until: to } : null;
  const metaOn = isMetaConfigured();
  const smOn = isSupermetricsConfigured();
  let fb = { configured: metaOn || smOn, provider: metaOn ? 'meta' : smOn ? 'supermetrics' : null, error: null, totals: null, byDim: null, rows: 0, hierarchy: null, daily: null };
  if (metaOn) {
    try {
      const all = await fetchMetaAll(range, (label) => prog.step(label), { fresh: refresh });
      // Sheet-Zeilen mit Ad-ID exakt auf die Meta-Anzeige legen (vor dem
      // Zeitraum-Filter, damit auch die Leadliste dieselben Namen zeigt).
      // Bewusst gegen ALLE Kampagnen, damit auch Leads aus Kampagnen außerhalb
      // des Projekt-Bereichs erkannt und gemeldet werden.
      const adIds = resolveAdIds(dataset.leads, all);
      // Projekt-Bereich: nur Kampagnen dieses Funnels zählen (Landingpage/Name)
      const scoped = applyScope(all, PROJECT.scope);
      const meta = scoped.meta;
      const agg = aggregateFb(meta.records);
      const excludedKeys = new Set(scoped.excluded.map((c) => `${c.account}::${c.campaign}`));
      const leadsOutside = dataset.leads.filter((l) => l.isLead !== false && l.adAccount && excludedKeys.has(`${l.adAccount}::${l.campaign}`)).length;
      // Leads für denselben Zeitraum, damit FB-Hierarchie & Leads konsistent sind
      const leadsInRange = filterLeadsByRange(dataset.leads, from, to);
      // Stunden-Raster, wenn genau ein Tag gewählt ist
      const hourlyDay = from && to && from === to ? from : null;
      // Jedes Werbekonto getrennt rechnen – nichts wird zwischen Konten vermischt
      const combined = combineByAccount(meta, leadsInRange, { hourlyDay, features, qualifiedTiers });
      fb = { configured: true, provider: 'meta', error: null, fetchedAt: new Date().toISOString(), ...agg, hierarchy: combined.hierarchy, daily: combined.daily, totals: combined.totals, nonLeadCampaigns: combined.nonLeadCampaigns, uocByDim: combined.uocByDim, dimMeta: combined.dimMeta, dailyByEntity: combined.dailyByEntity, intradayByEntity: combined.intradayByEntity, intradayDay: combined.intradayDay, accounts: all.accounts, adIds, unassigned: combined.unassigned, accountsRequested: all.accountsRequested, accountErrors: all.accountErrors, accountWarnings: all.accountWarnings, scope: { active: scoped.active, rules: PROJECT.scope || null, excluded: scoped.excluded, leadsOutside } };
    } catch (err) {
      console.error('Meta-Fehler:', err.message);
      fb.error = err.message;
    }
  } else if (smOn) {
    try {
      const records = await fetchFbInsights();
      const agg = aggregateFb(records);
      fb = { configured: true, provider: 'supermetrics', error: null, fetchedAt: new Date().toISOString(), ...agg };
    } catch (err) {
      console.error('Supermetrics-Fehler:', err.message);
      fb.error = err.message;
    }
  }

  prog.step('Kennzahlen berechnet');
  const payload = {
    source,
    fetchedAt: new Date().toISOString(),
    range: range || null,
    project: publicProjectConfig(PROJECT),
    scoring: features.hasQuality ? { weights: cfg.weights, tiers: cfg.tiers } : { weights: {}, tiers: [] },
    fb,
    ...dataset,
  };
  cache.set(key, { at: Date.now(), payload });
  return payload;
}

/** Begrenzt Leads auf [from,to] (YYYY-MM-DD, inklusive). Tagesdatum = UTC,
 *  passend zum im Sheet angezeigten +0000-Zeitstempel. */
function filterLeadsByRange(leads, from, to) {
  if (!from && !to) return leads;
  return leads.filter((l) => {
    const day = (l.wonAt || '').slice(0, 10);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

// --- API --------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, configured: isConfigured(), mode: isConfigured() ? 'google' : 'demo' });
});

// Projekt-Konfiguration (Branding/Flags) – das Frontend holt sie vor den Daten,
// damit Farbe, Logo und Titel sofort stimmen.
app.get('/api/config', (req, res) => {
  res.json(publicProjectConfig(PROJECT));
});

// Fortschritt des laufenden Ladevorgangs für einen Zeitraum (Ladebalken).
app.get('/api/progress', (req, res) => {
  const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const key = `${isYmd(req.query.from) ? req.query.from : ''}|${isYmd(req.query.to) ? req.query.to : ''}`;
  const p = progress.get(key);
  res.set('Cache-Control', 'no-store');
  if (!p) return res.json({ active: false });
  res.json({ active: !p.finished, done: p.done, total: p.total, label: p.label, elapsedMs: Date.now() - p.startedAt });
});

app.get('/api/data', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const from = isYmd(req.query.from) ? req.query.from : '';
    const to = isYmd(req.query.to) ? req.query.to : '';
    const payload = await loadDataset({ refresh, from, to });
    res.json(payload);
  } catch (err) {
    console.error('Fehler beim Laden der Daten:', err);
    res.status(500).json({ error: err.message, hint: 'Prüfe Service-Account & Freigabe des Sheets (siehe README).' });
  }
});

// Diagnose: wo steckt ein Creative/eine Ad in jeder Datenquelle?
// Aufruf: /api/debug/find?q=Video Ad #4
// Diagnose: jeden Meta-Abruf je Konto einzeln ausführen (ok/Fehler/Zeilen/Dauer).
// Aufruf: /api/debug/meta  oder  /api/debug/meta?from=2026-10-20&to=2026-10-26
app.get('/api/debug/meta', async (req, res) => {
  try {
    if (!isMetaConfigured()) return res.json({ error: 'Meta nicht konfiguriert (META_ACCESS_TOKEN / META_AD_ACCOUNT_ID).' });
    const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const range = isYmd(req.query.from) && isYmd(req.query.to) ? { since: req.query.from, until: req.query.to } : null;
    res.json(await diagnoseMeta(range));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/debug/find', async (req, res) => {
  try {
    const q = String(req.query.q || '').toLowerCase().trim();
    if (!q) return res.json({ error: 'Bitte ?q=... angeben, z. B. /api/debug/find?q=Video Ad #4' });
    const has = (s) => String(s ?? '').toLowerCase().includes(q);
    // Standard: dieser Monat (leicht); optional ?from=…&to=…
    const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const range = isYmd(req.query.from) && isYmd(req.query.to)
      ? { since: req.query.from, until: req.query.to }
      : { since: `${today.slice(0, 8)}01`, until: today };

    // Sheet-Leads: nur Sheet lesen, KEIN kompletter Dashboard-Abruf
    const leadGroups = {};
    let leadCount = 0;
    if (isConfigured()) {
      const parsed = parseSheets(await fetchAllSheets(), PROJECT.sheet, PROJECT.features);
      const ds = buildDataset(parsed, loadScoringConfig(), PROJECT.features, PROJECT.sheet.utmRoles);
      for (const l of ds.leads) {
        if (!(has(l.creative) || has(l.mediumRaw) || has(l.adset) || has(l.sourceRaw))) continue;
        leadCount += 1;
        const key = `${l.sourceType} | kampagne="${l.campaign}" | anzeigengruppe="${l.adset}" | creative="${l.creative}" | ad_id=${l.adId || '-'}`;
        leadGroups[key] = (leadGroups[key] || 0) + 1;
      }
    }

    const meta = isMetaConfigured() ? await findInMeta(range, has) : { insights: [], adList: [], errors: [] };
    res.json({
      suchbegriff: q,
      zeitraum: range,
      sheet_leads: { treffer: leadCount, gruppen: leadGroups },
      meta_insights: meta.insights,
      meta_adliste: meta.adList,
      meta_fehler: meta.errors,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chat/health', (req, res) => {
  res.json({ configured: isChatConfigured() });
});

app.post('/api/chat', async (req, res) => {
  try {
    if (!isChatConfigured()) {
      return res.status(503).json({ error: 'Chatbot nicht konfiguriert (ANTHROPIC_API_KEY fehlt).' });
    }
    const { messages, from = '', to = '' } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages fehlt.' });
    }
    const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const payload = await loadDataset({ from: isYmd(from) ? from : '', to: isYmd(to) ? to : '' });
    const leadsInRange = filterLeadsByRange(payload.leads, isYmd(from) ? from : '', isYmd(to) ? to : '');
    const context = buildContext(payload, leadsInRange, PROJECT.features, qualifiedTiersOf(loadScoringConfig()));
    const answer = await chat({ messages: messages.slice(-12), context });
    res.json({ answer });
  } catch (err) {
    console.error('Chat-Fehler:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- Statisches Frontend (Production-Build) ---------------------------------
const distDir = path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res
      .type('html')
      .send(`<h1>${PROJECT.name} – API läuft</h1><p>Frontend noch nicht gebaut. Im Dev: <code>npm run dev</code> und <a href="http://localhost:5173">localhost:5173</a> öffnen. Für Production: <code>npm run serve</code>.</p>`)
  );
}

app.listen(PORT, () => {
  const mode = isConfigured() ? 'Google Sheets (live)' : 'DEMO (synthetische Daten)';
  console.log(`\n  ${PROJECT.name} – Server läuft auf  http://localhost:${PORT}`);
  console.log(`  Datenquelle: ${mode}`);
  console.log(`  Features: Tickets ${PROJECT.features.hasTickets ? 'an' : 'aus'} · Lead-Qualität ${PROJECT.features.hasQuality ? 'an' : 'aus'}\n`);
});
