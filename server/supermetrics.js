import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'supermetrics.json');

export function loadSupermetricsConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

export function isSupermetricsConfigured() {
  const cfg = safeConfig();
  return Boolean(cfg?.enabled && process.env.SUPERMETRICS_API_KEY);
}

function safeConfig() {
  try {
    return loadSupermetricsConfig();
  } catch {
    return null;
  }
}

const ymd = (d) => d.toISOString().slice(0, 10);

function buildQuery(cfg) {
  // Komplette Abfrage aus der .env hat Vorrang (1:1 aus dem Query-Builder)
  let q;
  if (process.env.SUPERMETRICS_QUERY_JSON) {
    q = JSON.parse(process.env.SUPERMETRICS_QUERY_JSON);
  } else {
    q = JSON.parse(JSON.stringify(cfg.query || {}));
  }
  if (process.env.SUPERMETRICS_DS_ACCOUNTS) {
    q.ds_accounts = process.env.SUPERMETRICS_DS_ACCOUNTS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (process.env.SUPERMETRICS_DS_USER) q.ds_user = process.env.SUPERMETRICS_DS_USER;

  if (!q.start_date && !q.date_range_type) {
    const end = new Date();
    const start = new Date(end.getTime() - (cfg.lookbackDays || 90) * 86400000);
    q.start_date = ymd(start);
    q.end_date = ymd(end);
  }
  if (cfg.maxRows && !q.max_rows) q.max_rows = cfg.maxRows;
  return q;
}

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Findet zu jeder Rolle den passenden Spaltenindex anhand des Anzeigenamens. */
function mapColumns(headers, roles) {
  const idx = {};
  const lowered = headers.map((h) => norm(h));
  for (const [role, names] of Object.entries(roles)) {
    let found = -1;
    // exakte Treffer bevorzugen, dann Teilstring
    for (const name of names) {
      const exact = lowered.indexOf(norm(name));
      if (exact !== -1) { found = exact; break; }
    }
    if (found === -1) {
      for (const name of names) {
        const part = lowered.findIndex((h) => h.includes(norm(name)));
        if (part !== -1) { found = part; break; }
      }
    }
    idx[role] = found;
  }
  return idx;
}

const toNum = (v) => {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Wandelt die Supermetrics-Antwort (data = [header, ...rows]) in normalisierte
 * Insight-Datensätze um. Exportiert (auch) für Tests.
 */
export function parseSupermetricsData(data, cfg) {
  if (!Array.isArray(data) || data.length === 0) return [];
  const noHeaders = cfg?.query?.settings?.no_headers;
  let headers;
  let rows;
  if (Array.isArray(data[0])) {
    if (noHeaders) {
      headers = (cfg.query.fields || []).map(String);
      rows = data;
    } else {
      headers = data[0].map(String);
      rows = data.slice(1);
    }
    const idx = mapColumns(headers, cfg.columnRoles || {});
    const at = (row, role) => (idx[role] >= 0 ? row[idx[role]] : '');
    return rows.map((row) => ({
      campaign: String(at(row, 'campaign') ?? '').trim(),
      adset: String(at(row, 'adset') ?? '').trim(),
      creative: String(at(row, 'creative') ?? '').trim(),
      placement: String(at(row, 'placement') ?? '').trim(),
      platform: String(at(row, 'platform') ?? '').trim(),
      date: String(at(row, 'date') ?? '').trim(),
      spend: toNum(at(row, 'spend')),
      impressions: toNum(at(row, 'impressions')),
      clicks: toNum(at(row, 'clicks')),
      reach: toNum(at(row, 'reach')),
    }));
  }
  // Fallback: data als Array von Objekten
  return data.map((o) => ({
    campaign: String(o.Campaign_name ?? o.campaign ?? '').trim(),
    adset: String(o.Adset_name ?? o.adset ?? '').trim(),
    creative: String(o.Ad_name ?? o.creative ?? '').trim(),
    placement: String(o.placement ?? '').trim(),
    platform: String(o.publisher_platform ?? '').trim(),
    date: String(o.date ?? o.Date ?? '').trim(),
    spend: toNum(o.cost ?? o.spend),
    impressions: toNum(o.impressions),
    clicks: toNum(o.clicks),
    reach: toNum(o.reach),
  }));
}

/** Holt die FB-Insights live von der Supermetrics-API. */
export async function fetchFbInsights() {
  if (!isSupermetricsConfigured()) return null;
  const cfg = loadSupermetricsConfig();
  const q = buildQuery(cfg);
  const apiKey = process.env.SUPERMETRICS_API_KEY;

  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(q),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Supermetrics: unerwartete Antwort (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || json.error) {
    const msg = json?.error?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(`Supermetrics-Fehler: ${msg}`);
  }
  const data = json.data ?? json.results ?? [];
  return parseSupermetricsData(data, cfg);
}

/** Verdichtet Insight-Datensätze je Dimension (Schlüssel normalisiert). */
export function aggregateFb(records) {
  const dims = { campaign: {}, adset: {}, creative: {}, placement: {} };
  const totals = { spend: 0, impressions: 0, clicks: 0 };
  const add = (bucket, key, r) => {
    const k = norm(key);
    if (!k) return;
    if (!bucket[k]) bucket[k] = { spend: 0, impressions: 0, clicks: 0 };
    bucket[k].spend += r.spend;
    bucket[k].impressions += r.impressions;
    bucket[k].clicks += r.clicks;
  };
  for (const r of records || []) {
    add(dims.campaign, r.campaign, r);
    add(dims.adset, r.adset, r);
    add(dims.creative, r.creative, r);
    // Placement-Schlüssel: Plattform + Position zusammen, falls vorhanden
    const placeKey = [r.platform, r.placement].filter(Boolean).join(' ') || r.placement;
    add(dims.placement, placeKey, r);
    totals.spend += r.spend;
    totals.impressions += r.impressions;
    totals.clicks += r.clicks;
  }
  return { byDim: dims, totals, rows: (records || []).length };
}

export const _internal = { mapColumns, toNum, norm, buildQuery };
