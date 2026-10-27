/**
 * Facebook/Meta Marketing API – holt Ad-Insights direkt über den Graph-API-
 * Access-Token. Liefert:
 *   - records:  Placement-Ebene (Ad × publisher_platform × platform_position)
 *               für die bestehende Dimensions-Aggregation (aggregateFb)
 *   - entities: Kennzahlen je Ad inkl. IDs + Hierarchie + INDIVIDUELL
 *               ausgehende Klicks/CTR/Klickpreis (unique_outbound_*)
 *   - daily:    täglicher Ad-Spend/Impressionen/Klicks (für den Zeitgraphen)
 *   - status:   effective_status je Kampagne und Anzeigengruppe (aktiv?)
 *
 * Benötigte .env:
 *   META_ACCESS_TOKEN   – Access-Token mit ads_read
 *   META_AD_ACCOUNT_ID  – Werbekonto, z. B. act_367913946654819 (mehrere kommagetrennt)
 * Weitere Konten mit EIGENEM Token (z. B. aus einem anderen Business Portfolio):
 *   META_ACCESS_TOKEN_2 + META_AD_ACCOUNT_ID_2, _3, … bis _9. Fehlt das Token
 *   eines Paares, gilt META_ACCESS_TOKEN.
 * Optional:
 *   META_API_VERSION    – Graph-API-Version (Default v21.0)
 *   META_LOOKBACK_DAYS  – Zeitfenster in Tagen (Default 90)
 */

const GRAPH = 'https://graph.facebook.com';

export function isMetaConfigured() {
  return accountTargets().length > 0;
}

const ymd = (d) => d.toISOString().slice(0, 10);

function normAccount(id) {
  const s = String(id || '').trim();
  return s.startsWith('act_') ? s : `act_${s}`;
}

/** Position lesbar machen (z. B. "feed", "instagram_stories" -> "instagram stories"). */
function positionLabel(position) {
  return String(position || '').trim().replace(/_/g, ' ');
}

/** Meta liefert action-basierte Felder als Array [{action_type, value}]. Summe der Werte. */
function actionSum(field, type = 'outbound_click') {
  if (!Array.isArray(field)) return 0;
  let sum = 0;
  for (const a of field) {
    if (!type || a.action_type === type) sum += Number(a.value) || 0;
  }
  return sum;
}

function cfg() {
  return {
    token: process.env.META_ACCESS_TOKEN,
    account: normAccount(accountIds()[0] || ''),
    version: process.env.META_API_VERSION || 'v21.0',
    lookback: Number(process.env.META_LOOKBACK_DAYS) || 90,
  };
}

/** Liest ein ODER mehrere Werbekonten aus META_AD_ACCOUNT_ID (kommagetrennt). */
function accountIds(value = process.env.META_AD_ACCOUNT_ID) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normAccount);
}

/**
 * Alle Werbekonten mit dem jeweils passenden Token:
 *   META_AD_ACCOUNT_ID   (+ META_ACCESS_TOKEN)
 *   META_AD_ACCOUNT_ID_2 (+ META_ACCESS_TOKEN_2, sonst META_ACCESS_TOKEN) … bis _9
 * Ein Konto, das mehrfach eingetragen ist, wird nur einmal abgefragt.
 */
export function accountTargets(env = process.env) {
  const targets = [];
  const seen = new Set();
  for (const suffix of ['', ...Array.from({ length: 8 }, (_, i) => `_${i + 2}`)]) {
    const token = env[`META_ACCESS_TOKEN${suffix}`] || env.META_ACCESS_TOKEN;
    if (!token) continue;
    for (const account of accountIds(env[`META_AD_ACCOUNT_ID${suffix}`])) {
      if (seen.has(account)) continue;
      seen.add(account);
      targets.push({ account, token });
    }
  }
  return targets;
}

function dateRange(lookback) {
  const end = new Date();
  const start = new Date(end.getTime() - lookback * 86400000);
  return { since: ymd(start), until: ymd(end) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wiederholbare Meta-Fehler: Rate-Limits (4 = App, 17 = User, 613 = Custom) UND
// transiente Serverfehler, die Meta selbst zum erneuten Versuch markiert
// (1 = unknown, 2 = "unexpected error, please retry your request later").
const RATE_LIMIT_CODES = new Set([1, 2, 4, 17, 613, 80000, 80004]);

/** Generischer paginierter GET gegen die Graph API, mit Retry bei Rate-Limit
 * UND bei Netzwerkfehlern ("fetch failed", Verbindungsabbruch, Timeout). */
// Seiten-Obergrenze je Abruf (à 500 Zeilen). Wird sie erreicht, ist die Liste
// unvollständig – das wird als Fehler gemeldet statt still abgeschnitten.
const MAX_PAGES = 400;

async function graphGet(url, { attempts = 4 } = {}) {
  const out = [];
  let next = url;
  let guard = 0;
  while (next && guard < MAX_PAGES) {
    guard += 1;
    let json = null;
    // bis zu 4 Versuche – bei Rate-Limit (Code 4 etc.) UND bei Netzwerkfehlern,
    // mit ansteigender Wartezeit. So überstehen wir transiente Abbrüche.
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await fetch(next);
        json = await res.json().catch(() => null);
        if (!json) throw new Error(`Meta: unerwartete Antwort (HTTP ${res.status})`);
        if (json.error && RATE_LIMIT_CODES.has(json.error.code)) {
          if (attempt < attempts - 1) { await sleep(2000 * (attempt + 1)); continue; }
        }
        break; // Erfolg oder nicht-retrybarer Meta-Fehler
      } catch (err) {
        // Netzwerk-/Parsing-Fehler -> erneut versuchen, sonst durchreichen
        if (attempt < attempts - 1) { await sleep(1500 * (attempt + 1)); json = null; continue; }
        throw err;
      }
    }
    if (json.error) {
      const e = json.error;
      throw new Error(`Meta-Fehler: ${e.message}${e.code ? ` (Code ${e.code})` : ''}`);
    }
    for (const row of json.data || []) out.push(row);
    next = json.paging?.next || null;
  }
  if (next) throw new Error(`Meta: mehr als ${MAX_PAGES * 500} Zeilen – Zeitraum verkleinern`);
  return out;
}

function insightsUrl({ account, version, token }, extra) {
  const params = new URLSearchParams({ access_token: token, limit: '500', ...extra });
  return `${GRAPH}/${version}/${account}/insights?${params.toString()}`;
}

/** Placement-Ebene (für die Dimensions-Tabellen Kampagne/Anzeigengruppe/Creative/Placement). */
async function fetchPlacementRecords(c, range) {
  const rows = await graphGet(
    insightsUrl(c, {
      level: 'ad',
      fields: 'campaign_name,adset_name,ad_name,spend,impressions,clicks,reach',
      breakdowns: 'publisher_platform,platform_position',
      time_range: JSON.stringify(range),
    })
  );
  return rows.map((r) => ({
    campaign: String(r.campaign_name ?? '').trim(),
    adset: String(r.adset_name ?? '').trim(),
    creative: String(r.ad_name ?? '').trim(),
    platform: String(r.publisher_platform ?? '').trim(),
    placement: positionLabel(r.platform_position),
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    reach: Number(r.reach) || 0,
  }));
}

/** Kennzahlen je Ad inkl. IDs und individuell ausgehender Metriken. */
async function fetchEntities(c, range) {
  const rows = await graphGet(
    insightsUrl(c, {
      level: 'ad',
      fields:
        'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,cpm,unique_outbound_clicks,unique_outbound_clicks_ctr,cost_per_unique_outbound_click',
      time_range: JSON.stringify(range),
      time_increment: 'all_days',
    })
  );
  return rows.map((r) => ({
    campaignId: r.campaign_id,
    campaign: String(r.campaign_name ?? '').trim(),
    adsetId: r.adset_id,
    adset: String(r.adset_name ?? '').trim(),
    adId: r.ad_id,
    creative: String(r.ad_name ?? '').trim(),
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    cpm: Number(r.cpm) || 0,
    // INDIVIDUELL ausgehende Klicks (unique_outbound_clicks)
    uniqueOutboundClicks: actionSum(r.unique_outbound_clicks),
    uniqueOutboundCtr: actionSum(r.unique_outbound_clicks_ctr), // in % (action-Wert)
    costPerUniqueOutboundClick: actionSum(r.cost_per_unique_outbound_click),
  }));
}

/** Täglicher Spend/Impressionen/Klicks (Konto-Ebene) für den Zeitgraphen. */
async function fetchDaily(c, range) {
  const rows = await graphGet(
    insightsUrl(c, {
      level: 'account',
      fields: 'spend,impressions,clicks',
      time_range: JSON.stringify(range),
      time_increment: '1',
    })
  );
  return rows
    .map((r) => ({
      date: r.date_start,
      spend: Number(r.spend) || 0,
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Tägliche Kennzahlen JE WERBEANZEIGE inkl. Plattform-Split – Basis für die
 * "Grafik"-Ansicht (Zeitreihen je Kampagne/Anzeigengruppe/Creative mit
 * überlagerbaren KPIs). time_increment '1' = pro Tag, breakdowns =
 * publisher_platform (Facebook/Instagram/…) für den Ad-Spend pro Plattform.
 */
// Tagesdaten je Anzeige × Plattform werden schnell riesig (Anzeigen × Tage ×
// Plattformen). Meta bricht solche Abfragen mit Code 1 ab ("unknown error" /
// "reduce the amount of data"). Deshalb: in 7-Tage-Fenstern abfragen, bei
// Code 1/2 das Fenster halbieren (bis 1 Tag), höchstens 3 Fenster parallel.
// Abgeschlossene Fenster (Ende vor gestern) werden 12 h gemerkt.
const DAILY_WINDOW_DAYS = 7;
const DAILY_CACHE_TTL = 12 * 60 * 60 * 1000;
const dailyCache = new Map(); // `${account}|${since}|${until}` -> { at, rows }

const addDays = (ymdStr, n) => {
  const d = new Date(`${ymdStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000) + 1;

/** Zeitraum in Fenster zu je `size` Tagen zerlegen. */
export function splitRange({ since, until }, size = DAILY_WINDOW_DAYS) {
  const out = [];
  for (let s = since; s <= until; s = addDays(s, size)) {
    const e = addDays(s, size - 1);
    out.push({ since: s, until: e < until ? e : until });
  }
  return out;
}

async function fetchDailyWindow(c, win) {
  const key = `${c.account}|${win.since}|${win.until}`;
  const hit = dailyCache.get(key);
  if (hit && Date.now() - hit.at < DAILY_CACHE_TTL) return hit.rows;
  let raw;
  try {
    raw = await graphGet(
      insightsUrl(c, {
        level: 'ad',
        fields: 'campaign_name,adset_name,ad_name,spend,impressions,clicks,unique_outbound_clicks',
        breakdowns: 'publisher_platform',
        time_range: JSON.stringify(win),
        time_increment: '1',
      }),
      // nicht wiederholen: bei "zu schwer" ist Halbieren der bessere zweite Versuch
      { attempts: 1 }
    );
  } catch (err) {
    const days = daysBetween(win.since, win.until);
    if (/\(Code (1|2)\)/.test(err.message) && days > 1) {
      const half = Math.ceil(days / 2);
      const first = { since: win.since, until: addDays(win.since, half - 1) };
      const second = { since: addDays(win.since, half), until: win.until };
      const rows = [...(await fetchDailyWindow(c, first)), ...(await fetchDailyWindow(c, second))];
      if (win.until < addDays(ymd(new Date()), -1)) dailyCache.set(key, { at: Date.now(), rows });
      return rows;
    }
    throw err;
  }
  const rows = mapDailyRows(raw);
  // Nur abgeschlossene Fenster merken – die letzten Tage ändern sich noch
  if (win.until < addDays(ymd(new Date()), -1)) dailyCache.set(key, { at: Date.now(), rows });
  return rows;
}

async function fetchDailyEntities(c, range) {
  const windows = splitRange(range);
  const results = new Array(windows.length);
  let next = 0;
  const worker = async () => {
    while (next < windows.length) {
      const i = next++;
      results[i] = await fetchDailyWindow(c, windows[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, windows.length) }, worker));
  return results.flat();
}

function mapDailyRows(rows) {
  return rows.map((r) => ({
    date: r.date_start,
    campaign: String(r.campaign_name ?? '').trim(),
    adset: String(r.adset_name ?? '').trim(),
    creative: String(r.ad_name ?? '').trim(),
    platform: String(r.publisher_platform ?? '').trim(),
    spend: Number(r.spend) || 0,
    impressions: Number(r.impressions) || 0,
    clicks: Number(r.clicks) || 0,
    uoc: actionSum(r.unique_outbound_clicks),
  }));
}

/**
 * Ziel-URLs (Landingpages) je Anzeige aus dem Creative. Meta legt die URL je
 * nach Anzeigentyp an verschiedenen Stellen ab (link_data, video_data.call_to_action,
 * asset_feed_spec.link_urls, link_url …) – daher werden alle http(s)-Werte im
 * Creative eingesammelt, ohne Bild-/Video-Adressen von Facebook/Instagram.
 * Ergebnis: Map Ad-ID -> [URL, …]
 */
// Nur die Felder, in denen Meta die Ziel-URL ablegt – das komplette Creative
// (object_story_spec mit Texten, Bildern, Videos …) ist Meta schnell "zu viel".
const URL_FIELDS = 'creative{link_url,object_url,template_url,'
  + 'object_story_spec{link_data{link,child_attachments{link}},video_data{call_to_action{value{link}}},template_data{link}},'
  + 'asset_feed_spec{link_urls{website_url}}}';
// Ziel-URLs ändern sich praktisch nie -> 6 h merken, spart Abrufe bei jedem "Aktualisieren"
const URL_TTL = 6 * 60 * 60 * 1000;
const urlCache = new Map(); // Ad-ID -> { at, urls }

/** Einzelner Graph-Abruf ohne Paging (ohne data-Paging). Netzwerkfehler 1x wiederholen. */
async function graphObject(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      const json = await res.json().catch(() => null);
      if (!json) throw new Error(`Meta: unerwartete Antwort (HTTP ${res.status})`);
      if (json.error) {
        const err = new Error(`Meta-Fehler: ${json.error.message}${json.error.code ? ` (Code ${json.error.code})` : ''}`);
        err.metaCode = json.error.code;
        throw err;
      }
      return json;
    } catch (err) {
      if (err.metaCode != null || attempt === 1) throw err;
      await sleep(1500);
    }
  }
  return {};
}

/**
 * Ziel-URLs NUR für die übergebenen Anzeigen (die im Zeitraum Spend hatten).
 *
 * Weg 1: Anzeigen des Kontos, gefiltert nach Ad-ID, in 50er-Paketen. Meldet
 *        Meta "zu viel Daten" (Code 1/2), wird das Paket halbiert.
 * Weg 2: Lehnt Meta den Filter ab, alle Anzeigen des Kontos seitenweise (je
 *        100, nur URL-Felder) – wenige Abrufe, schont das Abruf-Limit.
 * Weg 3: Was danach noch fehlt, einzeln über /{ad-id} (höchstens 20).
 * (Der früher genutzte Parameter ?ids= ist ab Graph-API v26 abgeschaltet.)
 */
async function fetchAdUrls(c, adIds) {
  const now = Date.now();
  const ids = [...new Set((adIds || []).map(String).filter(Boolean))];
  const missing = ids.filter((id) => !(urlCache.get(id)?.at > now - URL_TTL));
  const remember = (id, creative) => urlCache.set(id, { at: now, urls: collectUrls(creative) });

  let rest = missing;
  try {
    let size = 50;
    for (let i = 0; i < missing.length;) {
      const chunk = missing.slice(i, i + size);
      const filtering = JSON.stringify([{ field: 'id', operator: 'IN', value: chunk }]);
      const url = `${GRAPH}/${c.version}/${c.account}/ads?fields=${encodeURIComponent(`id,${URL_FIELDS}`)}`
        + `&filtering=${encodeURIComponent(filtering)}&limit=${size}&access_token=${c.token}`;
      try {
        const json = await graphObject(url);
        for (const row of json.data || []) remember(String(row.id), row.creative);
        // Anzeigen, die der Filter nicht zurückgab (z. B. gelöscht): leer merken
        for (const id of chunk) if (!urlCache.has(id) || urlCache.get(id).at !== now) remember(id, null);
        i += chunk.length;
        rest = missing.slice(i);
      } catch (err) {
        if ((err.metaCode === 1 || err.metaCode === 2) && size > 1) { size = Math.max(1, Math.floor(size / 2)); continue; }
        throw err;
      }
    }
  } catch (err) {
    console.warn(`Meta-Konto ${c.account}: Ad-Filter abgelehnt (${err.message}) – lese Anzeigen seitenweise`);
    // Weg 2: alle Anzeigen des Kontos seitenweise (je 100) mit nur den URL-Feldern –
    // wenige Abrufe statt einem je Anzeige (schont das Abruf-Limit, Code 17)
    const wanted = new Set(rest);
    const rows = await graphGetAdaptive((n) => `${GRAPH}/${c.version}/${c.account}/ads?fields=${encodeURIComponent(`id,${URL_FIELDS}`)}&limit=${n}&access_token=${c.token}`, 100);
    for (const row of rows) {
      if (wanted.delete(String(row.id))) remember(String(row.id), row.creative);
    }
    // Weg 3: was dann noch fehlt (z. B. gelöschte Anzeigen) einzeln, aber höchstens 20
    const queue = [...wanted].slice(0, 20);
    for (const id of [...wanted].slice(20)) remember(id, null);
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift();
        const json = await graphObject(`${GRAPH}/${c.version}/${id}?fields=${encodeURIComponent(URL_FIELDS)}&access_token=${c.token}`);
        remember(id, json.creative);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
  }
  return new Map(ids.map((id) => [id, urlCache.get(id)?.urls || []]));
}

const MEDIA_HOST = /(fbcdn\.net|facebook\.com|fb\.me|fb\.com|instagram\.com|cdninstagram\.com|whatsapp\.com)/i;
export function collectUrls(node, found = new Set()) {
  if (node == null) return [...found];
  if (typeof node === 'string') {
    if (/^https?:\/\//i.test(node) && !MEDIA_HOST.test(node)) found.add(node.trim());
  } else if (Array.isArray(node)) {
    for (const x of node) collectUrls(x, found);
  } else if (typeof node === 'object') {
    for (const v of Object.values(node)) collectUrls(v, found);
  }
  return [...found];
}

/** Anzeigename des Werbekontos (für die optische Trennung mehrerer Accounts). */
async function fetchAccountName(c) {
  const url = `${GRAPH}/${c.version}/${c.account}?fields=name&access_token=${c.token}`;
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  return (json && json.name) ? String(json.name).trim() : c.account;
}

/** effective_status je Kampagne (+objective), Anzeigengruppe und Werbeanzeige. */
/**
 * Liste abrufen und bei "zu viel Daten" (Code 1/2) mit halber Seitengröße
 * wiederholen. build(limit) liefert die URL.
 */
async function graphGetAdaptive(build, limit = 200) {
  for (;;) {
    try {
      return await graphGet(build(limit));
    } catch (err) {
      if (/\(Code (1|2)\)/.test(err.message) && limit > 25) { limit = Math.floor(limit / 2); continue; }
      throw err;
    }
  }
}

/**
 * effective_status je Kampagne (+objective), Anzeigengruppe und Werbeanzeige.
 * Die drei Listen werden UNABHÄNGIG geholt: scheitert eine, bleiben die anderen
 * erhalten, und der Grund landet in warn() statt still zu verschwinden.
 * Ohne Status kann das Dashboard nicht zwischen aktiv und pausiert
 * unterscheiden ("Nur aktive" blendet dann nichts aus).
 */
// Status-Listen: 10 Min frisch halten (spart Abrufe bei jedem "Aktualisieren"),
// bei Fehlern (z. B. Abruf-Limit, Code 17) bis zu 24 h den letzten guten Stand nutzen.
const STATUS_FRESH = 10 * 60 * 1000;
const STATUS_STALE_MAX = 24 * 60 * 60 * 1000;
const statusCache = new Map(); // `${account}|${label}` -> { at, rows }

async function fetchStatus(c, warn = () => {}, { fresh = false } = {}) {
  const base = `${GRAPH}/${c.version}/${c.account}`;
  const tok = `access_token=${c.token}`;
  const get = async (label, build) => {
    const key = `${c.account}|${label}`;
    const hit = statusCache.get(key);
    // 'Aktualisieren' (fresh) holt immer neu – sonst fehlen frisch angelegte Anzeigen
    if (!fresh && hit && Date.now() - hit.at < STATUS_FRESH) return hit.rows;
    try {
      const rows = await graphGetAdaptive(build);
      statusCache.set(key, { at: Date.now(), rows });
      return rows;
    } catch (err) {
      if (hit && Date.now() - hit.at < STATUS_STALE_MAX) {
        const min = Math.round((Date.now() - hit.at) / 60000);
        warn(`Status der ${label} von vor ${min} Min (aktuell nicht lesbar: ${err.message})`);
        return hit.rows;
      }
      warn(`Status der ${label} nicht lesbar (${err.message})`);
      return [];
    }
  };
  const [camps, adsets, ads] = await Promise.all([
    get('Kampagnen', (n) => `${base}/campaigns?fields=id,name,effective_status,objective&limit=${n}&${tok}`),
    get('Anzeigengruppen', (n) => `${base}/adsets?fields=id,name,effective_status,campaign_id&limit=${n}&${tok}`),
    // schlank: nur IDs statt verschachtelter adset{name}/campaign{name}; die
    // Namen kommen über die beiden Listen oben
    get('Werbeanzeigen', (n) => `${base}/ads?fields=id,name,effective_status,adset_id,campaign_id&limit=${n}&${tok}`),
  ]);
  const isActive = (s) => s === 'ACTIVE';
  const campaignName = new Map(camps.map((x) => [String(x.id), String(x.name).trim()]));
  const adsetName = new Map(adsets.map((x) => [String(x.id), String(x.name).trim()]));
  const campaignStatus = {};
  for (const x of camps) {
    campaignStatus[String(x.name).trim()] = { status: x.effective_status, active: isActive(x.effective_status), objective: x.objective || null };
  }
  const adsetStatus = {};
  for (const x of adsets) adsetStatus[String(x.name).trim()] = { status: x.effective_status, active: isActive(x.effective_status) };
  const adStatus = {};
  const adList = [];
  for (const x of ads) {
    const name = String(x.name).trim();
    adStatus[name] = { status: x.effective_status, active: isActive(x.effective_status) };
    adList.push({
      id: x.id, name, active: isActive(x.effective_status), status: x.effective_status,
      campaign: campaignName.get(String(x.campaign_id)) || '', adset: adsetName.get(String(x.adset_id)) || '',
    });
  }
  return { campaignStatus, adsetStatus, adStatus, adList };
}

/** Holt alle Meta-Daten in einem Rutsch – über EIN oder MEHRERE Werbekonten
 * (META_AD_ACCOUNT_ID kommagetrennt). Die Ergebnisse werden zusammengeführt:
 * Records/Entities/Tages-Entitäten aneinandergehängt, Konto-Tagesspend je Datum
 * summiert, Status-Maps gemerged. Optional mit explizitem Zeitraum. */
/** Anzahl der Abrufe je Werbekonto in fetchMetaAll (für die Fortschrittsanzeige). */
export const META_STEPS_PER_ACCOUNT = 7;

export async function fetchMetaAll(customRange, onStep = () => {}, { fresh = false } = {}) {
  if (!isMetaConfigured()) return null;
  const base = cfg();
  const range = customRange?.since && customRange?.until ? customRange : dateRange(base.lookback);
  const targets = accountTargets();
  // Meldet jeden fertigen (auch gescheiterten) Abruf an die Fortschrittsanzeige
  const step = (n, label) => (p) => p.finally(() => onStep(`Meta Konto ${n}/${targets.length}: ${label}`));

  // Pro Konto alles parallel holen. Schlägt EIN Konto fehl, wird es übersprungen
  // (Warnung im Log), damit die übrigen Konten trotzdem angezeigt werden.
  const accountErrors = [];
  const accountWarnings = [];
  const perAccount = (await Promise.all(
    targets.map(async ({ account, token }, i) => {
      const tick = (label, p) => step(i + 1, label)(p);
      try {
        const c = { ...base, account, token };
        const [records, entities, daily, dailyEntities, status, name] = await Promise.all([
          tick('Placements', fetchPlacementRecords(c, range)),
          tick('Kennzahlen', fetchEntities(c, range)),
          tick('Tagesspend', fetchDaily(c, range)),
          // Optional für die Grafik je Kampagne/Anzeige. Scheitert der Abruf, läuft
          // der Rest weiter – der Grund wird aber gemeldet (accountWarnings),
          // sonst zeigt die Grafik stillschweigend 0 € Spend.
          tick('Tagesdaten je Anzeige', fetchDailyEntities(c, range).catch((err) => {
            console.error(`Meta-Konto ${account}: Tagesdaten je Anzeige fehlen:`, err.message);
            accountWarnings.push(`${account}: Tagesdaten für die Grafik fehlen (${err.message})`);
            return [];
          })),
          tick('Status', fetchStatus(c, (msg) => {
            console.error(`Meta-Konto ${account}: ${msg}`);
            accountWarnings.push(`${account}: ${msg}`);
          }, { fresh })),
          tick('Kontoname', fetchAccountName(c).catch(() => account)),
        ]);
        // Landingpages je Anzeige (für den Projekt-Bereich, server/scope.js) –
        // nur für Anzeigen mit Spend im Zeitraum, daher nach den Insights
        const adUrls = await tick('Landingpages', fetchAdUrls(c, entities.map((e) => e.adId))).catch((err) => {
          console.error(`Meta-Konto ${account}: Landingpages der Anzeigen nicht lesbar:`, err.message);
          accountWarnings.push(`${account}: Landingpages der Anzeigen nicht lesbar (${err.message})`);
          return null;
        });
        // Entities mit ihrem Werbekonto markieren (für die optische Trennung)
        return {
          account, name, records, daily, status,
          entities: entities.map((e) => ({ ...e, account })),
          dailyEntities: dailyEntities.map((e) => ({ ...e, account })),
          adList: (status.adList || []).map((x) => ({ ...x, account, urls: adUrls ? (adUrls.get(String(x.id)) || []) : null })),
          adUrls: adUrls ? Object.fromEntries(adUrls) : null, // Ad-ID -> [URL]
        };
      } catch (err) {
        console.error(`Meta-Konto ${account} konnte nicht geladen werden:`, err.message);
        accountErrors.push(`${account}: ${err.message}`);
        return null;
      }
    })
  )).filter(Boolean);

  if (perAccount.length === 0) {
    // Konkreten Grund mitgeben (z. B. Code 17 = Rate-Limit, Code 190 = Token abgelaufen)
    throw new Error(`Meta: kein Werbekonto geladen – ${accountErrors.join(' | ') || 'Netzwerk/Token prüfen'}`);
  }

  // Zusammenführen
  const records = perAccount.flatMap((a) => a.records);
  const entities = perAccount.flatMap((a) => a.entities);
  const dailyEntities = perAccount.flatMap((a) => a.dailyEntities);

  // Konto-Tagesspend je Datum summieren (über alle Konten)
  const dailyMap = new Map();
  for (const a of perAccount) {
    for (const d of a.daily) {
      const e = dailyMap.get(d.date) || { date: d.date, spend: 0, impressions: 0, clicks: 0 };
      e.spend += d.spend || 0;
      e.impressions += d.impressions || 0;
      e.clicks += d.clicks || 0;
      dailyMap.set(d.date, e);
    }
  }
  const daily = [...dailyMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  // Status-Maps mergen
  const campaignStatus = {}, adsetStatus = {}, adStatus = {}, adList = [];
  for (const a of perAccount) {
    // Gleichnamige Einträge in mehreren Konten: aktiv gewinnt. Sonst würde das
    // zuletzt geladene Konto (z. B. pausiert) eine laufende Kampagne überdecken.
    mergeStatus(campaignStatus, a.status.campaignStatus);
    mergeStatus(adsetStatus, a.status.adsetStatus);
    mergeStatus(adStatus, a.status.adStatus);
    adList.push(...a.adList);
  }

  const accounts = perAccount.map((a) => ({ id: a.account, name: a.name }));
  return {
    records, entities, daily, dailyEntities, campaignStatus, adsetStatus, adStatus, adList, range, accounts,
    // Je Konto getrennt – für die Konto-saubere Auswertung (server/accounts.js)
    byAccount: perAccount.map((a) => ({
      account: a.account, name: a.name, entities: a.entities, dailyEntities: a.dailyEntities, daily: a.daily, adList: a.adList, adUrls: a.adUrls,
      records: a.records.map((r) => ({ ...r, account: a.account })),
      campaignStatus: a.status.campaignStatus || {}, adsetStatus: a.status.adsetStatus || {}, adStatus: a.status.adStatus || {},
    })),
    // Diagnose: wie viele Konten waren angefragt, welche scheiterten?
    accountsRequested: targets.length,
    accountWarnings,
    accountErrors,
  };
}

/** Status-Map zusammenführen; bei gleichem Namen gewinnt der aktive Eintrag. */
function mergeStatus(target, source = {}) {
  for (const [name, st] of Object.entries(source || {})) {
    const prev = target[name];
    if (!prev || (!prev.active && st.active)) target[name] = st;
  }
  return target;
}

/**
 * Diagnose: führt JEDEN Meta-Abruf für jedes Konto einzeln aus und meldet
 * je Schritt ok/Fehler, Zeilen und Dauer – ohne etwas zu verschlucken. Für
 * /api/debug/meta, damit alle Probleme auf einmal sichtbar werden.
 */
export async function diagnoseMeta(customRange) {
  const base = cfg();
  const range = customRange?.since && customRange?.until ? customRange : dateRange(base.lookback);
  const out = { version: base.version, range, accounts: [] };
  for (const { account, token } of accountTargets()) {
    const c = { ...base, account, token };
    const steps = [];
    const run = async (step, fn, count = (r) => (Array.isArray(r) ? r.length : r?.size ?? null)) => {
      const t0 = Date.now();
      try {
        const r = await fn();
        steps.push({ step, ok: true, rows: count(r), ms: Date.now() - t0 });
        return r;
      } catch (err) {
        steps.push({ step, ok: false, error: err.message, ms: Date.now() - t0 });
        return null;
      }
    };
    const name = await run('Kontoname', () => fetchAccountName(c), () => null);
    const entities = await run('Kennzahlen je Anzeige', () => fetchEntities(c, range));
    await run('Placements', () => fetchPlacementRecords(c, range));
    await run('Tagesspend Konto', () => fetchDaily(c, range));
    await run('Tagesdaten je Anzeige (Grafik)', () => fetchDailyEntities(c, range));
    const statusWarnings = [];
    await run('Status (Kampagnen/Anzeigengruppen/Anzeigen)', async () => {
      const st = await fetchStatus(c, (m) => statusWarnings.push(m));
      if (statusWarnings.length) throw new Error(statusWarnings.join(' | '));
      return st.adList;
    });
    const ids = (entities || []).map((e) => e.adId);
    const urls = await run('Landingpages', () => fetchAdUrls(c, ids));
    const domains = {};
    for (const list of urls ? urls.values() : []) {
      for (const u of list) {
        const host = u.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
        domains[host] = (domains[host] || 0) + 1;
      }
    }
    out.accounts.push({ account, name, tokenSource: token === process.env.META_ACCESS_TOKEN ? 'META_ACCESS_TOKEN' : 'eigenes Token (_2 …)', steps, landingpageDomains: domains });
  }
  return out;
}

/** Rückwärtskompatibel: nur die Placement-Records (für aggregateFb). */
export async function fetchMetaInsights() {
  const all = await fetchMetaAll();
  return all ? all.records : null;
}

export const _internal = { normAccount, positionLabel, actionSum, mergeStatus, fetchAdUrls, urlCache, fetchStatus, statusCache, fetchDailyEntities, dailyCache };
